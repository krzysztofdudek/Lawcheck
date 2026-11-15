import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { COMMIT_GROUPS, NIGHTLY_GROUPS, ROOT } from '../harness/sets.ts';

type Job = { strategy?: { matrix?: { group?: string[]; include?: Record<string, unknown>[] } }; steps?: { run?: string }[]; needs?: string | string[]; name?: string; if?: string };
type Workflow = { jobs: Record<string, Job> };

const WORKFLOWS = join(ROOT, '.github', 'workflows');
const read = (name: string): Workflow => parse(readFileSync(join(WORKFLOWS, name), 'utf8')) as Workflow;

function named(workflow: Workflow): string[] {
  const out: string[] = [];
  for (const job of Object.values(workflow.jobs)) {
    const groups = new Set<string>();
    for (const step of job.steps ?? []) for (const m of (step.run ?? '').matchAll(/--group (\$\{\{[^}]*\}\}|[a-z]+)/g)) if (!m[1]!.startsWith('$')) groups.add(m[1]!);
    out.push(...groups);
  }
  return out;
}

function commitProblems(ci: Workflow, groups: string[]): string[] {
  const problems: string[] = [];
  const whole = Object.values(ci.jobs).some((job) => (job.steps ?? []).some((step) => /npm run test:shard\b|npm test(?!\S)(?![^\n]*--group)/.test(step.run ?? '')));
  const run = whole ? [...groups, ...named(ci)] : named(ci);
  for (const group of groups) if (!run.includes(group)) problems.push(`ci.yml: no job runs commit group ${group}`);
  for (const group of new Set(run)) if (!groups.includes(group)) problems.push(`ci.yml: group ${group} is not a commit group of tests/harness/sets.ts`);
  return problems;
}

function nightlyProblems(workflows: Record<string, Workflow>, groups: string[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string[]>();
  for (const [file, workflow] of Object.entries(workflows)) for (const group of named(workflow)) seen.set(group, [...(seen.get(group) ?? []), file]);
  for (const group of groups) {
    const files = seen.get(group) ?? [];
    if (files.length !== 1) problems.push(`nightly group ${group} runs in ${files.length === 0 ? 'no workflow' : files.join(' and ')}, not in exactly one job`);
  }
  for (const group of seen.keys()) if (!groups.includes(group)) problems.push(`group ${group} is not a nightly group of tests/harness/sets.ts`);
  return problems;
}

const later = () => ({ nightly: read('nightly.yml'), weekly: read('weekly.yml') });

test('the commit matrix of ci.yml and its other jobs run every commit group of tests/harness/sets.ts, and no other', () => {
  assert.deepEqual(commitProblems(read('ci.yml'), Object.keys(COMMIT_GROUPS)), []);
});

test('the nightly and weekly workflows run every nightly group of tests/harness/sets.ts in exactly one job, and no other', () => {
  const workflows = later();
  assert.deepEqual(nightlyProblems({ 'nightly.yml': workflows.nightly, 'weekly.yml': workflows.weekly }, Object.keys(NIGHTLY_GROUPS)), []);
});

test('a group added to tests/harness/sets.ts and to no workflow is named, in each set (control)', () => {
  const named = { jobs: { a: { steps: [{ run: 'npm test -- --group core' }] } } };
  assert.deepEqual(commitProblems(named, ['core', 'planted']), ['ci.yml: no job runs commit group planted']);
  const workflows = later();
  assert.deepEqual(nightlyProblems({ 'nightly.yml': workflows.nightly, 'weekly.yml': workflows.weekly }, [...Object.keys(NIGHTLY_GROUPS), 'planted']), ['nightly group planted runs in no workflow, not in exactly one job']);
  assert.deepEqual(commitProblems(named, ['inputs']), ['ci.yml: no job runs commit group inputs', 'ci.yml: group core is not a commit group of tests/harness/sets.ts']);
});
