import assert from 'node:assert/strict';
import { inTemp, lawcheck, makeSample } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const NODE_22 = 'block 1 under "Refused environments"';

export const claims: Claims = {
  [NODE_22]: SCENARIO,
};

// The real Node runs the check and reports Node 22.11.0, as tests/environments/refusal.test.ts poses it; the install matrix runs a real Node 22 every night.
const POSED = ['--import', 'data:text/javascript,Object.defineProperty(process.versions,"node",{value:"22.11.0",enumerable:true})'];

export async function scenario(page: Page): Promise<void> {
  await inTemp(async (dir) => {
    const run = await lawcheck(makeSample(dir), ['check', '--base', 'main'], {}, POSED);
    assert.deepEqual([run.code, run.stdout], [2, page.text(NODE_22) + '\n']);
  });
}
