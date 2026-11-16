import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inTemp } from '../acceptance/helpers.ts';
import { checkSliceFiles, docker, GIT_IMAGES, gitFolder, securityFiles } from './matrix.ts';

test('test 207: the check slice acceptance tests and the security tests pass on the git of ubuntu:22.04, debian:12, ubuntu:24.04 and debian:sid (network)', async () => {
  const files = [...checkSliceFiles(), ...securityFiles()];
  assert.ok(checkSliceFiles().length >= 5 && securityFiles().length >= 1, files.join(' '));
  await inTemp(async (dir) => {
    gitFolder(dir);
    const problems: string[] = [];
    for (const image of GIT_IMAGES) {
      const run = docker(dir, image, 'git-cell.sh', files);
      if (run.code !== 0 || !run.lines.includes('ℹ fail 0') || run.lines.some((line) => line.includes('unsupported-environment'))) problems.push(`${image}: exit ${run.code}\n${run.output}`);
    }
    assert.deepEqual(problems, []);
  });
});
