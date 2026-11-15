import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killGroup, releaseFolder, releaseGroup, watchFolder, watchGroup } from '../rules.js';
import { findProgram, startProgram } from '../programs.js';
import type { Asked, Env, Provider } from './index.js';

const KILL_AFTER_MS = 5000;
const CLOSE_GRACE_MS = 2000;
const FAILURE_LENGTH = 300;

export interface Ended {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

export interface Program {
  name: string;
  args: (aside: string | null) => string[];
  read: (ended: Ended) => Asked;
  aside?: Record<string, string>;
  find?: (env: Env) => string | null;
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
  return { failure: reason.slice(0, FAILURE_LENGTH), resend: false };
}

export function plainOutput(name: string): (ended: Ended) => Asked {
  return (ended) => (ended.code === 0 ? { answer: ended.stdout } : failure(name, ended));
}

export function programProvider(program: Program, env: Env, timeoutSeconds: number): Provider {
  const find = program.find ?? ((e: Env) => findProgram(program.name, e));
  const missing = `the program ${program.name} is not on PATH`;
  let binary: string | null = null;
  return {
    ready() {
      binary = find(env);
      return binary === null ? missing : null;
    },
    ask(prompt) {
      const found = binary ?? find(env);
      if (found === null) return Promise.resolve({ failure: missing, resend: false });
      return run(program, found, prompt, env, timeoutSeconds * 1000);
    },
  };
}

function run(program: Program, binary: string, prompt: string, env: Env, timeoutMs: number): Promise<Asked> {
  return new Promise((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), `lawcheck-${program.name}-`));
    watchFolder(dir);
    let aside: string | null = null;
    if (program.aside !== undefined) {
      aside = mkdtempSync(join(tmpdir(), `lawcheck-${program.name}-aside-`));
      watchFolder(aside);
      for (const [name, text] of Object.entries(program.aside)) writeFileSync(join(aside, name), text);
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let killed = false;
    let exited: { code: number | null; signal: string | null } | null = null;
    let closed = false;
    let spawnError: string | null = null;
    let timer: NodeJS.Timeout | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const child = startProgram(binary, program.args(aside), { cwd: dir, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
    const pid = child.pid;
    if (pid !== undefined) watchGroup(pid);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      clearTimeout(graceTimer);
      if (pid !== undefined) releaseGroup(pid);
      child.stdout.destroy();
      child.stderr.destroy();
      releaseFolder(dir);
      if (aside !== null) releaseFolder(aside);
      if (spawnError !== null) resolve({ failure: `${program.name} cannot be started: ${spawnError}`, resend: false });
      else if (timedOut) resolve({ failure: `${program.name} gave no answer within ${timeoutMs / 1000} seconds`, resend: false });
      else resolve(program.read({ code: exited?.code ?? null, signal: exited?.signal ?? null, stdout, stderr }));
    };
    const maybeFinish = () => {
      if (settled || exited === null) return;
      if (timedOut && !killed) return;
      if (closed) return finish();
      if (graceTimer === undefined) graceTimer = setTimeout(finish, CLOSE_GRACE_MS);
    };

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.stdin.on('error', () => undefined);
    child.on('error', (error) => {
      spawnError = error.message;
      exited ??= { code: null, signal: null };
      closed = true;
      maybeFinish();
    });
    child.on('exit', (code, signal) => {
      exited = { code, signal };
      if (pid !== undefined && !timedOut) killGroup(pid, 'SIGKILL');
      maybeFinish();
    });
    child.on('close', () => {
      closed = true;
      maybeFinish();
    });

    timer = setTimeout(() => {
      timedOut = true;
      if (pid !== undefined) killGroup(pid, 'SIGTERM');
      killTimer = setTimeout(() => {
        killed = true;
        if (pid !== undefined) killGroup(pid, 'SIGKILL');
        maybeFinish();
      }, KILL_AFTER_MS);
    }, timeoutMs);

    child.stdin.end(prompt);
  });
}
