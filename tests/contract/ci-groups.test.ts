import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { COMMIT_GROUPS, NIGHTLY_GROUPS, ROOT } from '../harness/sets.ts';
import { continueOnErrorProblems } from '../harness/workflows.ts';

type Job = { 'continue-on-error'?: unknown; strategy?: { matrix?: { group?: string[]; os?: string[]; include?: Record<string, unknown>[] } }; steps?: { name?: string; run?: string; if?: string; 'continue-on-error'?: unknown }[]; needs?: string | string[]; name?: string; if?: string; 'runs-on'?: string };
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

const WHOLE_COMMIT_SET = /^(npm test( -- --repeat [1-9]\d*)?|node tests\/run\.ts commit( --repeat [1-9]\d*)?)$/;
const SYSTEM_OF: [RegExp, string][] = [[/^ubuntu-/, 'linux'], [/^windows-/, 'win32'], [/^macos-/, 'darwin']];

// The systems on which a job runs the whole commit set, every test of every group, with no condition on the job or the step.
function wholeSetSystems(workflow: Workflow): string[] {
  const out = new Set<string>();
  for (const job of Object.values(workflow.jobs)) {
    if (job.if !== undefined || !(job.steps ?? []).some((step) => step.if === undefined && WHOLE_COMMIT_SET.test((step.run ?? '').trim()))) continue;
    const on = job['runs-on'] ?? '';
    const oses = on === '${{ matrix.os }}' ? [...(job.strategy?.matrix?.os ?? []), ...(job.strategy?.matrix?.include ?? []).map((e) => String(e.os))] : [on];
    for (const os of oses) for (const [pattern, system] of SYSTEM_OF) if (pattern.test(os)) out.add(system);
  }
  return [...out].sort();
}

test('the nightly runs the whole commit set on Linux, Windows and macOS', () => {
  assert.deepEqual(wholeSetSystems(read('nightly.yml')), ['darwin', 'linux', 'win32']);
});

test('a nightly that runs the whole commit set on Linux alone, behind a condition, or nowhere is refused (control)', () => {
  const narrowed = read('nightly.yml');
  narrowed.jobs.repeat!.strategy!.matrix!.os = ['ubuntu-latest'];
  assert.deepEqual(wholeSetSystems(narrowed), ['linux']);
  const gated = read('nightly.yml');
  gated.jobs.repeat!.if = "github.event_name == 'schedule'";
  assert.deepEqual(wholeSetSystems(gated), []);
  const grouped = read('nightly.yml');
  for (const step of grouped.jobs.repeat!.steps!) if (step.run !== undefined) step.run = step.run.replace('npm test -- --repeat 3', 'npm test -- --group core --repeat 3');
  assert.deepEqual(wholeSetSystems(grouped), []);
  const gone = read('nightly.yml');
  delete gone.jobs.repeat;
  assert.deepEqual(wholeSetSystems(gone), []);
});

// What decides the bytes of .grammars: the pinned packages, the script that builds and checks them, and the licenses it copies.
const GRAMMAR_INPUTS = ['package-lock.json', 'scripts/grammars.ts', 'scripts/grammar-licenses.txt'];

function grammarKeys(workflows: Record<string, Workflow>): string[] {
  const problems: string[] = [];
  for (const [file, workflow] of Object.entries(workflows)) for (const [name, job] of Object.entries(workflow.jobs)) for (const step of (job.steps ?? []) as { uses?: string; with?: { path?: string; key?: string } }[]) {
    if (!step.uses?.startsWith('actions/cache') || step.with?.path !== '.grammars') continue;
    if (step.with.key !== `grammars-\${{ hashFiles(${GRAMMAR_INPUTS.map((f) => `'${f}'`).join(', ')}) }}`) problems.push(`${file} ${name}: the grammar cache is keyed by ${step.with.key}`);
  }
  return problems;
}

test('every grammar cache is keyed by every file that decides the bytes of .grammars', () => {
  assert.deepEqual(grammarKeys({ 'ci.yml': read('ci.yml'), 'nightly.yml': read('nightly.yml'), 'weekly.yml': read('weekly.yml'), 'release.yml': read('release.yml') }), []);
});

test('the nightly repeat job and its test step carry no continue-on-error, as a flake there must stop the release', () => {
  assert.deepEqual(continueOnErrorProblems('nightly.yml', read('nightly.yml').jobs, ['repeat']), []);
});

test('continue-on-error on the nightly repeat job or its test step is refused, and a literal false is not (control)', () => {
  const on = (edit: (workflow: Workflow) => void): string[] => { const workflow = read('nightly.yml'); edit(workflow); return continueOnErrorProblems('nightly.yml', workflow.jobs, ['repeat']); };
  const reds = (what: string) => `nightly.yml: ${what} has continue-on-error, so GitHub reports its red as a success`;
  assert.deepEqual(on((w) => { w.jobs.repeat!['continue-on-error'] = true; }), [reds('repeat')]);
  assert.deepEqual(on((w) => { w.jobs.repeat!.steps!.find((s) => s.run === 'npm test -- --repeat 3')!['continue-on-error'] = true; }), [reds('step 6 of repeat (The commit set, three times)')]);
  assert.deepEqual(on((w) => { w.jobs.repeat!['continue-on-error'] = false; }), []);
});
