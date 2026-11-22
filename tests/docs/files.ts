import assert from 'node:assert/strict';
import { inTemp, lawcheck, newRepository, read } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const IGNORE = 'block 1 under "The folder .lawcheck"';

export const claims: Claims = {
  [IGNORE]: SCENARIO,
};

export async function scenario(page: Page): Promise<void> {
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    const run = await lawcheck(repo, ['init']);
    assert.equal(run.code, 0, run.stdout);
    assert.equal(read(repo, '.lawcheck/.gitignore'), page.text(IGNORE) + '\n');
  });
}
