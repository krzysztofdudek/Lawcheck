import assert from 'node:assert/strict';
import { git, inTemp, lawcheck, newRepository, read, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "Script rules"': SCENARIO,
  'block 1 under "The syntax tree"': SCENARIO,
  'block 2 under "The syntax tree"': SCENARIO,
  'block 3 under "The syntax tree"': SCENARIO,
  'block 4 under "The syntax tree"': SCENARIO,
  'block 1 under "Trying a rule"': 'tests/acceptance/docs.test.ts > test 129: every page holds what section 7 asks, and its examples are real',
};

export async function scenario(page: Page): Promise<void> {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, {
      '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n\nrules:\n  no-todo:\n    why: A TODO without an issue number gets forgotten.\n\ntypes:\n  source:\n    paths: ["src/**/*.ts"]\n    rules: [no-todo]\n',
      'src/tax.ts': '// TODO round the tax\n// TODO #12 round the discount\nexport const tax = 1;\n',
    });
    write(repo, '.lawcheck/rules/no-todo.mjs', page.text('block 1 under "Script rules"') + '\n');
    const run = await lawcheck(repo, ['try', 'no-todo', 'src/tax.ts']);
    assert.deepEqual([run.code, run.stdout], [1, [
      'lawcheck: try no-todo (script rule, enforced)  1 finding in 1 of 1 file',
      '',
      'src/tax.ts:1  error[no-todo]  TODO without an issue number',
      '  why:  A TODO without an issue number gets forgotten.',
      '',
    ].join('\n')]);
  });
  await inTemp(async (dir) => {
    const repo = newRepository(dir, {
      '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n\nrules:\n  no-eval:\n    why: eval runs text that nobody reviewed as code.\n\ntypes:\n  source:\n    paths: ["src/**/*.ts"]\n    rules: [no-eval]\n',
      'src/run.ts': 'const note = "eval(x)"; // eval(y)\neval(note);\n',
    });
    write(repo, '.lawcheck/rules/no-eval.mjs', page.text('block 1 under "The syntax tree"') + '\n');
    const run = await lawcheck(repo, ['try', 'no-eval', 'src/run.ts']);
    assert.deepEqual([run.code, run.stdout], [1, [
      'lawcheck: try no-eval (script rule, enforced)  1 finding in 1 of 1 file',
      '',
      'src/run.ts:2  error[no-eval]  eval runs text as code',
      '  why:  eval runs text that nobody reviewed as code.',
      '',
    ].join('\n')]);
    assert.equal(page.text('block 2 under "The syntax tree"') + '\n', read(repo, 'src/run.ts'));
    const tree = await lawcheck(repo, page.text('block 3 under "The syntax tree"').replace(/^\$ lawcheck /, '').split(' '));
    assert.deepEqual([tree.code, tree.stdout], [0, page.text('block 4 under "The syntax tree"') + '\n']);
  });
}
