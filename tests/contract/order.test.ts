import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, testFolder } from '../harness/tool.ts';

const NAMES = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

function order(seed: string | null): string[] {
  const folder = testFolder('lawcheck-order-');
  try {
    const file = join(folder.dir, 'scratch.test.ts');
    const log = join(folder.dir, 'order.log');
    writeFileSync(
      file,
      [`import { test } from 'node:test';`, `import assert from 'node:assert/strict';`, `import { appendFileSync } from 'node:fs';`, ...NAMES.map((n) => `test(${JSON.stringify(`test 1: ${n}`)}, () => { appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(n)} + '\\n'); assert.equal(${JSON.stringify(n)}.length > 0, true); });`)].join('\n'),
    );
    const env: NodeJS.ProcessEnv = { ...process.env, LAWCHECK_SHUFFLE: seed ?? '', LAWCHECK_TIE: '', LAWCHECK_STARTED: '' };
    delete env.NODE_TEST_CONTEXT;
    const harness = pathToFileURL(join(ROOT, 'tests', 'harness', 'tool.ts')).href;
    spawnSync(process.execPath, ['--test', `--import=${harness}`, '--test-reporter=tap', file], { cwd: folder.dir, env, encoding: 'utf8' });
    return readFileSync(log, 'utf8').trim().split('\n');
  } finally {
    folder.remove();
  }
}

test('R-57: the tests of a file run in the order of the seed, the same order for the same seed, and in definition order without one', () => {
  assert.deepEqual(order(null), NAMES);
  const orders = ['1', '2', '3', '4'].map((seed) => order(seed));
  for (const found of orders) assert.deepEqual([...found].sort(), [...NAMES].sort());
  assert.ok(orders.some((found) => found.join() !== NAMES.join()), orders.map((o) => o.join(' ')).join('\n'));
  assert.deepEqual(order('2'), orders[1]);
});

test('R-49: a test of a file that asserts nothing fails the run, whether it is empty or only waits for the timer of the test before it', () => {
  const folder = testFolder('lawcheck-count-');
  try {
    const file = join(folder.dir, 'scratch.test.ts');
    writeFileSync(
      file,
      [
        `import { test } from 'node:test';`,
        `import assert from 'node:assert/strict';`,
        `test('test 1: asserts', () => { assert.equal(2 + 2, 4); });`,
        `test('test 1: asserts nothing', async () => { await new Promise((done) => setTimeout(done, 50)); });`,
      ].join('\n'),
    );
    const env: NodeJS.ProcessEnv = { ...process.env, LAWCHECK_SHUFFLE: '', LAWCHECK_TIE: '', LAWCHECK_STARTED: '' };
    delete env.NODE_TEST_CONTEXT;
    const harness = pathToFileURL(join(ROOT, 'tests', 'harness', 'tool.ts')).href;
    const run = spawnSync(process.execPath, ['--test', `--import=${harness}`, file], { cwd: folder.dir, env, encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stdout + run.stderr, /harness-count: the test made no assertion/);
  } finally {
    folder.remove();
  }
});

test('R-57: the runner prints the order seed as the line "order seed <n>" alone, and the rerun hint on a line of its own', () => {
  const env: NodeJS.ProcessEnv = { ...process.env, LAWCHECK_STARTED: '', LAWCHECK_SHUFFLE: '', LAWCHECK_TIE: '' };
  delete env.NODE_TEST_CONTEXT;
  delete env.LAWCHECK_ORDER_SEED;
  const run = spawnSync(process.execPath, [join(ROOT, 'tests', 'run.ts'), 'commit', '--shuffle=7', 'tests/contract/starts.test.ts'], { cwd: ROOT, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const lines = run.stdout.split('\n');
  assert.ok(lines.includes('order seed 7'), lines.join('\n'));
  assert.ok(lines.includes('rerun with --shuffle=7'), lines.join('\n'));
  assert.equal(lines.indexOf('rerun with --shuffle=7'), lines.indexOf('order seed 7') + 1);
});
