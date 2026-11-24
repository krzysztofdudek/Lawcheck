import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { COMMIT_GROUPS, nightly, NIGHTLY_GROUPS, ROOT, setFiles } from '../harness/sets.ts';
import { PLATFORM_SKIPS } from '../harness/skips.ts';
import { continueOnErrorProblems } from '../harness/workflows.ts';

type Job = { 'continue-on-error'?: unknown; strategy?: { matrix?: { group?: string[]; os?: string[]; include?: Record<string, unknown>[] } }; steps?: { name?: string; uses?: string; run?: string; if?: string; 'continue-on-error'?: unknown }[]; needs?: string | string[]; name?: string; if?: string; 'runs-on'?: string };
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

test('question 95: the commit matrix of ci.yml and its other jobs run every commit group of tests/harness/sets.ts, and no other', () => {
  assert.deepEqual(commitProblems(read('ci.yml'), Object.keys(COMMIT_GROUPS)), []);
});

test('question 95: the nightly and weekly workflows run every nightly group of tests/harness/sets.ts in exactly one job, and no other', () => {
  const workflows = later();
  assert.deepEqual(nightlyProblems({ 'nightly.yml': workflows.nightly, 'weekly.yml': workflows.weekly }, Object.keys(NIGHTLY_GROUPS)), []);
});

test('question 95: a group added to tests/harness/sets.ts and to no workflow is named, in each set (control)', () => {
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
    for (const system of jobSystems(job)) out.add(system);
  }
  return [...out].sort();
}

test('question 95: the nightly runs the whole commit set on Linux, Windows and macOS', () => {
  assert.deepEqual(wholeSetSystems(read('nightly.yml')), ['darwin', 'linux', 'win32']);
});

test('question 95: a nightly that runs the whole commit set on Linux alone, behind a condition, or nowhere is refused (control)', () => {
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

// The systems a job runs on: its runner, or each runner of its matrix.
function jobSystems(job: Job): string[] {
  const on = job['runs-on'] ?? '';
  const oses = on === '${{ matrix.os }}' ? [...(job.strategy?.matrix?.os ?? []), ...(job.strategy?.matrix?.include ?? []).map((e) => String(e.os))] : [on];
  return SYSTEM_OF.filter(([pattern]) => oses.some((os) => pattern.test(os))).map(([, system]) => system);
}

// The systems the nightly names, where its commit set runs, that no job of the group runs on.
function missingSystems(workflow: Workflow, group: string): string[] {
  const on = new Set<string>();
  for (const job of Object.values(workflow.jobs)) if (named({ jobs: { job } }).includes(group)) for (const system of jobSystems(job)) on.add(system);
  return wholeSetSystems(workflow).filter((system) => !on.has(system));
}

test('R-70: the nightly job of the shipped deadlines and rule limit runs on every system the nightly runs its commit set on', () => {
  assert.deepEqual(missingSystems(read('nightly.yml'), 'deadlines'), []);
});

test('R-70: a system removed from the job of the shipped deadlines, or the job removed, is named (control)', () => {
  const noMac = read('nightly.yml');
  noMac.jobs.deadlines!.strategy!.matrix!.os = ['ubuntu-latest', 'windows-latest'];
  assert.deepEqual(missingSystems(noMac, 'deadlines'), ['darwin']);
  const linuxOnly = read('nightly.yml');
  linuxOnly.jobs.deadlines!.strategy!.matrix!.os = ['ubuntu-latest'];
  assert.deepEqual(missingSystems(linuxOnly, 'deadlines'), ['darwin', 'win32']);
  const gone = read('nightly.yml');
  delete gone.jobs.deadlines;
  assert.deepEqual(missingSystems(gone, 'deadlines'), ['darwin', 'linux', 'win32']);
});

// The parts of nightly files that PLATFORM_SKIPS skips on Windows or macOS, where no job of the nightly and weekly workflows runs the file's group on that system, so the entry never applies.
function unreadNightlySkips(workflows: Workflow[]): string[] {
  const systems = new Map<string, Set<string>>();
  for (const workflow of workflows) for (const job of Object.values(workflow.jobs)) for (const group of named({ jobs: { job } })) for (const system of jobSystems(job)) systems.set(group, (systems.get(group) ?? new Set()).add(system));
  const unread: string[] = [];
  for (const skip of PLATFORM_SKIPS) {
    if (!nightly(skip.file) || (skip.platform !== 'win32' && skip.platform !== 'darwin')) continue;
    const groups = Object.entries(NIGHTLY_GROUPS).filter(([, dirs]) => setFiles('nightly', dirs).includes(skip.file)).map(([group]) => group);
    if (!groups.some((group) => systems.get(group)?.has(skip.platform))) unread.push(`${skip.file} > ${skip.test}: ${skip.part} on ${skip.platform}`);
  }
  return unread;
}

test('question 95: a nightly file with a part skipped on Windows or macOS runs on that system in the nightly, so the skip applies there', () => {
  assert.ok(PLATFORM_SKIPS.some((skip) => nightly(skip.file) && skip.platform === 'win32'));
  assert.deepEqual(unreadNightlySkips([read('nightly.yml'), read('weekly.yml')]), []);
});

test('question 95: a nightly file skipped in part on Windows whose group runs on Linux alone is named (control)', () => {
  const narrowed = read('nightly.yml');
  narrowed.jobs.deadlines!.strategy!.matrix!.os = ['ubuntu-latest'];
  assert.deepEqual(unreadNightlySkips([narrowed, read('weekly.yml')]), ['tests/deadlines/hook-deadlines.nightly.test.ts > test 163: the deadline, and a hook that is stopped, at the deadlines the plugin ships: a hook stopped by SIGTERM on win32']);
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

test('question 95: every grammar cache is keyed by every file that decides the bytes of .grammars', () => {
  assert.deepEqual(grammarKeys({ 'ci.yml': read('ci.yml'), 'nightly.yml': read('nightly.yml'), 'weekly.yml': read('weekly.yml'), 'release.yml': read('release.yml') }), []);
});

const WORKFLOW_FILES = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name)).sort();

test('question 95: no job or step of any workflow file carries continue-on-error, as a red there must stop the required check and the release', () => {
  assert.ok(WORKFLOW_FILES.length > 0);
  for (const file of WORKFLOW_FILES) assert.deepEqual(continueOnErrorProblems(file, read(file).jobs), [], file);
});

test('question 95: continue-on-error on any job or step of any workflow file is refused, and a literal false is not (control)', () => {
  const reds = (file: string, what: string) => `${file}: ${what} has continue-on-error, so GitHub reports its red as a success`;
  for (const file of WORKFLOW_FILES) {
    const on = (edit: (workflow: Workflow) => void): string[] => { const workflow = read(file); edit(workflow); return continueOnErrorProblems(file, workflow.jobs); };
    const jobs = Object.entries(read(file).jobs);
    assert.ok(jobs.length > 0, file);
    for (const [name, job] of jobs) {
      assert.deepEqual(on((w) => { w.jobs[name]!['continue-on-error'] = true; }), [reds(file, name)], `${file} ${name}`);
      assert.deepEqual(on((w) => { w.jobs[name]!['continue-on-error'] = false; }), [], `${file} ${name} with false`);
      (job.steps ?? []).forEach((step, i) => {
        const what = `step ${i + 1} of ${name} (${step.name ?? step.uses ?? step.run ?? 'unnamed'})`;
        assert.deepEqual(on((w) => { w.jobs[name]!.steps![i]!['continue-on-error'] = true; }), [reds(file, what)], `${file} ${what}`);
        assert.deepEqual(on((w) => { w.jobs[name]!.steps![i]!['continue-on-error'] = '${{ matrix.node != \'24\' }}'; }), [reds(file, what)], `${file} ${what} with an expression`);
      });
    }
  }
});
