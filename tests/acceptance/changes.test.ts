import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { append, check, D, D_PATH, findingLines, git, NOTHING_CHANGED, TEST3, TEST4, withSample, write } from './helpers.ts';

test('test 1: nothing changed', async () => {
  await withSample(async (s) => {
    const run = await check(s);
    assert.equal(run.stdout, NOTHING_CHANGED);
    assert.equal(run.code, 0);
  });
});

test('test 2: the passing run', async () => {
  await withSample(async (s) => {
    append(s, 'src/cli/main.ts', "console.log('done');\n");
    const run = await check(s);
    assert.equal(run.stdout, 'lawcheck: PASS  1 changed file (against main)\n');
    assert.equal(run.code, 0);
  });
});

test('test 3: the failing run', async () => {
  await withSample(async (s) => {
    write(s, D_PATH, D);
    const run = await check(s, '--full', '--base', 'main');
    assert.equal(run.stdout, TEST3);
    assert.equal(run.code, 1);
  });
});

test('test 4: add D', async () => {
  await withSample(async (s) => {
    write(s, D_PATH, D);
    const run = await check(s);
    assert.equal(run.stdout, TEST4);
    assert.equal(run.code, 1);
  });
});

test('test 5: add D and commit it', async () => {
  await withSample(async (s) => {
    write(s, D_PATH, D);
    git(s, 'add', '-A');
    git(s, 'commit', '-q', '-m', 'discount');
    const run = await check(s);
    assert.equal(run.stdout, TEST4);
    assert.equal(run.code, 1);
  });
});

test('test 6: an error on a line the change left alone fails the run', async () => {
  await withSample(async (s) => {
    append(s, 'src/core/price.ts', '// end\n');
    const run = await check(s);
    assert.deepEqual(findingLines(run.stdout), ['src/core/price.ts:2  error[no-console]  writes to the terminal with console.log']);
    assert.equal(run.code, 1);
  });
});

test('test 7: an advisory finding is a warning and passes', async () => {
  await withSample(async (s) => {
    append(s, 'src/core/tax.ts', '// end\n');
    const run = await check(s);
    assert.equal(
      run.stdout,
      [
        'lawcheck: PASS  1 warning in 1 changed file (against main)',
        '',
        'src/core/tax.ts:1  warning[no-todo]  TODO without an issue number',
        '  why:  A TODO without an issue number gets forgotten.',
        '',
      ].join('\n'),
    );
    assert.doesNotMatch(run.stdout, /next:/);
    assert.equal(run.code, 0);
  });
});

test('test 8: the rules of every type on the way down bind the file', async () => {
  await withSample(async (s) => {
    append(s, 'src/cli/main.ts', '// TODO flags\n');
    const run = await check(s);
    assert.deepEqual(findingLines(run.stdout), ['src/cli/main.ts:3  warning[no-todo]  TODO without an issue number']);
  });
});

test('test 9: content narrows a type', async () => {
  await withSample(async (s) => {
    write(s, 'tools/notes.mjs', '// TODO later\n');
    write(s, 'tools/ship.js', '#!/usr/bin/env node\n// TODO later\n');
    const run = await check(s);
    assert.deepEqual(findingLines(run.stdout), ['tools/ship.js:2  warning[no-todo]  TODO without an issue number']);
    assert.match(run.stdout.split('\n')[0]!, /2 changed files/);
  });
});

test('test 10: an exclusion leaves a file without a type', async () => {
  await withSample(async (s) => {
    write(s, 'src/core/api.d.ts', 'console.log(1);\n');
    const run = await check(s);
    assert.equal(run.stdout, 'lawcheck: PASS  1 changed file (against main)\n');
  });
});

test('test 11: a file git ignores is not there', async () => {
  await withSample(async (s) => {
    write(s, 'src/core/gen.ts', 'console.log(1);\n');
    write(s, '.gitignore', 'src/core/gen.ts\n');
    const run = await check(s);
    assert.equal(run.stdout, 'lawcheck: PASS  1 changed file (against main)\n');
  });
});

test('test 12: a path with letters outside ASCII', async () => {
  await withSample(async (s) => {
    write(s, 'src/core/żółw.ts', 'console.log(1);\n');
    const run = await check(s);
    assert.deepEqual(findingLines(run.stdout), ['src/core/żółw.ts:1  error[no-console]  writes to the terminal with console.log']);
    assert.equal(run.code, 1);
  });
});

test('test 13: renames, deletions and staged edits', async () => {
  await withSample(async (s) => {
    git(s, 'mv', 'src/core/price.ts', 'src/core/cost.ts');
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: FAIL  1 error in 1 changed file (against main)');
    assert.ok(findingLines(run.stdout).some((line) => line.startsWith('src/core/cost.ts:2  error[no-console]')));
    assert.equal(run.code, 1);
  });
  await withSample(async (s) => {
    git(s, 'rm', '-q', 'src/core/price.ts');
    const run = await check(s);
    assert.equal(run.stdout, NOTHING_CHANGED);
    assert.equal(run.code, 0);
  });
  await withSample(async (s) => {
    append(s, 'src/core/price.ts', '// end\n');
    git(s, 'add', 'src/core/price.ts');
    const run = await check(s);
    assert.deepEqual(findingLines(run.stdout), ['src/core/price.ts:2  error[no-console]  writes to the terminal with console.log']);
    assert.equal(run.code, 1);
  });
});

test('test 14: the root below the top of the git tree', async () => {
  await withSample(
    async (s) => {
      write(s, `pkg/${D_PATH}`, D);
      append(s, 'top.txt', 'x\n');
      const run = await check(join(s, 'pkg', 'src'), '--full', '--base', 'main');
      assert.equal(run.stdout, TEST3);
      assert.equal(run.code, 1);
    },
    { under: 'pkg', top: (repo) => write(repo, 'top.txt', 'top\n') },
  );
});
