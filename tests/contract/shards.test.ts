import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { failedTests, judgeShards, mergeProblems, profile, readShards, summary, type Event, type Shard } from '../harness/merge.ts';
import { judgeRun } from '../harness/reporter.ts';
import { groupDirs, perPushFiles, PLATFORM_TESTS, ROOT, setFiles } from '../harness/sets.ts';
import { balance, planProblems, readPlan, repoPath, SYSTEMS, type Plan } from '../harness/shards.ts';

type Entry = { os: string; node: string; system: string; shard?: number; of?: number };
type Job = { needs?: string | string[]; if?: string; strategy?: { matrix?: { include?: Entry[] } } };
const ci = parse(readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')) as { jobs: Record<string, Job> };

test('every test file of each system\'s per-push set is in exactly one shard of tests/harness/shards.json', () => {
  assert.deepEqual(planProblems(readPlan()), []);
});

test('a plan that leaves a file out, names one twice, or names a file that is no test is refused (control)', () => {
  const plan = readPlan();
  const [first, ...rest] = plan.shards.linux!;
  const dropped: Plan = { ...plan, shards: { ...plan.shards, linux: [first!.slice(1), ...rest] } };
  assert.deepEqual(planProblems(dropped).filter((p) => p.startsWith('linux:')), [`linux: ${first![0]} is in no shard`]);
  const twice: Plan = { ...plan, shards: { ...plan.shards, linux: [first!, ...rest.map((s, i) => (i === 0 ? [...s, first![0]!] : s))] } };
  assert.deepEqual(planProblems(twice).filter((p) => p.startsWith('linux:')), [`linux: ${first![0]} is in shards 1 and 2`]);
  const stray: Plan = { ...plan, shards: { ...plan.shards, linux: [[...first!, 'tests/unit/none.test.ts'], ...rest] } };
  assert.deepEqual(planProblems(stray).filter((p) => p.startsWith('linux:')), ['linux: shard 1 names tests/unit/none.test.ts, which is not a test file of the per-push set of linux']);
});

test('the shards of ci.yml are the shards of the plan, for each system and Node, and the merge and the one required check wait for them', () => {
  const plan = readPlan();
  const entries = ci.jobs.shard?.strategy?.matrix?.include ?? [];
  const runs = new Map<string, Entry[]>();
  for (const e of entries) runs.set(`${e.os} ${e.node}`, [...(runs.get(`${e.os} ${e.node}`) ?? []), e]);
  assert.ok(runs.size >= 3);
  for (const [run, list] of runs) {
    const system = list[0]!.system;
    assert.ok((SYSTEMS as readonly string[]).includes(system), run);
    const count = plan.shards[system]!.length;
    assert.deepEqual(list.map((e) => [e.system, e.shard, e.of]).sort(), Array.from({ length: count }, (_, i) => [system, i + 1, count]).sort(), run);
  }
  const merges = (ci.jobs.merge?.strategy?.matrix?.include ?? []).map((e) => `${e.os} ${e.node}`).sort();
  assert.deepEqual(merges, [...runs.keys()].sort());
  assert.equal(ci.jobs.merge?.if, 'always()');
  const gate = ci.jobs['commit-set']!;
  assert.equal(gate.if, 'always()');
  const others = Object.keys(ci.jobs).filter((name) => name !== 'commit-set');
  assert.deepEqual([...(gate.needs as string[])].sort(), others.sort());
});

const ok = (file: string, name: string): Event => ({ type: 'test:pass', data: { file: join(ROOT, file), name, nesting: 0, details: { duration_ms: 5 } } });
const shard = (index: number, of: number, files: string[], status = 0): Shard => ({
  meta: { system: 'linux', node: 'v24', shard: index, of, files, started: 0, ended: 1000, status },
  events: files.map((f) => ok(f, `${f} test`)),
});

test('the merge of one system finds a shard that did not report, a file run twice or by no shard, and a failed shard', () => {
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

test('the merge of Windows or macOS finds a selected test that did not run, one that ran twice, and one that is not selected', () => {
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

test('Linux runs the whole commit set per push, and Windows and macOS the files PLATFORM_TESTS names for them', () => {
  const all = setFiles('commit', groupDirs('commit', null)!);
  assert.deepEqual(perPushFiles('linux'), all);
  for (const system of ['win32', 'darwin'] as const) assert.deepEqual(perPushFiles(system), all.filter((f) => PLATFORM_TESTS.some((e) => e.file === f && e.systems.includes(system))));
});

test('balance spreads files by measured time, slowest first, and gives an unmeasured file the median', () => {
  assert.deepEqual(balance(['a', 'b', 'c', 'd'], { a: 90, b: 50, c: 40, d: 10 }, 2), [['a', 'd'], ['b', 'c']]);
  assert.deepEqual(balance(['a', 'b', 'x'], { a: 100, b: 10 }, 2), [['a', 'b'], ['x']]);
});

async function* replay(events: Event[]): AsyncGenerator<Event> {
  for (const e of events) yield e;
}

function recorded(shards: { meta: Record<string, unknown>; events: Event[] }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-merge-'));
  for (const { meta, events } of shards) {
    writeFileSync(join(dir, `meta-${meta.shard}.json`), JSON.stringify(meta));
    writeFileSync(join(dir, `events-${meta.shard}.jsonl`), events.map((e) => JSON.stringify(e)).join('\n'));
  }
  return dir;
}

test('the merge reads a shard recorded on Windows against the root it recorded, from a checkout on another system', () => {
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

test('the reporter judges a run against the SLOW_TESTS of the system it ran on, not of the machine that reads it', async () => {
  const key = 'tests/acceptance/cli.test.ts > test 38: the base';
  const events: Event[] = [{ type: 'test:pass', data: { file: join(ROOT, 'tests/acceptance/cli.test.ts'), name: 'test 38: the base', nesting: 0, details: { duration_ms: 4_400 } } }];
  const on = async (system: 'linux' | 'win32') => (await judgeRun(replay(events), { system, started: null, target: 0 })).text;
  assert.doesNotMatch(await on('win32'), /no entry in SLOW_TESTS/);
  assert.match(await on('linux'), new RegExp(`no entry in SLOW_TESTS for linux\\n +4400 ms  ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('the merge of Windows or macOS counts a selected test that skipped or is todo as not run, unless PLATFORM_SKIPS skips it whole there', () => {
  const file = 'tests/acceptance/law.test.ts';
  const excused = 'section 6: a law that cannot be read is law-invalid';
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

test('the merge fails whenever the reporter judges the merged run red, and passes the run the reporter passes', async () => {
  const files = ['tests/unit/a.test.ts'];
  const plan: Plan = { measured: {}, shards: { linux: [files], win32: [files], darwin: [files] } };
  const clean = [shard(1, 1, files)];
  assert.equal((await judgeShards('linux', plan, clean, files)).failed, false);
  const red = await judgeShards('linux', plan, clean, files, async () => ({ text: 'RED      a whole-run verdict of the reporter', red: true }));
  assert.equal(red.failed, true);
  assert.match(red.text, /^RED {6}a whole-run verdict of the reporter$/m);
  assert.match(red.text, /^FAIL {2}the commit set on linux/m);
  const failing = shard(1, 1, files);
  failing.events = [{ type: 'test:fail', data: { file: join(ROOT, files[0]!), name: 'test 1: a', nesting: 0, details: { error: { failureType: 'testCodeFailure' } } } }];
  assert.equal((await judgeRun(replay(failing.events), { system: 'linux', started: null, target: 0 })).red, true);
  assert.equal((await judgeShards('linux', plan, [failing], files)).failed, true);
});

test('the merge times a system as its wall time, from the first shard\'s start to the last one\'s end, beside the time summed over the shards', async () => {
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
