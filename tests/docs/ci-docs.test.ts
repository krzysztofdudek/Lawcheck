import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { example } from '../harness/examples.ts';

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

test('S7-1: the workflow of docs/ci.md installs the project with a command that works without a lockfile, and says how Lawcheck is installed', () => {
  assert.ok(!runs.some((run) => /\bnpm ci\b/.test(run)), 'npm ci fails in a project with no package-lock.json');
  assert.ok(!steps.some((step) => step.with?.cache !== undefined), 'cache: npm needs a lockfile');
  assert.ok(runs.includes('npm install'), 'the install step is npm install');
  assert.ok(page.includes('$ npm install --save-dev lawcheck@alpha'), 'the page gives the command that adds Lawcheck');
  assert.ok(starts.length > 0);
  for (const line of starts) assert.match(line, /npx --no-install lawcheck /, `${line}: npx without --no-install downloads a tool on every run`);
  assert.equal(example('ci-install-pnpm'), 'pnpm install --frozen-lockfile');
  assert.equal(example('ci-install-yarn'), 'yarn install --frozen-lockfile');
});

test('S7-4: the workflow of docs/ci.md runs on a pull request, a merge queue and a push to main, and every check names a base or is --full', () => {
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

test('S7-4: the checkout keeps the history and not the token', () => {
  const checkout = steps.find((step) => step.uses?.startsWith('actions/checkout@'))!;
  assert.equal(checkout.with?.['fetch-depth'], 0);
  assert.equal(checkout.with?.['persist-credentials'], false);
  assert.equal(workflow.permissions.contents, 'read');
});

test('S7-3: the workflow checks a pull request again with the law of its base, and the page says who guards the law', () => {
  const check = steps.find((step) => step.run?.includes('lawcheck check') === true)!;
  assert.match(check.run!, /git cat-file -e "\$base:\.lawcheck\/law\.yaml"/, 'the second check only runs where the base has a law');
  assert.match(check.run!, /git ls-tree -r -z --name-only "\$base" -- \.lawcheck\/law\.yaml \.lawcheck\/rules/);
  assert.match(check.run!, /\[ "\$EVENT" != push \]/);
  assert.equal(starts.filter((line) => line.includes('check --base "$base"')).length, 2);
  assert.match(page, /## A change to the law/);
  assert.match(page, /code owner/);
  assert.match(page, /pull_request_target/);
});

test('S7-2, S7-11: the hooks of docs/ci.md start Lawcheck through npx, name a base that exists in a clone, and never ask the reviewer', () => {
  for (const id of ['pre-commit-hook', 'pre-push-hook']) {
    const text = example(id);
    assert.ok(text.startsWith('#!/bin/sh\n'), id);
    assert.ok(text.includes('npx --no-install lawcheck check --base origin/main'), id);
    assert.ok(!text.includes('--review'), id);
    assert.ok(!/^exec lawcheck/m.test(text), `${id}: no lawcheck is on the PATH when it is a dev dependency`);
  }
  assert.ok(example('pre-push-hook').includes('while read -r local_ref local_sha remote_ref remote_sha'), 'a pre-push hook reads the refs git gives it');
  assert.match(page, /core\.hooksPath/);
  assert.match(page, /never passes `--review`/);
});
