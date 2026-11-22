import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { git, inTemp, lawcheck, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';
import { PRINT, RECEIPT } from './index.ts';

const BEFORE = 'block 1 under "Quick start"';

export const claims: Claims = {
  [BEFORE]: SCENARIO,
  'block 2 under "Quick start"': SCENARIO,
  'block 1 under "1. Start the law"': SCENARIO,
  'block 2 under "1. Start the law"': SCENARIO,
  'block 1 under "2. Describe one type"': SCENARIO,
  'block 1 under "3. Add one may_use line"': SCENARIO,
  'block 1 under "4. Write a file that breaks it"': SCENARIO,
  'block 1 under "5. Check"': SCENARIO,
  'block 2 under "5. Check"': SCENARIO,
};

async function step(repo: string, command: string, output: string, code: number): Promise<void> {
  assert.ok(command.startsWith('$ lawcheck '), command);
  const run = await lawcheck(repo, command.slice('$ lawcheck '.length).split(' '));
  assert.equal(run.code, code, `${command}\n${run.stdout}`);
  assert.equal(run.stdout, output + '\n', command);
}

export async function scenario(page: Page): Promise<void> {
  assert.equal(page.text(BEFORE), '$ git init shop\n$ cd shop');
  assert.equal(page.text('block 2 under "Quick start"') + '\n', PRINT);
  assert.equal(page.text('block 1 under "4. Write a file that breaks it"') + '\n', RECEIPT);
  await inTemp(async (dir) => {
    git(dir, 'init', '-q', 'shop');
    const repo = join(dir, 'shop');
    write(repo, 'src/cli/print.ts', page.text('block 2 under "Quick start"') + '\n');

    await step(repo, page.text('block 1 under "1. Start the law"'), page.text('block 2 under "1. Start the law"'), 0);
    assert.ok(existsSync(join(repo, '.lawcheck', 'law.yaml')));

    write(repo, '.lawcheck/law.yaml', page.text('block 1 under "2. Describe one type"') + '\n');
    const typed = await lawcheck(repo, ['check']);
    assert.deepEqual([typed.code, typed.stdout], [0, 'lawcheck: PASS  3 files (no base: every file counts as changed)\n'], 'a type with no may_use judges nothing yet');

    write(repo, '.lawcheck/law.yaml', page.text('block 1 under "3. Add one may_use line"') + '\n');
    write(repo, 'src/core/receipt.ts', page.text('block 1 under "4. Write a file that breaks it"') + '\n');
    await step(repo, page.text('block 1 under "5. Check"'), page.text('block 2 under "5. Check"'), 1);
  });
}
