import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  | { hang: true };

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

export function openai(answer: unknown): Reply {
  return { body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: answer } }] }) };
}

export function anthropic(...texts: string[]): Reply {
  return { body: JSON.stringify({ content: texts.map((text) => ({ type: 'text', text })) }) };
}

export const defaultResponder: Responder = (request) => openai(defaultAnswer(request.prompt));

function promptOf(json: any): string {
  const content = json?.messages?.[0]?.content;
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

const FAKE_CLAUDE = `#!/usr/bin/env node
const { readdirSync, writeFileSync } = require('node:fs');
const { spawn } = require('node:child_process');
const mode = process.env.FAKE_CLAUDE_MODE || 'answer';
const record = (extra) => {
  if (!process.env.FAKE_CLAUDE_RECORD) return;
  writeFileSync(process.env.FAKE_CLAUDE_RECORD, JSON.stringify({
    args: process.argv.slice(2), cwd: process.cwd(), listing: readdirSync(process.cwd()), stdin, pid: process.pid, ...extra,
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
  const answer = JSON.stringify({ verdict: findings.length === 0 ? 'pass' : 'fail', findings });
  if (mode === 'sleep') {
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setTimeout(() => {}, 60000);"], { stdio: 'ignore' });
    record({ child: child.pid });
    setTimeout(() => {}, 60000);
    return;
  }
  record({});
  if (mode === 'error') {
    process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'Not logged in' }));
    process.exit(1);
  }
  const keys = [process.env.LAWCHECK_REVIEWER_KEY, process.env.ANTHROPIC_API_KEY].join(' and ');
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
  if (mode === 'raw') {
    process.stdout.write(answer + '\\n');
    return;
  }
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: answer }) + '\\n');
});
`;

export function writeFakeClaude(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'claude');
  writeFileSync(path, FAKE_CLAUDE);
  chmodSync(path, 0o755);
  // npm installs claude on Windows as a .cmd file of this shape.
  if (process.platform === 'win32') writeFileSync(`${path}.cmd`, `@"${process.execPath}" "${path}" %*\r\n`);
  return dir;
}
