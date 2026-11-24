import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, inTemp, lawcheck, ROOT, write } from '../acceptance/helpers.ts';
import { blocksOf, SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';
import { PRINT, RECEIPT } from './index.ts';

const INSTALL = 'block 1 under "Quick start"';
const BEFORE = 'block 2 under "Quick start"';
const PRINT_BLOCK = 'block 3 under "Quick start"';

export const claims: Claims = {
  [INSTALL]: SCENARIO,
  [BEFORE]: SCENARIO,
  [PRINT_BLOCK]: SCENARIO,
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
  const install = blocksOf(readFileSync(join(ROOT, 'docs/install.md'), 'utf8')).find((block) => block.key === 'block 1 under "Install globally"');
  assert.equal(page.text(INSTALL), `${install?.text}\n$ lawcheck --version`, 'the install line of docs/install.md, which test 205 runs, then the version');
  assert.equal(page.text(BEFORE), '$ git init shop\n$ cd shop');
  assert.equal(page.text(PRINT_BLOCK) + '\n', PRINT);
  assert.equal(page.text('block 1 under "4. Write a file that breaks it"') + '\n', RECEIPT);
  await inTemp(async (dir) => {
    git(dir, 'init', '-q', 'shop');
    const repo = join(dir, 'shop');
    write(repo, 'src/cli/print.ts', page.text(PRINT_BLOCK) + '\n');

    const version = await lawcheck(repo, ['--version']);
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
    assert.deepEqual([version.code, version.stdout], [0, `${manifest.version}\n`], page.text(INSTALL));

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
