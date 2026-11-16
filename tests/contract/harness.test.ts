import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync as existsSyncOf } from 'node:fs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { outputProblem } from '../harness/invariants.ts';
import { skipReason } from '../harness/skips.ts';
import * as childProcess from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CLI, CouldNotRun, withoutTypeStrippingWarning, expectBroken, fakeWrites, HOOK, PLATFORM_SKIPS, platformSkip, ROOT, startHook, startProgram, startShell, startTool, testFolder, unpackTarball } from '../harness/tool.ts';
import { promiseOf } from '../harness/promises.ts';
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

test('harness-1: a signal the test sends ends the run as the spec says, and SIGKILL alone may end it by the signal', async () => {
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
  // spec/check-slice.md, section 6: every format character (Unicode category Cf) but the two joiners.
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
    assert.match(lines[at + 1]!, /^promise  spec\/check-slice\.md, section 8, row 3: "Do: the failing run of section 6; See: its output, exit 1"$/);
    assert.match(lines[at + 2]!, /^got      the first line$/);
    assert.ok(lines.includes("rerun    npm run t -- 'test 3'"), red.out);
    assert.equal(lines[lines.length - 1], 'if the promise changed, change the spec row first; the guard then accepts a new expectation');
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
    assert.match(prints.message, /question 56/);
    const fails = await expectBroken('harness-1', () => stopHook("process.on('SIGTERM', () => process.exit(1)); " + ready));
    assert.match(fails.message, /question 56/);
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
