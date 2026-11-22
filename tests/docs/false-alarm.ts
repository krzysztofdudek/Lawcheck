import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { git, inTemp, newRepository, write } from '../acceptance/helpers.ts';
import { blocksOf, SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';
import { walk } from './write-a-reviewer-rule.ts';

export const claims: Claims = {
  'block 1 under "A finding you believe is wrong"': SCENARIO,
  'block 2 under "A finding you believe is wrong"': SCENARIO,
  'block 1 under "1. Read the finding"': SCENARIO,
  'block 2 under "1. Read the finding"': SCENARIO,
  'block 1 under "2. Check the type"': SCENARIO,
  'block 2 under "2. Check the type"': SCENARIO,
  'block 1 under "3. Check the rule alone"': SCENARIO,
  'block 2 under "3. Check the rule alone"': SCENARIO,
  'block 1 under "5. Fix the rule"': SCENARIO,
  'block 2 under "5. Fix the rule"': SCENARIO,
  'block 3 under "5. Fix the rule"': SCENARIO,
  'block 1 under "6. Waive the one line"': SCENARIO,
  'block 2 under "6. Waive the one line"': SCENARIO,
  'block 3 under "6. Waive the one line"': SCENARIO,
  'block 1 under "7. Find the waivers that waive nothing"': SCENARIO,
  'block 2 under "7. Find the waivers that waive nothing"': SCENARIO,
  'block 1 under "8. Remove it"': SCENARIO,
  'block 2 under "8. Remove it"': SCENARIO,
  'block 3 under "8. Remove it"': SCENARIO,
};

const adopt = readFileSync(new URL('../../docs/adopt-in-an-existing-repository.md', import.meta.url), 'utf8');
const blockOf = (key: string) => blocksOf(adopt).find((block) => block.key === key)!.text + '\n';
const LAW = blockOf('block 1 under "9. Make the rule enforced"');
const RULE = blockOf('block 1 under "3. Write the rule"');

export async function scenario(page: Page): Promise<void> {
  const round = page.text('block 1 under "8. Remove it"') + '\n';
  const older = page.text('block 1 under "A finding you believe is wrong"') + '\n';
  assert.deepEqual(older.split('\n').filter((_, at) => at !== 1), round.split('\n'), 'step 8 deletes line 2 of round.ts');
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': LAW, '.lawcheck/.gitignore': '.local/\nconfig.local.yaml\n', '.lawcheck/rules/no-console.mjs': RULE, 'src/core/round.ts': older });
    git(repo, 'checkout', '-q', '-b', 'work');
    const format = page.text('block 2 under "A finding you believe is wrong"') + '\n';
    write(repo, 'src/core/format.ts', format);
    await walk(page, repo, '1. Read the finding', 1);
    await walk(page, repo, '2. Check the type', 0);
    await walk(page, repo, '3. Check the rule alone', 1);
    write(repo, '.lawcheck/rules/no-console.mjs', page.text('block 1 under "5. Fix the rule"') + '\n');
    await walk(page, repo, '5. Fix the rule', 1, {}, 2);
    const waived = page.text('block 1 under "6. Waive the one line"') + '\n';
    assert.deepEqual(waived.split('\n').filter((line, at) => line !== format.split('\n')[at]).length, 1, 'step 6 edits one line');
    write(repo, 'src/core/format.ts', waived);
    await walk(page, repo, '6. Waive the one line', 0, {}, 2);
    await walk(page, repo, '7. Find the waivers that waive nothing', 0);
    write(repo, 'src/core/round.ts', round);
    await walk(page, repo, '8. Remove it', 0, {}, 2);
  });
}
