import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { failedTests, mergeProblems, type Event, type Shard } from '../harness/merge.ts';
import { LINUX_ONLY, perPushFiles, ROOT, setFiles, groupDirs } from '../harness/sets.ts';
import { balance, planProblems, readPlan, SYSTEMS, type Plan } from '../harness/shards.ts';

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

test('the per-push set of Windows and macOS is the commit set minus LINUX_ONLY, each entry with a reason, and Linux runs it all', () => {
  const all = setFiles('commit', groupDirs('commit', null)!);
  assert.deepEqual(perPushFiles('linux'), all);
  for (const entry of LINUX_ONLY) {
    assert.ok(all.includes(entry.file), entry.file);
    assert.ok(entry.reason.trim().length > 0, entry.file);
  }
  for (const system of ['win32', 'darwin'] as const) assert.deepEqual(perPushFiles(system), all.filter((f) => !LINUX_ONLY.some((e) => e.file === f)));
});

test('balance spreads files by measured time, slowest first, and gives an unmeasured file the median', () => {
  assert.deepEqual(balance(['a', 'b', 'c', 'd'], { a: 90, b: 50, c: 40, d: 10 }, 2), [['a', 'd'], ['b', 'c']]);
  assert.deepEqual(balance(['a', 'b', 'x'], { a: 100, b: 10 }, 2), [['a', 'b'], ['x']]);
});
