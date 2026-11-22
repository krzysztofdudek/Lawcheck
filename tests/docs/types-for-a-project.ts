import assert from 'node:assert/strict';
import { git, inTemp, lawcheck, read, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const STEPS = [
  '1. See the files without a type',
  '2. Describe the folders as types',
  '3. See the files of each type',
  '4. See why a file has its type',
  '5. List the files of one type',
  '6. Add a type for the tests',
  '7. Run a check',
  '8. Leave the tests out of source',
  '9. See the type of the test',
  '10. Leave the generated file out',
  '11. See the generated file',
  '12. See the type of a file you have not written yet',
  '13. Write a test beside the code',
  '14. Give the tests beside the code a type by their text',
  '15. See the type a file gets by its text',
];
const EDITS = new Set(['2. Describe the folders as types', '6. Add a type for the tests', '8. Leave the tests out of source', '10. Leave the generated file out', '13. Write a test beside the code', '14. Give the tests beside the code a type by their text']);
const CORE = '      core:\n        about: The business logic.\n        paths: ["src/core/**"]\n';

export const claims: Claims = Object.fromEntries(STEPS.flatMap((step) => (EDITS.has(step) ? [`block 1 under "${step}"`] : [`block 1 under "${step}"`, `block 2 under "${step}"`])).map((key) => [key, SCENARIO]));

const FILES: Record<string, string> = {
  'scripts/release.mjs': "console.log('release');\n",
  'src/api/orders.ts': 'export const order = 1;\n',
  'src/core/price.ts': 'export const price = 1;\n',
  'src/core/price.test.ts': "import { price } from './price';\nexport const test = price;\n",
  'src/db/orders.ts': 'export const rows = [];\n',
  'src/generated/schema.ts': 'export const schema = {};\n',
};

const LAW = '.lawcheck/law.yaml';

function words(line: string): string[] {
  return [...line.matchAll(/'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2]!);
}

function paths(repo: string, line: string): void {
  const law = read(repo, LAW);
  const at = law.indexOf('    paths: ["src/**/*.ts"');
  assert.ok(at >= 0, law);
  write(repo, LAW, law.slice(0, at) + line + law.slice(law.indexOf('\n', at)));
}

export async function scenario(page: Page): Promise<void> {
  await inTemp(async (dir) => {
    const repo = `${dir}/repo`;
    for (const [path, text] of Object.entries(FILES)) write(repo, path, text);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'first');
    assert.equal((await lawcheck(repo, ['init'])).code, 0);
    for (const step of STEPS) {
      const block = page.text(`block 1 under "${step}"`);
      if (step.startsWith('2.')) write(repo, LAW, block + '\n');
      else if (step.startsWith('6.')) write(repo, LAW, read(repo, LAW) + block + '\n');
      else if (step.startsWith('13.')) write(repo, 'src/core/rounding.ts', block + '\n');
      else if (step.startsWith('14.')) {
        const law = read(repo, LAW);
        assert.ok(law.includes(CORE), law);
        write(repo, LAW, law.replace(CORE, block + '\n'));
      }
      else if (EDITS.has(step)) paths(repo, block);
      else {
        const run = await lawcheck(repo, words(block.replace(/^\$ lawcheck /, '')));
        assert.equal(run.stdout, page.text(`block 2 under "${step}"`) + '\n', step);
        assert.equal(run.code, step.startsWith('7.') ? 2 : 0, step);
      }
    }
  });
}
