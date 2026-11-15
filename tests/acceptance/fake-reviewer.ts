import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { programDir } from './helpers.ts';

export const FAILED_MESSAGE = 'the message says neither what happened nor what to do next';

export interface Recorded {
  index: number;
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: any;
  prompt: string;
  start: number;
  end: number;
}

export type Reply =
  | { status?: number; headers?: Record<string, string>; body: string; delayMs?: number }
  | { close: true }
  | { hang: true }
  | { cut: string };

export type Responder = (request: Recorded, fake: Fake) => Reply | Promise<Reply>;

export interface Fake {
  base: string;
  url: string;
  requests: Recorded[];
  respond: Responder;
  close(): Promise<void>;
  maxInFlight(): number;
}

export function fileLines(prompt: string): { line: number; text: string }[] {
  const start = prompt.lastIndexOf('\n<file path=');
  const end = prompt.lastIndexOf('\n</file>');
  if (start < 0 || end < 0) return [];
  const body = prompt.slice(prompt.indexOf('\n', start + 1) + 1, end + 1);
  return body
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const bar = line.indexOf('|');
      return { line: Number(line.slice(0, bar)), text: line.slice(bar + 2) };
    });
}

export function filePath(prompt: string): string {
  const match = prompt.match(/\n<file path=("(?:[^"\\]|\\.)*")>\n/);
  return match ? (JSON.parse(match[1]!) as string) : '';
}

export function defaultAnswer(prompt: string): string {
  const findings = fileLines(prompt)
    .filter(({ text }) => text.includes("Error('failed')"))
    .map(({ line }) => ({ line, message: FAILED_MESSAGE }));
  return JSON.stringify({ verdict: findings.length === 0 ? 'pass' : 'fail', findings });
}

// The reply shapes follow each vendor's documented API: OpenAI's chat completions (choices[].message.content), Anthropic's messages (content[] of type text), Google's generateContent (candidates[].content.parts[].text), Ollama's /api/chat with stream false (message.content).
export function openai(answer: unknown): Reply {
  return { body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: answer } }] }) };
}

export function anthropic(...texts: string[]): Reply {
  return { body: JSON.stringify({ content: texts.map((text) => ({ type: 'text', text })) }) };
}

export function google(...texts: string[]): Reply {
  return { body: JSON.stringify({ candidates: [{ content: { role: 'model', parts: texts.map((text) => ({ text })) }, finishReason: 'STOP' }] }) };
}

export function ollama(answer: unknown): Reply {
  return { body: JSON.stringify({ model: 'test-model', created_at: '2026-11-15T00:00:00Z', message: { role: 'assistant', content: answer }, done: true, done_reason: 'stop' }) };
}

export const defaultResponder: Responder = (request) => openai(defaultAnswer(request.prompt));

function promptOf(json: any): string {
  const content = json?.messages?.[0]?.content ?? json?.contents?.[0]?.parts?.[0]?.text;
  return typeof content === 'string' ? content : '';
}

export async function startFake(respond: Responder = defaultResponder): Promise<Fake> {
  const requests: Recorded[] = [];
  const open = new Set<import('node:net').Socket>();
  let inFlight = 0;
  let maxInFlight = 0;
  const fake: Fake = {
    base: '',
    url: '',
    requests,
    respond,
    close: () =>
      new Promise((done) => {
        for (const socket of open) socket.destroy();
        server.close(() => done());
      }),
    maxInFlight: () => maxInFlight,
  };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let json: any = null;
      try {
        json = JSON.parse(body);
      } catch {
        json = null;
      }
      const recorded: Recorded = {
        index: requests.length,
        method: req.method ?? '',
        path: req.url ?? '',
        headers: { ...req.headers },
        body,
        json,
        prompt: promptOf(json),
        start: Date.now(),
        end: 0,
      };
      requests.push(recorded);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const reply = await fake.respond(recorded, fake);
      if ('hang' in reply) return;
      if ('close' in reply) {
        inFlight--;
        recorded.end = Date.now();
        req.socket.destroy();
        return;
      }
      if ('cut' in reply) {
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(reply.cut) * 2) });
        res.write(reply.cut, () => {
          inFlight--;
          recorded.end = Date.now();
          req.socket.destroy();
        });
        return;
      }
      if (reply.delayMs) await new Promise((done) => setTimeout(done, reply.delayMs));
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers });
      res.end(reply.body, () => {
        inFlight--;
        recorded.end = Date.now();
      });
    });
  });
  server.on('connection', (socket) => {
    open.add(socket);
    socket.on('close', () => open.delete(socket));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const port = (server.address() as AddressInfo).port;
  fake.base = `http://127.0.0.1:${port}`;
  fake.url = `${fake.base}/v1`;
  return fake;
}

export async function withFake<T>(body: (fake: Fake) => Promise<T>, respond?: Responder): Promise<T> {
  const fake = await startFake(respond);
  try {
    return await body(fake);
  } finally {
    await fake.close();
  }
}

// The fake claude prints the envelope of `claude --print --output-format json`. The fake codex prints what `codex exec` prints on standard output, the final message alone, with its errors on standard error (codex-cli 0.169.0). The fake gemini follows the headless mode of the Gemini CLI with `--output-format text`: the reply alone on standard output, exit 1 for a failed call, 42 for a bad input, 53 for a turn limit (gemini-cli docs/cli/headless.md). The fake copilot follows `copilot --silent` with the prompt on standard input: the answer alone, a failure on standard error with exit 1 (Copilot CLI 1.0.111).
function fakeScript(name: string): string {
  const upper = name.toUpperCase();
  return `#!/usr/bin/env node
const { readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const envelope = ${JSON.stringify(name === 'claude')};
const mode = process.env.FAKE_${upper}_MODE || 'answer';
const args = process.argv.slice(2);
if (args[0] === 'mcp' && args[1] === 'list' && args[2] === '--json') {
  if (process.env.FAKE_${upper}_LISTED) require('node:fs').appendFileSync(process.env.FAKE_${upper}_LISTED, 'listed\\n');
  if (process.env.FAKE_${upper}_LIST_DELAY) require('node:child_process').execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, ' + Number(process.env.FAKE_${upper}_LIST_DELAY) + ')']);
  if (mode === 'list-fails') {
    process.stderr.write('no config\\n');
    process.exit(2);
  }
  process.stdout.write(process.env.FAKE_${upper}_MCP ?? ${JSON.stringify(name === 'copilot' ? '{"mcpServers":{}}' : '[]')});
  process.exit(0);
}
const record = (extra) => {
  if (!process.env.FAKE_${upper}_RECORD) return;
  const policy = args.indexOf('--policy');
  writeFileSync(process.env.FAKE_${upper}_RECORD, JSON.stringify({
    args, cwd: process.cwd(), listing: readdirSync(process.cwd()), stdin, pid: process.pid, env: process.env,
    policy: policy < 0 ? null : readFileSync(args[policy + 1], 'utf8'), ...extra,
  }));
};
let stdin = '';
if (mode === 'expired') {
  process.stderr.write('expired\\n');
  process.exit(1);
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (stdin += chunk));
process.stdin.on('end', () => {
  if (process.env.FAKE_${upper}_ASKED) require('node:fs').appendFileSync(process.env.FAKE_${upper}_ASKED, 'asked\\n');
  const lines = [];
  const start = stdin.lastIndexOf('\\n<file path=');
  const end = stdin.lastIndexOf('\\n</file>');
  if (start >= 0 && end >= 0) {
    for (const line of stdin.slice(stdin.indexOf('\\n', start + 1) + 1, end + 1).split('\\n')) {
      if (line === '') continue;
      const bar = line.indexOf('|');
      lines.push({ line: Number(line.slice(0, bar)), text: line.slice(bar + 2) });
    }
  }
  const findings = lines.filter((l) => l.text.includes("Error('failed')")).map((l) => ({ line: l.line, message: ${JSON.stringify(FAILED_MESSAGE)} }));
  const answer = process.env.FAKE_${upper}_ANSWER ?? JSON.stringify({ verdict: findings.length === 0 ? 'pass' : 'fail', findings });
  if (mode === 'sleep') {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60000);"], { stdio: 'ignore' });
    record({ child: child.pid });
    setTimeout(() => {}, 60000);
    return;
  }
  record({});
  if (mode === 'error') {
    if (envelope) process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' }));
    else process.stderr.write('starting\\nNot logged in\\n');
    process.exit(1);
  }
  // A program gets its own sign-in variables and never LAWCHECK_REVIEWER_KEY (spec/reviewer-slice.md, decision 25), so the fake echoes two of claude's.
  const keys = [process.env.ANTHROPIC_AUTH_TOKEN, process.env.ANTHROPIC_API_KEY].join(' and ');
  if (mode === 'echo-error') {
    process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'Invalid API key: ' + keys }));
    process.exit(1);
  }
  if (mode === 'echo-stderr') {
    process.stderr.write('rejected ' + keys + '\\n');
    process.exit(3);
  }
  if (mode === 'echo-answer') {
    process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify({ verdict: 'fail', findings: [{ line: 1, message: 'the key is ' + keys }] }) }) + '\\n');
    return;
  }
  if (mode === 'boom') {
    process.stderr.write('boom\\n');
    process.exit(3);
  }
  if (mode.startsWith('exit-')) {
    process.stderr.write('ended with ' + mode.slice(5) + '\\n');
    process.exit(Number(mode.slice(5)));
  }
  if (mode === 'silent-exit') process.exit(1);
  if (mode === 'killed') {
    process.stdout.write(answer.slice(0, 10));
    process.kill(process.pid, 'SIGKILL');
    return;
  }
  if (mode === 'cut') {
    process.stdout.write(answer.slice(0, Math.floor(answer.length / 2)));
    return;
  }
  if (mode === 'large') {
    process.stdout.write('x'.repeat(3 * 1024 * 1024));
    return;
  }
  if (mode === 'huge') {
    process.stdout.write('x'.repeat(4 * 1024 * 1024 + 1));
    return;
  }
  if (mode === 'escape') {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000);'], { detached: true, stdio: 'ignore' });
    child.unref();
    record({ child: child.pid });
    process.stdout.write(answer + '\\n');
    process.exit(0);
  }
  if (mode === 'late') {
    setTimeout(() => process.stdout.write(answer + '\\n'), Number(process.env.FAKE_${upper}_DELAY));
    return;
  }
  if (mode === 'setsid') {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000);'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
    record({ child: child.pid });
    process.stdout.write(answer + '\\n');
    process.exit(0);
  }
  if (mode === 'raw' || !envelope) {
    process.stdout.write(answer + '\\n');
    return;
  }
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: answer }) + '\\n');
});
`;
}

export function writeFakeProgram(dir: string, name: 'claude' | 'codex' | 'gemini' | 'copilot'): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, fakeScript(name));
  chmodSync(path, 0o755);
  // npm installs these programs on Windows as .cmd files of this shape.
  if (process.platform === 'win32') writeFileSync(`${path}.cmd`, `@"${process.execPath}" "${path}" %*\r\n`);
  return dir;
}

export function writeFakeClaude(dir: string): string {
  return writeFakeProgram(dir, 'claude');
}

export const PROGRAM_NAMES = ['claude', 'codex', 'gemini', 'copilot'];

// A folder that holds git and nothing else; on Windows git's own folder, since a link to git.exe there finds no installation.
export function gitAlone(dir: string): string {
  const gitDir = programDir('git');
  if (process.platform === 'win32') {
    for (const name of PROGRAM_NAMES) for (const ending of ['', '.cmd', '.exe']) assert.ok(!existsSync(join(gitDir, name + ending)), `${gitDir} holds ${name}${ending}`);
    return gitDir;
  }
  const alone = join(dir, 'git-alone');
  mkdirSync(alone, { recursive: true });
  symlinkSync(join(gitDir, 'git'), join(alone, 'git'));
  return alone;
}

export function whyOf(code: string): string {
  const page = readFileSync(new URL('../../docs/codes.md', import.meta.url), 'utf8');
  const row = page.split('\n').find((line) => line.startsWith(`| \`${code}\` |`));
  assert.ok(row, code);
  return row!.split(' | ').at(-1)!.replace(/ \|$/, '');
}

export function counted(path: string): number {
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).length : 0;
}
