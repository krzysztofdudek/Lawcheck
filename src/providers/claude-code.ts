import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReviewerConfig } from '../config.js';
import { killGroup, releaseFolder, releaseGroup, watchFolder, watchGroup } from '../rules.js';
import { findProgram, startProgram } from '../programs.js';
import { variable } from './index.js';
import { hide } from '../keys.js';
import type { Asked, Env, Provider } from './index.js';

const KILL_AFTER_MS = 5000;
const CLOSE_GRACE_MS = 2000;

export function claudeArguments(model: string | null): string[] {
  return [
    '--print',
    '--output-format',
    'json',
    ...(model === null ? [] : ['--model', model]),
    '--tools',
    '',
    '--disable-slash-commands',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--no-session-persistence',
  ];
}

function lastLine(text: string): string | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  return lines.length === 0 ? null : lines[lines.length - 1]!.trim();
}

export function readOutput(code: number | null, signal: string | null, stdout: string, stderr: string): Asked {
  let envelope: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(stdout.trim());
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) envelope = value as Record<string, unknown>;
  } catch {
    envelope = null;
  }
  const result = envelope !== null && typeof envelope.result === 'string' ? envelope.result : null;
  const failed = code !== 0 || envelope?.is_error === true;
  if (failed) {
    const reason = result ?? lastLine(stderr) ?? lastLine(stdout) ?? (signal === null ? `claude exited with ${code}` : `claude was ended by ${signal}`);
    return { failure: [...hide(reason)].slice(0, 300).join(''), resend: false };
  }
  return { answer: envelope?.type === 'result' && result !== null ? result : stdout };
}

export function claudeCode(config: ReviewerConfig, env: Env): Provider {
  let program: string | null = null;
  return {
    keys: ['LAWCHECK_REVIEWER_KEY', 'ANTHROPIC_API_KEY'].map((name) => variable(env, name)).filter((key): key is string => key !== null),
    ready() {
      program = findProgram('claude', env);
      return program === null ? 'the program claude is not on PATH' : null;
    },
    ask(prompt) {
      const binary = program ?? findProgram('claude', env);
      if (binary === null) return Promise.resolve({ failure: 'the program claude is not on PATH', resend: false });
      return run(binary, claudeArguments(config.model), prompt, env, config.timeout * 1000);
    },
  };
}

function run(binary: string, args: string[], prompt: string, env: Env, timeoutMs: number): Promise<Asked> {
  return new Promise((resolve) => {
    const dir = mkdtempSync(join(tmpdir(), 'lawcheck-claude-'));
    watchFolder(dir);
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

    const child = startProgram(binary, args, { cwd: dir, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildProcessWithoutNullStreams;
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
      if (spawnError !== null) resolve({ failure: `claude cannot be started: ${spawnError}`, resend: false });
      else if (timedOut) resolve({ failure: `claude gave no answer within ${timeoutMs / 1000} seconds`, resend: false });
      else resolve(readOutput(exited?.code ?? null, exited?.signal ?? null, stdout, stderr));
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
