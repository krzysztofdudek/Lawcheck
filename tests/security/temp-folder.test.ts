import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFakeClaude } from '../acceptance/fake-reviewer.ts';
import { F, F_PATH, inTemp, lawcheck, makeSample, pathWith, withR, write } from '../acceptance/helpers.ts';

const missing = (dir: string) => {
  const path = join(dir, 'no-such-folder');
  return { TMPDIR: path, TEMP: path, TMP: path };
};

test('harness-5: a check whose temporary folder is missing still judges the change, and ends in no internal', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    write(s, 'src/core/discount.ts', "console.log('d');\n");
    const run = await lawcheck(s, ['check', '--base', 'main'], missing(dir));
    assert.equal(run.code, 1, run.stdout);
    assert.ok(run.stdout.includes('src/core/discount.ts:1  error[no-console]'), run.stdout);
  });
});

test('harness-5: a review through claude-code whose temporary folder is missing names the folder, and ends in no internal', async () => {
  await withR(async (r, dir) => {
    write(r, '.lawcheck/config.yaml', 'reviewer:\n  provider: claude-code\n');
    write(r, F_PATH, F);
    const env = { PATH: pathWith(writeFakeClaude(join(dir, 'bin'))), ...missing(dir) };
    const run = await lawcheck(r, ['check', '--review', '--base', 'main'], env, [], { stderr: /reviewer call/ });
    assert.equal(run.code, 2, run.stdout);
    assert.match(run.stdout, /error\[reviewer-unreachable\]  clear-errors: a folder for claude cannot be made in .*no-such-folder \(ENOENT\)/, run.stdout);
  });
});
