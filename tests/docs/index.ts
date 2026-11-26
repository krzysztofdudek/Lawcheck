import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, inTemp, lawcheck, newRepository, ROOT, write } from '../acceptance/helpers.ts';
import { blocksOf, SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "A law and a finding"': SCENARIO,
  'block 2 under "A law and a finding"': SCENARIO,
  'block 3 under "A law and a finding"': SCENARIO,
  'block 1 under "A rule and a finding"': SCENARIO,
  'block 2 under "A rule and a finding"': SCENARIO,
  'block 3 under "A rule and a finding"': SCENARIO,
  'block 1 under "Try it"': SCENARIO,
};

export const PRINT = 'export function print(text: string): void {\n  console.log(text);\n}\n';
export const RECEIPT = 'import { print } from "../cli/print.js";\n\nexport function receipt(sum: number): void {\n  print(`total: ${sum}`);\n}\n';

const DATED = 'import { print } from "../cli/print.js";\n\nexport function receipt(sum: number): void {\n  print(`${new Date().toISOString()} total: ${sum}`);\n}\n';

export async function receiptCheck(law: string, rules: Record<string, string> = {}, receipt = RECEIPT): Promise<{ code: number; stdout: string }> {
  return inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': law, 'src/cli/print.ts': PRINT, ...rules });
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, 'src/core/receipt.ts', receipt);
    const run = await lawcheck(repo, ['check', '--base', 'main']);
    return { code: run.code, stdout: run.stdout };
  });
}

export async function scenario(page: Page): Promise<void> {
  const install = blocksOf(readFileSync(join(ROOT, 'docs/install.md'), 'utf8')).find((block) => block.key === 'block 1 under "Install globally"');
  assert.equal(page.text('block 1 under "Try it"'), `${install?.text.replace(/^\$ /, '')}\nlawcheck docs quick-start`, 'the install line of docs/install.md, which test 205 runs, then the quick start');
  assert.equal(page.text('block 2 under "A law and a finding"'), '$ lawcheck check --base main');
  const run = await receiptCheck(page.text('block 1 under "A law and a finding"') + '\n');
  assert.equal(run.code, 1, run.stdout);
  assert.equal(run.stdout, page.text('block 3 under "A law and a finding"') + '\n');
  const ruled = await receiptCheck(page.text('block 2 under "A rule and a finding"') + '\n', { '.lawcheck/rules/no-clock.mjs': page.text('block 1 under "A rule and a finding"') + '\n' }, DATED);
  assert.equal(ruled.code, 1, ruled.stdout);
  assert.equal(ruled.stdout, page.text('block 3 under "A rule and a finding"') + '\n');
}
