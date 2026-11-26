import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { parse } from 'yaml';
import { COMMIT_GROUPS, EMPTY_GROUPS, nightly, NIGHTLY_GROUPS, ROOT, setFiles } from '../harness/sets.ts';
import { PLATFORM_SKIPS } from '../harness/skips.ts';
import { continueOnErrorProblems } from '../harness/workflows.ts';
import { chosenTests, inputProblems, NIGHTLY_JOBS, SEVERAL_SYSTEMS } from '../harness/chosen.ts';
import { judgeRun } from '../harness/reporter.ts';
import { platformSkip, testFolder } from '../harness/tool.ts';

type Job = { 'continue-on-error'?: unknown; strategy?: { matrix?: { group?: string[]; os?: string[] | string; include?: Record<string, unknown>[] } }; steps?: { name?: string; uses?: string; run?: string; if?: string; 'continue-on-error'?: unknown }[]; needs?: string | string[]; name?: string; if?: string; 'runs-on'?: string };
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

// A group declared empty has no job, so no job stands green over no test; once it holds a test it leaves the declared-empty list (tests/contract/discovery.test.ts), and then it needs its one job.
function nightlyProblems(workflows: Record<string, Workflow>, groups: string[], empty: string[] = []): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string[]>();
  for (const [file, workflow] of Object.entries(workflows)) for (const group of named(workflow)) seen.set(group, [...(seen.get(group) ?? []), file]);
  for (const group of groups) {
    const files = seen.get(group) ?? [];
    if (empty.includes(group)) {
      if (files.length > 0) problems.push(`nightly group ${group} is declared empty in tests/harness/sets.ts and has a job in ${files.join(' and ')}`);
    } else if (files.length !== 1) problems.push(`nightly group ${group} runs in ${files.length === 0 ? 'no workflow' : files.join(' and ')}, not in exactly one job`);
  }
  for (const group of seen.keys()) if (!groups.includes(group)) problems.push(`group ${group} is not a nightly group of tests/harness/sets.ts`);
  return problems;
}

// nightly.yml, and weekly.yml while a group runs weekly.
const later = (): Record<string, Workflow> => Object.fromEntries(['nightly.yml', 'weekly.yml'].filter((name) => existsSync(join(WORKFLOWS, name))).map((name) => [name, read(name)]));

test('question 95: the commit matrix of ci.yml and its other jobs run every commit group of tests/harness/sets.ts, and no other', () => {
  assert.deepEqual(commitProblems(read('ci.yml'), Object.keys(COMMIT_GROUPS)), []);
});

test('question 95: the nightly and weekly workflows run every nightly group of tests/harness/sets.ts that holds a test in exactly one job, and no other group', () => {
  assert.deepEqual(nightlyProblems(later(), Object.keys(NIGHTLY_GROUPS), EMPTY_GROUPS.nightly), []);
  assert.ok(Object.keys(NIGHTLY_GROUPS).some((group) => !EMPTY_GROUPS.nightly.includes(group)));
});

test('question 95: a group added to tests/harness/sets.ts and to no workflow is named, in each set (control)', () => {
  const named = { jobs: { a: { steps: [{ run: 'npm test -- --group core' }] } } };
  assert.deepEqual(commitProblems(named, ['core', 'planted']), ['ci.yml: no job runs commit group planted']);
  assert.deepEqual(nightlyProblems(later(), [...Object.keys(NIGHTLY_GROUPS), 'planted'], EMPTY_GROUPS.nightly), ['nightly group planted runs in no workflow, not in exactly one job']);
  const filled = EMPTY_GROUPS.nightly[0]!;
  assert.deepEqual(nightlyProblems(later(), Object.keys(NIGHTLY_GROUPS), EMPTY_GROUPS.nightly.filter((group) => group !== filled)), [`nightly group ${filled} runs in no workflow, not in exactly one job`]);
  const jobbed = { ...later(), 'weekly.yml': { jobs: { a: { steps: [{ run: `node tests/run.ts nightly --group ${filled}` }] } } } };
  assert.deepEqual(nightlyProblems(jobbed, Object.keys(NIGHTLY_GROUPS), EMPTY_GROUPS.nightly), [`nightly group ${filled} is declared empty in tests/harness/sets.ts and has a job in weekly.yml`]);
  assert.deepEqual(commitProblems(named, ['inputs']), ['ci.yml: no job runs commit group inputs', 'ci.yml: group core is not a commit group of tests/harness/sets.ts']);
});

const WHOLE_COMMIT_SET = /^(npm test( -- --repeat [1-9]\d*)?|node tests\/run\.ts commit( --repeat [1-9]\d*)?)$/;
const SYSTEM_OF: [RegExp, string][] = [[/^ubuntu-/, 'linux'], [/^windows-/, 'win32'], [/^macos-/, 'darwin']];

// The one condition a job of the nightly may carry: it holds on every run that names no jobs.
const choiceOf = (key: string): string => `\${{ !inputs.jobs || contains(format(',{0},', inputs.jobs), ',${key},') }}`;

// The systems of a matrix on a run that names no system: the list itself, or the default of the one expression that narrows it.
function matrixSystems(os: string[] | string | undefined): string[] {
  if (typeof os !== 'string') return os ?? [];
  const whole = /^\$\{\{ fromJSON\(\(inputs\.os && inputs\.os != 'all'\) && format\('\["\{0\}"\]', inputs\.os\) \|\| '(\[[^']*\])'\) \}\}$/.exec(os);
  return whole === null ? [] : (JSON.parse(whole[1]!) as string[]);
}

// The systems on which a job runs the whole commit set, every test of every group, with no condition on the job or the step.
function wholeSetSystems(workflow: Workflow): string[] {
  const out = new Set<string>();
  for (const [key, job] of Object.entries(workflow.jobs)) {
    if ((job.if !== undefined && job.if !== choiceOf(key)) || !(job.steps ?? []).some((step) => step.if === undefined && WHOLE_COMMIT_SET.test((step.run ?? '').trim()))) continue;
    for (const system of jobSystems(job)) out.add(system);
  }
  return [...out].sort();
}

test('question 95: the nightly runs the whole commit set on Linux, Windows and macOS', () => {
  assert.deepEqual(wholeSetSystems(read('nightly.yml')), ['darwin', 'linux', 'win32']);
});

test('question 95: a nightly that runs the whole commit set on Linux alone, behind a condition, or nowhere is refused (control)', () => {
  const narrowed = read('nightly.yml');
  narrowed.jobs.commit!.strategy!.matrix!.os = ['ubuntu-latest'];
  assert.deepEqual(wholeSetSystems(narrowed), ['linux']);
  const gated = read('nightly.yml');
  gated.jobs.commit!.if = "github.event_name == 'schedule'";
  assert.deepEqual(wholeSetSystems(gated), []);
  const grouped = read('nightly.yml');
  for (const step of grouped.jobs.commit!.steps!) if (step.run !== undefined) step.run = step.run.replace('npm test', 'npm test -- --group core');
  assert.deepEqual(wholeSetSystems(grouped), []);
  const gone = read('nightly.yml');
  delete gone.jobs.commit;
  assert.deepEqual(wholeSetSystems(gone), []);
  const another = read('nightly.yml');
  another.jobs.commit!.if = choiceOf('limits');
  assert.deepEqual(wholeSetSystems(another), []);
  const chosenByDefault = read('nightly.yml');
  chosenByDefault.jobs.commit!.strategy!.matrix!.os = String(chosenByDefault.jobs.commit!.strategy!.matrix!.os).replace(',"windows-latest","macos-latest"', '');
  assert.deepEqual(wholeSetSystems(chosenByDefault), ['linux']);
});

// The systems a job runs on: its runner, or each runner of its matrix.
function jobSystems(job: Job): string[] {
  const on = job['runs-on'] ?? '';
  const oses = on === '${{ matrix.os }}' ? [...matrixSystems(job.strategy?.matrix?.os), ...(job.strategy?.matrix?.include ?? []).map((e) => String(e.os))] : [on];
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
  assert.deepEqual(unreadNightlySkips(Object.values(later())), []);
});

test('question 95: a nightly file skipped in part on Windows whose group runs on Linux alone is named (control)', () => {
  const narrowed = read('nightly.yml');
  narrowed.jobs.deadlines!.strategy!.matrix!.os = ['ubuntu-latest'];
  assert.deepEqual(unreadNightlySkips(Object.values({ ...later(), 'nightly.yml': narrowed })), ['tests/deadlines/hook-deadlines.nightly.test.ts > test 163: the deadline, and a hook that is stopped, at the deadlines the plugin ships: a hook stopped by SIGTERM on win32']);
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
  assert.deepEqual(grammarKeys({ 'ci.yml': read('ci.yml'), ...later(), 'release.yml': read('release.yml') }), []);
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

type Step = { name?: string; run?: string; env?: Record<string, string> };
type ChosenJob = { if?: string; strategy?: { matrix?: { os?: unknown } }; steps?: Step[] };
type Chosen = { 'run-name'?: string; env?: Record<string, string>; on: { workflow_dispatch: { inputs: Record<string, { default?: string; options?: string[] }> } }; jobs: Record<string, ChosenJob> };

const readChosen = (name: string): Chosen => read(name) as unknown as Chosen;

const NARROWED = "inputs.jobs || inputs.tests || (inputs.os && inputs.os != 'all')";
const WHOLE = 'Nightly, whole';

// How a run of the runner in a step of nightly.yml gets the chosen tests: a container and a cleared environment each need it passed.
function unnarrowed(workflow: Chosen): string[] {
  const out: string[] = [];
  for (const [key, job] of Object.entries(workflow.jobs)) {
    if (key === 'chosen') continue;
    for (const step of job.steps ?? []) {
      const run = step.run ?? '';
      if (/\$\{\{[^}]*inputs\./.test(run)) out.push(`${key}: an input is written into a script`);
      if (!/tests\/run\.ts (commit|nightly)|npm test\b/.test(run)) continue;
      if (/\bdocker run\b/.test(run) && !/\bdocker run [^\n]*-e LAWCHECK_ONLY /.test(run)) out.push(`${key}: ${step.name ?? run} starts a container without LAWCHECK_ONLY`);
      if (/\benv -i\b/.test(run) && !run.includes('LAWCHECK_ONLY="$LAWCHECK_ONLY"')) out.push(`${key}: ${step.name ?? run} clears the environment and drops LAWCHECK_ONLY`);
    }
  }
  return out;
}

function choiceProblems(workflow: Chosen): string[] {
  const out: string[] = [];
  const jobs = Object.keys(workflow.jobs).filter((key) => key !== 'chosen');
  if (jobs.join() !== Object.keys(NIGHTLY_JOBS).join()) out.push(`the jobs ${jobs.join()} are not the jobs of NIGHTLY_JOBS`);
  for (const key of jobs) {
    const job = workflow.jobs[key]!;
    if (job.if !== `\${{ !inputs.jobs || contains(format(',{0},', inputs.jobs), ',${key},') }}`) out.push(`${key}: not chosen by its own name`);
    const runs = (job.steps ?? []).map((step) => step.run ?? '').join('\n');
    const set = NIGHTLY_JOBS[key];
    if (set !== undefined && !(set.group === null ? /npm test\b/.test(runs) : runs.includes(`tests/run.ts nightly --group ${set.group}`))) out.push(`${key}: its steps do not run the set NIGHTLY_JOBS names`);
    if ((job.strategy?.matrix?.os !== undefined) !== SEVERAL_SYSTEMS.includes(key)) out.push(`${key}: SEVERAL_SYSTEMS and the matrix disagree`);
  }
  if (workflow.env?.LAWCHECK_ONLY !== '${{ inputs.tests }}') out.push('the tests input does not reach LAWCHECK_ONLY');
  return [...out, ...unnarrowed(workflow)];
}

test('test 1427: every job of nightly.yml is chosen by its own name, runs the set the input check holds it to, and passes the chosen tests to the runner', () => {
  assert.deepEqual(choiceProblems(readChosen('nightly.yml')), []);
  assert.deepEqual(Object.keys(readChosen('nightly.yml').on.workflow_dispatch.inputs), ['jobs', 'tests', 'os']);
  const planted = readChosen('nightly.yml');
  planted.jobs.limits!.if = planted.jobs.sabotage!.if!;
  for (const step of planted.jobs.limits!.steps!) if (step.run !== undefined) step.run = step.run.replace('-e LAWCHECK_ONLY ', '');
  for (const step of planted.jobs.sabotage!.steps!) if (step.run !== undefined) step.run = step.run.replace('LAWCHECK_ONLY="$LAWCHECK_ONLY" ', '');
  planted.jobs.properties!.steps!.push({ run: 'node tests/run.ts nightly ${{ inputs.tests }}' });
  const problems = choiceProblems(planted);
  for (const part of ['limits: not chosen by its own name', 'limits: The limits in a container', 'limits: Test', 'sabotage: The sabotage list, with the network closed clears', 'properties: an input is written into a script']) assert.ok(problems.some((p) => p.startsWith(part)), `${part} in ${problems.join('; ')}`);
});

test('test 1428: the input check refuses a job or a test that would be left out without a red, and takes the inputs that match', () => {
  assert.deepEqual(inputProblems('', '', 'all'), []);
  assert.deepEqual(inputProblems('limits', 'test 251', 'all'), []);
  assert.deepEqual(inputProblems('limits,deadlines', 'test 251, test 163', ''), []);
  assert.deepEqual(inputProblems('commit', '', 'windows-latest'), []);
  assert.deepEqual(inputProblems('', '', 'macos-latest'), []);
  const only = (jobs: string, tests: string, os: string, expected: RegExp[]) => {
    const problems = inputProblems(jobs, tests, os);
    assert.equal(problems.length, expected.length, problems.join('; '));
    expected.forEach((pattern, i) => assert.match(problems[i]!, pattern));
  };
  only('limit', '', 'all', [/there is no job 'limit'/]);
  only('limits, environments', '', 'all', [/there is no job ' environments'/]);
  only('', 'test 251', 'all', [/name the jobs that hold the tests too/]);
  only('limits,deadlines', 'test 251', 'all', [/the job deadlines holds none of test 251/]);
  only('limits', 'test 251,test 163', 'all', [/no chosen job holds a test named test 163/]);
  only('limits', 'test 251,251', 'all', [/'251' is not a test id/]);
  only('limits', ' , ', 'all', [/names no test id/]);
  only('limits', '', 'windows-latest', [/only the jobs commit and deadlines run on several systems/]);
  assert.deepEqual(chosenTests(' tests 248 ,test 251,'), ['test 248', 'test 251']);
  const cli = (env: Record<string, string>) => spawnSync(process.execPath, [join(ROOT, 'tests', 'harness', 'chosen.ts')], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, LAWCHECK_JOBS: '', LAWCHECK_ONLY: '', LAWCHECK_OS: '', ...env } });
  const good = cli({ LAWCHECK_JOBS: 'limits', LAWCHECK_ONLY: 'test 251', LAWCHECK_OS: 'all' });
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.equal(good.stdout, 'chosen: jobs limits, tests test 251, os all\n');
  const bad = cli({ LAWCHECK_JOBS: 'limit' });
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /^::error::jobs: there is no job 'limit'/);
});

function runner(only: string, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, LAWCHECK_ONLY: only, LAWCHECK_RECORD: '', LAWCHECK_ORDER_SEED: '' };
  // Under node --test this process carries NODE_TEST_CONTEXT, which makes a nested node --test report to its parent instead of printing.
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [join(ROOT, 'tests', 'run.ts'), 'commit', ...args], { cwd: ROOT, encoding: 'utf8', env });
}

const SELF = 'tests/contract/ci-groups.test.ts';

test('test 1429: LAWCHECK_ONLY narrows a run to the chosen tests among those the step runs, and refuses a test that no file holds', () => {
  const one = runner('test 1431', SELF);
  assert.equal(one.status, 0, one.stdout + one.stderr);
  assert.match(one.stdout, /LAWCHECK_ONLY narrows this run to test 1431/);
  assert.match(one.stdout, /ran 1 test files, 1 tests: 1 passed, 0 failed/);
  const own = runner('test 1431,test 1428', SELF, 'test 1431');
  assert.equal(own.status, 0, own.stdout + own.stderr);
  assert.match(own.stdout, /ran 1 test files, 1 tests: 1 passed, 0 failed/);
  for (const args of [['tests/contract/starts.test.ts'], [SELF, '--skip', 'test 1431'], [SELF, 'test 1428']]) {
    const none = runner('test 1431', ...args);
    assert.equal(none.status, 0, `${args.join(' ')}: ${none.stdout}${none.stderr}`);
    assert.match(none.stdout, /none of the chosen tests is in this part of the run, 0 tests\n$/, args.join(' '));
  }
  // Built here, because a file counts as holding any id it quotes.
  const absent = ['test', '99999'].join(' ');
  for (const [only, message] of [[absent, /no test file holds a test named/], ['test 1431,limits', /'limits', which is not a test id/]] as const) {
    const refused = runner(only, SELF);
    assert.equal(refused.status, 2, refused.stdout + refused.stderr);
    assert.match(refused.stderr, message);
  }
});

test('test 1430: a part of a run in which one of its chosen tests did not run is red and names it', async () => {
  const ran = async function* () {
    yield { type: 'test:pass', data: { name: 'tests 1431 and 1500: two numbers in one name', nesting: 0, file: join(ROOT, SELF) } };
  };
  const judged = (chosen?: string[]) => judgeRun(ran(), { system: 'linux', started: null, target: 0, chosen });
  assert.equal((await judged(['test 1431', 'test 1500'])).red, false);
  const missing = await judged(['test 1431', 'test 1428']);
  assert.equal(missing.red, true);
  assert.match(missing.text, /a chosen test did not run[^\n]*\ngot      no test named test 1428 ran/);
  assert.equal((await judged()).red, false);
  // This call quotes an id that no test of this file is named by, so the file counts as holding it, and only the reporter of the run can tell.
  const quoted = runner('test 163', SELF);
  assert.equal(quoted.status, 1, quoted.stdout + quoted.stderr);
  assert.match(quoted.stdout, /got      no test named test 163 ran/);
});

test('test 1431: the tests a narrowed run starts do not see the list it chose, so what they run or judge themselves is not held to it', () => {
  assert.deepEqual(Object.keys(process.env).filter((name) => name === 'LAWCHECK_ONLY' || /\btests? 1431\b/.test(process.env[name]!)), []);
});

// The script of release.yml's job nightly, run with a gh that answers from a list of runs and applies the script's own --jq with jq.
function releaseVerdict(runs: { id: number; head_sha: string; event: string; status: string; conclusion: string | null; display_title: string }[]) {
  const step = readChosen('release.yml').jobs.nightly!.steps![0]!;
  const folder = testFolder('lawcheck-release-nightly-');
  const dir = folder.dir;
  try {
    writeFileSync(join(dir, 'runs.json'), JSON.stringify({ workflow_runs: runs.map((run) => ({ ...run, html_url: `https://example.invalid/${run.id}` })) }));
    // As GitHub does, it lists the runs of the commit the query names, and the runs of every commit when it names none.
    const standIn = [
      '#!/bin/sh',
      'case "$2" in',
      '  repos/o/r/commits/refs/tags/v9.9.9) echo abc123 ;;',
      '  repos/o/r/actions/workflows/nightly.yml/runs\\?*)',
      '    sha=$(printf %s "${2#*\\?}" | tr "&" "\\n" | sed -n "s/^head_sha=//p")',
      `    jq --arg sha "$sha" '.workflow_runs |= map(select($sha == "" or .head_sha == $sha))' "$FAKE_RUNS" | jq -r "$4" ;;`,
      '  *) exit 3 ;;',
      'esac',
    ];
    writeFileSync(join(dir, 'gh'), `${standIn.join('\n')}\n`);
    chmodSync(join(dir, 'gh'), 0o755);
    const run = spawnSync('bash', ['-c', step.run!], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, FAKE_RUNS: join(dir, 'runs.json'), REPO: 'o/r', TAG: 'v9.9.9', COMMIT: 'abc123' } });
    return { status: run.status, out: run.stdout + run.stderr };
  } finally {
    folder.remove();
  }
}

test('test 1432: only a run with no inputs takes the name release.yml counts', () => {
  const nightly = readChosen('nightly.yml');
  assert.equal(nightly['run-name'], `\${{ (${NARROWED}) && format('Nightly of chosen parts (jobs={0} tests={1} os={2})', inputs.jobs || 'all', inputs.tests || 'all', inputs.os || 'all') || '${WHOLE}' }}`);
  assert.equal(nightly.jobs.chosen!.if, `\${{ ${NARROWED} }}`);
  assert.ok(readChosen('release.yml').jobs.nightly!.steps![0]!.run!.includes(`.display_title == "${WHOLE}"`));
});

test('test 1433: release.yml takes one green whole Nightly on the tagged commit, and refuses a run of chosen parts, a red or unfinished run, a called one and none', (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  const whole = { id: 1, head_sha: 'abc123', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', display_title: WHOLE };
  const taken = releaseVerdict([whole]);
  assert.equal(taken.status, 0, taken.out);
  assert.match(taken.out, /green whole Nightlies:\n1 workflow_dispatch completed success/);
  const refused = [
    [{ ...whole, display_title: 'Nightly of chosen parts (jobs=limits tests=test 251 os=all)' }],
    [{ ...whole, conclusion: 'failure' }, { ...whole, id: 2, conclusion: 'cancelled' }],
    [{ ...whole, status: 'in_progress', conclusion: null }],
    [{ ...whole, event: 'push' }],
    [{ ...whole, head_sha: 'def456' }],
    [],
  ];
  for (const runs of refused) {
    const verdict = releaseVerdict(runs);
    assert.equal(verdict.status, 1, `${JSON.stringify(runs)}: ${verdict.out}`);
    assert.match(verdict.out, /has no green whole Nightly/);
  }
});

test('test 1434: the nightly runs the commit set once on each system', () => {
  const runs = read('nightly.yml').jobs.commit!.steps!.map((step) => step.run ?? '').filter((run) => run.startsWith('npm test'));
  assert.deepEqual(runs, ['npm test']);
});
