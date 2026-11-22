import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { parseConfig } from '../../dist/config.js';
import { GITIGNORE } from '../../dist/init.js';
import { anthropic, defaultAnswer, withFake } from '../acceptance/fake-reviewer.ts';
import { git, GIT_ENV, inTemp, lawcheck, newRepository, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "A law shared by a team"': SCENARIO,
  'block 1 under "1. Give everyone one reviewer"': SCENARIO,
  'block 1 under "2. See the files with no verdict"': SCENARIO,
  'block 2 under "2. See the files with no verdict"': SCENARIO,
  'block 1 under "3. Record the reviews before you push"': SCENARIO,
  'block 2 under "3. Record the reviews before you push"': SCENARIO,
  'block 1 under "4. Commit what the review wrote"': SCENARIO,
  'block 2 under "4. Commit what the review wrote"': SCENARIO,
  'block 1 under "5. Merge two branches that both recorded reviews"': SCENARIO,
  'block 1 under "6. Check that both reviews hold"': SCENARIO,
  'block 2 under "6. Check that both reviews hold"': SCENARIO,
  'block 1 under "1. Write the attribute"': SCENARIO,
  'block 1 under "2. Merge the file again"': SCENARIO,
  'block 1 under "3. Commit the merge"': SCENARIO,
};

const RULE = 'Every error message a caller can see says what happened and what the caller can do next.\n';
const REFUND = "export function refund(): never {\n  throw new Error('The order is paid out already; open a new order to refund it again.');\n}\n";
const PRICE = "export function price(n: number): number {\n  if (n < 0) throw new Error('The price is below zero; pass a price of 0 or more.');\n  return n;\n}\n";

const command = (line: string, program: string): string[] => {
  assert.ok(line.startsWith(`$ ${program} `), line);
  return line.slice(`$ ${program} `.length).split(' ');
};
const shell = (repo: string, line: string): string => execFileSync('git', command(line, 'git'), { cwd: repo, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

export async function scenario(page: Page): Promise<void> {
  const config = page.text('block 1 under "1. Give everyone one reviewer"');
  assert.ok('config' in parseConfig(config), config);
  assert.equal((parse(config) as { reviewer: { provider: string } }).reviewer.provider, 'anthropic', 'the page names the key of anthropic');
  const review = command(page.text('block 1 under "3. Record the reviews before you push"'), 'lawcheck');
  const explain = command(page.text('block 1 under "6. Check that both reviews hold"'), 'lawcheck');
  const [add, commit] = page.text('block 1 under "3. Commit the merge"').split('\n');

  await withFake(async (fake) => {
    // The provider of the page sends its request to the fake reviewer, which takes the key of an endpoint.
    const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.base, LAWCHECK_REVIEWER_KEY: 'fake-key' };
    const branches = async (repo: string, attributes: boolean): Promise<void> => {
      for (const [branch, path, text] of [['refund', 'src/core/refund.ts', REFUND], ['price', 'src/core/price.ts', PRICE]] as const) {
        git(repo, 'checkout', '-q', '-b', branch, 'main');
        write(repo, path, text);
        if (branch === 'refund' && attributes) {
          const missed = await lawcheck(repo, command(page.text('block 1 under "2. See the files with no verdict"'), 'lawcheck'));
          assert.deepEqual([missed.code, missed.stdout], [1, page.text('block 2 under "2. See the files with no verdict"') + '\n']);
        }
        const run = await lawcheck(repo, review, env);
        assert.equal(run.code, 0, run.stdout);
        if (branch === 'refund' && attributes) {
          assert.equal(run.stdout, page.text('block 2 under "3. Record the reviews before you push"') + '\n');
          assert.equal(shell(repo, page.text('block 1 under "4. Commit what the review wrote"')), page.text('block 2 under "4. Commit what the review wrote"') + '\n');
        }
        git(repo, 'add', path, '.lawcheck/verdicts', ...(attributes ? ['.lawcheck/.gitattributes'] : []));
        git(repo, 'commit', '-q', '-m', branch);
        if (!attributes) rmSync(join(repo, '.lawcheck/.gitattributes'));
      }
      git(repo, 'checkout', '-q', 'main');
      git(repo, 'merge', '-q', 'refund');
    };
    const files = { '.lawcheck/law.yaml': page.text('block 1 under "A law shared by a team"'), '.lawcheck/rules/clear-errors.md': RULE, '.lawcheck/config.yaml': config, '.lawcheck/.gitignore': GITIGNORE };

    await inTemp(async (dir) => {
      const repo = newRepository(dir, files);
      await branches(repo, true);
      shell(repo, page.text('block 1 under "5. Merge two branches that both recorded reviews"').replace('git merge', 'git merge --no-edit'));
      const explained = await lawcheck(repo, explain);
      assert.deepEqual([explained.code, explained.stdout], [0, page.text('block 2 under "6. Check that both reviews hold"') + '\n']);
    });

    await inTemp(async (dir) => {
      const repo = newRepository(dir, files);
      await branches(repo, false);
      assert.throws(() => git(repo, 'merge', '--no-edit', 'price'), (error: { stdout?: string }) => /CONFLICT .*\.lawcheck\/verdicts/.test(error.stdout ?? ''), 'without the attribute the merge stops');
      write(repo, '.lawcheck/.gitattributes', page.text('block 1 under "1. Write the attribute"') + '\n');
      shell(repo, page.text('block 1 under "2. Merge the file again"'));
      shell(repo, add!);
      shell(repo, commit!);
      const explained = await lawcheck(repo, ['explain', 'src/core/price.ts']);
      assert.match(explained.stdout, /  clear-errors  reviewer  enforced  from library  reviewed  /, 'the pass of the branch merged second holds');
    });
  }, (request) => anthropic(defaultAnswer(request.prompt)));
}
