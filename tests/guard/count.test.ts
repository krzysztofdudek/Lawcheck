import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COUNT = fileURLToPath(new URL('./count.ts', import.meta.url));

test('suite guard (T-7 A): a run with fewer tests than the sources declare fails, minus the skips with a platform reason', () => {
  const root = mkdtempSync(join(tmpdir(), 'lawcheck-count-'));
  try {
    mkdirSync(join(root, 'tests', 'harness'), { recursive: true });
    writeFileSync(join(root, 'tests', 'harness', 'skips.ts'), "export const PLATFORM_SKIPS = [{ test: 'test 2', part: 'the whole test', platform: 'linux', reason: 'no file mode on Windows' }];\n");
    writeFileSync(join(root, 'tests', 'a.test.ts'), [
      "import { test } from 'node:test';",
      "test('test 1: runs', () => {});",
      "test('test 2: listed skip', (t) => { t.skip('no file mode on Windows'); });",
      "test('test 3: unlisted skip', (t) => { t.skip('flaky'); });",
      'for (const n of [4, 5]) test(`test ${n}: generated`, () => {});',
      '',
    ].join('\n'));
    writeFileSync(join(root, 'tests', 'b.test.ts'), "import { test } from 'node:test';\ntest('test 6: left out of the run', () => {});\n");
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/a.test.ts'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    writeFileSync(join(root, 'run.tap'), run.stdout);
    const count = spawnSync(process.execPath, [COUNT, '--tap', join(root, 'run.tap'), '--root', root, 'tests/*.test.ts'], { encoding: 'utf8' });
    assert.equal(count.stderr, '');
    assert.equal(count.status, 1);
    assert.equal(count.stdout, [
      'REFUSED  fewer-tests  test 3: unlisted skip',
      'where    tests/a.test.ts:4',
      `what     skipped with "flaky", which is not a platform reason of PLATFORM_SKIPS on ${process.platform}`,
      'needs    nothing passes it: a test the sources declare runs, or skips with a platform reason',
      '',
      'REFUSED  fewer-tests  test 6: left out of the run',
      'where    tests/b.test.ts:2',
      `what     did not run on ${process.platform}`,
      'needs    nothing passes it: a test the sources declare runs, or skips with a platform reason',
      '',
      `suite guard: FAIL  2 declared tests did not run on ${process.platform}`,
      '',
    ].join('\n'));
    writeFileSync(join(root, 'tests', 'a.test.ts'), "import { test } from 'node:test';\ntest('test 1: runs', () => {});\n");
    const clean = spawnSync(process.execPath, [COUNT, '--tap', join(root, 'run.tap'), '--root', root, 'tests/a.test.ts'], { encoding: 'utf8' });
    assert.equal(clean.status, 0, clean.stdout);
    assert.equal(clean.stdout, `suite guard: PASS  every test of 1 files ran on ${process.platform}, or skipped with a platform reason\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
