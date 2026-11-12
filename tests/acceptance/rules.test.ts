import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';
import { append, check, CLI, D, D_PATH, findingLines, GIT_ENV, lawcheck, NO_CONSOLE, setRule, TEST4, withSample, write } from './helpers.ts';

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

function runnersOf(root: string): number[] {
  const pids: number[] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').includes(`--allow-fs-read=${root}`)) pids.push(Number(entry));
    } catch {
      // The process ended while the list was read.
    }
  }
  return pids;
}

test('section 3: a rule that spins ends with the tool, whatever ends the tool', async () => {
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    await withRule('export function check() { while (true) {} }\n', async (s) => {
      const root = realpathSync(s);
      const tool = spawn(process.execPath, [CLI, 'check', '--base', 'main'], { cwd: s, env: GIT_ENV, stdio: 'ignore' });
      const closed = new Promise<number | null>((done) => tool.on('close', (code) => done(code)));
      let pids: number[] = [];
      for (let i = 0; i < 100 && pids.length === 0; i++) {
        await sleep(100);
        pids = runnersOf(root);
      }
      assert.equal(pids.length, 1, `${signal}: the runner started`);
      tool.kill(signal);
      const code = await closed;
      let left = pids;
      for (let i = 0; i < 50 && left.length > 0; i++) {
        await sleep(100);
        left = runnersOf(root);
      }
      try {
        assert.deepEqual(left, [], `${signal}: no runner outlives the tool`);
      } finally {
        for (const pid of left) process.kill(pid, 'SIGKILL');
      }
      if (signal === 'SIGTERM') assert.equal(code, 2);
    });
  }
});
