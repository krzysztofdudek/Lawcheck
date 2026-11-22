import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { CLI, git, GIT_ENV, inTemp, lawcheck, newRepository, NO_CONSOLE, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const RECIPE = (kind: string) => `tests/environments/ci-recipes.nightly.test.ts > tests 306 and 307: S7-1, S7-2, S7-3, S7-4, the workflow and the hooks of docs/ci.md (design tests 15 and 16), run as written on ${kind}, as a pull request and as a push (network)`;

export const claims: Claims = {
  'block 1 under "1. Install Lawcheck in the project"': 'tests/acceptance/ci-docs.test.ts > test 305: S7-1, the workflow of docs/ci.md installs the project with a command that works without a lockfile, and says how Lawcheck is installed',
  'example ci-workflow': RECIPE('npm-lock'),
  'example ci-install-pnpm': RECIPE('pnpm'),
  'example ci-install-yarn': RECIPE('yarn1'),
  'block 1 under "4. Keep cache folders out of the change"': SCENARIO,
  'example pre-commit-hook': SCENARIO,
  'block 1 under "2. Make it executable"': SCENARIO,
  'block 1 under "3. Make git read the folder"': SCENARIO,
  'block 1 under "4. Commit a breach"': SCENARIO,
  'block 2 under "4. Commit a breach"': SCENARIO,
  'example pre-push-hook': RECIPE('npm-lock'),
};

const LAW = `lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.

types:
  library:
    paths: ["src/core/**"]
    rules: [no-console]
`;
const TOTAL = 'export function total(price: number): number {\n  console.log(price);\n  return price;\n}\n';

// The words of a command line as sh splits them, for the lines of these blocks: no variable, no escape.
const words = (line: string): string[] => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);

function job(dir: string, files: Record<string, string>): string {
  const origin = newRepository(join(dir, 'origin'), { '.lawcheck/law.yaml': LAW, '.lawcheck/rules/no-console.mjs': NO_CONSOLE, ...files });
  const clone = join(dir, 'job');
  git(dir, 'clone', '-q', origin, clone);
  git(clone, 'remote', 'set-head', 'origin', '-d');
  git(clone, 'checkout', '-q', '-b', 'work');
  return clone;
}

export async function scenario(page: Page): Promise<void> {
  const exclude = /^echo (\S+) >> (\S+)$/.exec(page.text('block 1 under "4. Keep cache folders out of the change"'));
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

  await inTemp(async (dir) => {
    const hook = page.text('example pre-commit-hook') + '\n';
    const clone = job(dir, { '.githooks/pre-commit': hook, '.gitignore': 'node_modules/\n' });
    // A stand-in for the dev dependency, so npx --no-install starts the built tool with no network.
    write(clone, 'node_modules/lawcheck/package.json', JSON.stringify({ name: 'lawcheck', version: '0.0.0', bin: { lawcheck: 'cli.js' } }));
    write(clone, 'node_modules/.bin/lawcheck', `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
    chmodSync(join(clone, 'node_modules/.bin/lawcheck'), 0o755);
    const run = (block: string): string => {
      const [program, ...args] = words(page.text(block).slice(2));
      return execFileSync(program!, args, { cwd: clone, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    };
    run('block 1 under "2. Make it executable"');
    run('block 1 under "3. Make git read the folder"');
    write(clone, 'src/core/total.ts', TOTAL);
    git(clone, 'add', 'src/core/total.ts');
    const refused = (() => {
      try {
        run('block 1 under "4. Commit a breach"');
      } catch (error) {
        return error as { status: number; stdout: string; stderr: string };
      }
      return null;
    })();
    assert.ok(refused, 'the hook refuses the commit');
    assert.equal(refused.status, 1);
    assert.equal(refused.stdout + refused.stderr, page.text('block 2 under "4. Commit a breach"') + '\n');
    assert.equal(git(clone, 'rev-list', '--count', 'origin/main..HEAD').trim(), '0', 'git keeps the commit out');
  });
}
