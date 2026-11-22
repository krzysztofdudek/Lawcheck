import assert from 'node:assert/strict';
import { git, inTemp, lawcheck, newRepository, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "A law and a finding"': SCENARIO,
  'block 2 under "A law and a finding"': SCENARIO,
  'block 3 under "A law and a finding"': SCENARIO,
};

export const PRINT = 'export function print(text: string): void {\n  console.log(text);\n}\n';
export const RECEIPT = 'import { print } from "../cli/print.js";\n\nexport function receipt(sum: number): void {\n  print(`total: ${sum}`);\n}\n';

export async function receiptCheck(law: string): Promise<{ code: number; stdout: string }> {
  return inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': law, 'src/cli/print.ts': PRINT });
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, 'src/core/receipt.ts', RECEIPT);
    const run = await lawcheck(repo, ['check', '--base', 'main']);
    return { code: run.code, stdout: run.stdout };
  });
}

export async function scenario(page: Page): Promise<void> {
  assert.equal(page.text('block 2 under "A law and a finding"'), '$ lawcheck check --base main');
  const run = await receiptCheck(page.text('block 1 under "A law and a finding"') + '\n');
  assert.equal(run.code, 1, run.stdout);
  assert.equal(run.stdout, page.text('block 3 under "A law and a finding"') + '\n');
}
