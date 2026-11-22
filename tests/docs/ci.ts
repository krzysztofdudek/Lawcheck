import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { anthropic, defaultAnswer, withFake } from '../acceptance/fake-reviewer.ts';
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
  'block 2 under "4. Keep cache folders out of the change"': SCENARIO,
  'block 1 under "5. Give the base on another CI service"': SCENARIO,
  'block 2 under "5. Give the base on another CI service"': SCENARIO,
  'block 3 under "5. Give the base on another CI service"': SCENARIO,
  'block 4 under "5. Give the base on another CI service"': SCENARIO,
  'block 1 under "6. Give the base on GitLab CI"': SCENARIO,
  'block 1 under "7. Give the base on Azure Pipelines"': SCENARIO,
  'block 1 under "Reviewer rules in CI"': SCENARIO,
  'block 1 under "1. Record the reviews before you push"': SCENARIO,
  'block 2 under "1. Record the reviews before you push"': SCENARIO,
  'block 1 under "2. Commit the verdicts"': SCENARIO,
  'block 1 under "A change to the law"': SCENARIO,
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
const REVIEWED = `lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.
  clear-errors:
    why: An error a caller sees says what happened and what to do next.

types:
  library:
    paths: ["src/core/**"]
    rules: [no-console, clear-errors]
`;
const REFUND = "export function refund(): never {\n  throw new Error('The order is paid out already; open a new order to refund it again.');\n}\n";

const args = (block: string): string[] => {
  assert.ok(block.startsWith('$ lawcheck '), block);
  return block.slice('$ lawcheck '.length).split(' ');
};
const output = (page: Page, key: string): string => page.text(key) + '\n';

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
  await inTemp(async (dir) => {
    const origin = newRepository(join(dir, 'origin'), { '.lawcheck/law.yaml': LAW, '.lawcheck/rules/no-console.mjs': NO_CONSOLE, '.gitignore': 'node_modules/\n' });
    git(origin, 'checkout', '-q', '-b', 'work');
    write(origin, 'src/core/total.ts', TOTAL);
    git(origin, 'add', '-A');
    git(origin, 'commit', '-q', '-m', 'total');
    const services: [step: string, clone: string[], env: NodeJS.ProcessEnv][] = [
      ['6. Give the base on GitLab CI', ['--single-branch', '--branch', 'work'], { GITLAB_CI: 'true', CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main' }],
      ['7. Give the base on Azure Pipelines', ['--branch', 'work'], { TF_BUILD: 'True', SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main' }],
      ['7. Give the base on Azure Pipelines', ['--branch', 'work'], { TF_BUILD: 'True', SYSTEM_PULLREQUEST_TARGETBRANCH: 'main' }],
    ];
    for (const [at, [step, options, env]] of services.entries()) {
      const clone = join(dir, `job-${at}`);
      git(dir, 'clone', '-q', ...options, origin, clone);
      if (step.includes('GitLab')) assert.throws(() => git(clone, 'rev-parse', '--verify', '-q', 'origin/main'), 'the job fetched its own branch alone');
      // A stand-in for the dev dependency, so npx --no-install starts the built tool with no network.
      write(clone, 'node_modules/lawcheck/package.json', JSON.stringify({ name: 'lawcheck', version: '0.0.0', bin: { lawcheck: 'cli.js' } }));
      write(clone, 'node_modules/.bin/lawcheck', `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
      chmodSync(join(clone, 'node_modules/.bin/lawcheck'), 0o755);
      // A script file inside the clone would count as a changed file.
      const script = join(dir, `job-${at}.sh`);
      write(dir, `job-${at}.sh`, page.text(`block 1 under "${step}"`) + '\n');
      const job = spawnSync('sh', [script], { cwd: clone, env: { ...GIT_ENV, npm_config_update_notifier: 'false', ...env }, encoding: 'utf8' });
      assert.equal(job.status, 1, `${step}\n${job.stdout}${job.stderr}`);
      assert.equal(job.stdout.split('\n')[0], 'lawcheck: FAIL  1 error in 1 changed file (against origin/main)', step);
      assert.match(job.stdout, /^src\/core\/total\.ts:2  error\[no-console\]/m, step);
    }
  });

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

  const ignore = /^echo (\S+) >> (\S+)$/.exec(page.text('block 2 under "4. Keep cache folders out of the change"'));
  assert.ok(ignore, 'the block appends one line to a file');
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n\ntypes:\n  source:\n    paths: ["src/**/*.ts"]\n', 'src/price.ts': 'export const price = 1;\n', '.gitignore': '.env\n' });
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, 'node_modules/left-pad/index.js', 'module.exports = 1;\n');
    write(repo, 'node_modules/left-pad/package.json', '{"name":"left-pad"}\n');
    const installed = await lawcheck(repo, ['check', '--base', 'main']);
    assert.deepEqual([installed.code, installed.stdout], [0, 'lawcheck: PASS  2 changed files (against main)\n'], 'the files of node_modules count as changed');
    appendFileSync(join(repo, ignore[2]!), `${ignore[1]}\n`);
    const ignored = await lawcheck(repo, ['check', '--base', 'main']);
    assert.deepEqual([ignored.code, ignored.stdout], [0, 'lawcheck: PASS  1 changed file (against main)\n'], 'only the edited .gitignore is in the change');
  });

  await inTemp(async (dir) => {
    const clone = job(dir, { '.gitignore': 'node_modules/\n' });
    write(clone, '.githooks/pre-commit', page.text('example pre-commit-hook') + '\n');
    // A stand-in for the dev dependency, so npx --no-install starts the built tool with no network.
    write(clone, 'node_modules/lawcheck/package.json', JSON.stringify({ name: 'lawcheck', version: '0.0.0', bin: { lawcheck: 'cli.js' } }));
    write(clone, 'node_modules/.bin/lawcheck', `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
    chmodSync(join(clone, 'node_modules/.bin/lawcheck'), 0o755);
    const run = (block: string): string => {
      const [program, ...args] = words(page.text(block).slice(2));
      return execFileSync(program!, args, { cwd: clone, env: { ...GIT_ENV, npm_config_update_notifier: 'false' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
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

  await inTemp(async (dir) => {
    const clone = job(dir, {});
    write(clone, 'src/core/total.ts', TOTAL);
    const step = '5. Give the base on another CI service';
    const none = await lawcheck(clone, args(page.text(`block 1 under "${step}"`)), { CI: 'true' });
    assert.deepEqual([none.code, none.stdout], [2, output(page, `block 2 under "${step}"`)], 'a CI job with no base');
    const given = await lawcheck(clone, args(page.text(`block 3 under "${step}"`)), { CI: 'true' });
    assert.deepEqual([given.code, given.stdout], [1, output(page, `block 4 under "${step}"`)], 'the base given');

    git(clone, 'checkout', '-q', '-b', 'law', 'origin/main');
    write(clone, '.lawcheck/law.yaml', LAW.replace('    rules: [no-console]\n', ''));
    write(clone, 'src/core/total.ts', TOTAL);
    const loosened = await lawcheck(clone, args(page.text('block 3 under "5. Give the base on another CI service"')));
    assert.deepEqual([loosened.code, loosened.stdout], [0, output(page, 'block 1 under "A change to the law"')], 'the first check of a change that loosens the law');
    git(clone, 'add', '-A');
    git(clone, 'commit', '-q', '-m', 'law');
    git(clone, 'checkout', 'origin/main', '--', '.lawcheck/law.yaml', '.lawcheck/rules');
    const second = await lawcheck(clone, args(page.text('block 3 under "5. Give the base on another CI service"')));
    assert.equal(second.code, 1, 'the check with the law of the base fails');
    assert.match(second.stdout, /^src\/core\/total\.ts:2  error\[no-console\]/m);
  });

  const record = args(page.text('block 1 under "1. Record the reviews before you push"'));
  await withFake(async (fake) => {
    await inTemp(async (dir) => {
      const clone = job(dir, { '.lawcheck/law.yaml': REVIEWED, '.lawcheck/rules/clear-errors.md': 'Every error message a caller can see says what happened and what the caller can do next.\n', '.lawcheck/config.yaml': 'reviewer:\n  provider: anthropic\n  model: your-model-id\n' });
      write(clone, 'src/core/refund.ts', REFUND);
      const plain = record.filter((word) => word !== '--review');
      const missing = await lawcheck(clone, plain, { CI: 'true' });
      assert.deepEqual([missing.code, missing.stdout], [1, output(page, 'block 1 under "Reviewer rules in CI"')], 'the job with no verdict');
      const recorded = await lawcheck(clone, record, { LAWCHECK_REVIEWER_ENDPOINT: fake.base, LAWCHECK_REVIEWER_KEY: 'fake-key' });
      assert.deepEqual([recorded.code, recorded.stdout], [0, output(page, 'block 2 under "1. Record the reviews before you push"')], 'the review');
      git(clone, 'add', 'src/core/refund.ts', '.lawcheck/verdicts', '.lawcheck/.gitattributes');
      git(clone, 'commit', '-q', '-m', 'refund');
      const calls = fake.requests.length;
      const passed = await lawcheck(clone, plain, { CI: 'true' });
      assert.deepEqual([passed.code, passed.stdout], [0, output(page, 'block 1 under "2. Commit the verdicts"')], 'the job after the commit');
      assert.equal(fake.requests.length, calls, 'the job calls no reviewer');
    });
  }, (request) => anthropic(defaultAnswer(request.prompt)));
}
