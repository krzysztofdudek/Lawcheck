import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATTERN_RUN_BUDGET_MS } from '../properties/numbers.ts';
import { append, check, git, LAW, lawcheck, withSample, write } from './helpers.ts';

const WINDOWS = process.platform === 'win32';
const LINUX = process.platform === 'linux';
const BREACH = 'console.log(1)\n';
const NO_CONSOLE_WHY = '  why:  Only the command layer writes to the terminal.';
const finding = (place: string) => `${place}  error[no-console]  writes to the terminal with console.log`;

function writeBytes(repo: string, name: Buffer, content: string): void {
  writeFileSync(Buffer.concat([Buffer.from(`${repo}/`), name]), content);
}

test('S1-2: a file whose name holds a line break, a carriage return or an invalid byte is judged, its name escaped', { skip: WINDOWS && 'Windows refuses these characters in a file name' }, async () => {
  await withSample(async (s) => {
    const names = [Buffer.from('src/core/new\nline.ts'), Buffer.from('src/core/cr\rx.ts')];
    if (LINUX) names.push(Buffer.concat([Buffer.from('src/core/bad'), Buffer.from([0xff]), Buffer.from('.ts')]));
    for (const name of names) writeBytes(s, name, BREACH);
    const text = await check(s);
    const places = [...(LINUX ? ['src/core/bad\\xff.ts:1'] : []), 'src/core/cr\\rx.ts:1', 'src/core/new\\nline.ts:1'];
    assert.deepEqual(
      { code: text.code, stdout: text.stdout, stderr: text.stderr },
      {
        code: 1,
        stdout: [
          `lawcheck: FAIL  ${places.length} errors in ${places.length} changed files (against main)`,
          '',
          finding(places[0]!),
          NO_CONSOLE_WHY,
          ...places.slice(1).map(finding),
          '',
          `next: fix ${places[0]}`,
          '',
        ].join('\n'),
        stderr: '',
      },
    );
    const json = JSON.parse((await check(s, '--base', 'main', '--json')).stdout);
    assert.deepEqual(json.findings.map((f: { file: string }) => f.file), places.map((p) => p.slice(0, -2)));
    assert.equal(json.scope.files, places.length);
  });
});

test('S1-2: a name given on the command line in its escaped form selects that file, and a raw backslash selects the same file as its escape', { skip: WINDOWS && 'Windows refuses these characters in a file name' }, async () => {
  await withSample(async (s) => {
    writeBytes(s, Buffer.from('src/core/new\nline.ts'), BREACH);
    writeBytes(s, Buffer.from('src/core/back\\slash.ts'), BREACH);
    const one = await lawcheck(s, ['check', './src/core/new\\nline.ts']);
    assert.deepEqual([one.code, one.stdout.split('\n')[0], one.stdout.split('\n')[2]], [1, 'lawcheck: FAIL  1 error in 1 named file', finding('src/core/new\\nline.ts:1')]);
    for (const word of ['./src/core/back\\slash.ts', './src/core/back\\\\slash.ts']) {
      const run = await lawcheck(s, ['check', word]);
      assert.deepEqual([run.code, run.stdout.split('\n')[2]], [1, finding('src/core/back\\\\slash.ts:1')], word);
    }
  });
});

test('S5-9: explain gives a file whose name holds a line break its type, on one line', { skip: WINDOWS && 'Windows refuses a line break in a file name' }, async () => {
  await withSample(async (s) => {
    writeBytes(s, Buffer.from('src/core/new\nline.ts'), BREACH);
    const run = await lawcheck(s, ['explain', 'src/core/new\\nline.ts']);
    assert.equal(run.code, 0);
    const lines = run.stdout.split('\n');
    assert.equal(lines[0], 'src/core/new\\nline.ts');
    assert.equal(lines[1], '  type:  library  (source > library)  Code the commands call.');
    const json = JSON.parse((await lawcheck(s, ['explain', 'src/core/new\\nline.ts', '--json'])).stdout);
    assert.deepEqual([json.path, json.exists, json.type, json.none], ['src/core/new\\nline.ts', true, 'library', null]);
  });
});

test('S5-6: explain of a path with a segment over 255 bytes says it does not exist yet, never internal', async () => {
  await withSample(async (s) => {
    const long = `src/core/${'a'.repeat(300)}.ts`;
    const run = await lawcheck(s, ['explain', long]);
    assert.deepEqual([run.code, run.stderr, run.stdout.split('\n')[0]], [0, '', `${long}  (does not exist yet)`]);
    const longer = `src/${'b/'.repeat(2500)}c.ts`;
    const deep = await lawcheck(s, ['explain', longer, '--json']);
    assert.equal(deep.code, 0, deep.stdout);
    assert.equal(JSON.parse(deep.stdout).exists, false);
  });
});

test('S1-1: a law with src/**/*a*a*a*a*a*a*b.ts and a file named with 240 a ends within the budget', async () => {
  await withSample(async (s) => {
    write(s, '.lawcheck/law.yaml', LAW.replace('paths: ["src/core/**"]', 'paths: ["src/**/*a*a*a*a*a*a*b.ts"]'));
    write(s, `src/core/${'a'.repeat(240)}.ts`, BREACH);
    write(s, `src/core/${'a'.repeat(6)}b.ts`, BREACH);
    const run = await check(s, '--full', '--base', 'main');
    assert.ok(run.ms <= PATTERN_RUN_BUDGET_MS, `the run took ${run.ms} ms`);
    assert.equal(run.code, 1);
    assert.deepEqual(run.stdout.split('\n').filter((line) => line.includes('error[no-console]')), [finding('src/core/aaaaaab.ts:1')]);
  });
});

function nestedRepository(s: string, dir: string, submodule: boolean): void {
  const inner = join(s, dir);
  mkdirSync(inner, { recursive: true });
  git(inner, 'init', '-q', '-b', 'main');
  write(inner, 'a.ts', BREACH);
  git(inner, 'add', '-A');
  git(inner, 'commit', '-q', '-m', 'inner');
  if (submodule) git(s, 'add', dir);
}

for (const submodule of [true, false]) {
  const kind = submodule ? 'a submodule' : 'a repository of its own';
  test(`S1-9, S5-8: a type that reaches into ${kind} is named in a note, and explain and try give the true reason`, async () => {
    await withSample(async (s) => {
      write(s, '.lawcheck/law.yaml', `${LAW}  libs:\n    paths: ["libs/**/*.ts"]\n    rules: [no-console]\n`);
      nestedRepository(s, 'libs/sub', submodule);
      const note = `note: the paths of a type reach into libs/sub (${kind}); Lawcheck does not look into another repository, so no file there is judged`;
      const run = await check(s, '--full', '--base', 'main');
      assert.equal(run.stdout.split('\n')[1], note, run.stdout);
      const explained = await lawcheck(s, ['explain', 'libs/sub/a.ts']);
      assert.deepEqual([explained.code, explained.stdout], [0, `libs/sub/a.ts\n  type:  none: it lies in libs/sub, ${kind}, which Lawcheck does not look into\n`]);
      const absent = await lawcheck(s, ['explain', 'libs/sub/b.ts']);
      assert.deepEqual([absent.code, absent.stdout], [0, `libs/sub/b.ts  (does not exist yet)\n  type:  none: it lies in libs/sub, ${kind}, which Lawcheck does not look into\n`]);
      const tried = await lawcheck(s, ['try', 'no-console', 'libs/sub/a.ts']);
      assert.equal(tried.code, 2);
      assert.match(tried.stdout, new RegExp(`error\\[usage\\]  the target 'libs/sub/a\\.ts' selects no file: it lies in libs/sub, ${kind}, which Lawcheck does not look into`));
    });
  });
}

test('S1-9: no note when no type reaches into the other repository', async () => {
  await withSample(async (s) => {
    nestedRepository(s, 'libs/sub', true);
    const run = await check(s, '--full', '--base', 'main');
    assert.ok(!run.stdout.includes('note:'), run.stdout);
  });
});

