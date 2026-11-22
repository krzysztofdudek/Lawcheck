import assert from 'node:assert/strict';
import { KEY_F } from '../acceptance/helpers.ts';
import { SCENARIO, shows } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';
import { receiptCheck } from './index.ts';

export const claims: Claims = {
  'block 1 under "Law"': SCENARIO,
  'block 1 under "Finding"': SCENARIO,
  'block 1 under "Verdict"': SCENARIO,
};

export async function scenario(page: Page): Promise<void> {
  const run = await receiptCheck(page.text('block 1 under "Law"') + '\n');
  assert.equal(run.code, 1, run.stdout);
  shows(run.stdout, page.text('block 1 under "Finding"'));
  assert.equal(page.text('block 1 under "Verdict"'), `${KEY_F} clear-errors`, 'the line test 53 finds in .lawcheck/verdicts');
}
