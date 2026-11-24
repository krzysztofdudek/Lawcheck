import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { alive, F, F_PATH, LAW, pathWith, programDir, setRule, startLawcheck, withR, withSample, write } from '../acceptance/helpers.ts';
import { writeFakeClaude } from '../acceptance/fake-reviewer.ts';
import { platformSkip } from '../harness/tool.ts';
import type { Expect, Running } from '../harness/tool.ts';
import { LIMITS_STOPPED_MS } from '../numbers.ts';
import { run } from './support.ts';

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

function stoppedBy(signal: string): string {
  return ['lawcheck: ERROR  1 error', '', `error[stopped]  stopped by ${signal}`, '  why:  a run stopped before its end says nothing about the code', '', 'next: run lawcheck check again and let it end', ''].join('\n');
}

function start(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}, expect: Expect = {}): Running {
  return startLawcheck(cwd, args, { ...expect, env });
}

async function until(condition: () => boolean, what: string, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 20));
  }
}

async function stop(running: Running, signal: (typeof SIGNALS)[number]): Promise<void> {
  const sent = Date.now();
  running.kill(signal);
  const result = await running.ended;
  const ms = Date.now() - sent;
  process.stdout.write(`# ${signal}: the run ended ${ms} ms after the signal\n`);
  assert.equal(result.stdout, stoppedBy(signal), signal);
  assert.equal(result.code, 2, signal);
  assert.ok(ms <= LIMITS_STOPPED_MS, `${signal}: ${ms} ms`);
}

// The content pattern backtracks exponentially on a line of a's that ends in another character, so typing the file never ends by itself.
const HEAVY_LAW = `${LAW}  slow:\n    paths: ["slow/**"]\n    content: "^(a|a)+$"\n`;

test('test 239: S1-1, R-28, a signal while files are typed against a heavy pattern ends the run as stopped', async (t) => {
  const skipped = platformSkip('the whole test');
  if (skipped !== null) return t.skip(skipped);
  for (const signal of SIGNALS) {
    await withSample(
      async (s, dir) => {
        const mark = join(dir, 'listed');
        const fakeGit = join(dir, 'bin');
        write(dir, 'bin/git', `#!/bin/sh\ncase "$*" in *"ls-files -z --cached"*) : > "${mark}";; esac\nexec "${join(programDir('git'), 'git')}" "$@"\n`);
        chmodSync(join(fakeGit, 'git'), 0o755);
        write(s, 'slow/a.ts', `${'a'.repeat(80)}!\n`);
        const running = start(s, ['check', '--base', 'main'], { PATH: pathWith(fakeGit) }, { outside: ['listed'] });
        await until(() => existsSync(mark), 'the files to be listed');
        await stop(running, signal);
      },
      { onMain: (s) => writeFileSync(join(s, '.lawcheck/law.yaml'), HEAVY_LAW) },
    );
  }
});

test('test 239: S1-1, a signal while a rule spins ends the run as stopped, and the runner with it', async (t) => {
  const skipped = platformSkip('the whole test');
  if (skipped !== null) return t.skip(skipped);
  const spin = "export function check() { console.error('runner ' + process.pid); while (true) {} }\n";
  for (const signal of SIGNALS) {
    await withSample(
      async (s) => {
        write(s, 'src/core/discount.ts', 'export const d = 1;\n');
        const running = start(s, ['check', '--base', 'main'], {}, { stderr: /^runner \d+\n$/ });
        const pid = Number((await running.output(/^runner (\d+)$/m, 'stderr'))[1]);
        await stop(running, signal);
        await until(() => !alive(pid), `runner ${pid} to end`, 5000);
      },
      { onMain: (s) => setRule(s, 'no-console', spin) },
    );
  }
});

// The fake sends the first half of an answer of one megabyte and holds the rest, so the signal always comes while the answer is read.
test('test 239: S3-3, a signal while a one-megabyte answer is read ends the run as stopped', async (t) => {
  const skipped = platformSkip('the whole test');
  if (skipped !== null) return t.skip(skipped);
  const body = JSON.stringify({ choices: [{ message: { role: 'assistant', content: `${'{'.repeat(1_000_000)}{"verdict":"pass","findings":[]}` } }] });
  for (const signal of SIGNALS) {
    let halfSent = false;
    const sockets = new Set<import('node:net').Socket>();
    const server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) });
        res.write(body.slice(0, body.length / 2), () => (halfSent = true));
      });
    });
    server.on('connection', (socket) => sockets.add(socket));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
    try {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
        const running = start(r, ['check', '--review', '--base', 'main'], { LAWCHECK_REVIEWER_ENDPOINT: url }, { stderr: /^lawcheck: 1 reviewer call to openai-compatible\n$/ });
        await until(() => halfSent, 'half of the answer to be sent');
        await stop(running, signal);
      });
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    }
  }
});

// A signal is answered from the moment the entry module runs, so the main thread loads only the modules the answer needs; the rest load in the worker.
const LOAD_HOOK = [
  "import { registerHooks } from 'node:module';",
  "import { threadId } from 'node:worker_threads';",
  "import { appendFileSync } from 'node:fs';",
  "registerHooks({ load(url, context, next) { if (threadId === 0 && url.startsWith('file:')) appendFileSync(process.env.LAWCHECK_TEST_LOADS, url.split('/').pop() + '\\n'); return next(url, context); } });",
  '',
].join('\n');

test('test 257: the main thread loads only what answers a signal, and the command loads in the worker', async () => {
  await withSample(async (s, dir) => {
    const hook = join(dir, 'hook.mjs');
    const loads = join(dir, 'loads.txt');
    writeFileSync(hook, LOAD_HOOK);
    writeFileSync(loads, '');
    const result = await run(s, ['check', '--base', 'main'], { env: { LAWCHECK_TEST_LOADS: loads }, node: ['--import', pathToFileURL(hook).href], outside: ['loads.txt'] });
    assert.equal(result.stdout, 'lawcheck: PASS  nothing changed against main\n');
    assert.equal(result.code, 0);
    assert.deepEqual([...new Set(readFileSync(loads, 'utf8').split('\n').filter(Boolean))].sort(), ['args.js', 'cli.js', 'keys.js', 'limits.js', 'output.js', 'programs.js', 'progress.js']);
  });
});

test('test 258: a signal while git runs ends the run as stopped within two seconds, and git with it', async (t) => {
  const skipped = platformSkip('the whole test');
  if (skipped !== null) return t.skip(skipped);
  for (const signal of SIGNALS) {
    await withSample(async (s, dir) => {
      const pidFile = join(dir, 'git.pid');
      write(dir, 'bin/git', `#!/bin/sh\ncase "$*" in *"ls-files -z --cached"*) echo $$ > "${pidFile}"; exec sleep 30;; esac\nexec "${join(programDir('git'), 'git')}" "$@"\n`);
      chmodSync(join(dir, 'bin', 'git'), 0o755);
      const running = start(s, ['check', '--base', 'main'], { PATH: pathWith(join(dir, 'bin')) }, { outside: ['git.pid'] });
      await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').endsWith('\n'), 'git to start');
      const pid = Number(readFileSync(pidFile, 'utf8'));
      await stop(running, signal);
      await until(() => !alive(pid), `git ${pid} to end`, 2000);
    });
  }
});

// The hook holds the worker two seconds before its first module, as a starved processor does; the step watch must count from the start of the command, not from the worker's first beat.
const SLOW_WORKER = [
  "import { registerHooks } from 'node:module';",
  "import { threadId } from 'node:worker_threads';",
  'let held = false;',
  "registerHooks({ load(url, context, next) { if (threadId !== 0 && !held) { held = true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000); } return next(url, context); } });",
  '',
].join('\n');

test('test 270: a worker slow to start is no step past its limit, since the watch starts with the command', async () => {
  await withSample(async (s, dir) => {
    const hook = join(dir, 'slow.mjs');
    writeFileSync(hook, SLOW_WORKER);
    const result = await run(s, ['check', '--base', 'main'], { node: ['--import', pathToFileURL(hook).href] });
    assert.equal(result.stdout, 'lawcheck: PASS  nothing changed against main\n');
    assert.equal(result.stderr, '');
    assert.equal(result.code, 0);
  });
});

// The hook holds the worker once the index is copied into its temporary folder, so the kill lands while that folder exists.
const HOLD_COPY = [
  "import fs from 'node:fs';",
  "import { syncBuiltinESMExports } from 'node:module';",
  'const copy = fs.copyFileSync;',
  "fs.copyFileSync = (from, to, mode) => { copy(from, to, mode); if (String(to).includes('lawcheck-index-')) { fs.writeFileSync(process.env.LAWCHECK_TEST_COPIED, ''); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000); } };",
  'syncBuiltinESMExports();',
  '',
].join('\n');

test('test 252: R-112, a run killed with SIGKILL while git reads its copy of the index leaves nothing in the temporary directory', async () => {
  await withSample(async (s, dir) => {
    const hook = join(dir, 'hold.mjs');
    const copied = join(dir, 'copied');
    writeFileSync(hook, HOLD_COPY);
    const running = startLawcheck(s, ['check', '--base', 'main'], { env: { LAWCHECK_TEST_COPIED: copied }, node: ['--import', pathToFileURL(hook).href], outside: ['copied'] });
    await until(() => existsSync(copied), 'the copy of the index');
    running.kill('SIGKILL');
    const result = await running.ended;
    assert.equal(result.signal, 'SIGKILL');
    assert.equal(result.stdout, '');
  });
});

// The hook holds the worker right after a folder of a reviewer program is made, whether by mkdtemp or by mkdir, so the kill lands between the making of the folder and the end of the call.
const HOLD_PROGRAM_FOLDER = [
  "import fs from 'node:fs';",
  "import { syncBuiltinESMExports } from 'node:module';",
  'const hold = (path) => { if (String(path).includes("lawcheck-claude-")) { fs.writeFileSync(process.env.LAWCHECK_TEST_MADE, ""); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000); } };',
  'const mkdtemp = fs.mkdtempSync;',
  'fs.mkdtempSync = (prefix, options) => { const made = mkdtemp(prefix, options); hold(made); return made; };',
  'const mkdir = fs.mkdirSync;',
  'fs.mkdirSync = (path, options) => { const made = mkdir(path, options); hold(path); return made; };',
  'syncBuiltinESMExports();',
  '',
].join('\n');

test('R-113: a run killed with SIGKILL right after the folder of a reviewer program is made leaves nothing in the temporary directory', async () => {
  await withR(
    async (r, dir) => {
      const hook = join(dir, 'hold.mjs');
      const made = join(dir, 'made');
      writeFileSync(hook, HOLD_PROGRAM_FOLDER);
      write(r, F_PATH, F);
      const bin = writeFakeClaude(join(dir, 'bin'));
      const running = startLawcheck(r, ['check', '--review', '--base', 'main'], { env: { PATH: pathWith(bin), LAWCHECK_TEST_MADE: made }, node: ['--import', pathToFileURL(hook).href], outside: ['made'] });
      await until(() => existsSync(made), 'the folder of the reviewer program');
      running.kill('SIGKILL');
      const result = await running.ended;
      assert.equal(result.signal, 'SIGKILL');
      assert.equal(result.stdout, '');
    },
    { onMain: (r: string) => write(r, '.lawcheck/config.yaml', 'reviewer:\n  provider: claude-code\n  model: test-model\n') },
  );
});
