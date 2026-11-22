import assert from 'node:assert/strict';
import { git, inTemp, lawcheck, newRepository, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';
import { commands, gitCommands, walk } from './write-a-reviewer-rule.ts';

export const claims: Claims = {
  'block 1 under "1. Start the law on a branch"': SCENARIO,
  'block 2 under "1. Start the law on a branch"': SCENARIO,
  'block 1 under "2. Write the law with an advisory rule"': SCENARIO,
  'block 1 under "3. Write the rule"': SCENARIO,
  'block 1 under "4. Check the branch"': SCENARIO,
  'block 2 under "4. Check the branch"': SCENARIO,
  'block 1 under "5. List the debt"': SCENARIO,
  'block 2 under "5. List the debt"': SCENARIO,
  'block 1 under "6. Merge the law"': SCENARIO,
  'block 1 under "7. Change an old file"': SCENARIO,
  'block 2 under "7. Change an old file"': SCENARIO,
  'block 3 under "7. Change an old file"': SCENARIO,
  'block 1 under "8. Pay the debt"': SCENARIO,
  'block 2 under "8. Pay the debt"': SCENARIO,
  'block 3 under "8. Pay the debt"': SCENARIO,
  'block 4 under "8. Pay the debt"': SCENARIO,
  'block 1 under "9. Make the rule enforced"': SCENARIO,
  'block 2 under "9. Make the rule enforced"': SCENARIO,
  'block 3 under "9. Make the rule enforced"': SCENARIO,
  'block 1 under "If it goes wrong"': SCENARIO,
};

const MAIN = {
  'src/core/report.ts': "export function report(total: number): void {\n  console.log('total', total);\n}\n",
  'src/core/tax.ts': "export function tax(cents: number): number {\n  console.warn('tax is rounded');\n  return Math.round(cents * 0.2);\n}\n",
  'src/core/price.ts': 'export function price(cents: number): number {\n  return cents;\n}\n',
  'src/cli/main.ts': "import { report } from '../core/report.js';\n\nconsole.log('start');\nreport(1);\n",
};

export async function scenario(page: Page): Promise<void> {
  const advisory = page.text('block 1 under "2. Write the law with an advisory rule"') + '\n';
  const rule = page.text('block 1 under "3. Write the rule"') + '\n';
  const enforced = page.text('block 1 under "9. Make the rule enforced"') + '\n';
  assert.equal(enforced, advisory.replace('    status: advisory\n', ''), 'step 9 deletes the status line and nothing else');
  await inTemp(async (dir) => {
    const repo = newRepository(dir, MAIN);
    const [checkout, init, ...rest] = commands(page.text('block 1 under "1. Start the law on a branch"'));
    assert.deepEqual([checkout, init, rest], [['git', 'checkout', '-b', 'law'], ['lawcheck', 'init'], []]);
    git(repo, ...checkout!.slice(1));
    const started = await lawcheck(repo, ['init']);
    assert.deepEqual([started.code, started.stdout], [0, page.text('block 2 under "1. Start the law on a branch"') + '\n']);
    write(repo, '.lawcheck/law.yaml', advisory);
    write(repo, '.lawcheck/rules/no-console.mjs', rule);
    await walk(page, repo, '4. Check the branch', 0);
    await walk(page, repo, '5. List the debt', 0);
    gitCommands(repo, page.text('block 1 under "6. Merge the law"'));
    assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main\n');
    git(repo, 'checkout', '-q', '-b', 'unit');
    write(repo, 'src/core/report.ts', page.text('block 1 under "7. Change an old file"') + '\n');
    await walk(page, repo, '7. Change an old file', 0, {}, 2);
    write(repo, 'src/core/report.ts', page.text('block 1 under "8. Pay the debt"') + '\n');
    write(repo, 'src/core/tax.ts', page.text('block 2 under "8. Pay the debt"') + '\n');
    await walk(page, repo, '8. Pay the debt', 0, {}, 3);
    write(repo, '.lawcheck/law.yaml', enforced);
    await walk(page, repo, '9. Make the rule enforced', 0, {}, 2);
    write(repo, 'src/core/price.ts', 'export function price(cents: number): number {\n  console.log(cents);\n  return cents;\n}\n');
    const caught = await lawcheck(repo, ['check', '--base', 'main']);
    assert.equal(caught.code, 1, `an enforced rule fails a new console call\n${caught.stdout}`);
  });
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { ...MAIN, '.lawcheck/law.yaml': enforced, '.lawcheck/rules/no-console.mjs': rule });
    git(repo, 'checkout', '-q', '-b', 'unit');
    write(repo, 'src/core/report.ts', page.text('block 1 under "7. Change an old file"') + '\n');
    const run = await lawcheck(repo, ['check', '--base', 'main']);
    assert.deepEqual([run.code, run.stdout], [1, page.text('block 1 under "If it goes wrong"') + '\n']);
  });
}
