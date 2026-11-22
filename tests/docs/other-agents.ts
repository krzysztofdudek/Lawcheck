import assert from 'node:assert/strict';
import { git, inTemp, lawcheck, newRepository, NO_CONSOLE, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "Other coding agents"': SCENARIO,
  'block 1 under "1. Add one line to the instructions file"': SCENARIO,
  'block 1 under "2. See what the agent reads"': SCENARIO,
  'block 2 under "2. See what the agent reads"': SCENARIO,
  'block 1 under "3. See a failed check as the agent does"': SCENARIO,
  'block 2 under "3. See a failed check as the agent does"': SCENARIO,
};

const args = (block: string): string[] => {
  assert.ok(block.startsWith('$ lawcheck '), block);
  return block.slice('$ lawcheck '.length).split(' ');
};

export async function scenario(page: Page): Promise<void> {
  const line = /^Run `lawcheck (\w+)` at the start of every session and follow it\.$/.exec(page.text('block 1 under "1. Add one line to the instructions file"'));
  assert.ok(line, 'the line names one command of lawcheck');
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': page.text('block 1 under "Other coding agents"'), '.lawcheck/rules/no-console.mjs': NO_CONSOLE, 'src/core/price.ts': 'export const price = 1;\n' });
    const prime = args(page.text('block 1 under "2. See what the agent reads"'));
    assert.deepEqual(prime, [line[1]], 'step 2 runs the command of the line');
    const primed = await lawcheck(repo, prime);
    assert.deepEqual([primed.code, primed.stdout], [0, page.text('block 2 under "2. See what the agent reads"') + '\n']);
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, 'src/core/total.ts', 'export function total(price: number): number {\n  console.log(price);\n  return price;\n}\n');
    const checked = await lawcheck(repo, args(page.text('block 1 under "3. See a failed check as the agent does"')));
    assert.deepEqual([checked.code, checked.stdout], [1, page.text('block 2 under "3. See a failed check as the agent does"') + '\n']);
  });
}
