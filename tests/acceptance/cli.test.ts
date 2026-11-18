import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  append,
  check,
  copySample,
  D,
  D_PATH,
  findingLines,
  git,
  inTemp,
  lawcheck,
  NOTHING_CHANGED,
  withSample,
  write,
} from './helpers.ts';

const BASE_NOPE = [
  'lawcheck: ERROR  1 error',
  '',
  "error[base-unreachable]  the base 'nope' names no commit here",
  '  why:  without its base a change cannot be told from debt',
  '',
  'next: pass --base with a branch or a commit that exists here',
  '',
].join('\n');

const NO_BASE = 'lawcheck: FAIL  1 error, 2 warnings in 8 files (no base: every file counts as changed)';

test('test 38: the base', async () => {
  await withSample(async (s) => {
    const nope = await check(s, '--base', 'nope');
    assert.equal(nope.stdout, BASE_NOPE);
    assert.equal(nope.code, 2);
    const fromEnv = await lawcheck(s, ['check'], { LAWCHECK_BASE: 'main' });
    assert.equal(fromEnv.stdout, NOTHING_CHANGED);
    assert.equal(fromEnv.code, 0);
    const flagFirst = await lawcheck(s, ['check', '--base', 'main'], { LAWCHECK_BASE: 'nope' });
    assert.equal(flagFirst.stdout, NOTHING_CHANGED);
    assert.equal(flagFirst.code, 0);
    git(s, 'checkout', '-q', '--orphan', 'lone');
    git(s, 'commit', '-q', '-m', 'lone');
    const lone = await check(s, '--base', 'main');
    assert.equal(lone.code, 2);
    assert.match(lone.stdout, /^error\[base-unreachable\]/m);
  });
  await withSample(async (s) => {
    git(s, 'checkout', '-q', 'main');
    append(s, 'src/core/price.ts', '// later\n');
    git(s, 'commit', '-q', '-am', 'later');
    git(s, 'checkout', '-q', 'work');
    const moved = await check(s, '--base', 'main');
    assert.equal(moved.stdout, NOTHING_CHANGED);
    assert.equal(moved.code, 0);
  });
});

test('test 39: no base', async () => {
  await withSample(async (s) => {
    const plain = await lawcheck(s, ['check']);
    assert.equal(plain.stdout.split('\n')[0], NO_BASE);
    assert.equal(plain.code, 1);
    const empty = await lawcheck(s, ['check'], { LAWCHECK_BASE: '' });
    assert.equal(empty.stdout.split('\n')[0], NO_BASE);
    assert.equal(empty.code, 1);
  });
  await inTemp(async (dir) => {
    const repo = join(dir, 'fresh');
    copySample(repo);
    git(repo, 'init', '-q', '-b', 'main');
    const plain = await lawcheck(repo, ['check']);
    assert.equal(plain.stdout.split('\n')[0], NO_BASE);
    assert.equal(plain.code, 1);
    const based = await check(repo, '--base', 'main');
    assert.equal(based.code, 2);
    assert.match(based.stdout, /^error\[base-unreachable\]/m);
  });
});

test('test 40: the base from origin/HEAD', async () => {
  await withSample(async (s, dir) => {
    git(s, 'checkout', '-q', 'main');
    git(dir, 'clone', '-q', s, 'clone');
    const clone = join(dir, 'clone');
    git(clone, 'checkout', '-q', '-b', 'work');
    const run = await lawcheck(clone, ['check']);
    assert.equal(run.stdout, 'lawcheck: PASS  nothing changed against origin/main\n');
  });
});

const DEBT = [
  ['src/core/price.ts', 2, 'library', 'no-console', 'writes to the terminal with console.log', 'Only the command layer writes to the terminal.'],
  ['src/core/tax.ts', 1, 'library', 'no-todo', 'TODO without an issue number', 'A TODO without an issue number gets forgotten.'],
  ['tools/release.mjs', 2, 'script', 'no-todo', 'TODO without an issue number', 'A TODO without an issue number gets forgotten.'],
].map(([file, line, type, rule, message, why]) => ({
  code: rule, rule, severity: 'warning', blocking: false, debt: true, file, line, type, message, why,
}));

test('test 41: JSON', async () => {
  await withSample(async (s) => {
    write(s, D_PATH, D);
    const run = await check(s, '--full', '--base', 'main', '--json');
    const expected = {
      schema: 'lawcheck-check/0',
      result: 'fail',
      scope: { mode: 'full', base: 'main', files: 1, law_changed: false },
      summary: { errors: 1, warnings: 1, debt: 3, waivers: 1, unresolved: 0 },
      findings: [
        {
          code: 'no-console', rule: 'no-console', severity: 'error', blocking: true, debt: false,
          file: 'src/core/discount.ts', line: 2, type: 'library',
          message: 'writes to the terminal with console.log',
          why: 'Only the command layer writes to the terminal.',
        },
        {
          code: 'no-todo', rule: 'no-todo', severity: 'warning', blocking: false, debt: false,
          file: 'src/core/discount.ts', line: 3, type: 'library',
          message: 'TODO without an issue number',
          why: 'A TODO without an issue number gets forgotten.',
        },
        ...DEBT,
      ],
      waivers: [
        { file: 'src/core/discount.ts', line: 4, rule: 'no-console', debt: false, waived: 1, reason: 'the pricing team reads this warning until 2.0' },
      ],
      unresolved: [],
      reviews: { missing: 0, calls_made: 0, passes_recorded: 0 },
      next: { command: null, text: 'fix src/core/discount.ts:2' },
    };
    assert.deepEqual(JSON.parse(run.stdout), expected);
    assert.equal(JSON.stringify(JSON.parse(run.stdout)), JSON.stringify(expected), 'the keys keep the order of section 6');
    assert.ok(run.stdout.endsWith('}\n'));
    assert.equal(run.stdout, JSON.stringify(JSON.parse(run.stdout), null, 2) + '\n');
    assert.equal(run.code, 1);
  });
  await withSample(async (s) => {
    append(s, 'src/cli/main.ts', "console.log('done');\n");
    const run = await check(s, '--base', 'main', '--json');
    const document = JSON.parse(run.stdout);
    assert.equal(document.result, 'pass');
    assert.deepEqual(document.findings, []);
    assert.equal(document.next, null);
    assert.deepEqual(document.reviews, { missing: 0, calls_made: 0, passes_recorded: 0 });
    assert.equal(run.code, 0);
  });
});

test('test 42: not initialized, and no git', async () => {
  await inTemp(async (dir) => {
    git(dir, 'init', '-q');
    const run = await lawcheck(dir, ['check']);
    assert.equal(run.code, 2);
    assert.match(run.stdout, /^error\[not-initialized\]/m);
  });
  await inTemp(async (dir) => {
    copySample(join(dir, 'plain'));
    const run = await lawcheck(join(dir, 'plain'), ['check']);
    assert.equal(run.code, 2);
    assert.match(run.stdout, /^error\[no-git\]/m);
  });
  await withSample(async (s) => {
    const run = await lawcheck(s, ['check', '--base', 'main'], { PATH: '/nonexistent' });
    assert.equal(run.code, 2);
    assert.match(run.stdout, /^error\[no-git\]/m);
  });
});

test('test 43: usage', async () => {
  await withSample(async (s) => {
    const cases = [[], ['fix'], ['check', 'src', '--full'], ['check', '--base'], ['check', '--base=main'], ['check', '--full', '--full']];
    for (const args of cases) {
      const run = await lawcheck(s, args);
      assert.equal(run.code, 2, args.join(' '));
      assert.match(run.stdout, /^error\[usage\]/m, args.join(' '));
      if (args.length < 2) assert.match(run.stdout, /init, prime, check, explain, try, docs, doctor/, args.join(' '));
    }
    const jsonCases = [['check', '--base', '--json'], ['check', '--json', '--bogus'], ['check', '--bogus', '--json']];
    for (const args of jsonCases) {
      const run = await lawcheck(s, args);
      assert.equal(run.code, 2, args.join(' '));
      const document = JSON.parse(run.stdout);
      assert.equal(document.schema, 'lawcheck-error/1');
      assert.equal(document.errors[0].code, 'usage');
      assert.equal(document.errors[0].file, null);
      assert.equal(document.errors[0].line, null);
    }
  });
});

test('test 44: version and help', async () => {
  await inTemp(async (dir) => {
    const version = await lawcheck(dir, ['--version']);
    assert.equal(version.stdout, '0.1.0-alpha.2\n');
    assert.equal(version.code, 0);
    for (const [args, first] of [[['--help'], 'usage: lawcheck <command> [<arguments>] [--json]'], [['check', '--help'], 'usage: lawcheck check [--full] [--base <ref>] [--review [--again] [--max-calls <n>]] [--json]']] as const) {
      const run = await lawcheck(dir, [...args]);
      assert.equal(run.stdout.split('\n')[0], first);
      assert.equal(run.code, 0);
    }
  });
});

test('test 45: at most 50 finding lines', async () => {
  await withSample(async (s) => {
    write(s, 'src/core/many.ts', 'console.log(1);\n'.repeat(60));
    const plain = await check(s);
    const plainLines = plain.stdout.split('\n');
    assert.equal(findingLines(plain.stdout).length, 50);
    const last = plainLines.indexOf(findingLines(plain.stdout)[49]!);
    assert.equal(plainLines[last + 1], '... 10 more findings (--json lists all)');
    const json = JSON.parse((await check(s, '--base', 'main', '--json')).stdout);
    assert.equal(json.findings.length, 60);
    const full = await check(s, '--full', '--base', 'main');
    const fullLines = full.stdout.split('\n');
    assert.equal(findingLines(full.stdout).length, 50);
    const fiftieth = fullLines.indexOf(findingLines(full.stdout)[49]!);
    assert.equal(fullLines[fiftieth + 1], '... 13 more findings (--json lists all)');
    const heading = fullLines.indexOf('debt (outside this change): 3 findings in 3 files');
    assert.ok(heading > fiftieth, full.stdout);
    assert.ok(!/^\S+  (error|warning)\[/.test(fullLines[heading + 1] ?? ''), full.stdout);
  });
  await withSample(async (s) => {
    write(s, 'src/core/many.ts', 'console.log(1);\n'.repeat(49));
    const run = await check(s, '--full', '--base', 'main');
    const out = run.stdout.split('\n');
    const found = findingLines(run.stdout);
    assert.equal(found.length, 50);
    assert.ok(found.slice(0, 49).every((line) => line.startsWith('src/core/many.ts:')));
    const heading = out.indexOf('debt (outside this change): 3 findings in 3 files');
    assert.ok(heading > out.indexOf(found[48]!));
    assert.equal(out[heading + 1], 'src/core/price.ts:2  warning[no-console]  writes to the terminal with console.log');
    assert.equal(out[heading + 2], '... 2 more findings (--json lists all)');
  });
});
