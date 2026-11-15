import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync, writeSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { defaultAnswer, openai, withFake } from '../acceptance/fake-reviewer.ts';
import { alive, CLI, D, D_PATH, F_PRIME, git, GIT_ENV, inTemp, pathWith, programDir, ROOT, setRule, withR, withSample, write } from '../acceptance/helpers.ts';
import { errorLines, MiB, run } from './support.ts';

// These run nightly, on Linux, in a container of 1 GB of memory and 2 CPUs; spec/check-slice.md, section 10, holds the numbers.
const SEED = Number(process.env.LAWCHECK_SEED ?? 20261115);

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function realText(repo: string, path: string, bytes: number): void {
  const full = join(repo, path);
  mkdirSync(join(full, '..'), { recursive: true });
  const line = 'export const a = 1; // a line of text\n';
  const chunk = line.repeat(Math.floor(MiB / line.length));
  const fd = openSync(full, 'w');
  try {
    for (let written = 0; written < bytes; ) {
      const part = chunk.slice(0, Math.min(chunk.length, bytes - written));
      writeSync(fd, part);
      written += part.length;
    }
  } finally {
    closeSync(fd);
  }
}

test('test 248: 150,000 files: every one is typed and judged, and the one that breaks a rule is found', async () => {
  await withSample(async (s) => {
    for (let d = 0; d < 150; d++) {
      mkdirSync(join(s, `src/core/d${d}`), { recursive: true });
      for (let i = 0; i < 1000; i++) writeFileSync(join(s, `src/core/d${d}/f${i}.ts`), `export const v${i} = ${i};\n`);
    }
    write(s, 'src/core/d7/f7.ts', 'console.log(7);\n');
    for (const args of [['check', '--base', 'main'], ['check', '--base', 'main', '--full']]) {
      const result = await run(s, args, { budgetMs: 300_000 });
      assert.equal(result.stdout.split('\n')[0], 'lawcheck: FAIL  1 error in 150000 changed files (against main)', args.join(' '));
      assert.deepEqual(errorLines(result.stdout), ['src/core/d7/f7.ts:1  error[no-console]  writes to the terminal with console.log'], args.join(' '));
      assert.equal(result.code, 1, args.join(' '));
    }
  });
});

test('test 249: 4 GiB of text across files stops at the file that passes 128 MiB, as text-too-large', async () => {
  await inTemp(async (dir) => {
    const repo = join(dir, 'r');
    write(repo, '.lawcheck/law.yaml', 'lawcheck: 0.1.0\ntypes:\n  big:\n    paths: ["big/**"]\n');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'law');
    for (let i = 1; i <= 256; i++) realText(repo, `big/t${String(i).padStart(3, '0')}.ts`, 16 * MiB);
    const result = await run(repo, ['check', '--base', 'main'], { budgetMs: 300_000 });
    assert.deepEqual(errorLines(result.stdout), ['big/t009.ts  error[text-too-large]  the text of the files read in this run reaches 150,994,944 bytes with this file, more than the 128 MiB one run may read']);
    assert.equal(result.code, 2);
  });
});

test('S1-4: S5-2: test 250: a text file of 600 MB written whole is file-too-large in check, doctor, explain and try', async () => {
  await withSample(async (s) => {
    realText(s, 'src/core/huge.ts', 600_000_000);
    const line = 'src/core/huge.ts  error[file-too-large]  the file holds 600,000,000 bytes, more than the 16 MiB a file read as text may hold';
    for (const args of [['check', '--base', 'main', '--full'], ['explain', 'src/core/huge.ts'], ['try', 'no-todo', 'src/core/tax.ts']]) {
      const result = await run(s, args, { budgetMs: 120_000 });
      assert.deepEqual(errorLines(result.stdout), [line], args.join(' '));
      assert.equal(result.code, 2, args.join(' '));
    }
    const doctor = await run(s, ['doctor'], { budgetMs: 120_000 });
    assert.ok(doctor.stdout.includes('fail  types  src/core/huge.ts  the file holds 600,000,000 bytes'), doctor.stdout);
    assert.equal(doctor.code, 2);
  });
});

test('S2-5: test 251: 30 rules that hang end as rule-crashed, each after its 30 seconds, within the time of the run', async () => {
  const ids = Array.from({ length: 30 }, (_, i) => `hang-${String(i + 1).padStart(2, '0')}`);
  await withSample(
    async (s) => {
      write(s, D_PATH, D);
      const bound = Math.min(Math.ceil(ids.length / availableParallelism()) * 30_000, 600_000) + 60_000;
      const result = await run(s, ['check', '--base', 'main'], { budgetMs: bound });
      assert.deepEqual(errorLines(result.stdout), ids.map((id) => `.lawcheck/rules/${id}.mjs  error[rule-crashed]  passes 30 seconds on src/core/discount.ts`));
      assert.equal(result.code, 2);
    },
    {
      onMain: (s) => {
        const law = readFileSync(join(s, '.lawcheck/law.yaml'), 'utf8')
          .replace('\ntypes:', `${ids.map((id) => `  ${id}:\n    why: It hangs.\n`).join('')}\ntypes:`)
          .replace('rules: [no-console]', `rules: [no-console, ${ids.join(', ')}]`);
        writeFileSync(join(s, '.lawcheck/law.yaml'), law);
        for (const id of ids) setRule(s, id, 'export function check() { while (true) {} }\n');
      },
    },
  );
});

test('S2-5: test 251: rules that take 29 seconds a file are stopped when the script rules of the run pass 600 seconds', async () => {
  const ids = ['slow-a', 'slow-b', 'slow-c'];
  const slow = 'export async function check() { await new Promise((done) => setTimeout(done, 29_000)); return []; }\n';
  await withSample(
    async (s) => {
      for (let i = 1; i <= 25; i++) write(s, `src/core/f${String(i).padStart(2, '0')}.ts`, 'export const f = 1;\n');
      const result = await run(s, ['check', '--base', 'main'], { budgetMs: 700_000 });
      const cores = availableParallelism();
      const lines = errorLines(result.stdout);
      assert.equal(lines.length, ids.length, result.stdout);
      ids.forEach((id, i) => {
        const where = i < cores ? /had not finished on src\/core\/f\d\d\.ts when/ : /had not started when/;
        assert.match(lines[i]!, new RegExp(`^\\.lawcheck/rules/${id}\\.mjs  error\\[rules-too-slow\\]  ${where.source} the script rules of this run passed the 600 seconds they may take together$`));
      });
      assert.ok(result.ms >= 600_000 && result.ms < 660_000, String(result.ms));
      assert.equal(result.code, 2);
    },
    {
      onMain: (s) => {
        const law = readFileSync(join(s, '.lawcheck/law.yaml'), 'utf8')
          .replace('\ntypes:', `${ids.map((id) => `  ${id}:\n    why: It is slow.\n`).join('')}\ntypes:`)
          .replace('rules: [no-console]', `rules: [no-console, ${ids.join(', ')}]`);
        writeFileSync(join(s, '.lawcheck/law.yaml'), law);
        for (const id of ids) setRule(s, id, slow);
      },
    },
  );
});

const VERDICT_LINE = /^[0-9a-f]{32} [a-z0-9]+(-[a-z0-9]+)*$/;

function verdictLines(r: string): string[] {
  const path = join(r, '.lawcheck/verdicts');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  assert.ok(text === '' || text.endsWith('\n'), 'the verdicts file ends with a line end');
  const lines = text.split('\n').slice(0, -1);
  for (const line of lines) assert.match(line, VERDICT_LINE);
  return lines;
}

function passingFiles(r: string, count: number, from = 0): void {
  for (let i = from; i < from + count; i++) write(r, `src/core/refund${i}.ts`, F_PRIME.replace('function refund', `function refund${i}`));
}

test('test 252: kill -9 at a random moment of 50 reviews leaves a verdicts file that parses, and the next run passes', async () => {
  const next = random(SEED);
  process.stdout.write(`# seed ${SEED}\n`);
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        passingFiles(r, 12);
        const env = { ...GIT_ENV, LAWCHECK_REVIEWER_ENDPOINT: fake.url };
        for (let i = 0; i < 50; i++) {
          passingFiles(r, 1, 12 + i);
          const child = spawn(process.execPath, [CLI, 'check', '--review', '--base', 'main'], { cwd: r, env, stdio: 'ignore' });
          const closed = new Promise<void>((done) => child.on('close', () => done()));
          const delay = Math.floor(next() * 1500);
          setTimeout(() => child.kill('SIGKILL'), delay);
          await closed;
          verdictLines(r);
        }
        const after = await run(r, ['check', '--review', '--base', 'main'], { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, budgetMs: 120_000 });
        assert.match(after.stdout, /^lawcheck: PASS  6[34] changed files \(against main\), 62 waivers(, \d+ reviewer calls?)?\n$/);
        assert.equal(after.code, 0);
        assert.equal(verdictLines(r).length, 62);
        const plain = await run(r, ['check', '--base', 'main']);
        assert.equal(plain.code, 0, plain.stdout);
      });
    },
    async (request) => {
      await new Promise((done) => setTimeout(done, 50));
      return openai(defaultAnswer(request.prompt));
    },
  );
});

// The fake answers on every tenth of a second, so the answers of both runs arrive together and their writes of the verdicts file meet.
test('test 253: two reviews at once leave a verdicts file that holds the passes of both', async () => {
  let release: () => void = () => undefined;
  const first = new Promise<void>((done) => (release = done));
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        passingFiles(r, 40);
        const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.url };
        const a = run(r, ['check', '--review', '--base', 'main'], { env, budgetMs: 120_000 });
        await first;
        passingFiles(r, 40, 40);
        const b = run(r, ['check', '--review', '--base', 'main'], { env, budgetMs: 120_000 });
        const [ra, rb] = await Promise.all([a, b]);
        assert.equal(ra.code, 0, ra.stdout);
        assert.equal(rb.code, 0, rb.stdout);
        assert.equal(verdictLines(r).length, 80);
      });
    },
    async (request) => {
      release();
      await new Promise((done) => setTimeout(done, 100 - (Date.now() % 100)));
      return openai(defaultAnswer(request.prompt));
    },
  );
});

const STEP_NEXT = "next: make the step named faster, such as a type's content pattern that backtracks, then run lawcheck check again";
const stepTooSlow = (what: string) =>
  ['lawcheck: ERROR  1 error', '', `error[step-too-slow]  one step of the run took more than 30 seconds without an end: ${what}`, '  why:  a step that never ends gives no answer, so one step of a run has a limit of time', '', STEP_NEXT, ''].join('\n');

test('S1-1: test 255: a step that never ends, typing against a content pattern that backtracks, ends as step-too-slow after 30 seconds', async () => {
  await withSample(
    async (s) => {
      write(s, 'slow/a.ts', `${'a'.repeat(80)}!\n`);
      const result = await run(s, ['check', '--base', 'main'], { budgetMs: 120_000 });
      assert.equal(result.stdout, stepTooSlow('typing slow/a.ts'));
      assert.equal(result.code, 2);
      assert.ok(result.ms >= 30_000 && result.ms < 40_000, String(result.ms));
    },
    { onMain: (s) => writeFileSync(join(s, '.lawcheck/law.yaml'), `${readFileSync(join(s, '.lawcheck/law.yaml'), 'utf8')}  slow:\n    paths: ["slow/**"]\n    content: "^(a|a)+$"\n`) },
  );
});

test('test 259: a git that never answers ends as step-too-slow after 30 seconds, and git with it', async () => {
  await withSample(async (s, dir) => {
    const pidFile = join(dir, 'git.pid');
    write(dir, 'bin/git', `#!/bin/sh\ncase "$*" in *"ls-files -z --cached"*) echo $$ > "${pidFile}"; exec sleep 600;; esac\nexec "${join(programDir('git'), 'git')}" "$@"\n`);
    chmodSync(join(dir, 'bin', 'git'), 0o755);
    const result = await run(s, ['check', '--base', 'main'], { env: { PATH: pathWith(join(dir, 'bin')) }, budgetMs: 120_000 });
    assert.equal(result.stdout, stepTooSlow('running git ls-files -z --cached --others --exclude-standard'));
    assert.equal(result.code, 2);
    assert.ok(result.ms >= 30_000 && result.ms < 40_000, String(result.ms));
    assert.equal(alive(Number(readFileSync(pidFile, 'utf8'))), false);
  });
});

// The nightly job mounts a small file system of its own here, `--tmpfs /full:size=8m,mode=1777`, so a test can fill it.
const FULL_DISK = process.env.LAWCHECK_FULL_DISK;

test('S3-8: test 265: a review on a disk with one free page is file-unwritable, and init there too, never internal', async () => {
  assert.ok(FULL_DISK !== undefined && existsSync(FULL_DISK), 'could not run: LAWCHECK_FULL_DISK names no folder; the nightly job mounts one');
  const fill = (pages: number) => {
    const filler = join(FULL_DISK!, 'filler');
    rmSync(filler, { force: true });
    const fd = openSync(filler, 'w');
    const block = Buffer.alloc(4096);
    try {
      for (;;) writeSync(fd, block);
    } catch {
      // The disk is full.
    } finally {
      closeSync(fd);
    }
    truncateSync(filler, Math.max(0, statSync(filler).size - pages * 4096));
  };
  const r = join(FULL_DISK!, 'r');
  rmSync(r, { recursive: true, force: true });
  await withFake(async (fake) => {
    mkdirSync(r);
    git(r, 'init', '-q', '-b', 'main');
    cpSync(join(ROOT, 'tests', 'sample'), r, { recursive: true });
    cpSync(join(ROOT, 'tests', 'reviewer-sample'), r, { recursive: true });
    git(r, 'add', '-A');
    git(r, 'commit', '-q', '-m', 'sample');
    git(r, 'checkout', '-q', '-b', 'work');
    write(r, 'src/core/refund.ts', 'export function refund(paid: boolean): void {\n  return;\n}\n');
    fill(1);
    const result = await run(r, ['check', '--review', '--base', 'main'], { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, budgetMs: 60_000 });
    assert.match(errorLines(result.stdout).join('\n'), /^\S+  error\[file-unwritable\]  cannot be written \(ENOSPC\)/);
    assert.doesNotMatch(result.stdout, /internal/);
    assert.equal(result.code, 2);
  });
  rmSync(r, { recursive: true, force: true });
  const fresh = join(FULL_DISK!, 'n');
  rmSync(fresh, { recursive: true, force: true });
  mkdirSync(fresh);
  git(fresh, 'init', '-q', '-b', 'main');
  fill(0);
  const init = await run(fresh, ['init'], { budgetMs: 60_000 });
  assert.match(errorLines(init.stdout).join('\n'), /error\[file-unwritable\]  cannot be written \(ENOSPC\)/);
  assert.equal(init.code, 2);
  rmSync(join(FULL_DISK!, 'filler'), { force: true });
  rmSync(fresh, { recursive: true, force: true });
});
