import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { outputProblem } from '../harness/invariants.ts';
import { CouldNotRun, expectBroken, ROOT, startTool } from '../harness/tool.ts';
import type { Expect } from '../harness/tool.ts';

const ENV: NodeJS.ProcessEnv = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' };

async function inTemp(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-harness-')));
  try {
    await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function fake(dir: string, body: string): string {
  const path = join(dir, `fake-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(path, ["import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';", "import { spawn, execFileSync } from 'node:child_process';", "import { join } from 'node:path';", body, ''].join('\n'));
  return path;
}

function tool(dir: string, body: string, args: string[] = ['check'], expect: Expect = {}, cwd = dir) {
  return startTool(cwd, args, ENV, { ...expect, cli: fake(dir, body) }).ended;
}

function repository(dir: string): string {
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env: ENV, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'first');
  return repo;
}

const PASS_DOC = JSON.stringify({
  schema: 'lawcheck-check/0',
  result: 'pass',
  scope: { mode: 'change', base: 'main', files: 0, law_changed: false },
  summary: { errors: 0, warnings: 0, debt: 0, waivers: 0, unresolved: 0 },
  findings: [],
  waivers: [],
  unresolved: [],
  reviews: { missing: 0, calls_made: 0, passes_recorded: 0 },
  next: null,
});

test('harness: a run that keeps every invariant passes, and its outputs reach the test', async () => {
  await inTemp(async (dir) => {
    const repo = repository(dir);
    const run = await tool(dir, "process.stdout.write('lawcheck: PASS  nothing changed against main\\n');", ['check'], {}, repo);
    assert.deepEqual([run.code, run.signal, run.stdout, run.stderr], [0, null, 'lawcheck: PASS  nothing changed against main\n', '']);
    const json = await tool(dir, `process.stdout.write(JSON.stringify(${PASS_DOC}, null, 2) + '\\n');`, ['check', '--json']);
    assert.equal(json.json.result, 'pass');
  });
});

test('harness-1: an exit code outside 0, 1 and 2, or a death by signal, fails the run', async () => {
  await inTemp(async (dir) => {
    const three = await expectBroken('harness-1', () => tool(dir, 'process.exit(3);'));
    assert.match(three.message, /exit code 3/);
    const killed = await expectBroken('harness-1', () => tool(dir, "process.kill(process.pid, 'SIGKILL');"));
    assert.match(killed.message, /died by SIGKILL/);
  });
});

test('harness-2: a forbidden character or a forged line in text output fails the run', async () => {
  for (const [text, expected] of [
    ['a\r', /U\+000D/],
    ['tab\there', /U\+0009/],
    ['\u001b[31mred', /U\+001B/],
    ['del\u007f', /U\+007F/],
    ['c1\u0085', /U\+0085/],
    ['ls ', /U\+2028/],
    ['ps ', /U\+2029/],
    ['rlo‮', /U\+202E/],
    ['iso⁦', /U\+2066/],
    ['::error file=a.ts::forged', /CI command/],
    ['##[error]forged', /CI command/],
    ['##vso[task.complete result=Succeeded]', /CI command/],
  ] as const) {
    assert.match(outputProblem(`lawcheck: PASS\n${text}\n`) ?? '', expected, JSON.stringify(text));
  }
  assert.equal(outputProblem('lawcheck: PASS  1 changed file (against main)\n  why:  a reason: with :: inside\n'), null);
  await inTemp(async (dir) => {
    await expectBroken('harness-2', () => tool(dir, "process.stdout.write('src/a.ts:1  error[x]  a\\r::error::forged\\n'); process.exitCode = 1;"));
    await expectBroken('harness-2', () => tool(dir, "process.stderr.write('\\u001b[2Jcleared\\n');", ['check'], { stderr: /cleared/ }));
  });
});

test('harness-3: --json output must be one valid document whose exit code agrees', async () => {
  await inTemp(async (dir) => {
    const invalid = await expectBroken('harness-3', () => tool(dir, "process.stdout.write(JSON.stringify({ schema: 'lawcheck-check/0', result: 'pass' }) + '\\n');", ['check', '--json']));
    assert.match(invalid.message, /breaks lawcheck-check\/0/);
    const disagrees = await expectBroken('harness-3', () => tool(dir, `process.stdout.write(JSON.stringify(${PASS_DOC}) + '\\n'); process.exitCode = 1;`, ['check', '--json']));
    assert.match(disagrees.message, /exit 1/);
    await expectBroken('harness-3', () => tool(dir, `process.stdout.write(JSON.stringify(${PASS_DOC}) + '\\n' + JSON.stringify(${PASS_DOC}) + '\\n');`, ['check', '--json']));
    await expectBroken('harness-3', () => tool(dir, "process.stdout.write(JSON.stringify({ result: 'pass', schema: 'lawcheck-check/0' }) + '\\n');", ['check', '--json']));
    const unknown = await expectBroken('harness-3', () => tool(dir, "process.stdout.write(JSON.stringify({ schema: 'lawcheck-nothing/9' }) + '\\n');", ['check', '--json']));
    assert.match(unknown.message, /no schema file/);
    const error = await tool(dir, "process.stdout.write(JSON.stringify({ schema: 'lawcheck-error/1', errors: [{ code: 'usage', file: null, line: null, message: 'm', why: 'w' }], next: { command: null, text: 't' } }) + '\\n'); process.exitCode = 2;", ['check', '--json']);
    assert.equal(error.code, 2);
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
    const json = "process.stdout.write(JSON.stringify({ schema: 'lawcheck-error/1', errors: [{ code: 'internal', file: null, line: null, message: 'boom', why: 'w' }], next: { command: null, text: 't' } }) + '\\n'); process.exitCode = 2;";
    await expectBroken('harness-5', () => tool(dir, json, ['check', '--json']));
  });
});

test('harness-6: a run past its budget, or one that leaves a process alive, fails', async () => {
  await inTemp(async (dir) => {
    const slow = await expectBroken('harness-6', () => tool(dir, 'setTimeout(() => {}, 60000);', ['check'], { budget: 500 }));
    assert.match(slow.message, /within its budget of 500 ms/);
    const left = await expectBroken('harness-6', () =>
      tool(dir, "const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', detached: true }); c.unref(); setTimeout(() => process.exit(0), 300);"),
    );
    assert.match(left.message, /alive .* after the run ended/);
  });
});

test('harness-7: a change of git state fails the run, except the files its command writes by contract', async () => {
  await inTemp(async (dir) => {
    const repo = repository(dir);
    const changed = await expectBroken('harness-7', () => tool(dir, "writeFileSync('a.txt', 'b\\n');", ['check'], {}, repo));
    assert.match(changed.message, /changed a\.txt/);
    execFileSync('git', ['checkout', '-q', '--', 'a.txt'], { cwd: repo, env: ENV });
    await expectBroken('harness-7', () => tool(dir, "writeFileSync('new.txt', 'n\\n');", ['check'], {}, repo));
    rmSync(join(repo, 'new.txt'));
    await expectBroken('harness-7', () => tool(dir, "execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'x']);", ['check'], {}, repo));
    await expectBroken('harness-7', () => tool(dir, "writeFileSync('b.txt', 'b\\n'); execFileSync('git', ['add', 'b.txt']);", ['check'], { writes: ['b.txt'] }, repo));
    execFileSync('git', ['reset', '-q', '--hard', 'HEAD~1'], { cwd: repo, env: ENV });
    rmSync(join(repo, 'b.txt'), { force: true });
    const init = "mkdirSync('.lawcheck'); writeFileSync('.lawcheck/law.yaml', 'lawcheck: 0.1.0\\n'); writeFileSync('.lawcheck/.gitignore', '.local/\\n');";
    assert.equal((await tool(dir, init, ['init'], {}, repo)).code, 0);
    await expectBroken('harness-7', () => tool(dir, "writeFileSync('.lawcheck/verdicts', 'x\\n');", ['check'], {}, repo));
    assert.equal((await tool(dir, "writeFileSync('.lawcheck/verdicts', 'y\\n');", ['check', '--review'], {}, repo)).code, 0);
    assert.equal((await tool(dir, "writeFileSync('c.txt', 'c\\n');", ['check'], { writes: ['c.txt'] }, repo)).code, 0);
  });
});

test('harness-8: a file left in the temporary directory fails the run', async () => {
  await inTemp(async (dir) => {
    const left = await expectBroken('harness-8', () => tool(dir, "writeFileSync(join(process.env.TMPDIR, 'lawcheck-left'), 'x');"));
    assert.match(left.message, /left lawcheck-left/);
  });
});

test('harness: a missing build is "could not run", never a pass', async () => {
  await inTemp(async (dir) => {
    assert.throws(() => startTool(dir, ['check'], ENV, { cli: join(dir, 'missing.js') }), CouldNotRun);
  });
});

function nodeTest(dir: string, name: string, body: string): { code: number | null; out: string } {
  const file = join(dir, 'scratch.test.ts');
  const harness = pathToFileURL(join(ROOT, 'tests', 'harness', 'tool.ts')).href;
  writeFileSync(file, [`import { test } from 'node:test';`, `import assert from 'node:assert/strict';`, `import { startTool } from ${JSON.stringify(harness)};`, `test(${JSON.stringify(name)}, async () => {`, body, '});', ''].join('\n'));
  const reporter = join(ROOT, 'tests', 'harness', 'reporter.ts');
  const env: NodeJS.ProcessEnv = { ...process.env, LAWCHECK_STARTED: '' };
  // node:test marks its own child processes with NODE_TEST_CONTEXT, and a test file run under that mark does not run tests of its own.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', `--test-reporter=${reporter}`, '--test-reporter-destination=stdout', file], { cwd: dir, env, encoding: 'utf8' });
  return { code: result.status, out: result.stdout + result.stderr };
}

test('harness-count: a test that starts the tool and reads none of its outputs fails', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-harness-')));
  try {
    writeFileSync(join(dir, 'quiet.mjs'), '');
    const env = JSON.stringify(ENV);
    const silent = nodeTest(dir, 'test 1: a test that compares nothing', `await startTool(${JSON.stringify(dir)}, ['check'], ${env}, { cli: ${JSON.stringify(join(dir, 'quiet.mjs'))} }).ended;`);
    assert.equal(silent.code, 1, silent.out);
    assert.match(silent.out, /harness-count: the test started the tool 1 times and read none of its outputs/);
    const compared = nodeTest(dir, 'test 1: a test that compares', `assert.equal((await startTool(${JSON.stringify(dir)}, ['check'], ${env}, { cli: ${JSON.stringify(join(dir, 'quiet.mjs'))} }).ended).code, 0);`);
    assert.equal(compared.code, 0, compared.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the reporter: one block per red test, last, with its promise, what was got and the rerun command', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-harness-')));
  try {
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
    const green = nodeTest(dir, 'test 3: the failing run', "assert.equal(1, 1);");
    assert.equal(green.code, 0);
    assert.ok(!green.out.includes('RED'), green.out);
    const missing = nodeTest(dir, 'test 3: the failing run', `throw new (await import(${JSON.stringify(pathToFileURL(join(ROOT, 'tests', 'harness', 'tool.ts')).href)})).CouldNotRun('docker is not on the PATH');`);
    assert.equal(missing.code, 1);
    assert.match(missing.out, /\ncould not run  docker is not on the PATH\n/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
