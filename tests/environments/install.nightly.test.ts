import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inTemp } from '../acceptance/helpers.ts';
import { docker, INSTALL_CELLS, installFolder } from './matrix.ts';
import type { Cell } from './matrix.ts';

async function runCells(cells: Cell[]): Promise<string[]> {
  return inTemp(async (dir) => {
    installFolder(dir);
    const problems: string[] = [];
    for (const cell of cells) {
      const run = docker(dir, cell.image, 'install-cell.sh', [cell.manager, cell.expect, ...(cell.cause === undefined ? [] : [cell.cause])]);
      const name = `${cell.image} ${cell.manager} (${cell.expect})`;
      if (run.lines.some((line) => line.startsWith('could not run'))) problems.push(`${name}: ${run.lines.find((line) => line.startsWith('could not run'))}\n${run.output}`);
      else if (run.code !== 0 || !run.lines.includes('done') || run.lines.some((line) => line.startsWith('fail'))) problems.push(`${name}: exit ${run.code}\n${run.output}`);
    }
    return problems;
  });
}

test('test 206: the install matrix, each package manager on node:24 and node:24-alpine, passes or refuses as the spec says (network)', async () => {
  assert.deepEqual(await runCells(INSTALL_CELLS.filter((cell) => cell.image.startsWith('node:24'))), []);
});

test('S8-2: on oven/bun, Bun with no Node, the installed Lawcheck refuses in its first line, and doctor agrees with check (network)', async () => {
  assert.deepEqual(await runCells(INSTALL_CELLS.filter((cell) => cell.image === 'oven/bun')), []);
});

test('S8-3: on node:20 and node:22, npm installs Lawcheck with a warning, and every command refuses in its first line, naming the Node version (network)', async () => {
  assert.deepEqual(await runCells(INSTALL_CELLS.filter((cell) => cell.image === 'node:20' || cell.image === 'node:22')), []);
});

test('S8-5: with Yarn 1, check --json through yarn --silent run, as docs/config.md gives it, is one JSON document (network)', async () => {
  assert.deepEqual(await runCells(INSTALL_CELLS.filter((cell) => cell.manager === 'yarn1')), []);
});
