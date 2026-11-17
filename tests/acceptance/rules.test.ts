import { test } from 'node:test';
import { LIMITS_VARIABLE, platformSkip, waitUntil } from '../harness/tool.ts';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { append, check, D, D_PATH, findingLines, lawcheck, NO_CONSOLE, ROOT, setRule, startLawcheck, TEST4, withSample, write } from './helpers.ts';
import { assertCrashes, CRASH, hangScenario, withRule, withRules } from './rule-bench.ts';
import { PAST_USER_SET_MS, RULE_CALL_MS, TEST_RULE_MS, USER_SET_RULE_MS } from '../numbers.ts';
import { LIMITS } from '../../dist/rules.js';

const ORIGINAL = NO_CONSOLE.replace('export function check', 'function original');

test('test 21: each broken answer crashes the rule', async () => {
  const cases: [string, string][] = [
    ['throws', "export function check() { throw new Error('broken'); }\n"],
    ['returns {}', 'export function check() { return {}; }\n'],
    ['a finding without a message', 'export function check() { return [{ line: 1 }]; }\n'],
    ['a finding for another file', "export function check() { return [{ file: 'README.md', message: 'x' }]; }\n"],
    ['line 0', "export function check() { return [{ message: 'x', line: 0 }]; }\n"],
    ['line NaN', "export function check() { return [{ message: 'x', line: NaN }]; }\n"],
    ['line 7', "export function check() { return [{ message: 'x', line: 7 }]; }\n"],
    ['a function in a finding', "export function check() { return [{ message: 'x', extra: () => 1 }]; }\n"],
    ['process.exit(0)', 'export function check() { process.exit(0); }\n'],
    ['no check exported', 'export function other() { return []; }\n'],
  ];
  await Promise.all(
    cases.map(([name, source]) =>
      withRule(source, async (s) => {
        assertCrashes(await check(s), name);
      }),
    ),
  );
});

test('test 22: one line per broken rule', async () => {
  await withRule("export function check() { throw new Error('x'); }\n", async (s) => {
    append(s, 'src/core/price.ts', '// end\n');
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: ERROR  1 error');
    assert.equal(run.stdout.split('\n').filter((line) => line.includes('error[rule-crashed]')).length, 1);
    assert.equal(run.code, 2);
  });
  await withRule(
    "export function check() { throw new Error('x'); }\n",
    async (s) => {
      append(s, 'src/core/price.ts', '// end\n');
      const run = await check(s);
      assert.equal(run.stdout.split('\n')[0], 'lawcheck: ERROR  2 errors');
      const lines = run.stdout.split('\n').filter((line) => line.includes('error[rule-crashed]'));
      assert.equal(lines.length, 2);
      assert.ok(lines[0]!.startsWith(CRASH));
      assert.ok(lines[1]!.startsWith('.lawcheck/rules/no-todo.mjs  error[rule-crashed]'));
      assert.equal(run.code, 2);
    },
    { 'no-todo': "export function check() { throw new Error('y'); }\n" },
  );
});

test('test 23: a rule with no file to judge is not loaded', async () => {
  await withRules({ 'no-console': "throw new Error('x')\n" }, async (s) => {
    append(s, 'src/cli/main.ts', '// end\n');
    const run = await check(s);
    assert.equal(run.stdout, 'lawcheck: PASS  1 changed file (against main)\n');
    assert.equal(run.code, 0);
    assertCrashes(await check(s, '--full', '--base', 'main'), '--full');
  });
});

test('test 24: a rule that hangs is stopped', async () => {
  await hangScenario(TEST_RULE_MS);
});

test('R-85: each call of a rule has the whole limit, so two calls that are each inside it pass however long they take together', async () => {
  await withRule(ORIGINAL + `export async function check(input) {\n  await new Promise((done) => setTimeout(done, ${RULE_CALL_MS}));\n  return original(input);\n}\n`, async (s) => {
    write(s, 'src/core/second.ts', 'export const second = 1;\n');
    const run = await startLawcheck(s, ['check', '--base', 'main'], { limits: { ruleMs: TEST_RULE_MS } }).ended;
    assert.equal(run.stdout, TEST4.replace('in 1 changed file', 'in 2 changed files'));
    assert.equal(run.code, 1);
    assert.ok(run.ms >= 2 * RULE_CALL_MS, `the check ended after ${run.ms} ms, before both calls answered`);
  });
});

test('check-slice §3: the tool allows a rule 30 seconds for its load and 30 for each call', () => {
  const sentence = /The tool allows (\d+) seconds for the load and (\d+) seconds for each call/.exec(readFileSync(join(ROOT, 'spec', 'check-slice.md'), 'utf8'));
  assert.ok(sentence, 'spec/check-slice.md, section 3, names the time a rule may take');
  assert.equal(sentence[1], sentence[2]);
  assert.deepEqual(LIMITS, { ruleMs: Number(sentence[1]) * 1000 });
});

test('R-87: the tool a user starts keeps its 30 seconds for a rule when the variable of the test entry is set', async () => {
  await withRule(
    ORIGINAL + `export async function check(input) {\n  await new Promise((done) => setTimeout(done, ${PAST_USER_SET_MS}));\n  return original(input);\n}\n`,
    async (s) => {
      const run = await lawcheck(s, ['check', '--base', 'main'], { [LIMITS_VARIABLE]: JSON.stringify({ ruleMs: USER_SET_RULE_MS }) });
      assert.equal(run.stdout, TEST4);
      assert.equal(run.code, 1);
      assert.ok(run.ms >= PAST_USER_SET_MS, `the check ended after ${run.ms} ms, before the rule answered`);
    },
  );
});

test('test 25: an async rule', async () => {
  await withRule(
    ORIGINAL + 'export async function check(input) {\n  await new Promise((done) => setTimeout(done, 20));\n  return original(input);\n}\n',
    async (s) => {
      const run = await check(s);
      assert.equal(run.stdout, TEST4);
      assert.equal(run.code, 1);
    },
  );
});

test('test 26: the runner stops writes, programs, workers and reads outside', async () => {
  const cases: [string, string][] = [
    ['writeFileSync', "import { writeFileSync } from 'node:fs';\n" + ORIGINAL + "export function check(input) { writeFileSync('out.txt', 'x'); return original(input); }\n"],
    ['execSync', "import { execSync } from 'node:child_process';\n" + ORIGINAL + "export function check(input) { execSync('echo x'); return original(input); }\n"],
    ['Worker', "import { Worker } from 'node:worker_threads';\n" + ORIGINAL + "export function check(input) { new Worker('1', { eval: true }); return original(input); }\n"],
    ['readFileSync outside', "import { readFileSync } from 'node:fs';\n" + ORIGINAL + "export function check(input) { readFileSync('../outside.txt'); return original(input); }\n"],
  ];
  await Promise.all(
    cases.map(([name, source]) =>
      withRule(source, async (s) => {
        write(join(s, '..'), 'outside.txt', 'outside\n');
        assertCrashes(await check(s), name);
        assert.equal(existsSync(join(s, 'out.txt')), false);
      }),
    ),
  );
});

test('test 27: no variable of the caller reaches the rule', async () => {
  await withRule(
    'export function check() { return [{ message: String(process.env.SECRET) + " " + String(process.env.NODE_OPTIONS) }]; }\n',
    async (s) => {
      const run = await lawcheck(s, ['check', '--base', 'main'], { SECRET: 'abc', NODE_OPTIONS: '--no-warnings' });
      assert.ok(findingLines(run.stdout).includes('src/core/discount.ts  error[no-console]  undefined undefined'), run.stdout);
    },
  );
});

test('test 28: a rule reads files under the root', async () => {
  await withRule(
    "import { readFileSync } from 'node:fs';\nexport function check() { return [{ message: readFileSync('README.md', 'utf8').trim() }]; }\n",
    async (s) => {
      const run = await check(s);
      assert.ok(findingLines(run.stdout).includes('src/core/discount.ts  error[no-console]  # Sample'), run.stdout);
    },
  );
});

test('test 29: repo.filesOf', async () => {
  await withRules({ 'no-todo': "export function check({ repo }) { return [{ message: repo.filesOf('source').join(' ') }]; }\n" }, async (s) => {
    append(s, 'src/cli/main.ts', '// end\n');
    const run = await check(s);
    assert.deepEqual(findingLines(run.stdout), ['src/cli/main.ts  warning[no-todo]  src/cli/main.ts src/core/price.ts src/core/tax.ts']);
  });
  await withRules({ 'no-todo': "export function check({ repo }) { return [{ message: repo.filesOf('nope').join(' ') }]; }\n" }, async (s) => {
    append(s, 'src/cli/main.ts', '// end\n');
    const run = await check(s);
    assert.match(run.stdout, /^\.lawcheck\/rules\/no-todo\.mjs {2}error\[rule-crashed\]/m);
    assert.equal(run.code, 2);
  });
});

test('test 30: lines and line breaks in messages', async () => {
  const rule = "export function check({ files }) { return [{ message: files[0].lines.length + ' ' + files[0].lines[0].length + '\\nsecond line' }]; }\n";
  await withRules({ 'no-console': rule }, async (s) => {
    write(s, 'src/core/crlf.ts', 'ab\r\ncd\r\n');
    const run = await check(s);
    assert.deepEqual(findingLines(run.stdout), ['src/core/crlf.ts  error[no-console]  2 2 second line']);
  });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('check-slice §3: a rule that spins ends with the tool, whatever ends the tool', async () => {
  const spin = "export function check() { console.error('runner ' + process.pid); return new Promise(() => setTimeout(() => { console.error('spinning'); while (true) {} }, 100)); }\n";
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    await withRule(spin, async (s) => {
      const tool = startLawcheck(s, ['check', '--base', 'main'], { stderr: /^runner \d+\nspinning\n$/ });
      const pid = Number((await tool.output(/^runner (\d+)\nspinning\n/m))[1]);
      assert.ok(pid > 0, `${signal}: the runner started`);
      tool.kill(signal);
      const { code } = await tool.ended;
      const left = !(await waitUntil(() => !alive(pid), 'KILLED_GRACE_MS'));
      try {
        assert.equal(left, false, `${signal}: no runner outlives the tool`);
      } finally {
        if (left) process.kill(pid, 'SIGKILL');
      }
      if (signal === 'SIGTERM' && platformSkip('exit 2 after SIGTERM') === null) assert.equal(code, 2);
    });
  }
});

test("check-slice §3: a rule that writes to the runner's channel crashes as that rule", async () => {
  const cases: [string, string][] = [
    ['sends null', 'export function check() { process.send(null); return []; }\n'],
    ['sends an answer of its own', ORIGINAL + "export function check(input) { process.send({ kind: 'result', value: [] }); return original(input); }\n"],
  ];
  for (const [name, source] of cases) {
    await withRule(source, async (s) => {
      const run = await check(s);
      assertCrashes(run, name);
      assert.doesNotMatch(run.stdout, /error\[internal\]/, name);
    });
  }
});

test("R-114: check-slice §3, a rule that sends its own standard error through the runner's channel crashes as that rule, and the run ends", async () => {
  await withRule("process._send({ kind: 'x' }, process.stderr, {}, () => {});\nexport function check() { return []; }\n", async (s) => {
    const run = await check(s);
    // Node on Windows passes only TCP handles through a channel, so there the send fails inside the rule and the rule is judged.
    if (process.platform === 'win32') return assert.equal(run.code, 0, run.stdout);
    assertCrashes(run, 'sends its standard error');
    assert.match(run.stdout, /writes to the runner's channel in its load/);
  });
});

test('R-114: check-slice §3, a rule that sends its own standard error with an internal message of Node is judged, and the run ends at once', async () => {
  await withRule("process._send({ cmd: 'NODE_x' }, process.stderr, {}, () => {});\nexport function check() { return []; }\n", async (s) => {
    const started = performance.now();
    const run = await check(s);
    assert.equal(run.code, 0, run.stdout);
    assert.ok(performance.now() - started < 5_000, `the run took ${Math.round(performance.now() - started)} ms`);
  });
});

test('check-slice §3: what a rule prints goes to standard error', async () => {
  await withRule(
    ORIGINAL + "export function check(input) { console.log('out from the rule'); console.error('err from the rule'); return original(input); }\n",
    async (s) => {
      const run = await lawcheck(s, ['check', '--base', 'main', '--json'], {}, [], { stderr: 'out from the rule\nerr from the rule\n' });
      assert.equal(JSON.parse(run.stdout).result, 'fail');
      assert.doesNotMatch(run.stdout, /from the rule/);
      assert.match(run.stderr, /out from the rule/);
      assert.match(run.stderr, /err from the rule/);
    },
  );
});

test('check-slice §3: the runner takes no flag the tool was started with', async () => {
  await withRule('export function check() { return [{ message: JSON.stringify(process.execArgv) }]; }\n', async (s) => {
    const run = await lawcheck(s, ['check', '--base', 'main'], {}, ['--no-warnings', '--max-old-space-size=256']);
    const line = findingLines(run.stdout)[0] ?? '';
    const flags = JSON.parse(line.slice(line.indexOf('  error[no-console]  ') + '  error[no-console]  '.length));
    assert.equal(flags.length, 4, line);
    assert.equal(flags[0], '--permission');
    assert.equal(flags[1], `--allow-fs-read=${realpathSync(s)}`);
    assert.ok(isAbsolute(flags[2].slice('--allow-fs-read='.length)), flags[2]);
    assert.equal(flags[3], '--no-experimental-sqlite');
  });
});
