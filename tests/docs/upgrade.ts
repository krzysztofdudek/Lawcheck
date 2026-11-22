import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { append, git, inTemp, lawcheck, newRepository, ROOT, write } from '../acceptance/helpers.ts';
import { blocksOf, SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';
import { PRINT } from './index.ts';

const VERSION = '2. Check the version';
const PLUGIN = '3. Update the Claude Code plugin';
const LIST = '4. List what the new version finds';
const TYPE = '5. Give the tests a type of their own';
const AGAIN = '6. Check the whole code again';
const FAILS = 'A law that passed now fails';

export const claims: Claims = Object.fromEntries(
  [
    `block 1 under "${VERSION}"`,
    `block 1 under "${PLUGIN}"`,
    `block 1 under "${LIST}"`,
    `block 2 under "${LIST}"`,
    `block 3 under "${LIST}"`,
    `block 1 under "${TYPE}"`,
    `block 1 under "${AGAIN}"`,
    `block 2 under "${AGAIN}"`,
    `block 1 under "${FAILS}"`,
    `block 2 under "${FAILS}"`,
  ].map((key) => [key, SCENARIO]),
);

const PRICE = 'export function total(prices: number[]): number {\n  return prices.reduce((sum, price) => sum + price, 0);\n}\n';
const ANOTHER_TEST = "\ntest('empty', () => {\n  expect(total([])).toBe(0);\n});\n";

const read = (path: string): string => readFileSync(`${ROOT}/${path}`, 'utf8');
const argv = (block: string): string[] => block.replace(/^\$ lawcheck /, '').split(' ');

// The page says the repository has the law of the home page, so the scenario takes that law from docs/index.md.
function indexLaw(): string {
  const block = blocksOf(read('docs/index.md')).find((b) => b.key === 'block 1 under "A law and a finding"');
  assert.ok(block, 'docs/index.md shows its law');
  return block.text;
}

function upgradeBranch(dir: string, test: string): string {
  const repo = newRepository(dir, { '.lawcheck/law.yaml': indexLaw(), 'src/cli/print.ts': PRINT, 'src/core/price.ts': PRICE, 'src/core/price.test.ts': test });
  git(repo, 'checkout', '-q', '-b', 'upgrade');
  return repo;
}

export async function scenario(page: Page): Promise<void> {
  const { version } = JSON.parse(read('package.json')) as { version: string };
  await inTemp(async (dir) => {
    const run = await lawcheck(dir, ['--version']);
    assert.deepEqual([run.code, run.stdout], [0, page.text(`block 1 under "${VERSION}"`) + '\n']);
    assert.equal(run.stdout, `${version}\n`);
  });

  const marketplace = JSON.parse(read('.claude-plugin/marketplace.json')) as { name: string; plugins: { name: string; source: string }[] };
  const plugin = marketplace.plugins.find((entry) => entry.source === './plugin');
  assert.ok(plugin, 'the marketplace lists the plugin of plugin/');
  assert.equal(page.text(`block 1 under "${PLUGIN}"`), [`claude plugin marketplace update ${marketplace.name}`, `claude plugin update ${plugin.name}@${marketplace.name}`].join('\n'));

  const test = page.text(`block 1 under "${LIST}"`) + '\n';
  await inTemp(async (dir) => {
    const repo = upgradeBranch(dir, test);
    const list = await lawcheck(repo, argv(page.text(`block 2 under "${LIST}"`)));
    assert.deepEqual([list.code, list.stdout], [0, page.text(`block 3 under "${LIST}"`) + '\n']);
    write(repo, '.lawcheck/law.yaml', page.text(`block 1 under "${TYPE}"`) + '\n');
    const again = await lawcheck(repo, argv(page.text(`block 1 under "${AGAIN}"`)));
    assert.deepEqual([again.code, again.stdout], [0, page.text(`block 2 under "${AGAIN}"`) + '\n']);
  });

  await inTemp(async (dir) => {
    const repo = upgradeBranch(dir, test);
    append(repo, 'src/core/price.test.ts', ANOTHER_TEST);
    const fails = await lawcheck(repo, argv(page.text(`block 1 under "${FAILS}"`)));
    assert.deepEqual([fails.code, fails.stdout], [1, page.text(`block 2 under "${FAILS}"`) + '\n']);
  });
}
