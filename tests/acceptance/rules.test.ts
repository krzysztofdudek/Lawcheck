import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { isAbsolute, join } from 'node:path';
import { append, check, D, D_PATH, findingLines, lawcheck, NO_CONSOLE, setRule, startLawcheck, TEST4, withSample, write } from './helpers.ts';

const CRASH = '.lawcheck/rules/no-console.mjs  error[rule-crashed]';

function assertCrashes(run: { code: number | null; stdout: string }, name: string): void {
  assert.equal(run.code, 2, `${name}: ${run.stdout}`);
  assert.ok(run.stdout.split('\n').some((line) => line.startsWith(CRASH)), `${name}: ${run.stdout}`);
  assert.deepEqual(findingLines(run.stdout).filter((line) => !line.includes('error[rule-crashed]')), [], name);
}

async function withRule(source: string, body: (s: string) => Promise<void>, rules: Record<string, string> = {}): Promise<void> {
  await withRules({ 'no-console': source, ...rules }, async (s) => {
    write(s, D_PATH, D);
    await body(s);
  });
}

async function withRules(rules: Record<string, string>, body: (s: string) => Promise<void>): Promise<void> {
  await withSample(body, {
    onMain: (s) => {
      for (const [rule, source] of Object.entries(rules)) setRule(s, rule, source);
    },
  });
}

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
  const cases: [string, string][] = [
    ['in check', 'export function check() { while (true) {} }\n'],
    ['at the top level', 'while (true) {}\nexport function check() { return []; }\n'],
  ];
  await Promise.all(
    cases.map(([name, source]) =>
      withRule(source, async (s) => {
        const run = await check(s);
        assertCrashes(run, name);
        assert.ok(run.ms < 40_000, `${name} took ${run.ms} ms`);
      }),
    ),
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

test('section 3: a rule that spins ends with the tool, whatever ends the tool', async () => {
  const spin = "export function check() { console.error('runner ' + process.pid); return new Promise(() => setTimeout(() => { while (true) {} }, 100)); }\n";
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    await withRule(spin, async (s) => {
      // Section 3: a signal that the tool can catch ends it as internal.
      const tool = startLawcheck(s, ['check', '--base', 'main'], { stderr: /^runner \d+\n$/, internal: signal === 'SIGTERM' });
      let pid: number | null = null;
      for (let i = 0; i < 100 && pid === null; i++) {
        await sleep(100);
        const found = /^runner (\d+)$/m.exec(tool.stderr());
        if (found !== null) pid = Number(found[1]);
      }
      assert.ok(pid !== null, `${signal}: the runner started`);
      await sleep(300);
      tool.kill(signal);
      const { code } = await tool.ended;
      let left = alive(pid);
      for (let i = 0; i < 50 && left; i++) {
        await sleep(100);
        left = alive(pid);
      }
      try {
        assert.equal(left, false, `${signal}: no runner outlives the tool`);
      } finally {
        if (left) process.kill(pid, 'SIGKILL');
      }
      // On Windows every signal ends a process at once, so the tool cannot answer SIGTERM with its own exit code.
      if (signal === 'SIGTERM' && process.platform !== 'win32') assert.equal(code, 2);
    });
  }
});

test("section 3: a rule that writes to the runner's channel crashes as that rule", async () => {
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

test('section 3: what a rule prints goes to standard error', async () => {
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

test('section 3: the runner takes no flag the tool was started with', async () => {
  await withRule('export function check() { return [{ message: JSON.stringify(process.execArgv) }]; }\n', async (s) => {
    const run = await lawcheck(s, ['check', '--base', 'main'], {}, ['--no-warnings', '--max-old-space-size=256']);
    const line = findingLines(run.stdout)[0] ?? '';
    const flags = JSON.parse(line.slice(line.indexOf('  error[no-console]  ') + '  error[no-console]  '.length));
    assert.equal(flags.length, 3, line);
    assert.equal(flags[0], '--permission');
    assert.equal(flags[1], `--allow-fs-read=${realpathSync(s)}`);
    assert.ok(isAbsolute(flags[2].slice('--allow-fs-read='.length)), flags[2]);
  });
});
