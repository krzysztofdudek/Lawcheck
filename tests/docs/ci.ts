import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { anthropic, defaultAnswer, withFake } from '../acceptance/fake-reviewer.ts';
import { atOnce, CLI, git, GIT_ENV, inTemp, lawcheck, newRepository, NO_CONSOLE, write } from '../acceptance/helpers.ts';
import { fakeWrites } from '../harness/tool.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const RECIPE = (kind: string) => `tests/environments/ci-recipes.nightly.test.ts > tests 306 and 307: S7-1, S7-2, S7-3, S7-4, the workflow and the hooks of docs/ci.md (design tests 15 and 16), run as written on ${kind}, as a pull request and as a push (network)`;

const SARIF = 'tests/acceptance/ci-docs.test.ts > test 1033: the code scanning recipe of docs/ci.md writes the SARIF file of every file from the first check, run as written on a pull request and on a push, and uploads it when the check fails too';

const ANNOTATE = 'tests/acceptance/ci-docs.test.ts > S7-13: the recipes of docs/ci.md turn --json into GitHub annotations and a GitLab code quality report, run as written';

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
  'example doctor-in-ci': 'tests/acceptance/ci-docs.test.ts > S7-16: the CI page says doctor is for a machine, and in a job that reads the committed verdicts doctor fails where check passes',
  'example annotations-script': ANNOTATE,
  'example annotations-step': ANNOTATE,
  'example code-quality-script': ANNOTATE,
  'example gitlab-code-quality-job': ANNOTATE,
  'example sarif-upload': SARIF,
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

// A shared cache of compiled modules for the programs of the scenario: each npx and each run of the tool starts node again, and with the cache the later starts skip compiling.
let COMPILED = '';
const withCache = (env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ NODE_COMPILE_CACHE: COMPILED, ...env });

// A program run without blocking the other sections: its exit code and what it wrote.
const started = (program: string, programArgs: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> =>
  new Promise((done, failed) => {
    const child = spawn(program, programArgs, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (text: string) => void (stdout += text));
    child.stderr.setEncoding('utf8').on('data', (text: string) => void (stderr += text));
    child.on('error', failed);
    child.on('close', (status) => done({ status, stdout, stderr }));
  });

// The sections of the scenario share no folder, so they run at once, as the other tests that run the tool per case do.

// The words of a command line as sh splits them, for the lines of these blocks: no variable, no escape.
const words = (line: string): string[] => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!);

// A stand-in for the dev dependency, so npx --no-install starts the built tool with no network.
function standIn(clone: string): void {
  write(clone, 'node_modules/lawcheck/package.json', JSON.stringify({ name: 'lawcheck', version: '0.0.0', bin: { lawcheck: 'cli.js' } }));
  write(clone, 'node_modules/.bin/lawcheck', `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
  chmodSync(join(clone, 'node_modules/.bin/lawcheck'), 0o755);
  // On Windows npm exec starts a bin through cmd.exe, which runs the .cmd file beside it and never the sh script; the sh script stays, because npm checks that this exact file exists before it starts the bin.
  if (process.platform === 'win32') write(clone, 'node_modules/.bin/lawcheck.cmd', `@"${process.execPath}" "${CLI}" %*\r\n`);
}

function job(dir: string, files: Record<string, string>): string {
  const origin = newRepository(join(dir, 'origin'), { '.lawcheck/law.yaml': LAW, '.lawcheck/rules/no-console.mjs': NO_CONSOLE, ...files });
  const clone = join(dir, 'job');
  git(dir, 'clone', '-q', origin, clone);
  git(clone, 'remote', 'set-head', 'origin', '-d');
  git(clone, 'checkout', '-q', '-b', 'work');
  return clone;
}

export async function scenario(page: Page): Promise<void> {
  await inTemp((cache) => {
    COMPILED = join(cache, 'compiled');
    fakeWrites(cache, ['compiled/']);
    return sections(page);
  });
}

async function sections(page: Page): Promise<void> {
  const all: [name: string, section: () => Promise<void>][] = [
    ['the reviews recorded before the push', async () => {
      const record = args(page.text('block 1 under "1. Record the reviews before you push"'));
      await withFake(async (fake) => {
        await inTemp(async (dir) => {
          const clone = job(dir, { '.lawcheck/law.yaml': REVIEWED, '.lawcheck/rules/clear-errors.md': 'Every error message a caller can see says what happened and what the caller can do next.\n', '.lawcheck/config.yaml': 'reviewer:\n  provider: anthropic\n  model: your-model-id\n' });
          write(clone, 'src/core/refund.ts', REFUND);
          const plain = record.filter((word) => word !== '--review');
          const missing = await lawcheck(clone, plain, withCache({ CI: 'true' }));
          assert.deepEqual([missing.code, missing.stdout], [1, output(page, 'block 1 under "Reviewer rules in CI"')], 'the job with no verdict');
          const recorded = await lawcheck(clone, record, withCache({ LAWCHECK_REVIEWER_ENDPOINT: fake.base, LAWCHECK_REVIEWER_KEY: 'fake-key' }));
          assert.deepEqual([recorded.code, recorded.stdout], [0, output(page, 'block 2 under "1. Record the reviews before you push"')], 'the review');
          git(clone, 'add', 'src/core/refund.ts', '.lawcheck/verdicts', '.lawcheck/.gitattributes');
          git(clone, 'commit', '-q', '-m', 'refund');
          const calls = fake.requests.length;
          const passed = await lawcheck(clone, plain, withCache({ CI: 'true' }));
          assert.deepEqual([passed.code, passed.stdout], [0, output(page, 'block 1 under "2. Commit the verdicts"')], 'the job after the commit');
          assert.equal(fake.requests.length, calls, 'the job calls no reviewer');
        });
      }, (request) => anthropic(defaultAnswer(request.prompt)));
    }],

    ['the jobs of GitLab CI and Azure Pipelines', () => inTemp(async (dir) => {
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
      await atOnce(services, services.length, ([step, , env]) => `${step} (${JSON.stringify(env)})`, async ([step, options, env], at) => {
        const clone = join(dir, `job-${at}`);
        git(dir, 'clone', '-q', '--shared', ...options, origin, clone);
        if (step.includes('GitLab')) assert.throws(() => git(clone, 'rev-parse', '--verify', '-q', 'origin/main'), 'the job fetched its own branch alone');
        standIn(clone);
        // A script file inside the clone would count as a changed file.
        const script = join(dir, `job-${at}.sh`);
        write(dir, `job-${at}.sh`, page.text(`block 1 under "${step}"`) + '\n');
        const job = await started('sh', [script], clone, withCache({ ...GIT_ENV, npm_config_update_notifier: 'false', ...env }));
        assert.equal(job.status, 1, `${step}\n${job.stdout}${job.stderr}`);
        assert.equal(job.stdout.split('\n')[0], 'lawcheck: FAIL  1 error in 1 changed file (against origin/main)', step);
        assert.match(job.stdout, /^src\/core\/total\.ts:2  error\[no-console\]/m, step);
      });
    })],

    ['a change to the law', () => inTemp(async (dir) => {
      const clone = job(dir, {});
      git(clone, 'checkout', '-q', '-b', 'law', 'origin/main');
      write(clone, '.lawcheck/law.yaml', LAW.replace('    rules: [no-console]\n', ''));
      write(clone, 'src/core/total.ts', TOTAL);
      const loosened = await lawcheck(clone, args(page.text('block 3 under "5. Give the base on another CI service"')), withCache());
      assert.deepEqual([loosened.code, loosened.stdout], [0, output(page, 'block 1 under "A change to the law"')], 'the first check of a change that loosens the law');
      git(clone, 'add', '-A');
      git(clone, 'commit', '-q', '-m', 'law');
      const second = await lawcheck(clone, [...args(page.text('block 3 under "5. Give the base on another CI service"')), '--law-from', 'origin/main'], withCache());
      assert.equal(second.code, 1, 'the check with the law of the base fails');
      assert.match(second.stdout, /^src\/core\/total\.ts:2  error\[no-console\]/m);
    })],

    ['the pre-commit hook', () => inTemp(async (dir) => {
      const clone = job(dir, { '.gitignore': 'node_modules/\n' });
      write(clone, '.githooks/pre-commit', page.text('example pre-commit-hook') + '\n');
      standIn(clone);
      const run = async (block: string): Promise<{ status: number | null; stdout: string; stderr: string }> => {
        const [program, ...args] = words(page.text(block).slice(2));
        return started(program!, args, clone, withCache({ ...GIT_ENV, npm_config_update_notifier: 'false' }));
      };
      for (const block of ['block 1 under "2. Make it executable"', 'block 1 under "3. Make git read the folder"']) {
        const made = await run(block);
        assert.equal(made.status, 0, `${block}\n${made.stdout}${made.stderr}`);
      }
      write(clone, 'src/core/total.ts', TOTAL);
      git(clone, 'add', 'src/core/total.ts');
      const refused = await run('block 1 under "4. Commit a breach"');
      assert.equal(refused.status, 1, 'the hook refuses the commit');
      assert.equal(refused.stdout + refused.stderr, page.text('block 2 under "4. Commit a breach"') + '\n');
      assert.equal(git(clone, 'rev-list', '--count', 'origin/main..HEAD').trim(), '0', 'git keeps the commit out');
    })],

    ['the base on another CI service', () => inTemp(async (dir) => {
      const clone = job(dir, {});
      write(clone, 'src/core/total.ts', TOTAL);
      const step = '5. Give the base on another CI service';
      const none = await lawcheck(clone, args(page.text(`block 1 under "${step}"`)), withCache({ CI: 'true' }));
      assert.deepEqual([none.code, none.stdout], [2, output(page, `block 2 under "${step}"`)], 'a CI job with no base');
      const given = await lawcheck(clone, args(page.text(`block 3 under "${step}"`)), withCache({ CI: 'true' }));
      assert.deepEqual([given.code, given.stdout], [1, output(page, `block 4 under "${step}"`)], 'the base given');
    })],

    ['node_modules kept out of the change by .gitignore', async () => {
      const ignore = /^echo (\S+) >> (\S+)$/.exec(page.text('block 2 under "4. Keep cache folders out of the change"'));
      assert.ok(ignore, 'the block appends one line to a file');
      await inTemp(async (dir) => {
        const repo = newRepository(dir, { '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n\ntypes:\n  source:\n    paths: ["src/**/*.ts"]\n', 'src/price.ts': 'export const price = 1;\n', '.gitignore': '.env\n' });
        git(repo, 'checkout', '-q', '-b', 'work');
        write(repo, 'node_modules/left-pad/index.js', 'module.exports = 1;\n');
        write(repo, 'node_modules/left-pad/package.json', '{"name":"left-pad"}\n');
        const installed = await lawcheck(repo, ['check', '--base', 'main'], withCache());
        assert.deepEqual([installed.code, installed.stdout], [0, 'lawcheck: PASS  2 changed files (against main)\n'], 'the files of node_modules count as changed');
        appendFileSync(join(repo, ignore[2]!), `${ignore[1]}\n`);
        const ignored = await lawcheck(repo, ['check', '--base', 'main'], withCache());
        assert.deepEqual([ignored.code, ignored.stdout], [0, 'lawcheck: PASS  1 changed file (against main)\n'], 'only the edited .gitignore is in the change');
      });
    }],

    ['the cache folders kept out of the change by .git/info/exclude', async () => {
      const exclude = /^echo (\S+) >> (\S+)$/.exec(page.text('block 1 under "4. Keep cache folders out of the change"'));
      assert.ok(exclude, 'the block appends one line to a file');
      await inTemp(async (dir) => {
        const repo = newRepository(dir, { '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n\ntypes:\n  source:\n    paths: ["src/**/*.ts"]\n', 'src/price.ts': 'export const price = 1;\n' });
        git(repo, 'checkout', '-q', '-b', 'work');
        write(repo, '.npm/_cacache/index-v5/00/index', 'a cache entry\n');
        const cached = await lawcheck(repo, ['check', '--base', 'main'], withCache());
        assert.deepEqual([cached.code, cached.stdout], [0, 'lawcheck: PASS  1 changed file (against main)\n'], 'the cache folder counts as changed');
        appendFileSync(join(repo, exclude[2]!), `${exclude[1]}\n`);
        const excluded = await lawcheck(repo, ['check', '--base', 'main'], withCache());
        assert.deepEqual([excluded.code, excluded.stdout], [0, 'lawcheck: PASS  nothing changed against main\n'], 'the excluded cache folder is not in the change');
      });
    }],
  ];
  await atOnce(all, all.length, ([name]) => name, ([, section]) => section());
}
