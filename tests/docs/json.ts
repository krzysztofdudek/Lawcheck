import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inTemp, lawcheck } from '../acceptance/helpers.ts';
import { blocksOf, SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';
import { exampleRepository } from './commands.ts';

const CHECK = 'block 1 under "lawcheck-check/0"';

export const claims: Claims = {
  [CHECK]: SCENARIO,
};

export async function scenario(page: Page): Promise<void> {
  const commands = blocksOf(readFileSync(new URL('../../docs/commands.md', import.meta.url), 'utf8'));
  const law = commands.find((block) => block.key === 'block 1 under "The commands"')!.text;
  await inTemp(async (dir) => {
    const run = await lawcheck(exampleRepository(dir, law), ['check', '--base', 'main', '--json']);
    assert.deepEqual([run.code, run.stdout], [1, page.text(CHECK) + '\n']);
  });
}
