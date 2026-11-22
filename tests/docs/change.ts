import assert from 'node:assert/strict';
import { git, inTemp, lawcheck, newRepository, write } from '../acceptance/helpers.ts';
import { SCENARIO, shows } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const READ = 'tests/acceptance/docs.test.ts > test 129: every page holds what section 7 asks, and its examples are real';

export const claims: Claims = {
  'block 1 under "The base"': READ,
  'block 1 under "--full and debt"': READ,
  'block 1 under "What a plain check leaves out"': SCENARIO,
};

const LAW = (rules: string) => `lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.

types:
  source:
    paths: ["src/**/*.ts"]
    types:
      library:
        paths: ["src/core/**"]
${rules}`;

export async function scenario(page: Page): Promise<void> {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, {
      '.lawcheck/law.yaml': LAW('        rules: [no-console]\n'),
      '.lawcheck/rules/no-console.mjs': 'export function check() {\n  return [];\n}\n',
      'src/core/price.ts': 'export const price = 1;\n',
    });
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, '.lawcheck/law.yaml', LAW(''));
    const run = await lawcheck(repo, ['check', '--base', 'main']);
    assert.equal(run.code, 0, run.stdout);
    shows(run.stdout, page.text('block 1 under "What a plain check leaves out"'));
  });
}
