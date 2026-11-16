import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { example } from '../harness/examples.ts';
import { inTemp, lawcheck, newRepository } from './helpers.ts';

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
  for (const what of ['core.hooksPath', 'never passes `--review`', 'never the index', '`--staged` is not built', 'spec/deferred.md', 'cannot catch a loosened law', '`origin/main`', 'not of the commits pushed']) assert.ok(page.includes(what), what);
});

test('S7-4: the page names the managers, the floors and the refusal of a plain check with no base in CI, and the code does what it says (report S8)', async () => {
  for (const what of ['Yarn 4 (`nodeLinker: node-modules` or `pnpm`)', 'Bun beside Node', "not with Yarn Plug'n'Play", 'Node 24 and git 2.34 or later', 'a command refuses in its first line', '`yarn install --immutable`', '`persist-credentials: false`', '`base-unreachable`', '`LAWCHECK_BASE`', '`--full`']) assert.ok(page.includes(what), what);
  const change = readFileSync(new URL('../../docs/change.md', import.meta.url), 'utf8');
  for (const what of ['a check on a machine counts every file as changed', 'In a CI job a plain check with no base is `base-unreachable` instead', 'checks the change a second time with the law of the base']) assert.ok(change.includes(what), what);
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
