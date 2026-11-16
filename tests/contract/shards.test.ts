import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { failedTests, judge, judgeShards, mergeProblems, parseRunStarted, profile, readShards, summary, tied, type Event, type Judge, type Shard } from '../harness/merge.ts';
import { judgeRun } from '../harness/reporter.ts';
import { startProgram, testFolder } from '../harness/tool.ts';
import { continueOnErrorProblems } from '../harness/workflows.ts';
import { groupDirs, perPushFiles, PLATFORM_TESTS, ROOT, setFiles } from '../harness/sets.ts';
import { balance, matrix, measureShards, plannedWalls, planProblems, readPlan, repoPath, SYSTEMS, wallOf, type Plan, type Run } from '../harness/shards.ts';


test('question 95: every test file of each system\'s per-push set is in exactly one shard of tests/harness/shards.json', () => {
  assert.deepEqual(planProblems(readPlan()), []);
});

test('question 95: a plan that leaves a file out, names one twice, or names a file that is no test is refused (control)', () => {
  const plan = readPlan();
  const shards = plan.shards.linux!;
  const at = shards.findIndex((list) => list.length > 1);
  const other = at === 0 ? 1 : 0;
  const file = shards[at]![0]!;
  const changed = (index: number, list: string[]): Plan => ({ ...plan, shards: { ...plan.shards, linux: shards.map((s, i) => (i === index ? list : s)) } });
  assert.deepEqual(planProblems(changed(at, shards[at]!.slice(1))).filter((p) => p.startsWith('linux:')), [`linux: ${file} is in no shard`]);
  assert.deepEqual(planProblems(changed(other, [...shards[other]!, file])).filter((p) => p.startsWith('linux:')), [`linux: ${file} is in shards ${[at + 1, other + 1].sort().join(' and ')}`]);
  assert.deepEqual(planProblems(changed(at, [...shards[at]!, 'tests/unit/none.test.ts'])).filter((p) => p.startsWith('linux:')), [`linux: shard ${at + 1} names tests/unit/none.test.ts, which is not a test file of the per-push set of linux`]);
});

type Step = { id?: string; shell?: string; 'working-directory'?: string; name?: string; uses?: string; if?: string; env?: Record<string, string>; run?: string; with?: Record<string, unknown>; 'continue-on-error'?: unknown };
type CiJob = { 'continue-on-error'?: unknown; permissions?: Record<string, string>; needs?: string | string[]; if?: string; 'runs-on'?: string; outputs?: Record<string, string>; strategy?: { matrix?: { include?: unknown } }; steps?: Step[] };
type Ci = { jobs: Record<string, CiJob> };
const OS: Record<(typeof SYSTEMS)[number], RegExp> = { linux: /^ubuntu-/, win32: /^windows-/, darwin: /^macos-/ };
const START_STEP = ['started=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" --jq .run_started_at) || started=', 'echo "at=$started" >> "$GITHUB_OUTPUT"'];
const START_STEP_KEYS = ['env', 'id', 'name', 'run'];
const isStartStep = (s: Step): boolean => s.id !== undefined && JSON.stringify(Object.keys(s).sort()) === JSON.stringify(START_STEP_KEYS) && s.name === 'The start of the run' && JSON.stringify(s.env) === JSON.stringify({ GH_TOKEN: '${{ github.token }}' }) && JSON.stringify(commandLines(s.run)) === JSON.stringify(START_STEP);
const commandLines = (run: string | undefined): string[] => (run ?? '').split('\n').filter((line) => line.trim() !== '');
const needsOf = (job: CiJob | undefined): string[] => [job?.needs ?? []].flat().sort();

// Each system runs per push in the shards of the plan and is merged on its own: the build prints the matrix from tests/harness/shards.json, one shard job per system reads it, the merge of a system waits for that system's shards only, and the one required check waits for every job.
function ciProblems(ci: Ci, plan: Plan): string[] {
  const problems: string[] = [];
  const build = ci.jobs.build;
  const step = build?.steps?.find((s) => /^set -o pipefail\nnode tests\/harness\/shards\.ts matrix "\$RUNS" \| tee -a "\$GITHUB_OUTPUT"\n?$/.test(s.run ?? ''));
  if (step === undefined || step.id === undefined || step.env?.RUNS === undefined) return ['ci.yml: no step of the build job prints the matrix of tests/harness/shards.json from its RUNS'];
  const runs = JSON.parse(step.env.RUNS) as Run[];
  const { outputs, problems: planned } = matrix(plan, runs);
  problems.push(...planned.map((p) => `ci.yml: ${p}`));
  for (const run of runs) {
    if (!(SYSTEMS as readonly string[]).includes(run.system)) continue;
    if (!OS[run.system].test(run.os)) problems.push(`ci.yml: the run ${run.os} Node ${run.node} is named ${run.system}`);
    if (run.offline !== undefined && run.system !== 'linux') problems.push(`ci.yml: the run ${run.os} Node ${run.node} asks for a closed network, which only the shards of Linux close`);
  }
  for (const system of SYSTEMS) {
    for (const key of [`shards_${system}`, `runs_${system}`]) {
      if (build!.outputs?.[key] !== `\${{ steps.${step.id}.outputs.${key} }}`) problems.push(`ci.yml: the build job does not give out ${key} of its matrix step`);
      if (!(key in outputs) || (outputs[key] ?? []).length === 0) problems.push(`ci.yml: ${key} is empty`);
    }
    const shard = ci.jobs[`shard-${system}`];
    if (shard === undefined) { problems.push(`ci.yml: no job shard-${system}`); continue; }
    if (!needsOf(shard).includes('build')) problems.push(`ci.yml: shard-${system} does not wait for the build`);
    if (shard.strategy?.matrix?.include !== `\${{ fromJSON(needs.build.outputs.shards_${system}) }}`) problems.push(`ci.yml: shard-${system} does not run the shards the plan has for ${system}`);
    if (shard['runs-on'] !== '${{ matrix.os }}') problems.push(`ci.yml: shard-${system} does not run on the system of its run`);
    if (shard.if !== undefined) problems.push(`ci.yml: shard-${system} runs only if ${shard.if}`);
    const runsShard = (shard.steps ?? []).filter((s) => (s.run ?? '').includes('npm run test:shard -- ${{ matrix.shard }}/${{ matrix.of }}'));
    if (runsShard.length === 0 || runsShard.some((s) => s.env?.LAWCHECK_RECORD !== '${{ runner.temp }}/shard')) problems.push(`ci.yml: shard-${system} does not run and record its shard`);
    const upload = (shard.steps ?? []).find((s) => s.uses?.startsWith('actions/upload-artifact@') && s.with?.name === 'shard-${{ matrix.os }}-${{ matrix.node }}-${{ matrix.shard }}');
    if (upload?.if !== 'always()') problems.push(`ci.yml: shard-${system} does not upload its recording whatever its result`);
    const merge = ci.jobs[`merge-${system}`];
    if (merge === undefined) { problems.push(`ci.yml: no job merge-${system}`); continue; }
    if (JSON.stringify(needsOf(merge)) !== JSON.stringify(['build', `shard-${system}`].sort())) problems.push(`ci.yml: merge-${system} waits for ${needsOf(merge).join(', ')}, not for the build and the shards of ${system} alone`);
    if (merge.if !== 'always()') problems.push(`ci.yml: merge-${system} does not run when a shard failed, was cancelled or skipped`);
    if (merge.strategy?.matrix?.include !== `\${{ fromJSON(needs.build.outputs.runs_${system}) }}`) problems.push(`ci.yml: merge-${system} does not merge each run of ${system}`);
    const merged = (merge.steps ?? []).find((s) => /^node tests\/harness\/merge\.ts shards --system \$\{\{ matrix\.system \}\}( |$)/.test(s.run ?? ''));
    const download = (merge.steps ?? []).find((s) => s.uses?.startsWith('actions/download-artifact@') && s.with?.pattern === 'shard-${{ matrix.os }}-${{ matrix.node }}-*' && s.with?.path === 'shards');
    if (merged === undefined || download === undefined) problems.push(`ci.yml: merge-${system} does not judge the shards of its run as one run of its system`);
    const started = (merge.steps ?? []).find(isStartStep);
    if (started === undefined || !(merged?.run ?? '').includes(`--run-started "\${{ steps.${started.id}.outputs.at }}"`)) problems.push(`ci.yml: merge-${system} does not time its run from the run's own start, run_started_at of the API, or lets a failed call fail the merge`);
    if (JSON.stringify(Object.entries(merge.permissions ?? {}).sort()) !== JSON.stringify([['actions', 'read'], ['contents', 'read']])) problems.push(`ci.yml: merge-${system} has permissions other than read of the contents and of the actions`);
  }
  for (const name of Object.keys(ci.jobs)) if (/^(shard|merge)(-|$)/.test(name) && !SYSTEMS.some((system) => name === `shard-${system}` || name === `merge-${system}`)) problems.push(`ci.yml: ${name} is no job of a system`);
  const gate = ci.jobs['commit-set'];
  if (gate === undefined) problems.push('ci.yml: no job commit-set');
  else {
    if (gate.if !== 'always()') problems.push('ci.yml: commit-set does not run when a job failed, was cancelled or skipped');
    const others = Object.keys(ci.jobs).filter((name) => name !== 'commit-set').sort();
    if (JSON.stringify(needsOf(gate)) !== JSON.stringify(others)) problems.push(`ci.yml: commit-set waits for ${needsOf(gate).join(', ')}, not for every other job`);
  }
  problems.push(...continueOnErrorProblems('ci.yml', ci.jobs));
  return problems;
}

const ciFile = (): Ci => parse(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')) as Ci;

test('question 95: each of the three systems runs per push in the shards of tests/harness/shards.json, each system\'s merge waits for its own shards only, and the one required check waits for every job', () => {
  const ci = ciFile();
  const plan = readPlan();
  assert.deepEqual(ciProblems(ci, plan), []);
  const runs = JSON.parse(ci.jobs.build!.steps!.find((s) => s.id === 'matrix')!.env!.RUNS!) as Run[];
  const { outputs } = matrix(plan, runs);
  for (const system of SYSTEMS) {
    const count = plan.shards[system]!.length;
    const mine = runs.filter((run) => run.system === system);
    assert.ok(mine.length > 0, system);
    assert.deepEqual(outputs[`shards_${system}`], mine.flatMap((run) => Array.from({ length: count }, (_, i) => ({ ...run, shard: i + 1, of: count }))), system);
  }
});

test('question 95: a ci.yml that drops the runs of a system, merges a system after another\'s shards, writes the shards by hand, or leaves a job out of the required check is refused (control)', () => {
  const plan = readPlan();
  const changed = (edit: (ci: Ci) => void): string[] => { const ci = ciFile(); edit(ci); return ciProblems(ci, plan); };
  const unstarted = (job: string) => `ci.yml: ${job} does not time its run from the run's own start, run_started_at of the API, or lets a failed call fail the merge`;
  const runsOf = (ci: Ci) => ci.jobs.build!.steps!.find((s) => s.id === 'matrix')!.env!;
  assert.deepEqual(changed((ci) => { const env = runsOf(ci); env.RUNS = JSON.stringify((JSON.parse(env.RUNS!) as Run[]).filter((run) => run.system !== 'win32')); }), ['ci.yml: no run of win32 per push', 'ci.yml: shards_win32 is empty', 'ci.yml: runs_win32 is empty']);
  assert.deepEqual(changed((ci) => { ci.jobs['merge-darwin']!.needs = ['build', 'shard-darwin', 'shard-win32']; }), ['ci.yml: merge-darwin waits for build, shard-darwin, shard-win32, not for the build and the shards of darwin alone']);
  assert.deepEqual(changed((ci) => { ci.jobs['shard-win32']!.strategy!.matrix!.include = [{ os: 'windows-latest', node: '24', system: 'win32', shard: 1, of: 1 }]; }), ['ci.yml: shard-win32 does not run the shards the plan has for win32']);
  assert.deepEqual(changed((ci) => { delete ci.jobs['merge-darwin']; ci.jobs['commit-set']!.needs = needsOf(ci.jobs['commit-set']).filter((n) => n !== 'merge-darwin'); }), ['ci.yml: no job merge-darwin']);
  assert.deepEqual(changed((ci) => { ci.jobs['commit-set']!.needs = needsOf(ci.jobs['commit-set']).filter((n) => n !== 'shard-darwin'); }), [`ci.yml: commit-set waits for ${needsOf(ciFile().jobs['commit-set']).filter((n) => n !== 'shard-darwin').join(', ')}, not for every other job`]);
  assert.deepEqual(changed((ci) => { ci.jobs['merge-win32']!.if = 'success()'; }), ['ci.yml: merge-win32 does not run when a shard failed, was cancelled or skipped']);
  assert.deepEqual(changed((ci) => { ci.jobs['shard-darwin']!.if = "github.event_name == 'push'"; }), ["ci.yml: shard-darwin runs only if github.event_name == 'push'"]);
  assert.deepEqual(changed((ci) => { const run = ci.jobs['merge-win32']!.steps!.find((s) => s.name === 'The shards as one run')!; run.run = run.run!.replace(/ --run-started "[^"]*"/, ''); }), ["ci.yml: merge-win32 does not time its run from the run's own start, run_started_at of the API, or lets a failed call fail the merge"]);
  assert.deepEqual(changed((ci) => { ci.jobs['merge-darwin']!.steps = ci.jobs['merge-darwin']!.steps!.filter((s) => s.id !== 'started'); }), ["ci.yml: merge-darwin does not time its run from the run's own start, run_started_at of the API, or lets a failed call fail the merge"]);
  assert.deepEqual(changed((ci) => { const read = ci.jobs['merge-linux']!.steps!.find((s) => s.id === 'started')!; read.run = read.run!.replace(' || started=', ''); }), [unstarted('merge-linux')]);
  for (const added of ['exit 1', 'false', 'test -n "$started"', 'echo "at=$started" >> "$GITHUB_OUTPUT" && exit 1']) {
    assert.deepEqual(changed((ci) => { const read = ci.jobs['merge-darwin']!.steps!.find((s) => s.id === 'started')!; read.run = `${read.run!.trimEnd()}\n${added}\n`; }), [unstarted('merge-darwin')], `${added} after the fallback`);
    assert.deepEqual(changed((ci) => { const read = ci.jobs['merge-win32']!.steps!.find((s) => s.id === 'started')!; const [call, write] = commandLines(read.run); read.run = `${call}\n${added}\n${write}\n`; }), [unstarted('merge-win32')], `${added} between the fallback and the write`);
  }
  for (const [key, value] of [['shell', "bash -c 'exit 1' {0}"], ['working-directory', 'nowhere'], ['if', 'false']] as const) {
    assert.deepEqual(changed((ci) => { Object.assign(ci.jobs['merge-linux']!.steps!.find((s) => s.id === 'started')!, { [key]: value }); }), [unstarted('merge-linux')], `${key} on the run-start step`);
  }
  assert.deepEqual(changed((ci) => { ci.jobs['merge-linux']!.permissions = { contents: 'read', actions: 'read', checks: 'write' }; }), ['ci.yml: merge-linux has permissions other than read of the contents and of the actions']);
  assert.deepEqual(changed((ci) => { delete ci.jobs['merge-linux']!.permissions; }), ['ci.yml: merge-linux has permissions other than read of the contents and of the actions']);
});

test('question 95: continue-on-error on any job of ci.yml or any step of one is refused, and a literal false is not (control)', () => {
  const plan = readPlan();
  const changed = (edit: (ci: Ci) => void): string[] => { const ci = ciFile(); edit(ci); return ciProblems(ci, plan); };
  const reds = (what: string) => `${what} has continue-on-error, so GitHub reports its red as a success`;
  assert.deepEqual(changed((ci) => { ci.jobs['shard-linux']!['continue-on-error'] = true; }), [`ci.yml: ${reds('shard-linux')}`]);
  assert.deepEqual(changed((ci) => { ci.jobs['shard-win32']!.steps!.find((s) => s.name?.startsWith('Shard '))!['continue-on-error'] = true; }), [`ci.yml: ${reds('step 6 of shard-win32 (Shard ${{ matrix.shard }} of ${{ matrix.of }})')}`]);
  assert.deepEqual(changed((ci) => { ci.jobs['merge-darwin']!['continue-on-error'] = '${{ matrix.node != \'24\' }}'; }), [`ci.yml: ${reds('merge-darwin')}`]);
  assert.deepEqual(changed((ci) => { ci.jobs['merge-linux']!.steps!.find((s) => s.name === 'The shards as one run')!['continue-on-error'] = true; }), [`ci.yml: ${reds('step 5 of merge-linux (The shards as one run)')}`]);
  assert.deepEqual(changed((ci) => { ci.jobs['commit-set']!['continue-on-error'] = true; }), [`ci.yml: ${reds('commit-set')}`]);
  assert.deepEqual(changed((ci) => { ci.jobs['commit-set']!.steps![0]!['continue-on-error'] = true; }), [`ci.yml: ${reds('step 1 of commit-set (Every job green)')}`]);
  assert.deepEqual(changed((ci) => { ci.jobs.real!['continue-on-error'] = true; }), [`ci.yml: ${reds('real')}`]);
  assert.deepEqual(changed((ci) => { ci.jobs.real!.steps!.find((s) => s.name === 'Two real repositories')!['continue-on-error'] = '${{ always() }}'; }), [`ci.yml: ${reds('step 5 of real (Two real repositories)')}`]);
  assert.deepEqual(changed((ci) => { ci.jobs.plugin!['continue-on-error'] = true; }), [`ci.yml: ${reds('plugin')}`]);
  assert.deepEqual(changed((ci) => { ci.jobs.workflows!.steps!.find((s) => s.name === 'actionlint')!['continue-on-error'] = true; }), [`ci.yml: ${reds('step 2 of workflows (actionlint)')}`]);
  assert.deepEqual(changed((ci) => { ci.jobs['shard-linux']!['continue-on-error'] = false; ci.jobs['commit-set']!.steps![0]!['continue-on-error'] = false; ci.jobs.real!['continue-on-error'] = false; }), []);
  const every = ciFile();
  for (const [name, job] of Object.entries(every.jobs)) {
    assert.equal(changed((ci) => { ci.jobs[name]!['continue-on-error'] = true; }).filter((p) => p.includes('continue-on-error')).length, 1, name);
    for (let i = 0; i < (job.steps ?? []).length; i++) assert.equal(changed((ci) => { ci.jobs[name]!.steps![i]!['continue-on-error'] = true; }).filter((p) => p.includes('continue-on-error')).length, 1, `step ${i + 1} of ${name}`);
  }
});

const ok = (file: string, name: string): Event => ({ type: 'test:pass', data: { file: join(ROOT, file), name, nesting: 0, details: { duration_ms: 5 } } });
const shard = (index: number, of: number, files: string[], status = 0): Shard => ({
  meta: { system: 'linux', node: 'v24', shard: index, of, files, started: 0, ended: 1000, status },
  events: files.map((f) => ok(f, `${f} test`)),
});

test('question 95: the merge of one system finds a shard that did not report, a file run twice or by no shard, and a failed shard', () => {
  const files = ['tests/unit/a.test.ts', 'tests/unit/b.test.ts', 'tests/unit/c.test.ts'];
  const plan: Plan = { measured: {}, shards: { linux: [[files[0]!, files[1]!], [files[2]!]], win32: [files], darwin: [files] } };
  assert.deepEqual(mergeProblems('linux', plan, [shard(1, 2, [files[0]!, files[1]!]), shard(2, 2, [files[2]!])], files), []);
  assert.deepEqual(mergeProblems('linux', plan, [shard(1, 2, [files[0]!, files[1]!])], files), [
    'shard 2 of 2 on linux did not report: it was cancelled, skipped or never ran',
    'tests/unit/c.test.ts ran in no shard on linux',
  ]);
  assert.deepEqual(mergeProblems('linux', plan, [shard(1, 2, [files[0]!, files[1]!]), shard(2, 2, [files[2]!, files[0]!])], files), ['tests/unit/a.test.ts ran in shards 1 and 2 on linux']);
  assert.deepEqual(mergeProblems('linux', plan, [shard(1, 2, [files[0]!, files[1]!], 1), shard(2, 2, [files[2]!])], files), ['shard 1 of 2 on linux failed (exit 1)']);
  assert.deepEqual(mergeProblems('linux', plan, [shard(1, 3, [files[0]!, files[1]!]), shard(2, 2, [files[2]!])], files), ['shard 1 ran as one of 3, and the plan has 2 for linux']);
  const failing = shard(2, 2, [files[2]!]);
  failing.events = [{ type: 'test:fail', data: { file: join(ROOT, files[2]!), name: 'c', nesting: 0, details: { error: { failureType: 'testCodeFailure' } } } }];
  assert.equal(failedTests([...shard(1, 2, files).events, ...failing.events]), 1);
});

test('question 95: the merge of Windows or macOS finds a selected test that did not run, one that ran twice, and one that is not selected', () => {
  const files = ['tests/unit/a.test.ts'];
  const plan: Plan = { measured: {}, shards: { linux: [files], win32: [files], darwin: [files] } };
  const run = (names: string[]): Shard => ({ meta: { system: 'win32', node: 'v24', shard: 1, of: 1, files, started: 0, ended: 1, status: 0 }, events: names.map((n) => ok(files[0]!, n)) });
  const selected = [{ file: files[0]!, test: 'test 1: a' }, { file: files[0]!, test: 'test 2: b' }];
  assert.deepEqual(mergeProblems('win32', plan, [run(['test 1: a', 'test 2: b'])], files, selected), []);
  assert.deepEqual(mergeProblems('win32', plan, [run(['test 1: a', 'test 1: a', 'test 3: c'])], files, selected), [
    'tests/unit/a.test.ts > test 1: a ran 2 times on win32',
    'tests/unit/a.test.ts > test 2: b is selected for win32 and did not run',
    'tests/unit/a.test.ts > test 3: c ran on win32, and PLATFORM_TESTS does not select it there',
  ]);
});

test('question 95: Linux runs the whole commit set per push, and Windows and macOS the files PLATFORM_TESTS names for them', () => {
  const all = setFiles('commit', groupDirs('commit', null)!);
  assert.deepEqual(perPushFiles('linux'), all);
  for (const system of ['win32', 'darwin'] as const) assert.deepEqual(perPushFiles(system), all.filter((f) => PLATFORM_TESTS.some((e) => e.file === f && e.systems.includes(system))));
});

test('question 95: balance spreads files by measured time, slowest first, and gives an unmeasured file the median', () => {
  assert.deepEqual(balance(['a', 'b', 'c', 'd'], { a: 90, b: 50, c: 40, d: 10 }, 2), [['a', 'd'], ['b', 'c']]);
  assert.deepEqual(balance(['a', 'b', 'x'], { a: 100, b: 10 }, 2), [['a', 'b'], ['x']]);
});

test('question 95: balance plans the wall time of shards that run several files at once, not the sum of their times, and lists each shard slowest first', () => {
  const ms = { a: 100, b: 60, c: 60, d: 50, e: 50 };
  const shards = balance(['a', 'b', 'c', 'd', 'e'], ms, 2, 2);
  assert.deepEqual(shards, [['a', 'd', 'e'], ['b', 'c']]);
  assert.deepEqual(shards.map((files) => wallOf(files, (f) => ms[f as keyof typeof ms], 2)), [100, 60]);
  assert.equal(wallOf(['a', 'b', 'c'], (f) => ms[f as keyof typeof ms], 2), 120);
});

test('question 95: the committed plan is what the planner makes from its own measurements: each file\'s cost in a shard and the slots of each system', () => {
  const plan = readPlan();
  for (const system of SYSTEMS) {
    const measured = plan.measured[system]!;
    assert.ok(measured.slots >= 1 && Object.keys(measured.cost).length > 0, system);
    assert.deepEqual(plan.shards[system], balance(perPushFiles(system), measured.cost, plan.shards[system]!.length, measured.slots), `${system}: node tests/harness/shards.ts plan writes another plan`);
    assert.equal(plannedWalls(plan, system).length, plan.shards[system]!.length);
  }
});

test('question 95: a file\'s cost is its time in the shard from node:test\'s summary of it, read from the recordings of that system only', () => {
  const root = '/home/runner/work/Lawcheck/Lawcheck/';
  const summary = (file: string, ms: number): Event => ({ type: 'test:summary', data: { file: `${root}${file}`, duration_ms: ms } });
  const dir = recorded([
    { meta: { system: 'linux', node: 'v24', root, slots: 3, shard: 1, of: 2, files: [], started: 0, ended: 1, status: 0 }, events: [summary('tests/unit/a.test.ts', 7_000.4), ok('tests/unit/a.test.ts', 'test 1: a'), summary('tests/unit/b.test.ts', 2_000)] },
    { meta: { system: 'win32', node: 'v24', root: 'D:\\a\\Lawcheck\\Lawcheck\\', slots: 3, shard: 2, of: 2, files: [], started: 0, ended: 1, status: 0 }, events: [{ type: 'test:summary', data: { file: 'D:\\a\\Lawcheck\\Lawcheck\\tests\\unit\\a.test.ts', duration_ms: 50_000 } }] },
  ]);
  try {
    const linux = measureShards(dir, 'linux');
    assert.deepEqual(linux.cost, { 'tests/unit/a.test.ts': 7_000, 'tests/unit/b.test.ts': 2_000 });
    assert.equal(linux.slots, 3);
    assert.deepEqual(measureShards(dir, 'win32').cost, { 'tests/unit/a.test.ts': 50_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function* replay(events: Event[]): AsyncGenerator<Event> {
  for (const e of events) yield e;
}

function recorded(shards: { meta: Record<string, unknown>; events: Event[] }[]): string {
  const dir = testFolder('lawcheck-merge-').dir;
  for (const { meta, events } of shards) {
    writeFileSync(join(dir, `meta-${meta.shard}.json`), JSON.stringify(meta));
    writeFileSync(join(dir, `events-${meta.shard}.jsonl`), events.map((e) => JSON.stringify(e)).join('\n'));
  }
  return dir;
}

test('question 95: the merge reads a shard recorded on Windows against the root it recorded, from a checkout on another system', () => {
  assert.equal(repoPath('D:\\a\\Lawcheck\\Lawcheck\\tests\\unit\\a.test.ts', 'D:\\a\\Lawcheck\\Lawcheck\\'), 'tests/unit/a.test.ts');
  assert.equal(repoPath('file:///D:/a/Lawcheck/Lawcheck/tests/unit/a.test.ts', 'd:\\a\\Lawcheck\\Lawcheck'), 'tests/unit/a.test.ts');
  assert.equal(repoPath('/Users/runner/work/Lawcheck/Lawcheck/tests/unit/a.test.ts', '/Users/runner/work/Lawcheck/Lawcheck/'), 'tests/unit/a.test.ts');
  assert.equal(repoPath('/elsewhere/tests/unit/a.test.ts', '/Users/runner/work/Lawcheck/Lawcheck/'), '/elsewhere/tests/unit/a.test.ts');
  const files = ['tests/unit/a.test.ts'];
  const root = 'D:\\a\\Lawcheck\\Lawcheck\\';
  const dir = recorded([{ meta: { system: 'win32', node: 'v24', root, shard: 1, of: 1, files, started: 0, ended: 1, status: 0 }, events: [{ type: 'test:pass', data: { file: `${root}tests\\unit\\a.test.ts`, name: 'test 1: a', nesting: 0, details: { duration_ms: 5 } } }] }]);
  try {
    const { shards, problems } = readShards(dir);
    assert.deepEqual(problems, []);
    const plan: Plan = { measured: {}, shards: { linux: [files], win32: [files], darwin: [files] } };
    assert.deepEqual(mergeProblems('win32', plan, shards, files, [{ file: files[0]!, test: 'test 1: a' }]), []);
    assert.equal(shards[0]!.events[0]!.data.file, join(ROOT, files[0]!));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('question 95: the reporter judges a run against the SLOW_TESTS of the system it ran on, not of the machine that reads it', async () => {
  const key = 'tests/acceptance/cli.test.ts > test 38: the base';
  const events: Event[] = [{ type: 'test:pass', data: { file: join(ROOT, 'tests/acceptance/cli.test.ts'), name: 'test 38: the base', nesting: 0, details: { duration_ms: 4_400 } } }];
  const on = async (system: 'linux' | 'win32') => (await judgeRun(replay(events), { system, started: null, target: 0 })).text;
  assert.doesNotMatch(await on('win32'), /no entry in SLOW_TESTS/);
  assert.match(await on('linux'), new RegExp(`no entry in SLOW_TESTS for linux\\n +4400 ms  ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('question 95: the merge of Windows or macOS counts a selected test that skipped or is todo as not run, unless PLATFORM_SKIPS skips it whole there', () => {
  const file = 'tests/acceptance/law.test.ts';
  const excused = 'check-slice §6: a law that cannot be read is law-invalid';
  const plan: Plan = { measured: {}, shards: { linux: [[file]], win32: [[file]], darwin: [[file]] } };
  const run = (system: 'win32' | 'darwin', events: Event[]): Shard => ({ meta: { system, node: 'v24', shard: 1, of: 1, files: [file], started: 0, ended: 1, status: 0 }, events });
  const event = (name: string, extra: Record<string, unknown>): Event => ({ type: 'test:pass', data: { file: join(ROOT, file), name, nesting: 0, details: { duration_ms: 1 }, ...extra } });
  const selected = [{ file, test: 'test 1: a' }, { file, test: 'test 2: b' }, { file, test: excused }];
  const events = [event('test 1: a', { skip: true }), event('test 2: b', { todo: true }), event(excused, { skip: 'chmod on Windows sets only the read-only flag' })];
  assert.deepEqual(mergeProblems('win32', plan, [run('win32', events)], [file], selected), [
    `${file} > test 1: a is selected for win32 and was skipped, so it did not run, and PLATFORM_SKIPS does not excuse it there`,
    `${file} > test 2: b is selected for win32 and was marked todo, so it did not run, and PLATFORM_SKIPS does not excuse it there`,
  ]);
  assert.ok(mergeProblems('darwin', plan, [run('darwin', events)], [file], selected).includes(`${file} > ${excused} is selected for darwin and was skipped, so it did not run, and PLATFORM_SKIPS does not excuse it there`));
});

test('question 95: the merge fails whenever the reporter judges the merged run red, and passes the run the reporter passes', async () => {
  const files = ['tests/unit/a.test.ts'];
  const plan: Plan = { measured: {}, shards: { linux: [files], win32: [files], darwin: [files] } };
  const clean = [shard(1, 1, files)];
  const untied: Judge = async (events, options) => {
    const tie = process.env.LAWCHECK_TIE;
    delete process.env.LAWCHECK_TIE;
    try {
      return await judgeRun(events, options);
    } finally {
      if (tie !== undefined) process.env.LAWCHECK_TIE = tie;
    }
  };
  assert.equal((await judgeShards('linux', plan, clean, files, untied)).failed, false);
  const whole = await judgeShards('linux', plan, clean, files);
  assert.equal(whole.failed, true);
  assert.match(whole.text, /^RED {6}the run-time tie of question 79$/m);
  const red = await judgeShards('linux', plan, clean, files, async () => ({ text: 'RED      a whole-run verdict of the reporter', red: true }));
  assert.equal(red.failed, true);
  assert.match(red.text, /^RED {6}a whole-run verdict of the reporter$/m);
  assert.match(red.text, /^FAIL {2}the commit set on linux/m);
  const failing = shard(1, 1, files);
  failing.events = [{ type: 'test:fail', data: { file: join(ROOT, files[0]!), name: 'test 1: a', nesting: 0, details: { error: { failureType: 'testCodeFailure' } } } }];
  assert.equal((await judgeRun(replay(failing.events), { system: 'linux', started: null, target: 0 })).red, true);
  assert.equal((await judgeShards('linux', plan, [failing], files, untied)).failed, true);
});

test('question 95: the merge times a system as its wall time, from the first shard\'s start to the last one\'s end, beside the time summed over the shards', async () => {
  const files = ['tests/unit/a.test.ts', 'tests/unit/b.test.ts'];
  const plan: Plan = { measured: {}, shards: { linux: [[files[0]!], [files[1]!]], win32: [files], darwin: [files] } };
  const one = shard(1, 2, [files[0]!]);
  const two = shard(2, 2, [files[1]!]);
  one.meta.started = 1_000_000; one.meta.ended = 1_100_000;
  two.meta.started = 1_050_000; two.meta.ended = 1_150_000;
  const judged = await judgeShards('linux', plan, [one, two], files);
  assert.match(judged.text, /; 150 s of wall time from the first shard's start to the last one's end, 200 s summed over the shards$/m);
  assert.match(judged.text, /^ran 2 test files, 2 tests: 2 passed, 0 failed, in 150\.\d s$/m);
  const written = profile('linux', [one, two]);
  assert.equal(written.wall_ms, 150_000);
  assert.equal(written.summed_ms, 200_000);
  assert.deepEqual(written.shards.map((s) => [s.shard, s.started, s.ended]), [[1, 1_000_000, 1_100_000], [2, 1_050_000, 1_150_000]]);
  assert.match(summary('linux', [one, two], false), /^150 s of wall time, from the first shard's start to the last one's end; 200 s summed over 2 shards; the slowest, shard 1, took 100 s\.$/m);
});

test('question 95: the merge times a system from the start of the run to its own verdict, beside the shards\' wall time, in its text, its summary and its profile', async () => {
  const files = ['tests/unit/a.test.ts'];
  const dir = recorded([{ meta: { system: 'linux', node: 'v24', shard: 1, of: 1, files, started: 1_000_000, ended: 1_076_000, status: 0 }, events: [ok(files[0]!, 'test 1: a')] }]);
  const out = testFolder('lawcheck-merge-out-').dir;
  try {
    const runStarted = parseRunStarted('2026-11-16T01:50:00Z')!;
    const judged = await judge(dir, 'linux', { profile: join(out, 'profile.json'), summary: join(out, 'summary.md'), runStarted, now: () => runStarted + 262_000 });
    assert.match(judged.text, /^262 s from the start of the run to this verdict, against 76 s of wall time of the shards$/m);
    assert.match(readFileSync(join(out, 'summary.md'), 'utf8'), /^76 s of wall time, from the first shard's start to the last one's end; 76 s summed over 1 shards; the slowest, shard 1, took 76 s\. 262 s from the start of the run to this verdict, the build, the setup and the merge included\.$/m);
    const written = JSON.parse(readFileSync(join(out, 'profile.json'), 'utf8')) as { wall_ms: number; run_ms: number | null };
    assert.deepEqual([written.wall_ms, written.run_ms], [76_000, 262_000]);
    const without = await judge(dir, 'linux', { profile: join(out, 'without.json') });
    assert.doesNotMatch(without.text, /from the start of the run/);
    assert.equal((JSON.parse(readFileSync(join(out, 'without.json'), 'utf8')) as { run_ms: number | null }).run_ms, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

const unreadable = "The start of the run could not be read, so only the wall time of the shards is given: 76 s from the first shard's start to the last one's end.";

test('question 95: when the call that reads the start of the run fails, the merge says so and gives the shards\' time, and its verdict is the tests\' verdict, as when the call works', async () => {
  const files = ['tests/unit/a.test.ts'];
  const meta = { system: 'linux', node: 'v24', shard: 1, of: 1, files, started: 1_000_000, ended: 1_076_000 };
  const green = recorded([{ meta: { ...meta, status: 0 }, events: [ok(files[0]!, 'test 1: a')] }]);
  const red = recorded([{ meta: { ...meta, status: 1 }, events: [{ type: 'test:fail', data: { file: join(ROOT, files[0]!), name: 'test 1: a', nesting: 0, details: { error: { failureType: 'testCodeFailure' } } } }] }]);
  const out = testFolder('lawcheck-merge-out-').dir;
  const merge = (dir: string, started: string | null) => startProgram(join(ROOT, 'tests', 'harness', 'merge.ts'), [dir, '--system', 'linux', '--profile', join(out, 'profile.json'), '--summary', join(out, 'summary.md'), ...(started === null ? [] : ['--run-started', started])], ROOT, {}).ended;
  try {
    for (const [name, dir] of [['a shard that ran fewer files than the plan has', green], ['a failed test', red]] as const) {
      writeFileSync(join(out, 'summary.md'), '');
      const without = await merge(dir, null);
      assert.equal(without.code, 1, name);
      writeFileSync(join(out, 'summary.md'), '');
      const working = await merge(dir, new Date(Date.now() - 262_000).toISOString().replace(/\.\d+Z$/, 'Z'));
      assert.equal(without.stderr, '', `${name}, no start given`);
      assert.equal(working.stderr, '', `${name}, the call works`);
      assert.equal(working.code, without.code, `${name}, the call works`);
      assert.ok(working.stdout.startsWith(without.stdout), name);
      assert.match(working.stdout.slice(without.stdout.length), /^\d+ s from the start of the run to this verdict, against 76 s of wall time of the shards\n$/);
      assert.match(readFileSync(join(out, 'summary.md'), 'utf8'), /\d+ s from the start of the run to this verdict, the build, the setup and the merge included\.\n\n$/);
      assert.ok((JSON.parse(readFileSync(join(out, 'profile.json'), 'utf8')) as { run_ms: number }).run_ms > 200_000);
      for (const value of ['', 'null', 'gh: HTTP 502']) {
        writeFileSync(join(out, 'summary.md'), '');
        const failing = await merge(dir, value);
        assert.equal(failing.code, without.code, `${name}, the call failed with ${JSON.stringify(value)}: ${failing.stderr}`);
        assert.equal(failing.stderr, '', `${name}, the call failed with ${JSON.stringify(value)}`);
        assert.equal(failing.stdout, `${without.stdout}${unreadable}\n`);
        assert.ok(readFileSync(join(out, 'summary.md'), 'utf8').endsWith(` ${unreadable}\n\n`));
        assert.equal((JSON.parse(readFileSync(join(out, 'profile.json'), 'utf8')) as { run_ms: number | null }).run_ms, null);
      }
    }
  } finally {
    rmSync(green, { recursive: true, force: true });
    rmSync(red, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('question 95: the start of a run is read from the timestamp GitHub gives, and an empty or other value is no start', () => {
  assert.equal(parseRunStarted('2026-11-16T01:50:00Z'), Date.UTC(2026, 10, 16, 1, 50, 0));
  assert.equal(parseRunStarted('2026-11-16T01:50:00.250Z'), Date.UTC(2026, 10, 16, 1, 50, 0, 250));
  for (const value of ['', 'null', '1763257800', '2026-11-16', '2026-11-16T01:50:00+01:00', '2026-13-45T99:99:99Z']) assert.equal(parseRunStarted(value), null, JSON.stringify(value));
});

test('question 95: the ledger tie judges only the merged run of Linux, which runs the whole commit set; Windows and macOS are judged without it, whatever the environment held', async () => {
  const seen: Record<string, string | undefined> = {};
  const before = process.env.LAWCHECK_TIE;
  process.env.LAWCHECK_TIE = '1';
  try {
    for (const system of SYSTEMS) {
      const files = perPushFiles(system);
      const one: Shard = { meta: { system, node: 'v24', shard: 1, of: 1, files, started: 0, ended: 1, status: 0 }, events: [] };
      await judgeShards(system, { measured: {}, shards: { [system]: [files] } }, [one], files, async () => { seen[system] = process.env.LAWCHECK_TIE; return { text: '', red: false }; });
      assert.equal(process.env.LAWCHECK_TIE, '1', `${system}: the environment is given back`);
    }
  } finally {
    if (before === undefined) delete process.env.LAWCHECK_TIE; else process.env.LAWCHECK_TIE = before;
  }
  assert.deepEqual(seen, { linux: '1', win32: undefined, darwin: undefined });
  assert.deepEqual(SYSTEMS.map((system) => tied(system, perPushFiles(system))), [true, false, false]);
});
