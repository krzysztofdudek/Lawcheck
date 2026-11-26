import { test } from 'node:test';
import assert from 'node:assert/strict';
import plainAssert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync as existsSyncOf } from 'node:fs';
import { closeSync, cpSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { outputProblem } from '../harness/invariants.ts';
import { skipReason } from '../harness/skips.ts';
import * as childProcess from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CLI, CouldNotRun, withoutTypeStrippingWarning, expectBroken, fakeWrites, HOOK, LOWER_BUDGET_VARIABLE, PLATFORM_SKIPS, platformSkip, ROOT, startHook, startProgram, startShell, startTool, testFolder, unpackTarball } from '../harness/tool.ts';
import { promiseOf } from '../harness/promises.ts';
import { gitChanges, gitState } from '../harness/state.ts';
import { judgeRun, killsSince, oomKills } from '../harness/reporter.ts';
import { ALONE, runRound } from '../harness/alone.ts';
import { failedTests } from '../harness/merge.ts';
import { count, findTest, readEntries, sabotage } from '../sabotage/run.ts';
import type { Entry, Tools } from '../sabotage/run.ts';
import { GIT_ENV } from '../acceptance/helpers.ts';
import type { Expect, Shell } from '../harness/tool.ts';

const WINDOWS = process.platform === 'win32';
const ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  ...(WINDOWS ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT } : {}),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'T',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 'T',
  GIT_COMMITTER_EMAIL: 't@example.com',
};

async function inTemp(body: (dir: string) => Promise<void>): Promise<void> {
  const folder = testFolder('lawcheck-harness-');
  try {
    await body(folder.dir);
  } finally {
    folder.remove();
  }
}

function fake(dir: string, body: string): string {
  mkdirSync(join(dir, 'fakes'), { recursive: true });
  const path = join(dir, 'fakes', `fake-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(path, ["import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';", "import { spawn, execFileSync } from 'node:child_process';", "import { join } from 'node:path';", body, ''].join('\n'));
  return path;
}

function start(dir: string, body: string, args: string[] = ['check'], expect: Expect = {}, cwd = dir) {
  return startTool(cwd, args, ENV, { ...expect, cli: fake(dir, body) });
}

function tool(dir: string, body: string, args: string[] = ['check'], expect: Expect = {}, cwd = dir) {
  return start(dir, body, args, expect, cwd).ended;
}

function repository(dir: string, name = 'repo'): string {
  const repo = join(dir, name);
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env: ENV, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
  return repo;
}

const printed = (document: object) => `process.stdout.write(JSON.stringify(${JSON.stringify(document)}, null, 2) + '\\n');`;

const PASS_DOC = {
  schema: 'lawcheck-check/0',
  result: 'pass',
  scope: { mode: 'change', base: 'main', files: 0, law_changed: false },
  summary: { errors: 0, warnings: 0, debt: 0, waivers: 0, unresolved: 0 },
  findings: [],
  waivers: [],
  unresolved: [],
  reviews: { missing: 0, calls_made: 0, passes_recorded: 0 },
  next: null,
};

const ERROR_DOC = { schema: 'lawcheck-error/1', errors: [{ code: 'usage', file: null, line: null, message: 'm', why: 'w' }], next: { command: null, text: 't' } };

test('question 95: harness: a run that keeps every invariant passes, and its outputs reach the test', async () => {
  await inTemp(async (dir) => {
    const repo = repository(dir);
    const run = await tool(dir, "process.stdout.write('lawcheck: PASS  nothing changed against main\\n');", ['check'], {}, repo);
    assert.deepEqual([run.code, run.signal, run.stdout, run.stderr], [0, null, 'lawcheck: PASS  nothing changed against main\n', '']);
    const json = await tool(dir, printed(PASS_DOC), ['check', '--json']);
    assert.equal(json.json.result, 'pass');
  });
});

test('harness-1: an exit code outside 0, 1 and 2, or a death by signal, fails the run', async () => {
  await inTemp(async (dir) => {
    const three = await expectBroken('harness-1', () => tool(dir, 'process.exit(3);'));
    assert.match(three.message, /exit code 3/);
    if (platformSkip('a death by a signal nobody sent') !== null) return;
    const killed = await expectBroken('harness-1', () => tool(dir, "process.kill(process.pid, 'SIGKILL');"));
    assert.match(killed.message, /died by SIGKILL/);
  });
});

test('harness-1: a signal the test sends ends the run as docs/codes.md says (stopped, exit 2) and as decision 56 says (a hook, exit 0), and SIGKILL alone may end it by the signal', async () => {
  if (platformSkip('the answer to a caught signal') !== null) return;
  await inTemp(async (dir) => {
    const ready = "process.stdout.write('ready\\n'); setInterval(() => {}, 1000);";
    const answers = "process.on('SIGTERM', () => { process.stdout.write('lawcheck: ERROR  1 error\\n\\nerror[internal]  stopped by SIGTERM\\n\\nnext: run lawcheck check again, and report the error if it stays\\n'); process.exit(2); }); " + ready;
    const caught = start(dir, answers);
    await caught.output(/ready\n/, 'stdout');
    caught.kill('SIGTERM');
    assert.equal((await caught.ended).code, 2);
    const dies = start(dir, ready);
    await dies.output(/ready\n/, 'stdout');
    dies.kill('SIGTERM');
    assert.match((await expectBroken('harness-1', () => dies.ended)).message, /died by SIGTERM/);
    const zero = start(dir, "process.on('SIGINT', () => process.exit(0)); " + ready);
    await zero.output(/ready\n/, 'stdout');
    zero.kill('SIGINT');
    assert.match((await expectBroken('harness-1', () => zero.ended)).message, /exited with 0/);
    const hard = start(dir, ready);
    await hard.output(/ready\n/, 'stdout');
    hard.kill('SIGKILL');
    assert.equal((await hard.ended).signal, 'SIGKILL');
  });
});

const FORBIDDEN: [number, number][] = [
  [0x00, 0x09],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0x200b, 0x200b],
  [0x200e, 0x200f],
  [0x2060, 0x2064],
  [0x206a, 0x206f],
  [0xfeff, 0xfeff],
  [0xfff9, 0xfffb],
  [0xe0001, 0xe0001],
  [0xe0020, 0xe007f],
];
// The joiners U+200C and U+200D are format characters that scripts and emoji sequences need, so they are allowed.
const ALLOWED = [0x0a, 0x20, 0x7e, 0xa0, 0x200c, 0x200d, 0x2027, 0x202f, 0x2065, 0x2070];

test('harness-2: every forbidden code point fails the output, and its allowed neighbours do not', () => {
  const hex = (c: number) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
  for (const [first, last] of FORBIDDEN) {
    for (let c = first; c <= last; c++) assert.match(outputProblem(`lawcheck: PASS\na${String.fromCodePoint(c)}b\n`) ?? '', new RegExp(hex(c).replace('+', '\\+')), hex(c));
  }
  for (const c of ALLOWED) assert.equal(outputProblem(`lawcheck: PASS\na${String.fromCodePoint(c)}b\n`), null, hex(c));
  // The escapes of docs/codes.md: every format character (Unicode category Cf) but the two joiners.
  for (let c = 0; c <= 0xffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const char = String.fromCodePoint(c);
    if (/\p{Cf}/u.test(char) && c !== 0x200c && c !== 0x200d) assert.notEqual(outputProblem(`lawcheck: PASS\na${char}b\n`), null, hex(c));
  }
  for (const forged of ['::error file=a.ts::forged', '::warning::x', '##[error]forged', '##vso[task.complete result=Succeeded]', '  ::error::after spaces', 'a line with ##vso[task.complete] inside']) assert.match(outputProblem(`lawcheck: PASS\n${forged}\n`) ?? '', /CI command/, forged);
  assert.equal(outputProblem('lawcheck: PASS  1 changed file (against main)\n  why:  a reason: with :: inside\n #[x]\n'), null);
});

test('harness-2: the check runs on standard output and on standard error', async () => {
  await inTemp(async (dir) => {
    await expectBroken('harness-2', () => tool(dir, "process.stdout.write('src/a.ts:1  error[x]  a\\r::error::forged\\n'); process.exitCode = 1;"));
    await expectBroken('harness-2', () => tool(dir, "process.stderr.write('\\u000bcleared\\n');", ['check'], { stderr: /cleared/ }));
  });
});

test('harness-3: --json output is exactly one valid document, its counts agree with its lists, and its exit code agrees', async () => {
  await inTemp(async (dir) => {
    const invalid = await expectBroken('harness-3', () => tool(dir, printed({ schema: 'lawcheck-check/0', result: 'pass' }), ['check', '--json']));
    assert.match(invalid.message, /breaks lawcheck-check\/0/);
    const disagrees = await expectBroken('harness-3', () => tool(dir, printed(PASS_DOC) + ' process.exitCode = 1;', ['check', '--json']));
    assert.match(disagrees.message, /exit 1/);
    await expectBroken('harness-3', () => tool(dir, `${printed(PASS_DOC)} ${printed(PASS_DOC)}`, ['check', '--json']));
    await expectBroken('harness-3', () => tool(dir, printed({ result: 'pass', ...PASS_DOC }).replace('"result":"pass",', ''), ['check', '--json']));
    const compact = await expectBroken('harness-3', () => tool(dir, `process.stdout.write(JSON.stringify(${JSON.stringify(PASS_DOC)}) + '\\n');`, ['check', '--json']));
    assert.match(compact.message, /not exactly JSON\.stringify/);
    await expectBroken('harness-3', () => tool(dir, `process.stdout.write('\\n'); ${printed(PASS_DOC)}`, ['check', '--json']));
    await expectBroken('harness-3', () => tool(dir, `${printed(PASS_DOC)} process.stdout.write('\\n');`, ['check', '--json']));
    const counts = await expectBroken('harness-3', () => tool(dir, printed({ ...PASS_DOC, summary: { ...PASS_DOC.summary, debt: 1 } }), ['check', '--json']));
    assert.match(counts.message, /summary\.debt is 1, the lists hold 0/);
    const unknown = await expectBroken('harness-3', () => tool(dir, printed({ schema: 'lawcheck-nothing/9' }), ['check', '--json']));
    assert.match(unknown.message, /no schema file/);
    assert.equal((await tool(dir, printed(ERROR_DOC) + ' process.exitCode = 2;', ['check', '--json'])).code, 2);
  });
});

test('harness-4: anything on standard error fails the run unless the test says what it expects', async () => {
  await inTemp(async (dir) => {
    await expectBroken('harness-4', () => tool(dir, "process.stderr.write('noise\\n');"));
    await expectBroken('harness-4', () => tool(dir, "process.stderr.write('noise\\n');", ['check'], { stderr: 'other\n' }));
    assert.equal((await tool(dir, "process.stderr.write('noise\\n');", ['check'], { stderr: 'noise\n' })).stderr, 'noise\n');
    assert.equal((await tool(dir, "process.stderr.write('lawcheck: 2 reviewer calls to claude-code\\n');", ['check', '--review'])).code, 0);
    await expectBroken('harness-4', () => tool(dir, "process.stderr.write('lawcheck: 2 reviewer calls to claude-code\\n');", ['check']));
  });
});

test('harness-5: the code internal fails the run unless the test names it', async () => {
  await inTemp(async (dir) => {
    const text = "process.stdout.write('lawcheck: ERROR  1 error\\n\\nerror[internal]  boom\\n\\nnext: report it\\n'); process.exitCode = 2;";
    await expectBroken('harness-5', () => tool(dir, text));
    assert.equal((await tool(dir, text, ['check'], { internal: true })).code, 2);
    const json = printed({ ...ERROR_DOC, errors: [{ ...ERROR_DOC.errors[0], code: 'internal' }] }) + ' process.exitCode = 2;';
    await expectBroken('harness-5', () => tool(dir, json, ['check', '--json']));
  });
});

test('harness-6: a run past its budget fails, and a budget names a time of tests/numbers.ts', async () => {
  await inTemp(async (dir) => {
    const slow = await expectBroken('harness-6', () => tool(dir, 'setTimeout(() => {}, 60000);', ['check'], { budget: 'LEFTOVER_GRACE_MS' }));
    assert.match(slow.message, /within its budget of 2000 ms/);
    assert.throws(() => start(dir, 'process.exit(0);', ['check'], { budget: '500' }), /a budget names a time of tests\/numbers\.ts/);
    assert.throws(() => start(dir, 'process.exit(0);', ['check'], { budget: 'CASES_PURE' }), /a budget names a time of tests\/numbers\.ts/);
  });
});

test('harness-6: a process the run leaves alive fails it, however quickly it left', async () => {
  if (platformSkip('a process left alive') !== null) return;
  await inTemp(async (dir) => {
    const setsid = await expectBroken('harness-6', () => tool(dir, "spawn('sleep', ['25'], { detached: true, stdio: 'ignore', cwd: '/' }).unref(); process.exit(0);"));
    assert.match(setsid.message, /alive .* after the run ended: \d+ \(sleep 25\)/);
    const late = await expectBroken('harness-6', () => tool(dir, "const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', detached: true }); c.unref(); setTimeout(() => process.exit(0), 300);"));
    assert.match(late.message, /alive .* after the run ended/);
  });
});

// Made-up test files and a round of the runner over them, as tests/run.ts runs one, with the budget of every test of the round lowered to BUDGET. Each timed test writes a line to its own log every time it runs.
const BUDGET = 1_000;
const OVER = 1_500;

function timed(dir: string, i: number, name: string, slow: 'first' | 'always' | 'never', body: string[] = []): string[] {
  return [
    `test(${JSON.stringify(name)}, () => {`,
    `  const log = join(${JSON.stringify(dir)}, 'runs-${i}.log');`,
    "  appendFileSync(log, 'run\\n');",
    "  const runs = readFileSync(log, 'utf8').split('\\n').filter(Boolean).length;",
    `  if (${slow === 'always' ? 'true' : slow === 'first' ? 'runs === 1' : 'false'}) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${OVER});`,
    ...body.map((line) => `  ${line}`),
    '  assert.ok(runs > 0);',
    '});',
  ];
}

function madeUp(dir: string, name: string, parts: string[][]): string {
  const lines = ["import { after, describe, test } from 'node:test';", "import assert from 'node:assert/strict';", "import { appendFileSync, readFileSync } from 'node:fs';", "import { join } from 'node:path';", ...parts.flat()];
  const file = join(dir, `${name}.test.mjs`);
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

const runsOf = (dir: string, i: number): number => (existsSyncOf(join(dir, `runs-${i}.log`)) ? readFileSync(join(dir, `runs-${i}.log`), 'utf8').split('\n').filter(Boolean).length : 0);

function round(dir: string, files: string[]): { red: boolean; out: string; events: string } {
  const harness = pathToFileURL(join(ROOT, 'tests', 'harness', 'tool.ts')).href;
  const reporter = pathToFileURL(join(ROOT, 'tests', 'harness', 'reporter.ts')).href;
  const recorder = pathToFileURL(join(ROOT, 'tests', 'harness', 'record.ts')).href;
  const env: NodeJS.ProcessEnv = { ...process.env, [LOWER_BUDGET_VARIABLE]: String(BUDGET), LAWCHECK_TIE: '', LAWCHECK_TARGET_MS: '', LAWCHECK_STARTED: '', LAWCHECK_SHUFFLE: '' };
  delete env.NODE_TEST_CONTEXT;
  const events = join(dir, 'events.jsonl');
  rmSync(events, { force: true });
  const shown = join(dir, 'out.txt');
  const base = ['--test', `--import=${harness}`, '--test-timeout=60000'];
  const fd = openSync(shown, 'w');
  let written = '';
  let red: boolean;
  try {
    red = runRound((verdict) => [...base, `--test-reporter=${reporter}?verdict=${encodeURIComponent(verdict)}`, `--test-reporter-destination=stdout`, `--test-reporter=${recorder}`, `--test-reporter-destination=${events}`, ...files], base, env, events, (text) => (written += text), (path) => path, ROOT, fd);
  } finally {
    closeSync(fd);
  }
  return { red, out: readFileSync(shown, 'utf8') + written, events };
}

const recorded = (events: string): { type: string; data: any }[] => readFileSync(events, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

async function* replayed(events: { type: string; data: any }[]) {
  for (const e of events) yield e;
}

// In a whole run the runner sets this variable for every test file, and judgeRun would hold the made-up run to the run-time tie, which no such run can meet.
async function judgedAlone(events: { type: string; data: any }[]) {
  const tie = process.env.LAWCHECK_TIE;
  delete process.env.LAWCHECK_TIE;
  try {
    return await judgeRun(replayed(events), { system: 'linux', started: null, target: 0 });
  } finally {
    if (tie !== undefined) process.env.LAWCHECK_TIE = tie;
  }
}

const LATE_FIRST = 'test 1: past its budget in the run, quick alone';

// A round over a file whose late test would pass alone and whose file fails in another way: red, the late test never runs alone, and the recording is red as a merge reads it. A process killed before its events reached the runner leaves no late mark to name.
async function redForMore(dir: string, files: string[], marked = true): Promise<void> {
  const { red, out, events } = round(dir, files);
  assert.equal(red, true, out);
  assert.equal(runsOf(dir, 0), 1, out);
  if (marked) assert.match(out, /\nnot run alone: the run is red for more than time\nRED      test 1: past its budget in the run, quick alone  .*: \d+ ms in the run, past its budget of 1000 ms; alone: the run is red for more than time, so the test did not run alone\nthe run is red\n$/);
  else assert.doesNotMatch(out, /once more alone, after the run/);
  assert.equal((await judgedAlone(recorded(events))).red, true);
}

test('test 1503: a test that fails only its time budget runs once more alone, and a green second run lists it as slow under load, counts it once and leaves the run green, in the output and in the record', async () => {
  await inTemp(async (dir) => {
    const file = madeUp(dir, 'made-up', [timed(dir, 0, LATE_FIRST, 'first')]);
    const { red, out, events } = round(dir, [file]);
    assert.equal(red, false, out);
    assert.equal(runsOf(dir, 0), 2);
    assert.match(out, /ran 1 test files, 1 tests: 0 passed, 0 failed, 1 past its budget, to run once more alone/);
    assert.match(out, /LATE     test 1  .*made-up\.test\.mjs\ngot      harness-6: the test took \d+ ms, past its budget of 1000 ms \(tests\/numbers\.ts\)\n/);
    assert.match(out, /\nonce more alone, after the run\nslow under load  test 1: past its budget in the run, quick alone  .*made-up\.test\.mjs: \d+ ms in the run, past its budget of 1000 ms; \d+ ms alone, so it counts once, as passed\nthe run is green/);
    assert.doesNotMatch(out, /RED /);
    const all = recorded(events);
    const second = all.filter((e) => e.type === ALONE);
    assert.equal(second.length, 1);
    assert.equal(second[0]!.data.passed, true);
    assert.equal(failedTests(all), 0);
    const merged = await judgedAlone(all);
    assert.equal(merged.red, false, merged.text);
    assert.match(merged.text, /ran 1 test files, 1 tests: 1 passed, 0 failed\n/);
    assert.match(merged.text, /slow under load: past the budget in the run, green once more alone\nslow under load  test 1: /);
    const unsettled = await judgedAlone(all.filter((e) => e.type !== ALONE));
    assert.equal(unsettled.red, true);
    assert.match(unsettled.text, /ran 1 test files, 1 tests: 0 passed, 1 failed\n/);
    assert.match(unsettled.text, /RED      test 1 .*\n(.*\n)*got      harness-6: the test took \d+ ms, past its budget of 1000 ms \(tests\/numbers\.ts\)\nalone    no second run alone is recorded/);
  });
});

test('test 1504: a test red on an assertion is never run again, even past its budget, and a time-only red whose second run alone is red keeps the run red', async () => {
  await inTemp(async (dir) => {
    const slow = round(dir, [madeUp(dir, 'slow', [timed(dir, 2, 'test 2: past its budget in the run and alone', 'always')])]);
    assert.equal(slow.red, true, slow.out);
    assert.equal(runsOf(dir, 2), 2);
    assert.match(slow.out, /LATE     test 2  /);
    assert.match(slow.out, /\nRED      test 2: past its budget in the run and alone  .*: \d+ ms in the run, past its budget of 1000 ms; alone: harness-6: the test took \d+ ms, past its budget of 1000 ms/);
    assert.match(slow.out, /the run is red\n$/);
    const all = recorded(slow.events);
    assert.deepEqual(all.filter((e) => e.type === ALONE).map((e) => [e.data.name, e.data.passed]), [['test 2: past its budget in the run and alone', false]]);
    const merged = await judgedAlone(all);
    assert.equal(merged.red, true);
    assert.match(merged.text, /RED      test 2 .*\n(.*\n)*alone    harness-6: the test took/);
    const asserted = round(dir, [madeUp(dir, 'asserted', [timed(dir, 3, 'test 3: red on an assertion and past its budget', 'always', ['assert.equal(runs, 0);'])])]);
    assert.equal(asserted.red, true, asserted.out);
    assert.equal(runsOf(dir, 3), 1);
    assert.match(asserted.out, /RED      test 3  .*asserted\.test\.mjs\n(.*\n)*got      Expected values to be strictly equal/);
    assert.doesNotMatch(asserted.out, /LATE |once more alone|not run alone/);
    assert.equal((await judgedAlone(recorded(asserted.events))).red, true);
  });
});

test('test 1505: a late test does not run alone, and the run stays red, when a test of its file throws or rejects after it ended', async () => {
  await inTemp(async (dir) => {
    await redForMore(dir, [madeUp(dir, 'thrown', [timed(dir, 0, LATE_FIRST, 'first'), timed(dir, 4, 'test 4: throws after it ended', 'never', ["setTimeout(() => { throw new Error('thrown after the test ended'); }, 20);"])])]);
    rmSync(join(dir, 'runs-0.log'));
    await redForMore(dir, [madeUp(dir, 'rejected', [timed(dir, 0, LATE_FIRST, 'first'), timed(dir, 5, 'test 5: rejects after it ended', 'never', ["setTimeout(() => { Promise.reject(new Error('rejected after the test ended')); }, 20);"])])]);
  });
});

test('test 1506: a late test does not run alone, and the run stays red, when a test of its file sets the exit code of its process', async () => {
  await inTemp(async (dir) => {
    await redForMore(dir, [madeUp(dir, 'exit-code', [timed(dir, 0, LATE_FIRST, 'first'), timed(dir, 6, 'test 6: sets the exit code', 'never', ['process.exitCode = 1;'])])]);
  });
});

test('test 1507: a late test does not run alone, and the run stays red, when the process of its file is killed after its tests', async () => {
  await inTemp(async (dir) => {
    await redForMore(dir, [madeUp(dir, 'killed', [timed(dir, 0, LATE_FIRST, 'first'), ["after(() => { process.on('exit', () => process.kill(process.pid, 'SIGKILL')); });"]])]);
  });
});

test('test 1508: a late test does not run alone, and the run stays red, when a test inside a describe of another file is red', async () => {
  await inTemp(async (dir) => {
    const inside = madeUp(dir, 'inside', [["describe('test 8: a describe', () => {", ...timed(dir, 8, 'test 8: red inside it', 'never', ['assert.equal(runs, 0);']).map((line) => `  ${line}`), '});']]);
    await redForMore(dir, [madeUp(dir, 'late', [timed(dir, 0, LATE_FIRST, 'first')]), inside]);
  });
});

test('harness-7: a change of git state fails the run, except the files its command writes by contract', async () => {
  await inTemp(async (dir) => {
    const repo = repository(dir);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env: ENV, stdio: 'ignore' });
    assert.match((await expectBroken('harness-7', () => tool(dir, "writeFileSync('a.txt', 'b\\n');", ['check'], {}, repo))).message, /changed a\.txt/);
    git('checkout', '-q', '--', 'a.txt');
    await expectBroken('harness-7', () => tool(dir, "writeFileSync('new.txt', 'n\\n');", ['check'], {}, repo));
    git('clean', '-fdxq');
    assert.match((await expectBroken('harness-7', () => tool(dir, "execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'x']);", ['check'], {}, repo))).message, /\.git\/refs\/heads\/main/);
    git('reset', '-q', '--hard', 'HEAD~1');
    assert.match((await expectBroken('harness-7', () => tool(dir, "execFileSync('git', ['branch', 'other']);", ['check'], {}, repo))).message, /\.git\/refs\/heads\/other/);
    git('branch', '-D', 'other');
    assert.match((await expectBroken('harness-7', () => tool(dir, "writeFileSync('b.txt', 'b\\n'); execFileSync('git', ['add', 'b.txt']);", ['check'], { writes: ['b.txt'] }, repo))).message, /\.git\/index/);
    git('rm', '-q', '--cached', 'b.txt');
    git('clean', '-fdxq');
    assert.match((await expectBroken('harness-7', () => tool(dir, "writeFileSync('.git/hooks/pre-commit', 'exit 0\\n');", ['check'], {}, repo))).message, /\.git\/hooks/);
    git('clean', '-fdxq');
    execFileSync(process.execPath, ['-e', "require('fs').rmSync('.git/hooks/pre-commit')"], { cwd: repo });
    assert.match((await expectBroken('harness-7', () => tool(dir, "appendFileSync('.git/info/exclude', 'x\\n');", ['check'], {}, repo))).message, /\.git\/info\/exclude/);
    const init = "mkdirSync('.lawcheck'); writeFileSync('.lawcheck/law.yaml', 'lawcheck: 0.1.0\\n'); writeFileSync('.lawcheck/.gitignore', '.local/\\n');";
    assert.equal((await tool(dir, init, ['init'], {}, repo)).code, 0);
    await expectBroken('harness-7', () => tool(dir, "mkdirSync('x/.lawcheck', { recursive: true }); writeFileSync('x/.lawcheck/law.yaml', 'lawcheck: 0.1.0\\n');", ['init'], {}, repo));
    git('clean', '-fdq', 'x');
    await expectBroken('harness-7', () => tool(dir, "writeFileSync('.lawcheck/verdicts', 'x\\n');", ['check'], {}, repo));
    const review = "mkdirSync('.lawcheck/.local/failures', { recursive: true }); writeFileSync('.lawcheck/verdicts', 'y\\n'); writeFileSync('.lawcheck/.local/.gitignore', '*\\n'); writeFileSync('.lawcheck/.local/failures/028d0c1eb1d0c7e8d19fe76964e47afd.json', '{}');";
    assert.equal((await tool(dir, review, ['check', '--review'], {}, repo)).code, 0);
    await expectBroken('harness-7', () => tool(dir, "writeFileSync('.lawcheck/.local/other.txt', 'x');", ['check', '--review'], {}, repo));
    assert.equal((await tool(dir, "writeFileSync('c.txt', 'c\\n');", ['check'], { writes: ['c.txt'] }, repo)).code, 0);
  });
});

test('harness-8: a run may change nothing outside its repository: not its temporary directory, its home or the test folder', async () => {
  await inTemp(async (dir) => {
    const repo = repository(dir);
    assert.match((await expectBroken('harness-8', () => tool(dir, "writeFileSync(join(process.env.TMPDIR, 'lawcheck-left'), 'x');"))).message, /left lawcheck-left/);
    assert.match((await expectBroken('harness-8', () => tool(dir, "mkdirSync(join(process.env.HOME, '.config'), { recursive: true }); writeFileSync(join(process.env.HOME, '.config', 'x'), 'x');"))).message, /\.config\/x in its home folder/);
    assert.match((await expectBroken('harness-8', () => tool(dir, "writeFileSync('../beside.txt', 'x');", ['check'], {}, repo))).message, /beside\.txt/);
    fakeWrites(dir, ['record.json']);
    assert.equal((await tool(dir, "writeFileSync('../record.json', 'x');", ['check'], {}, repo)).code, 0);
  });
});

test('harness-8: a file written beside a repository that lies below the test folder is outside the repository, and a changed mode alone is a change', async () => {
  await inTemp(async (dir) => {
    mkdirSync(join(dir, 'a'));
    const repo = repository(join(dir, 'a'));
    assert.match((await expectBroken('harness-8', () => tool(dir, "writeFileSync('../other.txt', 'x');", ['check'], {}, repo))).message, /a\/other\.txt/);
    rmSync(join(dir, 'a', 'other.txt'));
    const kept = join(dir, 'mode.txt');
    writeFileSync(kept, 'x\n');
    process.getBuiltinModule('node:fs').chmodSync(kept, 0o644);
    assert.match((await expectBroken('harness-8', () => tool(dir, "process.getBuiltinModule('node:fs').chmodSync('../../mode.txt', 0o444);", ['check'], {}, repo))).message, /mode\.txt/);
  });
});

async function* stream(...list: { type: string; data: object }[]): AsyncGenerator<{ type: string; data: object }> {
  for (const event of list) yield event;
}

const failedFile = (error: object) => stream({ type: 'test:fail', data: { name: 'test 5: a test', file: join(ROOT, 'tests', 'unit', 'x.test.ts'), nesting: 0, details: { duration_ms: 1, error } } });
const ended = { code: 'ERR_TEST_FAILURE', message: 'test failed' };

test('test 1004: the reporter says how the process of a test file ended, and counts the processes the kernel killed for lack of memory only after a SIGKILL', async (t) => {
  const tie = process.env.LAWCHECK_TIE;
  delete process.env.LAWCHECK_TIE;
  t.after(() => {
    if (tie !== undefined) process.env.LAWCHECK_TIE = tie;
  });
  const got = async (error: object, kills: number | null): Promise<string> => {
    const text = (await judgeRun(failedFile(error), { system: 'linux', started: null, target: 0, oomKills: () => kills })).text;
    return /^got {6}(.*)$/m.exec(text)![1]!;
  };
  const killed = { ...ended, signal: 'SIGKILL' };
  assert.equal(await got(killed, 2), 'test failed: SIGKILL ended the process of the test file, and memory.events of this cgroup counts 2 processes the kernel killed for lack of memory');
  assert.equal(await got(killed, 1), 'test failed: SIGKILL ended the process of the test file, and memory.events of this cgroup counts 1 process the kernel killed for lack of memory');
  assert.equal(await got(killed, 0), 'test failed: SIGKILL ended the process of the test file');
  assert.equal(await got(killed, null), 'test failed: SIGKILL ended the process of the test file');
  assert.equal(await got({ ...ended, signal: 'SIGTERM' }, 2), 'test failed: SIGTERM ended the process of the test file');
  assert.equal(await got({ ...ended, failureType: 'testCodeFailure', exitCode: 3 }, 2), 'test failed: the process of the test file exited with 3');
  assert.equal(await got({ ...ended, failureType: 'testCodeFailure', exitCode: 0 }, 2), 'test failed');
  assert.equal(await got({ code: 'ERR_ASSERTION', message: 'a is not b', signal: 'SIGKILL' }, 2), 'a is not b');
  let read = 0;
  const passing = stream({ type: 'test:pass', data: { name: 'test 5: a test', file: join(ROOT, 'tests', 'unit', 'x.test.ts'), nesting: 0, details: { duration_ms: 1 } } });
  assert.equal((await judgeRun(passing, { system: 'linux', started: null, target: 0, oomKills: () => ++read })).red, false);
  assert.equal(read, 0);
});

test('test 1004: the count of killed processes is read from memory.events of the cgroup the process names, and a run reports only the kills since it started', async () => {
  await inTemp(async (dir) => {
    const proc = join(dir, 'cgroup');
    mkdirSync(join(dir, 'sys', 'job'), { recursive: true });
    const events = join(dir, 'sys', 'job', 'memory.events');
    writeFileSync(proc, '0::/job\n');
    writeFileSync(events, 'low 0\nhigh 0\nmax 4\noom 3\noom_kill 3\n');
    assert.equal(oomKills(proc, join(dir, 'sys')), 3);
    writeFileSync(events, 'low 0\nmax 4\n');
    assert.equal(oomKills(proc, join(dir, 'sys')), null);
    writeFileSync(proc, '12:memory:/job\n');
    assert.equal(oomKills(proc, join(dir, 'sys')), null);
    assert.equal(oomKills(join(dir, 'missing'), join(dir, 'sys')), null);
  });
  const totals = [5, 8];
  const since = killsSince(() => totals.shift() ?? null);
  assert.equal(since(), 3);
  assert.equal(killsSince(() => null)(), null);
  const later = [4, null];
  assert.equal(killsSince(() => (later.length > 0 ? later.shift()! : null))(), null);
  const reset = [9, 2];
  assert.equal(killsSince(() => reset.shift() ?? null)(), 0);
});

test('question 95: harness: two runs at once in one repository are checked together when the last ends', async () => {
  await inTemp(async (dir) => {
    const repo = repository(dir);
    const quiet = fake(dir, "setTimeout(() => process.stdout.write('lawcheck: PASS\\n'), 200);");
    const writes = fake(dir, "writeFileSync('w.txt', 'w');");
    const waits = fake(dir, 'setTimeout(() => {}, 500);');
    const at = (cli: string) => startTool(repo, ['check'], ENV, { cli }).ended;
    const both = await Promise.all([at(quiet), at(quiet)]);
    assert.deepEqual(both.map((run) => run.code), [0, 0]);
    const one = at(writes);
    const other = at(waits);
    assert.equal((await one).code, 0);
    assert.match((await expectBroken('harness-7', () => other)).message, /w\.txt/);
  });
});

test('question 95: harness: the packed tarball starts as the package bin, and nothing else starts Lawcheck as a program', async () => {
  await inTemp(async (dir) => {
    const cli = unpackTarball(dir);
    const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
    assert.equal((await startTool(dir, ['--version'], ENV, { cli }).ended).stdout, `${version}\n`);
    assert.throws(() => startProgram(CLI, [], dir, ENV), /is Lawcheck itself/);
    assert.throws(() => startProgram(HOOK, ['stop'], dir, ENV), /is Lawcheck itself/);
    assert.throws(() => startProgram(cli, [], dir, ENV), /is Lawcheck itself/);
  });
});

test('question 95: harness: a missing build is "could not run", never a pass', async () => {
  await inTemp(async (dir) => {
    assert.throws(() => startTool(dir, ['check'], ENV, { cli: join(dir, 'missing.js') }), CouldNotRun);
  });
});

function nodeTest(dir: string, name: string, body: string): { code: number | null; out: string } {
  const file = join(dir, 'scratch.test.ts');
  const harness = pathToFileURL(join(ROOT, 'tests', 'harness', 'tool.ts')).href;
  writeFileSync(file, [`import { test } from 'node:test';`, `import assert from 'node:assert/strict';`, `import { startTool } from ${JSON.stringify(harness)};`, `test(${JSON.stringify(name)}, async () => {`, body, '});', ''].join('\n'));
  const reporter = pathToFileURL(join(ROOT, 'tests', 'harness', 'reporter.ts')).href;
  const env: NodeJS.ProcessEnv = { ...process.env, LAWCHECK_STARTED: '', LAWCHECK_TIE: '' };
  // node:test marks its own child processes with NODE_TEST_CONTEXT, and a test file run under that mark does not run tests of its own.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, '--test-reporter-destination=stdout', file], { cwd: dir, env, encoding: 'utf8' });
  return { code: result.status, out: result.stdout + withoutTypeStrippingWarning(result.stderr) };
}

test('R-90: harness-count, an assertion the harness counts keeps its meaning: match passes on a match and fails on none, through node:assert and node:assert/strict', () => {
  const text = ['a', 'b', 'c'].join('');
  for (const match of [assert.match, plainAssert.match, plainAssert.strict.match]) {
    match(text, /b/);
    assert.throws(() => match(text, /z/), /did not match/);
  }
  assert.doesNotMatch(text, /z/);
  assert.throws(() => assert.doesNotMatch(text, /b/), /expected to not match/);
});

test('harness-count: a test that starts the tool and reads none of its outputs fails', async () => {
  await inTemp(async (dir) => {
    writeFileSync(join(dir, 'quiet.mjs'), '');
    const env = JSON.stringify(ENV);
    const own = `(await import(${JSON.stringify(pathToFileURL(join(ROOT, 'tests', 'harness', 'tool.ts')).href)})).testFolder('nested-', ${JSON.stringify(dir)}).dir`;
    const silent = nodeTest(dir, 'test 1: a test that compares nothing', `await startTool(${own}, ['check'], ${env}, { cli: ${JSON.stringify(join(dir, 'quiet.mjs'))} }).ended;`);
    assert.equal(silent.code, 1, silent.out);
    assert.match(silent.out, /harness-count: the test started the tool 1 times and read none of its outputs/);
    const compared = nodeTest(dir, 'test 1: a test that compares', `assert.equal((await startTool(${own}, ['check'], ${env}, { cli: ${JSON.stringify(join(dir, 'quiet.mjs'))} }).ended).code, 0);`);
    assert.equal(compared.code, 0, compared.out);
  });
});

test('question 95: the reporter: one block per red test, last, with its promise, what was got and the rerun command', async () => {
  await inTemp(async (dir) => {
    const red = nodeTest(dir, 'test 3: the failing run', "assert.equal('lawcheck: PASS', 'lawcheck: FAIL', 'the first line');");
    assert.equal(red.code, 1);
    const lines = red.out.trimEnd().split('\n');
    const at = lines.findIndex((line) => line.startsWith('RED '));
    assert.ok(at > 0, red.out);
    assert.match(lines[0]!, /^ran 1 test files, 1 tests: 0 passed, 1 failed$/);
    assert.match(lines[at]!, /^RED {6}test 3  \S*scratch\.test\.ts$/);
    assert.equal(lines[at + 1], 'promise  test 3: what this test expects');
    assert.match(lines[at + 2]!, /^got      the first line$/);
    assert.ok(lines.includes("rerun    npm run t -- 'test 3'"), red.out);
    assert.equal(lines[lines.length - 1], 'if the promise changed, the change says so in tests/weakenings.md, and the suite guard checks the row (tests/README.md)');
    const green = nodeTest(dir, 'test 3: the failing run', 'assert.equal(1, 1);');
    assert.equal(green.code, 0);
    assert.ok(!green.out.includes('RED'), green.out);
    const missing = nodeTest(dir, 'test 3: the failing run', `throw new (await import(${JSON.stringify(pathToFileURL(join(ROOT, 'tests', 'harness', 'tool.ts')).href)})).CouldNotRun('docker is not on the PATH');`);
    assert.equal(missing.code, 1);
    assert.match(missing.out, /\ncould not run  docker is not on the PATH\n/);
  });
});

test('question 95: a skip comes only from PLATFORM_SKIPS, keyed by file and whole test name, with a platform and a reason', () => {
  assert.throws(() => skipReason('tests/unit/a.test.ts', 'test 1: a test', 'a part no entry names'), /without an entry in PLATFORM_SKIPS/);
  for (const entry of PLATFORM_SKIPS) {
    assert.ok(['win32', 'darwin', 'linux', 'root'].includes(entry.platform), JSON.stringify(entry));
    assert.ok(entry.reason.length > 0 && entry.part.length > 0 && entry.file.length > 0 && entry.test.length > 0, JSON.stringify(entry));
  }
  const listed = PLATFORM_SKIPS.find((entry) => entry.platform === 'win32' && entry.file !== 'tests/harness')!;
  assert.equal(skipReason(listed.file, listed.test, listed.part), WINDOWS ? listed.reason : null);
  assert.throws(() => skipReason(listed.file, `${listed.test.split(':')[0]}: another test of the same id`, listed.part), /without an entry/);
});


test('harness-1: a hook the test stops exits 0 and prints nothing, as question 56 says', async () => {
  if (platformSkip('the answer of a stopped hook') !== null) return;
  await inTemp(async (dir) => {
    const ready = "process.stdout.write(''); process.stderr.write(''); setInterval(() => {}, 1000); writeFileSync(join(process.env.CLAUDE_PLUGIN_DATA, 'ready'), '');";
    const env = { ...ENV, CLAUDE_PLUGIN_DATA: join(dir, 'data') };
    mkdirSync(join(dir, 'data'));
    fakeWrites(dir, ['data/']);
    const stopHook = async (body: string) => {
      const running = startHook('edit', JSON.stringify({ cwd: dir }), env, { hook: fake(dir, body) });
      await (await import('../harness/tool.ts')).waitUntil(() => existsSyncOf(join(dir, 'data', 'ready')), 'FAKE_STARTED_MS');
      rmSync(join(dir, 'data', 'ready'));
      running.kill('SIGTERM');
      return running.ended;
    };
    assert.equal((await stopHook("process.on('SIGTERM', () => process.exit(0)); " + ready)).code, 0);
    const prints = await expectBroken('harness-1', () => stopHook("process.on('SIGTERM', () => { process.stdout.write('{}'); process.exit(0); }); " + ready));
    assert.match(prints.message, /decision 56/);
    const fails = await expectBroken('harness-1', () => stopHook("process.on('SIGTERM', () => process.exit(1)); " + ready));
    assert.match(fails.message, /decision 56/);
  });
});

test('question 95: harness: a start of Lawcheck that does not come from the harness fails the test, through every function of child_process and however it is spelt', async () => {
  await inTemp(async (dir) => {
    const cp = childProcess as unknown as Record<string, (...args: unknown[]) => unknown>;
    const calls: [string, unknown[]][] = [
      ['spawn', [process.execPath, [CLI, '--version']]],
      ['spawnSync', [process.execPath, [CLI.split('\\').join('/'), 'check']]],
      ['execFile', [process.execPath, [join(dir, 'copy', 'dist', 'cli.js')]]],
      ['execFileSync', [process.execPath, [HOOK, 'stop']]],
      ['exec', [`node ${join('dist', 'cli.js')} check`]],
      ['execSync', [`"${process.execPath}" "${CLI}" check`]],
      ['fork', [CLI, ['check']]],
      ['spawnSync', ['lawcheck', ['check']]],
      ['execFileSync', [join(dir, 'bin', 'lawcheck.cmd'), ['check']]],
    ];
    for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork']) assert.ok(calls.some(([called]) => called === name), name);
    for (const [name, args] of calls) assert.throws(() => cp[name]!(...args), /a test started Lawcheck by hand/, `${name} ${JSON.stringify(args)}`);
    const run = childProcess.spawnSync;
    assert.equal(run(process.execPath, ['-e', 'process.exit(0)']).status, 0);
  });
});

test('question 95: harness: a start of Lawcheck through a shell line that does not come from the harness fails the test', () => {
  const cp = childProcess as unknown as Record<string, (...args: unknown[]) => unknown>;
  const calls: [string, unknown[]][] = [
    ['spawnSync', ['sh', ['-c', 'lawcheck --version']]],
    ['execFileSync', ['/bin/bash', ['-c', 'cd repo && lawcheck check --base main']]],
    ['spawn', ['powershell.exe', ['-NoProfile', '-Command', '& lawcheck check']]],
    ['spawnSync', ['C:\\Windows\\System32\\cmd.exe', ['/d', '/c', 'lawcheck.cmd check']]],
    ['execSync', ['PATH=bin:$PATH lawcheck check']],
    ['execSync', ['node ./node_modules/.bin/lawcheck check']],
    ['spawnSync', ['npx', ['--no-install', 'lawcheck', 'check'], { shell: true }]],
    ['execFileSync', ['sh', ['-c', 'node dist/cli.js check']]],
  ];
  for (const [name, args] of calls) assert.throws(() => cp[name]!(...args), /a test started Lawcheck by hand/, `${name} ${JSON.stringify(args)}`);
  for (const [name, args] of [
    ['spawnSync', ['sh', ['-c', 'echo lawcheck-test-1 lawchecks']]],
    ['spawnSync', ['git', ['-c', 'x.y=lawcheck check', '--version']]],
  ] as [string, unknown[]][]) assert.doesNotThrow(() => cp[name]!(...args), `${name} ${JSON.stringify(args)}`);
});

test('question 95: harness: a start through a shell checks its run as every start of the tool is checked', async () => {
  await inTemp(async (dir) => {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const shim = (body: string) => {
      const script = fake(dir, body);
      writeFileSync(join(bin, 'lawcheck'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
      writeFileSync(join(bin, 'lawcheck.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
    };
    const shell: Shell = WINDOWS ? 'cmd' : 'sh';
    const env = { PATH: `${bin}${WINDOWS ? ';' : ':'}${ENV.PATH}` };
    shim("process.stdout.write('lawcheck: PASS  1 named file\\n');");
    const run = await startShell(shell, 'lawcheck check ./a.txt', dir, ENV, { env }).ended;
    assert.equal(run.stdout, 'lawcheck: PASS  1 named file\n');
    assert.equal(run.code, 0);
    shim("process.stdout.write('lawcheck: PASS\\x1b[2K\\n');");
    const forged = await expectBroken('harness-2', () => startShell(shell, 'lawcheck check', dir, ENV, { env }).ended);
    assert.match(forged.message, /U\+001B/);
    shim("process.stderr.write('noise\\n');");
    await expectBroken('harness-4', () => startShell(shell, 'lawcheck check', dir, ENV, { env }).ended);
    shim("process.exit(3);");
    await expectBroken('harness-1', () => startShell(shell, 'lawcheck check', dir, ENV, { env }).ended);
    assert.throws(() => startShell(shell, 'echo lawcheck', dir, ENV, { env }), /a shell line starts lawcheck by its name/);
  });
});

test('harness-2: output that is not valid UTF-8 fails the run', async () => {
  await inTemp(async (dir) => {
    const lone = await expectBroken('harness-2', () => tool(dir, "process.stdout.write(Buffer.from([0x61, 0x9b, 0x0a]));"));
    assert.match(lone.message, /standard output is not valid UTF-8/);
    await expectBroken('harness-2', () => tool(dir, "process.stderr.write(Buffer.from([0xc3]));", ['check'], { stderr: /./ }));
    assert.equal((await tool(dir, "process.stdout.write(Buffer.from('żółw\\n'));")).stdout, 'żółw\n');
  });
});

test('harness-8: the test folder is checked whole: a file named like a run folder, and a run in a folder that is no test folder', async () => {
  await inTemp(async (dir) => {
    assert.match((await expectBroken('harness-8', () => tool(dir, "writeFileSync('.run-evil', 'x');"))).message, /\.run-evil/);
    assert.throws(() => start(dir, 'process.exit(0);', ['check'], {}, tmpdir()), /no folder of this test/);
  });
});

test('harness-7: an empty folder in the repository and every file of .git but its objects, logs and index count', async () => {
  await inTemp(async (dir) => {
    const repo = repository(dir);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env: ENV, stdio: 'ignore' });
    assert.match((await expectBroken('harness-7', () => tool(dir, "mkdirSync('empty');", ['check'], {}, repo))).message, /changed empty\//);
    execFileSync(process.execPath, ['-e', "require('fs').rmdirSync('empty')"], { cwd: repo });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, env: ENV, encoding: 'utf8' }).trim();
    for (const file of ['shallow', 'info/attributes', 'description', 'ORIG_HEAD', 'config.worktree', 'FETCH_HEAD']) {
      const broken = await expectBroken('harness-7', () => tool(dir, `mkdirSync('.git/info', { recursive: true }); writeFileSync('.git/${file}', '${head}\\n');`, ['check'], {}, repo));
      assert.ok(broken.message.includes(`.git/${file}`), broken.message);
      execFileSync(process.execPath, ['-e', `require('fs').rmSync('.git/${file}', { force: true })`], { cwd: repo });
    }
    assert.equal((await tool(dir, "writeFileSync('.git/objects/stray', 'x');", ['check'], {}, repo)).code, 0);
    assert.match((await expectBroken('harness-7', () => tool(dir, "writeFileSync('.git/HEAD', 'nonsense\\n');", ['check'], {}, repo))).message, /\.git\/HEAD/);
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    git('status');
  });
});

test('harness-7: a commit a test makes through GIT_ENV starts no automatic maintenance of git, so no repack in the background changes .git while the next run is compared', async () => {
  await inTemp(async (dir) => {
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const plant = (...args: string[]) => execFileSync('git', ['-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...args], { cwd: repo, env: GIT_ENV, stdio: 'ignore' });
    plant('init', '-q', '-b', 'main');
    for (const name of ['a', 'b', 'c']) {
      writeFileSync(join(repo, `${name}.txt`), `${name}\n`);
      plant('add', '-A');
      plant('commit', '-q', '-m', name);
      plant('repack', '-q');
    }
    const trace = join(dir, 'trace.json');
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'd'], { cwd: repo, env: { ...GIT_ENV, GIT_TRACE2_EVENT: trace }, stdio: 'ignore' });
    const before = gitState(repo);
    const started = readFileSync(trace, 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as { event: string; argv?: string[] });
    const upkeep = started.filter((e) => e.event === 'child_start' && (e.argv ?? []).some((word) => word === 'maintenance' || word === 'gc'));
    assert.deepEqual(upkeep.map((e) => e.argv!.join(' ')), []);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    assert.deepEqual(gitChanges(before, gitState(repo)).parts, []);
  });
});

test('question 95: harness-N, each harness invariant has its promise text for the reporter', () => {
  for (const id of ['harness-1', 'harness-2', 'harness-3', 'harness-4', 'harness-5', 'harness-6', 'harness-7', 'harness-8', 'harness-count']) {
    const promised = promiseOf(id);
    assert.ok(promised !== null && promised.text.length > 20, id);
  }
});

test('question 95: harness: the type stripping warning of Node 24.0 is taken out of the output of the suite\'s own programs, and nothing else', () => {
  const warning = '(node:42) ExperimentalWarning: Type Stripping is an experimental feature and might change at any time\n(Use `node --trace-warnings ...` to show where the warning was created)\n';
  assert.equal(withoutTypeStrippingWarning(`${warning}agent-trial: claude is not on the PATH\n`), 'agent-trial: claude is not on the PATH\n');
  const other = '(node:42) ExperimentalWarning: The Fetch API is an experimental feature\n(Use `node --trace-warnings ...` to show where the warning was created)\n';
  assert.equal(withoutTypeStrippingWarning(other), other);
  assert.equal(withoutTypeStrippingWarning('a\n'), 'a\n');
});

test('question 95: tests/run.ts --skip <id> leaves the tests of that id out of the run and runs the rest', () => {
  const env: NodeJS.ProcessEnv = { ...process.env, LAWCHECK_RECORD: '' };
  // Under node --test this process carries NODE_TEST_CONTEXT, which makes a nested node --test report to its parent instead of printing.
  delete env.NODE_TEST_CONTEXT;
  const ran = (...extra: string[]) => spawnSync(process.execPath, [join(ROOT, 'tests', 'run.ts'), 'commit', 'tests/contract/numbers.test.ts', ...extra], { cwd: ROOT, encoding: 'utf8', env });
  const all = ran();
  assert.equal(all.status, 0, all.stdout + all.stderr);
  const total = /ran 1 test files, (\d+) tests: \1 passed, 0 failed/.exec(all.stdout);
  assert.ok(total !== null, all.stdout);
  const skipped = ran('--skip', 'R-73');
  assert.equal(skipped.status, 0, skipped.stdout + skipped.stderr);
  const left = Number(total![1]) - 1;
  assert.match(skipped.stdout, new RegExp(`ran 1 test files, ${left} tests: ${left} passed, 0 failed`));
  const refused = ran('--skip', 'nothing');
  assert.equal(refused.status, 2, refused.stdout + refused.stderr);
  assert.match(refused.stderr + refused.stdout, /--skip takes a test id/);
});

const LIST = join(ROOT, 'tests', 'sabotage', 'list.json');
const ENTRY = { id: 'one', promise: 'test 1', file: 'src/a.ts', find: 'v = 1', replace: 'v = 2', killedBy: 'test 7: a' };

test('test 1003: tests/sabotage/list.json reads as entries with every field, each finds its text once in its file and names a test that exists', () => {
  const entries = readEntries(readFileSync(LIST, 'utf8'));
  assert.ok(entries.length > 0);
  const problems: string[] = [];
  for (const entry of entries) {
    const text = readFileSync(join(ROOT, entry.file), 'utf8');
    if (count(text, entry.find) !== 1) problems.push(`${entry.id}: its find text occurs ${count(text, entry.find)} times in ${entry.file}, not once`);
    if (findTest(ROOT, entry.killedBy) === null) problems.push(`${entry.id}: no test is named '${entry.killedBy}'`);
  }
  assert.deepEqual(problems, []);
});

test('test 1003: the list is refused when it is no array, holds an empty field, uses an id twice or replaces a text with itself', () => {
  const refused = (value: unknown, message: RegExp) => assert.throws(() => readEntries(JSON.stringify(value)), message);
  refused({}, /not a JSON array/);
  refused([{ ...ENTRY, replace: '' }], /entry 1 has no replace/);
  refused([{ ...ENTRY, find: undefined }], /entry 1 has no find/);
  refused([ENTRY, { ...ENTRY, replace: 'v = 3' }], /used twice/);
  refused([{ ...ENTRY, replace: 'v = 1' }], /replaces its text with itself/);
  assert.equal(readEntries(JSON.stringify([ENTRY])).length, 1);
});

test('test 1003: after a break is undone the sabotage run builds the unbroken code again before it runs the baseline of the next entry', async () => {
  await inTemp(async (dir) => {
    const root = join(dir, 'repo');
    mkdirSync(join(root, 'src'), { recursive: true });
    mkdirSync(join(root, 'tests'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export const v = 1;\n');
    writeFileSync(join(root, 'tests', 'a.test.ts'), "import { test } from 'node:test';\ntest('test 7: a', () => {});\ntest('test 8: b', () => {});\n");
    let built = '';
    const builds: string[] = [];
    const tools: Tools = {
      copyWorkingTree: (from, to) => cpSync(from, to, { recursive: true }),
      linkShared: () => undefined,
      build: (at) => {
        built = readFileSync(join(at, 'src', 'a.ts'), 'utf8');
        builds.push(built.trim());
        return { ok: true, output: '' };
      },
      runTests: () => {
        const state = built === 'export const v = 1;\n' ? 'ok' : 'not ok';
        return { tap: `${state} 1 - test 7: a\n${state} 2 - test 8: b\n`, status: 0 };
      },
    };
    const entries: Entry[] = [ENTRY, { ...ENTRY, id: 'two', replace: 'v = 3', killedBy: 'test 8: b' }];
    const outcomes = sabotage(root, entries, () => undefined, tools);
    assert.deepEqual(outcomes.map((o) => `${o.entry.id} ${o.result}`), ['one killed', 'two killed']);
    assert.deepEqual(builds, ['export const v = 1;', 'export const v = 2;', 'export const v = 1;', 'export const v = 3;']);
  });
});
