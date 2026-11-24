import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inTemp, lawcheck, newRepository, read } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const IGNORE = 'block 1 under "The folder .lawcheck"';

export const claims: Claims = {
  [IGNORE]: SCENARIO,
};

const PROPOSALS = ['.lawcheck/advice.md', '.lawcheck/target.md'];

export async function scenario(page: Page): Promise<void> {
  const text = readFileSync(new URL('../../docs/files.md', import.meta.url), 'utf8');
  for (const proposal of PROPOSALS) {
    const row = text.split('\n').find((line) => line.startsWith(`| \`${proposal}\` |`));
    assert.ok(row, `the table of the folder .lawcheck has a row for ${proposal}`);
    assert.match(row, /nothing in it is law \| a coding agent in the setup skill of the Claude Code plugin, .*; no command of Lawcheck reads it \|/, proposal);
    assert.ok(readFileSync(new URL(`../../plugin/skills/setup/references/${proposal.slice('.lawcheck/'.length)}`, import.meta.url), 'utf8').includes(`\`${proposal}\``), `the skill's reference file writes ${proposal}`);
  }
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    const run = await lawcheck(repo, ['init']);
    assert.equal(run.code, 0, run.stdout);
    assert.equal(read(repo, '.lawcheck/.gitignore'), page.text(IGNORE) + '\n');
  });
}
