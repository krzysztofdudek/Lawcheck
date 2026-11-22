import assert from 'node:assert/strict';
import { checkAnswer } from '../../dist/prompt.js';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const READ = 'tests/acceptance/docs.test.ts > test 129: every page holds what section 7 asks, and its examples are real';

export const claims: Claims = {
  'block 1 under "The rule file"': READ,
  'block 1 under "What it must answer"': SCENARIO,
  'block 1 under "Asking the reviewer"': READ,
  'block 1 under "Trying a reviewer rule"': READ,
};

export async function scenario(page: Page): Promise<void> {
  const answer = page.text('block 1 under "What it must answer"');
  assert.deepEqual(checkAnswer(answer, 12), { verdict: 'fail', findings: [{ line: 12, message: 'what breaks the rule on this line' }] });
  assert.ok('problem' in checkAnswer(answer, 11), 'a line outside the file is a bad answer');
}
