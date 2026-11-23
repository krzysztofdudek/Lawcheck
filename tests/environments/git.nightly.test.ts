import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inTemp } from '../acceptance/helpers.ts';
import { checkSliceFiles, docker, GIT_IMAGES, gitFolder, securityFiles } from './matrix.ts';
import { testBudget } from '../numbers.ts';

test('test 207: the check slice acceptance tests and the security tests pass on the git of ubuntu:22.04, debian:12, ubuntu:24.04 and debian:sid (network)', async (t) => {
  const files = [...checkSliceFiles(), ...securityFiles()];
  assert.ok(checkSliceFiles().length >= 5 && securityFiles().length >= 1, files.join(' '));
  const budget = testBudget(`tests/environments/git.nightly.test.ts > ${t.name}`, 'linux');
  await inTemp(async (dir) => {
    gitFolder(dir);
    const problems: string[] = [];
    const times: string[] = [];
    const begun = Date.now();
    for (const image of GIT_IMAGES) {
      const from = Date.now();
      const run = docker(dir, image, 'git-cell.sh', files);
      times.push(`${image}: ${Math.round((Date.now() - from) / 1000)} s in all, ${run.lines.filter((line) => line.startsWith('git ') || line.startsWith('tests took ')).join(', ')}`);
      if (run.code !== 0 || !run.lines.includes('ℹ fail 0') || run.lines.some((line) => line.includes('unsupported-environment'))) problems.push(`${image}: exit ${run.code}\n${run.output}`);
    }
    assert.deepEqual(problems, []);
    assert.ok(Date.now() - begun < budget, `the cells took longer than the test's budget of ${budget / 1000} s:\n${times.join('\n')}`);
  });
});
