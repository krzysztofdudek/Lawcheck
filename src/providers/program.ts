import { execFileSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killGroup, releaseFolder, releaseGroup, watchFolder, watchGroup } from '../rules.js';
import { findProgram, startProgram, trace } from '../programs.js';
import { MAX_REPLY_BYTES } from './http.js';
import { variable } from './index.js';
import type { Asked, Env, Provider } from './index.js';
import { hide } from '../keys.js';

const KILL_AFTER_MS = 5000;
const CLOSE_GRACE_MS = 2000;
const FAILURE_LENGTH = 300;
const STDERR_KEPT = 64 * 1024;

export const LAWCHECK_VARIABLES = ['LAWCHECK_REVIEWER_ENDPOINT', 'LAWCHECK_REVIEWER_KEY'];

// A sign-in variable that holds a command which prints a key, not a key.
const NOT_KEYS = ['COPILOT_PROVIDER_API_KEY_COMMAND'];

// The variables each program documents for its own sign-in; a program gets its own and no other's.
export const SIGN_IN_VARIABLES: Record<string, string[]> = {
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_PROVIDER_API_KEY', 'COPILOT_PROVIDER_API_KEY_COMMAND', 'COPILOT_PROVIDER_BEARER_TOKEN'],
};

export interface Ended {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

export type Prepared = { args: string[] } | { failure: string; resend: false; fix: string };

export interface Program {
  name: string;
  args: (aside: string | null, extra: string[]) => string[];
  read: (ended: Ended) => Asked;
  aside?: Record<string, string>;
  find?: (env: Env) => string | null;
  prepare?: (list: (args: string[]) => Promise<Asked>) => Promise<Prepared>;
}

export function lastLine(text: string): string | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.length === 0 ? null : lines[lines.length - 1]!.trim();
}

export function failure(name: string, ended: Ended, first: string | null = null): Asked {
  const reason =
    first ??
    lastLine(ended.stderr) ??
    lastLine(ended.stdout) ??
    (ended.signal === null ? `${name} exited with ${ended.code}` : `${name} was ended by ${ended.signal}`);
  return { failure: [...hide(reason)].slice(0, FAILURE_LENGTH).join(''), resend: false, fix: `do what ${name} says, such as signing in or naming a model it has` };
}

export function plainOutput(name: string): (ended: Ended) => Asked {
  return (ended) => (ended.code === 0 ? { answer: ended.stdout } : failure(name, ended));
}

export function hiddenFrom(program: string): string[] {
  return [...LAWCHECK_VARIABLES, ...Object.entries(SIGN_IN_VARIABLES).flatMap(([name, variables]) => (name === program ? [] : variables))];
}

export function programEnv(env: Env, program: string, platform: NodeJS.Platform = process.platform): Env {
  const hiddenNames = hiddenFrom(program);
  const hidden = (key: string) => hiddenNames.includes(platform === 'win32' ? key.toUpperCase() : key);
  return Object.fromEntries(Object.entries(env).filter(([key]) => !hidden(key)));
}

export function programProvider(program: Program, env: Env, timeoutSeconds: number): Provider {
  const find = program.find ?? ((e: Env) => findProgram(program.name, e));
  const missing = `the program ${program.name} is not on PATH`;
  const fix = `install ${program.name}, or put the folder that holds it on PATH`;
  const own = programEnv(env, program.name);
  let binary: string | null = null;
  let prepared: Promise<Prepared> | null = null;
  return {
    keys: (SIGN_IN_VARIABLES[program.name] ?? []).filter((name) => !NOT_KEYS.includes(name)).map((name) => variable(env, name)).filter((key): key is string => key !== null),
    ready() {
      binary = find(env);
      return binary === null ? missing : null;
    },
    fix: () => fix,
    async ask(prompt, seconds) {
      const found = binary ?? find(env);
      if (found === null) return { failure: missing, resend: false, fix };
      const deadline = Date.now() + Math.min(timeoutSeconds, seconds ?? timeoutSeconds) * 1000;
      let extra: string[] = [];
      if (program.prepare !== undefined) {
        const listFix = `run ${program.name} mcp list --json and fix what it says`;
        const read = (ended: Ended): Asked => (ended.code === 0 ? { answer: ended.stdout } : { ...failure(program.name, ended), fix: listFix });
        const list = (args: string[]) => run({ ...program, args: () => args, read }, found, [], '', own, deadline - Date.now(), timeoutSeconds);
        prepared ??= program.prepare(list);
        const done = await prepared;
        if ('failure' in done) return done;
        extra = done.args;
      }
      const left = deadline - Date.now();
      if (left <= 0) return timedOut(program.name, timeoutSeconds);
      return run(program, found, extra, prompt, own, left, timeoutSeconds);
    },
  };
}

export const CALL_VARIABLE = 'LAWCHECK_REVIEW_CALL';

// A process that left the program's group is found by the variable it inherited; Windows lets no process read another's environment.
function marked(call: string): number[] {
  if (process.platform === 'darwin') return markedOnMac(`${CALL_VARIABLE}=${call}`);
  if (!existsSync('/proc/self/environ')) return [];
  const mark = `${CALL_VARIABLE}=${call}\0`;
  const found: number[] = [];
  for (const entry of readdirSync('/proc')) {
    const pid = Number(entry);
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    try {
      if (readFileSync(`/proc/${pid}/environ`, 'latin1').includes(mark)) found.push(pid);
    } catch {
      continue;
    }
  }
  return found;
}

function timedOut(name: string, timeoutSeconds: number): Asked {
  return {
    failure: `${name} gave no answer within ${timeoutSeconds} seconds`,
    resend: false,
    fix: `raise reviewer.timeout in .lawcheck/config.yaml, or check that ${name} answers when started by hand`,
  };
}

// macOS has no /proc; its ps shows a process's environment after its command with -E, and -ww keeps the line whole.
function markedOnMac(mark: string): number[] {
  let listed: string;
  try {
    listed = execFileSync('ps', ['-A', '-E', '-ww', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    listed = String((error as { stdout?: unknown }).stdout ?? '');
  }
  const found: number[] = [];
  for (const line of listed.split('\n')) {
    const pid = Number.parseInt(line, 10);
    if (Number.isInteger(pid) && pid !== process.pid && (line.includes(`${mark} `) || line.endsWith(mark))) found.push(pid);
  }
  return found;
}

function folderFailure(name: string, error: unknown): Asked {
  return {
    failure: `a folder for ${name} cannot be made in ${tmpdir()} (${(error as NodeJS.ErrnoException).code ?? 'an error'})`,
    resend: false,
    fix: 'set TMPDIR (TEMP on Windows) to a folder that exists and can be written',
  };
}

function run(program: Program, binary: string, extra: string[], prompt: string, env: Env, limitMs: number, timeoutSeconds: number): Promise<Asked> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (asked: Asked) => {
      if (settled) return;
      settled = true;
      resolve(asked);
    };
    let dir: string;
    try {
      dir = mkdtempSync(join(tmpdir(), `lawcheck-${program.name}-`));
    } catch (error) {
      return settle(folderFailure(program.name, error));
    }
    watchFolder(dir);
    let aside: string | null = null;
    if (program.aside !== undefined) {
      try {
        aside = mkdtempSync(join(tmpdir(), `lawcheck-${program.name}-aside-`));
        watchFolder(aside);
        for (const [name, text] of Object.entries(program.aside)) writeFileSync(join(aside, name), text);
      } catch (error) {
        releaseFolder(dir);
        if (aside !== null) releaseFolder(aside);
        return settle(folderFailure(program.name, error));
      }
    }
    const out: Buffer[] = [];
    let outBytes = 0;
    let tooLarge = false;
    let stderr = '';
    let exited: { code: number | null; signal: string | null } | null = null;
    let closed = false;
    let cleaned = false;
    let spawnError: string | null = null;
    let killTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const call = randomUUID();
    const child = startProgram(binary, program.args(aside, extra), { cwd: dir, env: { ...env, [CALL_VARIABLE]: call }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
    const pid = child.pid;
    trace('tool', `started ${program.name} as ${pid}`);
    if (pid !== undefined) watchGroup(pid);

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(graceTimer);
      for (const escaped of marked(call)) {
        try {
          process.kill(escaped, 'SIGKILL');
        } catch {
          continue;
        }
      }
      if (pid !== undefined) releaseGroup(pid);
      child.stdout.destroy();
      child.stderr.destroy();
      for (const folder of aside === null ? [dir] : [dir, aside]) {
        try {
          releaseFolder(folder);
        } catch {
          // Windows keeps the working folder of a process that still runs; the guard removes it when the tool ends.
        }
      }
    };
    const outcome = (): Asked => {
      if (spawnError !== null) return { failure: `${program.name} cannot be started: ${spawnError}`, resend: false, fix: `install ${program.name}, or put the folder that holds it on PATH` };
      if (tooLarge) {
        return {
          failure: `${program.name} wrote more than ${MAX_REPLY_BYTES / 1024 / 1024} MiB on standard output, so its answer is not read`,
          resend: false,
          fix: `check that the program ${binary} is ${program.name}`,
        };
      }
      return program.read({ code: exited?.code ?? null, signal: exited?.signal ?? null, stdout: Buffer.concat(out).toString('utf8'), stderr });
    };
    const finish = () => {
      cleanup();
      settle(outcome());
    };

    const timer = setTimeout(() => {
      if (exited !== null) return finish();
      settle(timedOut(program.name, timeoutSeconds));
      if (pid !== undefined) killGroup(pid, 'SIGTERM');
      killTimer = setTimeout(() => {
        if (pid !== undefined) killGroup(pid, 'SIGKILL');
        cleanup();
      }, KILL_AFTER_MS);
      killTimer.unref();
    }, limitMs);

    child.stdout.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      outBytes += chunk.byteLength;
      if (outBytes > MAX_REPLY_BYTES) {
        tooLarge = true;
        out.length = 0;
        if (pid !== undefined) killGroup(pid, 'SIGKILL');
        return;
      }
      out.push(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr = (stderr + chunk).slice(-STDERR_KEPT)));
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => {
      spawnError = error.message;
      exited ??= { code: null, signal: null };
      closed = true;
      finish();
    });
    child.on('exit', (code, signal) => {
      exited = { code, signal };
      if (settled) return cleanup();
      if (pid !== undefined) killGroup(pid, 'SIGKILL');
      if (closed) return finish();
      graceTimer ??= setTimeout(finish, CLOSE_GRACE_MS);
    });
    child.on('close', () => {
      closed = true;
      if (exited !== null && !settled) finish();
    });

    child.stdin.end(prompt);
  });
}
