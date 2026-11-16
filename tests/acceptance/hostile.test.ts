import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATTERN_RUN_BUDGET_MS } from '../numbers.ts';
import { platformSkip } from '../harness/tool.ts';
import { append, check, git, LAW, lawcheck, withSample, withU, write } from './helpers.ts';

const BREACH = 'console.log(1)\n';
const NO_CONSOLE_WHY = '  why:  Only the command layer writes to the terminal.';
const finding = (place: string) => `${place}  error[no-console]  writes to the terminal with console.log`;

function writeBytes(repo: string, name: Buffer, content: string): void {
  writeFileSync(Buffer.concat([Buffer.from(`${repo}/`), name]), content);
}

test('S1-2: a file whose name holds a line break, a carriage return or an invalid byte is judged, its name escaped', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withSample(async (s) => {
    const names = [Buffer.from('src/core/new\nline.ts'), Buffer.from('src/core/cr\rx.ts')];
    const invalid = platformSkip('a name that is not valid UTF-8') === null;
    if (invalid) names.push(Buffer.concat([Buffer.from('src/core/bad'), Buffer.from([0xff]), Buffer.from('.ts')]));
    for (const name of names) writeBytes(s, name, BREACH);
    const text = await check(s);
    const places = [...(invalid ? ['src/core/bad\\xff.ts:1'] : []), 'src/core/cr\\rx.ts:1', 'src/core/new\\nline.ts:1'];
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

test('S1-2: an untracked src/core/a<LF>b.ts holding console.log is in the change and fails the check', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withSample(async (s) => {
    writeBytes(s, Buffer.from('src/core/a\nb.ts'), "console.log('x');\n");
    const run = await check(s);
    assert.deepEqual(
      { code: run.code, stdout: run.stdout },
      { code: 1, stdout: ['lawcheck: FAIL  1 error in 1 changed file (against main)', '', finding('src/core/a\\nb.ts:1'), NO_CONSOLE_WHY, '', 'next: fix src/core/a\\nb.ts:1', ''].join('\n') },
    );
  });
});

test('S1-2: a name given on the command line in its escaped form selects that file, and a raw backslash selects the same file as its escape', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
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

test('S5-9: explain gives a file whose name holds a line break its type, on one line', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
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
      assert.equal(run.stdout.split('\n')[2], note, run.stdout);
      const explained = await lawcheck(s, ['explain', 'libs/sub/a.ts']);
      assert.deepEqual([explained.code, explained.stdout], [0, `libs/sub/a.ts\n  type:  none: it lies in libs/sub, ${kind}, which Lawcheck does not look into\n`]);
      const absent = await lawcheck(s, ['explain', 'libs/sub/b.ts']);
      assert.deepEqual([absent.code, absent.stdout], [0, `libs/sub/b.ts  (does not exist yet)\n  type:  none: it lies in libs/sub, ${kind}, which Lawcheck does not look into\n`]);
      const named = await lawcheck(s, ['check', 'libs/sub/a.ts']);
      assert.deepEqual([named.code, named.stdout], [0, `lawcheck: PASS  0 named files\nnote: libs/sub/a.ts lies in libs/sub, ${kind}, which Lawcheck does not look into\n`]);
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

test('S1-14: an edit of a file marked assume-unchanged or skip-worktree is in the change', async () => {
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    await withSample(async (s) => {
      git(s, 'update-index', flag, 'src/core/tax.ts');
      append(s, 'src/core/tax.ts', BREACH);
      const run = await check(s);
      assert.equal(run.code, 1, flag);
      assert.deepEqual(run.stdout.split('\n')[0], 'lawcheck: FAIL  1 error, 1 warning in 1 changed file (against main)', flag);
      assert.ok(run.stdout.includes(finding('src/core/tax.ts:3')), flag);
      assert.equal(git(s, 'ls-files', '-v', 'src/core/tax.ts')[0], flag === '--assume-unchanged' ? 'h' : 'S');
    });
  }
});

test('S1-14: a marked file with no edit stays out of the change', async () => {
  await withSample(async (s) => {
    git(s, 'update-index', '--assume-unchanged', 'src/core/tax.ts');
    const run = await check(s);
    assert.deepEqual([run.code, run.stdout], [0, 'lawcheck: PASS  nothing changed against main\n']);
  });
});


test('S4-9: in a file with lone CR line ends a use is on line 1, since a lone \\r stays in its line, and that line is inside the file', async () => {
  await withU(async (u) => {
    write(u, 'src/core/g.ts', "export const a = 1;\rexport const b = 2;\rimport '../cli/main.js';\r");
    const run = await check(u, '--base', 'main', '--json');
    const uses = JSON.parse(run.stdout).findings.filter((f: { code: string }) => f.code === 'forbidden-use');
    assert.deepEqual(uses.map((f: { file: string; line: number }) => [f.file, f.line]), [['src/core/g.ts', 1]]);
  });
});

test('S4-9: a file in UTF-16 holds NUL bytes, so it is binary and has no type, as section 2 says', async () => {
  await withSample(async (s) => {
    write(s, 'src/core/wide.ts', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("console.log('x');\n", 'utf16le')]));
    const run = await check(s);
    assert.deepEqual([run.code, run.stdout], [0, 'lawcheck: PASS  1 changed file (against main)\n']);
    const explained = await lawcheck(s, ['explain', 'src/core/wide.ts']);
    assert.equal(explained.stdout, 'src/core/wide.ts\n  type:  none: it is binary, which has no type\n');
  });
});

test('S5-10: a number past 9007199254740991 is usage, and an empty path names no file', async () => {
  await withSample(async (s) => {
    const big = await lawcheck(s, ['try', 'no-console', 'src', '--times', '99999999999999999999']);
    assert.equal(big.code, 2);
    assert.equal(big.stdout.split('\n')[2], "error[usage]  the flag --times takes a number up to 9007199254740991, not '99999999999999999999'");
    for (const args of [['try', 'no-console', ''], ['explain', '']]) {
      const empty = await lawcheck(s, args);
      assert.deepEqual([empty.code, empty.stdout.split('\n')[2]], [2, 'error[usage]  an empty path names no file'], JSON.stringify(args));
    }
  });
});

for (const under of ['', 'pkg']) {
  const where = under === '' ? 'at the top of the work tree' : 'below it, in pkg/';
  test(`S1-14: with the law ${where}, a marked file with no edit passes and an edited one is in the change`, async () => {
    await withSample(async (repo) => {
      const s = under === '' ? repo : join(repo, under);
      const at = (path: string) => (under === '' ? path : `${under}/${path}`);
      git(repo, 'update-index', '--assume-unchanged', at('src/core/tax.ts'));
      git(repo, 'update-index', '--skip-worktree', at('src/cli/main.ts'));
      const clean = await check(s);
      assert.deepEqual([clean.code, clean.stdout], [0, 'lawcheck: PASS  nothing changed against main\n']);
      append(s, 'src/core/tax.ts', BREACH);
      const edited = await check(s);
      assert.equal(edited.code, 1, edited.stdout);
      assert.equal(edited.stdout.split('\n')[0], 'lawcheck: FAIL  1 error, 1 warning in 1 changed file (against main)');
    }, { under: under === '' ? undefined : under });
  });
}

const QUOTED: [string, Buffer][] = [
  ['a name that starts with a double quote', Buffer.from('"q.ts')],
  ['a name in double quotes', Buffer.from('"x.ts"')],
];
QUOTED.push(['a name with a line feed', Buffer.from('src/core/n\nl.ts')], ['a name with a carriage return', Buffer.from('src/core/c\rr.ts')]);

for (const [what, name] of QUOTED) {
  test(`S1-14: ${what}, marked assume-unchanged and edited, is in the change, and its twin without quotes is not`, async (t) => {
    const skip = platformSkip('the whole test');
    if (skip !== null) return t.skip(skip);
    await withSample(async (s) => {
      write(s, '.lawcheck/law.yaml', `${LAW}  quoted:\n    paths: ['"*']\n    rules: [no-console]\n`);
      writeBytes(s, name, 'export const x = 1;\n');
      write(s, 'x.ts', 'export const x = 1;\n');
      write(s, 'q.ts', 'export const x = 1;\n');
      git(s, 'add', '-A');
      git(s, 'commit', '-q', '-m', 'names');
      git(s, 'update-index', '--assume-unchanged', '--', name.toString('utf8'));
      writeBytes(s, name, BREACH);
      const run = await check(s, '--base', 'HEAD', '--json');
      assert.equal(run.code, 1, run.stdout);
      const files = JSON.parse(run.stdout).findings.map((f: { file: string }) => f.file);
      assert.deepEqual(files, [name.toString('utf8').replace(/\n/g, '\\n').replace(/\r/g, '\\r')]);
    });
  });
}
