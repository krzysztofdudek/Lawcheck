import assert from 'node:assert/strict';
import { git, inTemp, lawcheck, read, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const RUNS: Record<string, number> = {
  '4. See the files the rule binds': 0,
  '5. Try the rule': 1,
  '6. Check the code': 1,
  '8. Check the code again': 0,
  '10. Try the broken rule': 2,
  '12. Try the rule again': 1,
};
const EDITS = ['1. Add the rule to the law', '2. Write a helper the rules share', '3. Write the rule', '7. Make the rule advisory', '9. Put a typo in the helper', '11. Fix the helper'];
const STEPS = [...EDITS, ...Object.keys(RUNS)].sort((a, b) => parseInt(a) - parseInt(b));

const TREE = '13. Read the syntax tree';

export const claims: Claims = Object.fromEntries([...STEPS.flatMap((step) => (step in RUNS ? [`block 1 under "${step}"`, `block 2 under "${step}"`] : [`block 1 under "${step}"`])), ...[1, 2, 3, 4].map((n) => `block ${n} under "${TREE}"`)].map((key) => [key, SCENARIO]));

const FILES: Record<string, string> = {
  '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n\ntypes:\n  source:\n    about: Everything that ships.\n    paths: ["src/**/*.ts"]\n    types:\n      api:\n        about: The HTTP handlers.\n        paths: ["src/api/**"]\n      core:\n        about: The business logic.\n        paths: ["src/core/**"]\n',
  'src/api/orders.ts': "export const orders = () => fetch('/orders');\n",
  'src/core/price.ts': "export async function rate() {\n  const answer = await fetch('/rate');\n  return answer.json();\n}\n",
  'src/core/tax.ts': 'export const tax = 0.23;\n',
};

const LAW = '.lawcheck/law.yaml';
const HELPER = '.lawcheck/rules/lib/lines.mjs';

function swap(repo: string, path: string, from: string, to: string): void {
  const text = read(repo, path);
  assert.ok(text.includes(from), `${path} holds ${from}`);
  write(repo, path, text.replace(from, to));
}

export async function scenario(page: Page): Promise<void> {
  await inTemp(async (dir) => {
    const repo = `${dir}/repo`;
    for (const [path, text] of Object.entries(FILES)) write(repo, path, text);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'first');
    let line = '';
    for (const step of STEPS) {
      const block = page.text(`block 1 under "${step}"`);
      if (step.startsWith('1.')) write(repo, LAW, block + '\n');
      else if (step.startsWith('2.')) write(repo, HELPER, block + '\n');
      else if (step.startsWith('3.')) write(repo, '.lawcheck/rules/no-fetch.mjs', block + '\n');
      else if (step.startsWith('7.')) swap(repo, LAW, read(repo, LAW).slice(read(repo, LAW).indexOf('rules:'), read(repo, LAW).indexOf('\n\ntypes:')), block);
      else if (step.startsWith('9.')) {
        line = read(repo, HELPER).split('\n').find((l) => l.trim().startsWith('file.lines.'))!;
        swap(repo, HELPER, line, block);
      } else if (step.startsWith('11.')) {
        assert.equal(block, line, 'the fix gives back the line of step 2');
        swap(repo, HELPER, page.text('block 1 under "9. Put a typo in the helper"'), block);
      } else {
        const run = await lawcheck(repo, block.replace(/^\$ lawcheck /, '').split(' '));
        assert.equal(run.stdout, page.text(`block 2 under "${step}"`) + '\n', step);
        assert.equal(run.code, RUNS[step], step);
      }
    }
    write(repo, 'src/core/cart.ts', page.text(`block 1 under "${TREE}"`) + '\n');
    const lines = await lawcheck(repo, ['try', 'no-fetch']);
    assert.ok(lines.stdout.includes('src/core/cart.ts:1  warning[no-fetch]') && lines.stdout.includes('src/core/cart.ts:3  warning[no-fetch]'), lines.stdout);
    write(repo, '.lawcheck/rules/no-fetch.mjs', page.text(`block 2 under "${TREE}"`) + '\n');
    const run = await lawcheck(repo, page.text(`block 3 under "${TREE}"`).replace(/^\$ lawcheck /, '').split(' '));
    assert.equal(run.stdout, page.text(`block 4 under "${TREE}"`) + '\n', TREE);
    assert.ok(run.stdout.includes('src/core/cart.ts:3  warning[no-fetch]') && !run.stdout.includes('src/core/cart.ts:1 '), run.stdout);
    assert.equal(run.code, 1, TREE);
  });
}
