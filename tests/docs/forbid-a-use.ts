import assert from 'node:assert/strict';
import { git, inTemp, lawcheck, read, write } from '../acceptance/helpers.ts';
import { SCENARIO, shows } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const RUNS: Record<string, number> = {
  '2. See the list a file gets': 0,
  '4. Check it': 1,
  '6. Check it again': 0,
  '8. Check it with the new import': 0,
  '9. List the unresolved uses': 0,
  '10. Check the whole folder': 0,
  '12. Check the folder again': 0,
};
const EDITS = ['1. Give core a may_use list', '3. Write a file that breaks the list', '5. Fix the import', '7. Add an import of a file git does not list', '11. Leave the .sql files out of core'];
const STEPS = [...EDITS, ...Object.keys(RUNS)].sort((a, b) => parseInt(a) - parseInt(b));

export const claims: Claims = Object.fromEntries(STEPS.flatMap((step) => (step in RUNS ? [`block 1 under "${step}"`, `block 2 under "${step}"`] : [`block 1 under "${step}"`])).map((key) => [key, SCENARIO]));

const LAW = `lawcheck: 0.1.0

types:
  api:
    about: The HTTP handlers.
    paths: ["src/api/**"]
  core:
    about: The business logic.
    paths: ["src/core/**"]
`;

const FILES: Record<string, string> = {
  '.gitignore': 'src/generated/\n',
  '.lawcheck/law.yaml': LAW,
  'src/api/orders.ts': "import { price } from '../core/price';\n\nexport const order = price;\n",
  'src/core/price.ts': 'export const price = 1;\n',
  'src/core/orders.sql': 'select id from orders;\n',
};

export async function scenario(page: Page): Promise<void> {
  await inTemp(async (dir) => {
    const repo = `${dir}/repo`;
    for (const [path, text] of Object.entries(FILES)) write(repo, path, text);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'first');
    write(repo, 'src/generated/schema.ts', 'export const schema = 1;\n');
    for (const step of STEPS) {
      const block = page.text(`block 1 under "${step}"`);
      if (step.startsWith('1.')) write(repo, '.lawcheck/law.yaml', block + '\n');
      else if (step.startsWith('11.')) write(repo, '.lawcheck/law.yaml', read(repo, '.lawcheck/law.yaml').replace('    paths: ["src/core/**"]', block));
      else if (!(step in RUNS)) write(repo, 'src/core/discount.ts', block + '\n');
      else {
        const run = await lawcheck(repo, block.replace(/^\$ lawcheck /, '').split(' '));
        const shown = page.text(`block 2 under "${step}"`);
        if (step.startsWith('9.')) shows(run.stdout, shown);
        else assert.equal(run.stdout, shown + '\n', step);
        assert.equal(run.code, RUNS[step], step);
      }
    }
  });
}
