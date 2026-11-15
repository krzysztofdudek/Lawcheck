import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openai, withFake } from '../acceptance/fake-reviewer.ts';
import { alive, CLI, F, F_PATH, GIT_ENV, LAW, pathWith, programDir, setRule, withR, withSample, write } from '../acceptance/helpers.ts';

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const WINDOWS = 'every signal ends a process on Windows at once, so the tool cannot answer it with its own exit code';
const skip = process.platform === 'win32' ? WINDOWS : false;

const STOPPED_WITHIN_MS = 2000;

function stoppedBy(signal: string): string {
  return ['lawcheck: ERROR  1 error', '', `error[stopped]  stopped by ${signal}`, '  why:  a run stopped before its end says nothing about the code', '', 'next: run lawcheck check again and let it end', ''].join('\n');
}

interface Started {
  child: ChildProcess;
  stdout(): string;
  stderr(): string;
  closed: Promise<number | null>;
}

function start(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Started {
  const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...GIT_ENV, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout!.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
  child.stderr!.setEncoding('utf8').on('data', (chunk: string) => (err += chunk));
  const closed = new Promise<number | null>((done) => child.on('close', (code) => done(code)));
  return { child, stdout: () => out, stderr: () => err, closed };
}

async function until(condition: () => boolean, what: string, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

async function stop(run: Started, signal: (typeof SIGNALS)[number]): Promise<void> {
  const sent = Date.now();
  run.child.kill(signal);
  const code = await run.closed;
  const ms = Date.now() - sent;
  process.stdout.write(`# ${signal}: the run ended ${ms} ms after the signal\n`);
  assert.equal(run.stdout(), stoppedBy(signal), signal);
  assert.equal(code, 2, signal);
  assert.ok(ms <= STOPPED_WITHIN_MS, `${signal}: ${ms} ms`);
}

// The content pattern backtracks exponentially on a line of a's that ends in another character, so typing the file never ends by itself.
const HEAVY_LAW = `${LAW}  slow:\n    paths: ["slow/**"]\n    content: "^(a|a)+$"\n`;

test('S1-1: test 239: a signal while files are typed against a heavy pattern ends the run as stopped', { skip }, async () => {
  for (const signal of SIGNALS) {
    await withSample(
      async (s, dir) => {
        const mark = join(dir, 'listed');
        const fakeGit = join(dir, 'bin');
        write(dir, 'bin/git', `#!/bin/sh\ncase "$*" in *"ls-files -z --cached"*) : > "${mark}";; esac\nexec "${join(programDir('git'), 'git')}" "$@"\n`);
        chmodSync(join(fakeGit, 'git'), 0o755);
        write(s, 'slow/a.ts', `${'a'.repeat(40)}!\n`);
        const run = start(s, ['check', '--base', 'main'], { PATH: pathWith(fakeGit) });
        await until(() => existsSync(mark), 'the files to be listed');
        await stop(run, signal);
      },
      { onMain: (s) => writeFileSync(join(s, '.lawcheck/law.yaml'), HEAVY_LAW) },
    );
  }
});

test('S1-1: test 239: a signal while a rule spins ends the run as stopped, and the runner with it', { skip }, async () => {
  const spin = "export function check() { console.error('runner ' + process.pid); while (true) {} }\n";
  for (const signal of SIGNALS) {
    await withSample(
      async (s) => {
        write(s, 'src/core/discount.ts', 'export const d = 1;\n');
        const run = start(s, ['check', '--base', 'main']);
        await until(() => /^runner \d+$/m.test(run.stderr()), 'the runner to start');
        const pid = Number(/^runner (\d+)$/m.exec(run.stderr())![1]);
        await stop(run, signal);
        await until(() => !alive(pid), `runner ${pid} to end`, 5000);
      },
      { onMain: (s) => setRule(s, 'no-console', spin) },
    );
  }
});

test('S3-3: test 239: a signal while a one-megabyte answer is read ends the run as stopped', { skip }, async () => {
  const answer = `${'{'.repeat(1_000_000)}{"verdict":"pass","findings":[]}`;
  for (const signal of SIGNALS) {
    await withFake(
      async (fake) => {
        await withR(async (r) => {
          write(r, F_PATH, F);
          const run = start(r, ['check', '--review', '--base', 'main'], { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
          await until(() => (fake.requests[0]?.end ?? 0) > 0 || run.child.exitCode !== null, 'the answer to be sent');
          if (run.child.exitCode !== null) {
            process.stdout.write(`# ${signal}: the answer was read before a signal could be sent\n`);
            assert.doesNotMatch(run.stdout(), /error\[internal\]/);
            return;
          }
          await stop(run, signal);
        });
      },
      () => openai(answer),
    );
  }
});
