import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, inTemp, lawcheck, newRepository, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const RECIPE = (kind: string) => `tests/environments/ci-recipes.nightly.test.ts > tests 306 and 307: S7-1, S7-2, S7-3, S7-4, the workflow and the hooks of docs/ci.md (design tests 15 and 16), run as written on ${kind}, as a pull request and as a push (network)`;

export const claims: Claims = {
  'block 1 under "Install it in the project"': 'tests/acceptance/ci-docs.test.ts > test 305: S7-1, the workflow of docs/ci.md installs the project with a command that works without a lockfile, and says how Lawcheck is installed',
  'example ci-workflow': RECIPE('npm-lock'),
  'example ci-install-pnpm': RECIPE('pnpm'),
  'example ci-install-yarn': RECIPE('yarn1'),
  'block 4 under "A CI job"': SCENARIO,
  'example pre-commit-hook': RECIPE('npm-lock'),
  'example pre-push-hook': RECIPE('npm-lock'),
};

export async function scenario(page: Page): Promise<void> {
  const exclude = /^echo (\S+) >> (\S+)$/.exec(page.text('block 4 under "A CI job"'));
  assert.ok(exclude, 'the block appends one line to a file');
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n\ntypes:\n  source:\n    paths: ["src/**/*.ts"]\n', 'src/price.ts': 'export const price = 1;\n' });
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, '.npm/_cacache/index-v5/00/index', 'a cache entry\n');
    const cached = await lawcheck(repo, ['check', '--base', 'main']);
    assert.deepEqual([cached.code, cached.stdout], [0, 'lawcheck: PASS  1 changed file (against main)\n'], 'the cache folder counts as changed');
    appendFileSync(join(repo, exclude[2]!), `${exclude[1]}\n`);
    const excluded = await lawcheck(repo, ['check', '--base', 'main']);
    assert.deepEqual([excluded.code, excluded.stdout], [0, 'lawcheck: PASS  nothing changed against main\n'], 'the excluded cache folder is not in the change');
  });
}
