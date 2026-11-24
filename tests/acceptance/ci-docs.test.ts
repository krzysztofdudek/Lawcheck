import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { example } from '../harness/examples.ts';
import { openai, withFake } from './fake-reviewer.ts';
import { append, CLI, findingLines, git, GIT_ENV, inTemp, lawcheck, newRepository, NO_CONSOLE, NO_TODO, withR, write } from './helpers.ts';

interface Step {
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  env?: Record<string, string>;
}

const page = readFileSync(new URL('../../docs/ci.md', import.meta.url), 'utf8');
const workflow = parse(example('ci-workflow')) as { on: Record<string, { branches?: string[] } | null>; permissions: Record<string, string>; jobs: { check: { steps: Step[] } } };
const steps = workflow.jobs.check.steps;
const runs = steps.flatMap((step) => (step.run === undefined ? [] : [step.run]));
const starts = runs.flatMap((run) => run.split('\n').filter((line) => /\blawcheck check\b/.test(line)));

test('test 305: S7-1, the workflow of docs/ci.md installs the project with a command that works without a lockfile, and says how Lawcheck is installed', () => {
  assert.ok(!runs.some((run) => /\bnpm ci\b/.test(run)), 'npm ci fails in a project with no package-lock.json');
  assert.ok(!steps.some((step) => step.with?.cache !== undefined), 'cache: npm needs a lockfile');
  assert.ok(runs.includes('npm install'), 'the install step is npm install');
  assert.ok(page.includes('$ npm install --save-dev lawcheck@alpha'), 'the page gives the command that adds Lawcheck');
  assert.ok(starts.length > 0);
  for (const line of starts) assert.match(line, /npx --no-install lawcheck /, `${line}: npx without --no-install downloads a tool on every run`);
  assert.equal(example('ci-install-pnpm'), 'pnpm install --frozen-lockfile');
  assert.equal(example('ci-install-yarn'), 'yarn install --frozen-lockfile');
});

test('test 305: S7-4, the workflow of docs/ci.md runs on a pull request, a merge queue and a push to main, and every check names a base or is --full', () => {
  assert.deepEqual(Object.keys(workflow.on).sort(), ['merge_group', 'pull_request', 'push']);
  assert.deepEqual(workflow.on.push, { branches: ['main'] });
  for (const line of starts) {
    assert.match(line, / check (--base "\$base"|--full)$/, `${line}: a check with no base fails a CI job`);
    assert.ok(!line.includes('github.base_ref'), `${line}: github.base_ref is empty on a push`);
  }
  const check = steps.find((step) => step.run?.includes('lawcheck check') === true)!;
  for (const name of ['EVENT', 'BASE_REF', 'MERGE_BASE', 'BEFORE']) assert.ok(check.env?.[name] !== undefined, name);
  assert.match(check.run!, /HEAD\^/, 'a push whose "before" commit is gone falls back to the parent');
  assert.match(check.run!, /check --full/, 'a root commit falls back to --full');
});

test('test 305: S7-4, R-12, the checkout keeps the history and not the token', () => {
  const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'))!;
  assert.equal(checkout.with?.['fetch-depth'], 0);
  assert.equal(checkout.with?.['persist-credentials'], false);
  assert.equal(workflow.permissions.contents, 'read');
});

test('test 305: S7-3, the workflow checks again with the law of the base on every event and says so, and the page says what that does not hold', () => {
  const check = steps.find((step) => step.run?.includes('lawcheck check') === true)!;
  assert.match(check.run!, /git cat-file -e "\$base:\.\/\.lawcheck\/law\.yaml"/, 'a law below the top of the repository is found with ./');
  assert.match(check.run!, /git ls-tree -r -z --name-only "\$base" -- \.lawcheck\/law\.yaml \.lawcheck\/rules/);
  assert.match(check.run!, /rm -rf \.lawcheck\/rules/, 'a rule the pull request adds is not in the second check');
  assert.ok(!check.run!.includes('!= push'), 'a direct push is checked twice as well');
  assert.match(check.run!, /echo "Checking again with the law of \$base"/);
  assert.equal(starts.filter((line) => line.includes('check --base "$base"')).length, 2);
  assert.match(page, /## A change to the law/);
  for (const what of ['`.github/workflows/`', '`package.json`', 'the lockfile', 'every file a rule imports or reads', '`working-directory:', 'pull_request_target', 'force-push is judged by its last commit', "Keep a rule's helpers and settings under `.lawcheck/rules/`"]) assert.ok(page.includes(what), what);
  assert.ok(!page.includes('has to pass both'), 'the page no longer says a pull request has to pass both laws');
});

test('S7-2: S7-11, the hooks of docs/ci.md start Lawcheck through npx, name a base that exists in a clone, and never ask the reviewer', () => {
  for (const id of ['pre-commit-hook', 'pre-push-hook']) {
    const text = example(id);
    assert.ok(text.startsWith('#!/bin/sh\n'), id);
    assert.ok(text.includes('npx --no-install lawcheck check --base origin/main'), id);
    assert.ok(!text.includes('--review'), id);
    assert.ok(!/^exec lawcheck/m.test(text), `${id}: no lawcheck is on the PATH when it is a dev dependency`);
  }
  assert.ok(example('pre-push-hook').includes('while read -r local_ref local_sha remote_ref remote_sha'), 'a pre-push hook reads the refs git gives it');
  assert.ok(!example('pre-push-hook').includes('refs/heads/'), 'every ref but a tag is judged, HEAD included');
  for (const what of ['core.hooksPath', 'never passes `--review`', 'never the index', '`--staged` is not built', 'cannot catch a loosened law', '`origin/main`', 'not of the commits pushed']) assert.ok(page.includes(what), what);
});

test('S7-4: the page names the managers, the floors and the refusal of a plain check with no base in CI, and the code does what it says (report S8)', async () => {
  for (const what of ['Yarn 4 (`nodeLinker: node-modules` or `pnpm`)', 'Bun beside Node', "not with Yarn Plug'n'Play", 'Node 24 and git 2.34 or later', 'a command refuses in its first line', '`yarn install --immutable`', '`persist-credentials: false`', '`base-unreachable`', '`LAWCHECK_BASE`', '`--full`']) assert.ok(page.includes(what), what);
  const change = readFileSync(new URL('../../docs/change.md', import.meta.url), 'utf8');
  for (const what of ['a check on a machine counts every file as changed', 'In a CI job, a plain check with no base stops with `base-unreachable`', 'checks the change a second time with the law of the base']) assert.ok(change.includes(what), what);
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { 'src/price.ts': 'export const price = 1;\n', '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n\ntypes:\n  source:\n    about: Everything that ships.\n    paths: ["src/**/*.ts"]\n' });
    const machine = await lawcheck(repo, ['check']);
    assert.match(machine.stdout, /\(no base: every file counts as changed\)/, 'outside CI the first line says it');
    for (const env of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }, { GITLAB_CI: 'true' }, { TF_BUILD: 'True' }]) {
      const job = await lawcheck(repo, ['check'], env);
      assert.equal(job.code, 2, JSON.stringify(env));
      assert.match(job.stdout, /error\[base-unreachable\]  no base in this CI job/);
      for (const way of ['--base', 'LAWCHECK_BASE', '--full']) assert.ok(job.stdout.includes(way), way);
    }
    for (const off of ['false', 'no']) {
      const job = await lawcheck(repo, ['check'], { CI: off, GITHUB_ACTIONS: 'true' });
      assert.match(job.stdout, /\(no base: every file counts as changed\)/, `CI=${off} turns it off`);
    }
    const full = await lawcheck(repo, ['check', '--full'], { CI: 'true' });
    assert.ok(!full.stdout.includes('base-unreachable'), '--full needs no base');
  });
});

const REVIEWED_LAW = 'lawcheck: 0.1.0\n\nrules:\n  clear-errors:\n    why: An error says what to do next.\n\ntypes:\n  library:\n    paths: ["src/core/**"]\n    rules: [clear-errors]\n';
const REVIEWER_RULE = 'Every error message says what happened and what to do next.\n';
const REFUSE = "export function refund(): never {\n  throw new Error('failed');\n}\n";
const OPENAI_CONFIG = 'reviewer:\n  provider: openai-compatible\n  model: test-model\n';
const ANNOTATED_LAW = `lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.
  no-todo:
    why: A TODO without an issue number gets forgotten.
    status: advisory

types:
  library:
    paths: ["src/core/**"]
    rules: [no-console, no-todo]
`;

function sections(): string[] {
  return page.split('\n').filter((line) => line.startsWith('#'));
}

// A stand-in for the dev dependency, so npx --no-install starts the built tool with no network.
function standIn(clone: string): void {
  write(clone, 'node_modules/lawcheck/package.json', JSON.stringify({ name: 'lawcheck', version: '0.0.0', bin: { lawcheck: 'cli.js' } }));
  write(clone, 'node_modules/.bin/lawcheck', `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
  chmodSync(join(clone, 'node_modules/.bin/lawcheck'), 0o755);
  if (process.platform === 'win32') write(clone, 'node_modules/.bin/lawcheck.cmd', `@"${process.execPath}" "${CLI}" %*\r\n`);
}

function clone(dir: string, files: Record<string, string>): string {
  const origin = newRepository(join(dir, 'origin'), files);
  const work = join(dir, 'job');
  git(dir, 'clone', '-q', origin, work);
  git(work, 'remote', 'set-head', 'origin', '-d');
  git(work, 'checkout', '-q', '-b', 'work');
  return work;
}

test('S7-9: the CI page covers the pull request of a fork: no secret, no pull_request_target, a contributor with no reviewer, and the verdicts that CI trusts; and a job with no key does what the page says', async () => {
  assert.ok(sections().includes('## Pull requests from a fork'));
  assert.ok(sections().includes('### A contributor with no reviewer'));
  assert.ok(sections().includes('### The job trusts the verdicts'));
  for (const what of ['read-only token and no secrets', 'Keep the workflow on `pull_request`', 'The event `pull_request_target` runs in the base repository with its secrets', 'fails with `not-reviewed`', 'A maintainer then records the reviews', 'lets maintainers edit the pull request', 'whoever wrote it and whether a reviewer was asked', 'CI therefore trusts the author of the pull request on reviews']) assert.ok(page.includes(what), what);
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': REVIEWED_LAW, '.lawcheck/rules/clear-errors.md': REVIEWER_RULE });
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, 'src/core/refund.ts', REFUSE);
    const noKey = { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'main' };
    const job = await lawcheck(repo, ['check', '--base', 'main'], noKey);
    assert.equal(job.code, 1);
    assert.match(job.stdout, /error\[not-reviewed\]  clear-errors has no verdict for this content/, 'the job of a fork fails with not-reviewed');
    const contributor = await lawcheck(repo, ['check', '--review', '--base', 'main'], noKey);
    assert.equal(contributor.code, 2);
    assert.match(contributor.stdout, /error\[reviewer-not-configured\]/, 'a contributor with no reviewer cannot record it');
  });
  await withFake(async (fake) => {
    await inTemp(async (dir) => {
      const files = { '.lawcheck/law.yaml': REVIEWED_LAW, '.lawcheck/rules/clear-errors.md': REVIEWER_RULE, '.lawcheck/config.yaml': OPENAI_CONFIG };
      fake.respond = () => openai('{"verdict": "pass", "findings": []}');
      const author = clone(join(dir, 'author'), files);
      write(author, 'src/core/refund.ts', REFUSE);
      const own = await lawcheck(author, ['check', '--review', '--base', 'origin/main'], { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
      assert.equal(own.code, 0, 'a reviewer of the contributor, which passes every file');
      const copy = clone(join(dir, 'copy'), files);
      write(copy, 'src/core/refund.ts', REFUSE);
      write(copy, '.lawcheck/verdicts', readFileSync(join(author, '.lawcheck/verdicts'), 'utf8'));
      const job = await lawcheck(copy, ['check', '--base', 'origin/main'], { CI: 'true' });
      assert.deepEqual([job.code, job.stdout.split('\n')[0]], [0, 'lawcheck: PASS  2 changed files (against origin/main)'], 'a line of the verdicts file passes, from whichever reviewer or hand it came');
    });
  });
});

test('S7-13: the recipes of docs/ci.md turn --json into GitHub annotations and a GitLab code quality report, run as written', async () => {
  assert.ok(sections().includes('## Findings in the pull request'));
  assert.ok(sections().includes('### 1. Annotate on GitHub'));
  assert.ok(sections().includes('### 2. Report code quality on GitLab'));
  for (const what of ['A job that passes prints its warnings in its log, and nowhere else', 'A plain check prints no debt either', '`summary.debt` of its JSON is 0', 'With `--full` or `--strict`, `findings` holds the debt with `debt: true`']) assert.ok(page.includes(what), what);
  const todo = (name: string) => `export const ${name} = 1; // TODO tidy\n`;
  await inTemp(async (dir) => {
    const work = clone(dir, { '.gitignore': 'node_modules/\n', '.lawcheck/law.yaml': ANNOTATED_LAW, '.lawcheck/rules/no-console.mjs': NO_CONSOLE, '.lawcheck/rules/no-todo.mjs': NO_TODO, 'src/core/old.ts': "export const old = () => console.log('old');\n" });
    write(work, 'src/core/total.ts', 'export function total(price: number): number {\n  console.log(price);\n  // TODO tidy\n  return price;\n}\n');
    standIn(work);
    write(work, '.github/lawcheck-annotations.mjs', example('annotations-script') + '\n');
    write(work, 'scripts/lawcheck-code-quality.mjs', example('code-quality-script') + '\n');
    const env = { ...GIT_ENV, npm_config_update_notifier: 'false' };
    let scripts = 0;
    const shell = (script: string, extra: NodeJS.ProcessEnv = {}) => {
      const name = `script-${scripts++}.sh`;
      write(dir, name, `set -e\n${script}\n`);
      return spawnSync('sh', [join(dir, name)], { cwd: work, env: { ...env, ...extra }, encoding: 'utf8' });
    };
    const annotate = (...args: string[]) => shell(`${example('annotations-step')}\ncheck_and_annotate ${args.join(' ')}`, { GITHUB_WORKSPACE: work });

    const plain = annotate('--base', 'origin/main');
    assert.equal(plain.status, 1, plain.stdout + plain.stderr);
    assert.equal(
      plain.stdout,
      ['::error title=no-console,file=src/core/total.ts,line=2::writes to the terminal with console.log', '::warning title=no-todo,file=src/core/total.ts,line=3::TODO without an issue number', 'next: fix src/core/total.ts:2', ''].join('\n'),
      'a finding that blocks is an error, an advisory one a warning, and the debt is not in a plain check',
    );
    const plainJson = JSON.parse((await lawcheck(work, ['check', '--json', '--base', 'origin/main'])).stdout);
    assert.equal(plainJson.summary.debt, 0, 'a plain check holds no debt');
    assert.equal(plainJson.findings.some((finding: { debt: boolean }) => finding.debt), false);
    const full = annotate('--base', 'origin/main', '--full');
    assert.ok(full.stdout.includes('::notice title=no-console,file=src/core/old.ts,line=1::writes to the terminal with console.log\n'), 'debt is a notice with --full');
    const strict = annotate('--base', 'origin/main', '--strict');
    assert.ok(strict.stdout.includes('::error title=no-console,file=src/core/old.ts,line=1::'), 'an enforced finding of debt is an error with --strict');
    const refused = annotate('--base', 'origin/nope');
    assert.equal(refused.status, 2, 'the function keeps the exit code of the check');
    assert.match(refused.stdout, /^::error title=base-unreachable::the base 'origin\/nope' names no commit here\nnext: /, 'an error of exit 2 is annotated too');

    const escaped = spawnSync(process.execPath, ['.github/lawcheck-annotations.mjs'], {
      cwd: work,
      encoding: 'utf8',
      input: JSON.stringify({ findings: [{ code: 'x,y:z', blocking: true, debt: false, file: 'a,b:c%d\ne.ts', line: 3, message: '50% of line1\r\nline2' }, { code: 'y', blocking: true, debt: false, file: 'whole.ts', message: 'whole file' }] }),
    });
    assert.equal(escaped.stdout, '::error title=x%2Cy%3Az,file=a%2Cb%3Ac%25d%0Ae.ts,line=3::50%25 of line1%0D%0Aline2\n::error title=y,file=whole.ts::whole file\n', 'the characters of a workflow command are escaped, and a finding of a whole file has no line');

    const job = (parse(example('gitlab-code-quality-job')) as { 'lawcheck-quality': { script: string[]; artifacts: { when: string; reports: { codequality: string } } } })['lawcheck-quality'];
    assert.equal(job.artifacts.when, 'always');
    const run = shell(job.script.join('\n'), { GITLAB_CI: 'true', CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main' });
    assert.equal(run.status, 1, run.stdout + run.stderr);
    const report = JSON.parse(readFileSync(join(work, job.artifacts.reports.codequality), 'utf8')) as { description: string; check_name: string; fingerprint: string; severity: string; location: { path: string; lines: { begin: number } } }[];
    assert.deepEqual(
      report.map(({ fingerprint, ...rest }) => (assert.match(fingerprint, /^[0-9a-f]{64}$/), rest)),
      [
        { description: 'no-console: writes to the terminal with console.log', check_name: 'no-console', severity: 'critical', location: { path: 'src/core/total.ts', lines: { begin: 2 } } },
        { description: 'no-todo: TODO without an issue number', check_name: 'no-todo', severity: 'minor', location: { path: 'src/core/total.ts', lines: { begin: 3 } } },
      ],
    );
    assert.equal(new Set(report.map((item) => item.fingerprint)).size, report.length, 'every fingerprint is its own');

    const debt = { code: 'no-todo', blocking: false, debt: true, file: 'src/core/old.ts', message: 'TODO without an issue number' };
    const quality = spawnSync(process.execPath, ['scripts/lawcheck-code-quality.mjs'], { cwd: work, encoding: 'utf8', input: JSON.stringify({ findings: [{ ...debt, line: 1 }, { ...debt, line: 2 }, { ...debt, message: 'another' }, debt] }) });
    const entries = JSON.parse(quality.stdout) as { fingerprint: string; severity: string; location: { lines: { begin: number } } }[];
    assert.deepEqual(entries.map((entry) => [entry.severity, entry.location.lines.begin]), [['info', 1], ['info', 2], ['info', 1], ['info', 1]], 'debt is info, and a finding of the whole file is on line 1');
    assert.equal(new Set(entries.map((entry) => entry.fingerprint)).size, 4, 'findings of one rule in one file differ by line and by message');
  });
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.gitignore': 'node_modules/\n', 'pkg/.lawcheck/law.yaml': ANNOTATED_LAW, 'pkg/.lawcheck/rules/no-console.mjs': NO_CONSOLE, 'pkg/.lawcheck/rules/no-todo.mjs': NO_TODO });
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, 'pkg/src/core/total.ts', 'console.log(1);\n');
    write(repo, '.github/lawcheck-annotations.mjs', example('annotations-script') + '\n');
    write(repo, 'scripts/lawcheck-code-quality.mjs', example('code-quality-script') + '\n');
    const pkg = join(repo, 'pkg');
    standIn(pkg);
    write(dir, 'step.sh', `set -e\n${example('annotations-step')}\ncheck_and_annotate --base main\n`);
    const step = spawnSync('sh', [join(dir, 'step.sh')], { cwd: pkg, env: { ...GIT_ENV, GITHUB_WORKSPACE: repo }, encoding: 'utf8' });
    assert.equal(step.status, 1, step.stdout + step.stderr);
    assert.ok(step.stdout.startsWith('::error title=no-console,file=pkg/src/core/total.ts,line=1::'), `the step of a law below the top names the file from the top: ${step.stdout}`);
    const json = (await lawcheck(pkg, ['check', '--json', '--base', 'main'])).stdout;
    const quality = spawnSync(process.execPath, [join(repo, 'scripts/lawcheck-code-quality.mjs')], { cwd: pkg, encoding: 'utf8', input: json });
    assert.equal((JSON.parse(quality.stdout) as { location: { path: string } }[])[0]!.location.path, 'pkg/src/core/total.ts', 'the GitLab report names the file from the top');
  });
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': ANNOTATED_LAW.replace('rules: [no-console, no-todo]', 'rules: [no-todo]'), '.lawcheck/rules/no-console.mjs': NO_CONSOLE, '.lawcheck/rules/no-todo.mjs': NO_TODO, 'src/core/old.ts': todo('old') });
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, 'src/core/new.ts', todo('added'));
    const plain = await lawcheck(repo, ['check', '--base', 'main']);
    assert.equal(plain.code, 0, 'a warning leaves the exit code at 0');
    assert.match(plain.stdout, /^lawcheck: PASS  1 warning in 1 changed file/);
    assert.ok(plain.stdout.includes('src/core/new.ts:1  warning[no-todo]'), 'the log shows the warning of the change');
    assert.ok(!plain.stdout.includes('old.ts'), 'a plain check prints no debt');
    const full = JSON.parse((await lawcheck(repo, ['check', '--base', 'main', '--full', '--json'])).stdout);
    assert.deepEqual(full.findings.filter((finding: { debt: boolean }) => finding.debt).map((finding: { file: string }) => finding.file), ['src/core/old.ts']);
  });
});

test('test 973: the code scanning recipe of docs/ci.md writes the SARIF file from the first check of the workflow, run as written, and uploads it when the check fails too', async () => {
  assert.ok(sections().includes('### 3. Show the findings in GitHub code scanning'));
  const upload = (parse(example('sarif-upload')) as (Step & { if?: string })[])[0]!;
  assert.equal(upload.uses, 'github/codeql-action/upload-sarif@v4');
  assert.equal(upload.if, '${{ !cancelled() }}', 'the step runs after a check that failed with exit 1');
  assert.deepEqual(upload.with, { sarif_file: '${{ runner.temp }}/lawcheck.sarif', category: 'lawcheck' });
  for (const what of ['add `security-events: write` to `permissions`', 'to the first two `lawcheck check` lines', 'After exit 2, Lawcheck writes no file', 'GitHub Code Security and `actions: read`']) assert.ok(page.includes(what), what);
  assert.equal(workflow.permissions.contents, 'read', 'the permission the upload step adds to');

  const check = steps.find((step) => step.run?.includes('lawcheck check') === true)!;
  let added = 0;
  const script = check.run!
    .split('\n')
    .map((line) => (added < 2 && /npx --no-install lawcheck check /.test(line) ? (added++, `${line} --sarif "$RUNNER_TEMP/lawcheck.sarif"`) : line))
    .join('\n');
  assert.equal(added, 2);
  assert.ok(script.includes('lawcheck check --full --sarif "$RUNNER_TEMP/lawcheck.sarif"\n'), 'the root commit writes the file');
  assert.ok(script.includes('lawcheck check --base "$base" --sarif "$RUNNER_TEMP/lawcheck.sarif"\n'), 'the first check writes the file');
  await inTemp(async (dir) => {
    const work = clone(dir, { '.gitignore': 'node_modules/\n', '.lawcheck/law.yaml': ANNOTATED_LAW, '.lawcheck/rules/no-console.mjs': NO_CONSOLE, '.lawcheck/rules/no-todo.mjs': NO_TODO });
    write(work, 'src/core/total.ts', 'export function total(price: number): number {\n  console.log(price);\n  return price;\n}\n');
    standIn(work);
    const runnerTemp = join(dir, 'runner-temp');
    write(runnerTemp, '.keep', '');
    write(dir, 'check.sh', `${script}\n`);
    const env = { ...GIT_ENV, npm_config_update_notifier: 'false', EVENT: 'pull_request', BASE_REF: 'main', RUNNER_TEMP: runnerTemp };
    const job = spawnSync('sh', ['-e', join(dir, 'check.sh')], { cwd: work, env, encoding: 'utf8' });
    assert.equal(job.status, 1, job.stdout + job.stderr);
    const log = JSON.parse(readFileSync(join(runnerTemp, 'lawcheck.sarif'), 'utf8')) as { version: string; runs: { results: { ruleId: string; locations: { physicalLocation: { artifactLocation: { uri: string }; region: { startLine: number } } }[] }[] }[] };
    assert.equal(log.version, '2.1.0');
    assert.deepEqual(
      log.runs[0]!.results.map((result) => [result.ruleId, result.locations[0]!.physicalLocation.artifactLocation.uri, result.locations[0]!.physicalLocation.region.startLine]),
      [['no-console', 'src/core/total.ts', 2]],
      'the file the upload step reads holds the finding that fails the job',
    );
  });
});

test('S7-16: the CI page says doctor is for a machine, and in a job that reads the committed verdicts doctor fails where check passes', async () => {
  assert.ok(sections().includes('### 4. Run doctor on a machine, not in the job'));
  for (const what of ['`lawcheck doctor` fails with exit 2', 'Run `doctor` on your machine', 'Put it in a job only when that job holds the key and the address']) assert.ok(page.includes(what), what);
  await withFake(async (fake) => {
    await inTemp(async (dir) => {
      const work = clone(dir, { '.lawcheck/law.yaml': REVIEWED_LAW, '.lawcheck/rules/clear-errors.md': REVIEWER_RULE, '.lawcheck/config.yaml': OPENAI_CONFIG });
      write(work, 'src/core/refund.ts', "export function refund(): never {\n  throw new Error('The order is paid out already; open a new order to refund it again.');\n}\n");
      const recorded = await lawcheck(work, ['check', '--review', '--base', 'origin/main'], { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
      assert.equal(recorded.code, 0, recorded.stdout);
      git(work, 'add', '-A');
      git(work, 'commit', '-q', '-m', 'refund');
      const job = { CI: 'true' };
      const check = await lawcheck(work, ['check', '--base', 'origin/main'], job);
      assert.deepEqual([check.code, check.stdout.split('\n')[0]], [0, 'lawcheck: PASS  3 changed files (against origin/main)'], 'the job passes on the committed verdicts');
      const doctor = await lawcheck(work, ['doctor', '--base', 'origin/main'], job);
      assert.equal(doctor.code, 2, 'doctor fails in the same job');
      const shown = example('doctor-in-ci').split('\n');
      const lines = doctor.stdout.split('\n');
      const at = lines.indexOf(shown[0]!);
      assert.ok(at >= 0 && lines[at + 1] === shown[1], doctor.stdout);
    });
  });
});

test('S7-14: the CI page says a missing review fails only a changed file, and a check of a change that leaves the bound files alone passes with none', async () => {
  assert.ok(page.includes('A file that the change leaves alone is not asked about'));
  await withR(async (r) => {
    const untouched = await lawcheck(r, ['check', '--base', 'main']);
    assert.equal(untouched.stdout, 'lawcheck: PASS  nothing changed against main\n');
    write(r, 'README.md', '# changed\n');
    const elsewhere = await lawcheck(r, ['check', '--base', 'main']);
    assert.ok(!elsewhere.stdout.includes('not-reviewed'), elsewhere.stdout);
    append(r, 'src/core/tax.ts', '// changed\n');
    const bound = await lawcheck(r, ['check', '--base', 'main']);
    assert.ok(findingLines(bound.stdout).includes('src/core/tax.ts  error[not-reviewed]  clear-errors has no verdict for this content'), bound.stdout);
    assert.ok(!bound.stdout.includes('src/core/price.ts  error[not-reviewed]'), bound.stdout);
  });
});
