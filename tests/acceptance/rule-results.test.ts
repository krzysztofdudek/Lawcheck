import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEFT_RUNNING_EXTRA_MS, NOTHING_LEFT_EXTRA_MS, TEST_RULE_MS } from '../numbers.ts';
import { append, check, git, setRule, startLawcheck, withSample, write } from './helpers.ts';

const BREACH = 'console.log(1)\n';
const finding = (place: string) => `${place}  error[no-console]  writes to the terminal with console.log`;

const lineCases: [string, string, string][] = [
  ["the string '2'", "[{ message: 'x', line: '2' }]", 'returns a finding whose line is the string "2", not an integer for src/core/x.ts'],
  ['the bigint 2n', "[{ message: 'x', line: 2n }]", 'returns a finding whose line is the bigint 2n, not an integer for src/core/x.ts'],
  ['1.5', "[{ message: 'x', line: 1.5 }]", 'returns a finding whose line is the number 1.5, not an integer for src/core/x.ts'],
  ['1e400, which is Infinity', "[{ message: 'x', line: 1e400 }]", 'returns a finding whose line is the number Infinity, not an integer for src/core/x.ts'],
  ['7 in a file of 2 lines', "[{ message: 'x', line: 7 }]", 'returns a finding at line 7, outside lines 1 to 2 for src/core/x.ts'],
];

for (const [what, value, message] of lineCases) {
  test(`S2-4: a line that is ${what} is rule-crashed, named by its cause`, async () => {
    await withSample(async (s) => {
      setRule(s, 'no-console', `export function check() { return ${value}; }\n`);
      write(s, 'src/core/x.ts', 'a\nb\n');
      const run = await check(s);
      assert.equal(run.code, 2);
      assert.equal(run.stdout.split('\n')[2], `.lawcheck/rules/no-console.mjs  error[rule-crashed]  ${message}`);
    });
  });
}

test('S2-4: a line that is null is a finding about the whole file, as an absent line is', async () => {
  await withSample(async (s) => {
    write(s, 'src/core/x.ts', 'a\nb\n');
    write(s, 'src/core/empty.ts', '');
    const outputs: string[] = [];
    for (const line of [', line: null', '']) {
      setRule(s, 'no-console', `export function check() { return [{ message: 'x'${line} }]; }\n`);
      const run = await check(s);
      assert.equal(run.code, 1, run.stdout);
      outputs.push(run.stdout);
    }
    assert.equal(outputs[0], outputs[1]);
    const lines = outputs[0]!.split('\n');
    assert.ok(lines.includes('src/core/x.ts  error[no-console]  x'), outputs[0]);
    assert.ok(lines.includes('src/core/empty.ts  error[no-console]  x'), outputs[0]);
  });
});

test('S2-4: a line in an empty file names the empty file', async () => {
  await withSample(async (s) => {
    setRule(s, 'no-console', "export function check() { return [{ message: 'x', line: 1 }]; }\n");
    write(s, 'src/core/x.ts', '');
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[2], '.lawcheck/rules/no-console.mjs  error[rule-crashed]  returns a finding at line 1, though the file has no lines, for src/core/x.ts');
  });
});

const background: [string, string, string][] = [
  ['a rejection in a call', "export function check({ files }) { Promise.reject(new Error('lost')); return []; }\n", 'fails in the background: lost'],
  ['a rejection of an async call left behind', "export async function check({ files }) { void (async () => { await null; throw new Error('late'); })(); return []; }\n", 'fails in the background: late'],
  ['a throw from a timer 40 ms later', "export function check() { setTimeout(() => { throw new Error('late'); }, 40); return []; }\n", 'fails in the background: late'],
  ['a rejection after a timer and several turns', "export function check() { setTimeout(() => { void (async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); throw new Error('later'); })(); }, 10); return []; }\n", 'fails in the background: later'],
  ['a rejection at the top of the module', "Promise.reject(new Error('floating'));\nexport function check() { return []; }\n", 'fails in the background in its load: floating'],
];

for (const [what, source, message] of background) {
  test(`S2-6: ${what} gives the same rule-crashed on one file and on two`, async () => {
    for (const files of [['src/core/a.ts'], ['src/core/a.ts', 'src/core/b.ts']]) {
      await withSample(async (s) => {
        setRule(s, 'no-console', source);
        for (const file of files) write(s, file, 'export const x = 1;\n');
        const run = await check(s);
        assert.deepEqual([run.code, run.stdout.split('\n')[2]], [2, `.lawcheck/rules/no-console.mjs  error[rule-crashed]  ${message}`], `${files.length} files`);
      });
    }
  });
}

const inThePool: [string, string][] = [
  ['a pbkdf2 job', "import { pbkdf2 } from 'node:crypto';\nexport function check() { pbkdf2('a', 'b', 300000, 64, 'sha512', () => { throw new Error('after the job'); }); return []; }\n"],
  ['a scrypt job', "import { scrypt } from 'node:crypto';\nexport function check() { scrypt('a', 'b', 64, { N: 32768, maxmem: 64 * 1024 * 1024 }, () => { throw new Error('after the job'); }); return []; }\n"],
];

for (const [what, source] of inThePool) {
  test(`R-26: a throw from the callback of ${what} that ends after the rule's last result is rule-crashed on one file and on two`, async () => {
    for (const files of [['src/core/a.ts'], ['src/core/a.ts', 'src/core/b.ts']]) {
      await withSample(async (s) => {
        setRule(s, 'no-console', source);
        for (const file of files) write(s, file, 'export const x = 1;\n');
        const run = await check(s);
        assert.deepEqual([run.code, run.stdout.split('\n')[2]], [2, '.lawcheck/rules/no-console.mjs  error[rule-crashed]  fails in the background: after the job'], `${files.length} files`);
      });
    }
  });
}

const leftRunning: [string, string, string][] = [
  ['a process.exit', "setTimeout(() => process.exit(1), 20);", 'ends before answering after a call that left work running'],
  ['a loop that never ends', "setTimeout(() => { while (true) {} }, 20);", `passes ${TEST_RULE_MS / 1000} seconds after a call that left work running`],
];

for (const [what, left, message] of leftRunning) {
  test(`R-107: ${what} that the call on one file leaves on a timer is not blamed on the next file`, async () => {
    const rule = `export async function check({ files }) { if (files[0].path === 'src/core/a.ts') { ${left} } else await new Promise((r) => setTimeout(r, 200)); return []; }\n`;
    for (const args of [['--full'], ['src/core/a.ts']]) {
      await withSample(async (s) => {
        setRule(s, 'no-console', rule);
        for (const file of ['a', 'b']) write(s, `src/core/${file}.ts`, 'export const x = 1;\n');
        const run = await startLawcheck(s, ['check', ...args], { limits: { ruleMs: TEST_RULE_MS } }).ended;
        assert.deepEqual([run.code, run.stdout.split('\n')[2]], [2, `.lawcheck/rules/no-console.mjs  error[rule-crashed]  ${message}`], args.join(' '));
      });
    }
  });
}

test('R-107: a call that leaves nothing running, after one that left work that has ended, is named when the runner ends in it', async () => {
  await withSample(async (s) => {
    setRule(s, 'no-console', "export async function check({ files: [{ path }] }) { if (path === 'src/core/a.ts') setTimeout(() => {}, 20); if (path === 'src/core/b.ts') await new Promise((r) => setTimeout(r, 200)); if (path === 'src/core/c.ts') process.exit(1); return []; }\n");
    for (const file of ['a', 'b', 'c']) write(s, `src/core/${file}.ts`, 'export const x = 1;\n');
    const run = await check(s, '--full');
    assert.deepEqual([run.code, run.stdout.split('\n')[2]], [2, '.lawcheck/rules/no-console.mjs  error[rule-crashed]  ends before answering on src/core/c.ts']);
  });
});

test('R-107: a call that leaves nothing running is named when the runner ends in it', async () => {
  await withSample(async (s) => {
    setRule(s, 'no-console', "export function check({ files }) { if (files[0].path === 'src/core/b.ts') process.exit(1); return []; }\n");
    for (const file of ['a', 'b']) write(s, `src/core/${file}.ts`, 'export const x = 1;\n');
    const run = await check(s, '--full');
    assert.deepEqual([run.code, run.stdout.split('\n')[2]], [2, '.lawcheck/rules/no-console.mjs  error[rule-crashed]  ends before answering on src/core/b.ts']);
  });
});

const unreferenced: [string, string][] = [
  ['a timer', "export function check() { setTimeout(() => { throw new Error('unref'); }, 50).unref(); return []; }\n"],
  ['an interval', "export function check() { setInterval(() => { throw new Error('unref'); }, 50).unref(); return []; }\n"],
  ['an immediate', "export function check() { setImmediate(() => { throw new Error('unref'); }).unref(); return []; }\n"],
  ['a timer of node:timers/promises', "import { setTimeout as wait } from 'node:timers/promises';\nexport function check() { void wait(50, null, { ref: false }).then(() => { throw new Error('unref'); }); return []; }\n"],
  ['an immediate of node:timers/promises', "import { setImmediate as soon } from 'node:timers/promises';\nexport function check() { void soon(null, { ref: false }).then(() => { throw new Error('unref'); }); return []; }\n"],
  ['an interval of node:timers/promises', "import { setInterval as every } from 'node:timers/promises';\nexport function check() { void (async () => { for await (const _ of every(50, null, { ref: false })) throw new Error('unref'); })(); return []; }\n"],
  ['a wait of the scheduler of node:timers/promises', "import { scheduler } from 'node:timers/promises';\nexport function check() { void scheduler.wait(50, { ref: false }).then(() => { throw new Error('unref'); }); return []; }\n"],
];

for (const [what, source] of unreferenced) {
  test(`R-124: a throw from ${what} that the rule leaves unreferenced, after its last result, is rule-crashed as a throw from a referenced timer is`, async () => {
    await withSample(async (s) => {
      setRule(s, 'no-console', source);
      write(s, 'src/core/a.ts', 'export const x = 1;\n');
      const run = await check(s);
      assert.deepEqual([run.code, run.stdout.split('\n')[2]], [2, '.lawcheck/rules/no-console.mjs  error[rule-crashed]  fails in the background: unref']);
    });
  });
}

test('I-rules-1: a throw after an Atomics.waitAsync that ends after the rule\'s last result is rule-crashed, and a wait nobody ends lets the rule pass', async () => {
  await withSample(async (s) => {
    setRule(s, 'no-console', "export function check() { void Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50).value.then(() => { throw new Error('after the wait'); }); return []; }\n");
    write(s, 'src/core/a.ts', 'export const x = 1;\n');
    const run = await check(s);
    assert.deepEqual([run.code, run.stdout.split('\n')[2]], [2, '.lawcheck/rules/no-console.mjs  error[rule-crashed]  fails in the background: after the wait']);
  });
  await withSample(async (s) => {
    setRule(s, 'no-console', "export function check() { void Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0).value.then(() => { throw new Error('never'); }); return []; }\n");
    write(s, 'src/core/a.ts', 'export const x = 1;\n');
    const run = await check(s);
    assert.deepEqual([run.code, run.stdout.split('\n')[0]], [0, 'lawcheck: PASS  2 changed files (against main)']);
  });
});

const noStringForm: [string, string, string][] = [
  ['an object without a prototype', 'Object.create(null)', 'Cannot convert object to primitive value'],
  ['an array holding a symbol', '[Symbol()]', 'Cannot convert a Symbol value to a string'],
  ['a proxy whose traps throw a symbol', 'new Proxy({}, new Proxy({}, { get() { throw Symbol(); } }))', 'a value with no string form'],
  ['a proxy whose traps throw an object', 'new Proxy({}, new Proxy({}, { get() { throw { a: 1 }; } }))', 'a value with no string form'],
];
const noStringFormWhere: [string, (value: string) => string, (reason: string) => string][] = [
  ['a rejection in a call', (value) => `export function check() { Promise.reject(${value}); return []; }\n`, (reason) => `fails in the background: ${reason}`],
  ['a throw from a timer', (value) => `export function check() { setTimeout(() => { throw ${value}; }, 40); return []; }\n`, (reason) => `fails in the background: ${reason}`],
  ['a rejection at the top of the module', (value) => `Promise.reject(${value});\nexport function check() { return []; }\n`, (reason) => `fails in the background in its load: ${reason}`],
  ['a throw in a call', (value) => `export function check() { throw ${value}; }\n`, (reason) => `throws on src/core/a.ts: ${reason}`],
  ['a rejection of an async call', (value) => `export async function check() { throw ${value}; }\n`, (reason) => `throws on src/core/a.ts: ${reason}`],
];

for (const [where, source, message] of noStringFormWhere) {
  for (const [what, value, reason] of noStringForm) {
    test(`R-106: ${where} with ${what} is rule-crashed at once, named by the reason the value has no string form`, { timeout: 15_000 }, async () => {
      await withSample(async (s) => {
        setRule(s, 'no-console', source(value));
        write(s, 'src/core/a.ts', 'export const x = 1;\n');
        const run = await check(s);
        assert.deepEqual([run.code, run.stdout.split('\n')[2]], [2, `.lawcheck/rules/no-console.mjs  error[rule-crashed]  ${message(reason)}`]);
      });
    });
  }
}

for (const [what, value, reason] of noStringForm.slice(0, 2)) {
  test(`R-106: a throw at the top of the module with ${what} is rule-crashed at once, named by the reason the value has no string form`, { timeout: 15_000 }, async () => {
    await withSample(async (s) => {
      setRule(s, 'no-console', `throw ${value};\nexport function check() { return []; }\n`);
      write(s, 'src/core/a.ts', 'export const x = 1;\n');
      const run = await check(s);
      assert.deepEqual([run.code, run.stdout.split('\n')[2]], [2, `.lawcheck/rules/no-console.mjs  error[rule-crashed]  fails to load: ${reason}`]);
    });
  });
}

test('S2-6: a rule that settles its own promises is judged as before (control)', async () => {
  await withSample(async (s) => {
    setRule(s, 'no-console', "export async function check({ files }) { await Promise.reject(new Error('x')).catch(() => null); return files.flatMap((file) => file.lines.flatMap((text, i) => (text.includes('console.log') ? [{ line: i + 1, message: 'writes to the terminal with console.log' }] : []))); }\n");
    write(s, 'src/core/a.ts', BREACH);
    const run = await check(s);
    assert.equal(run.code, 1);
    assert.ok(run.stdout.split('\n').includes(finding('src/core/a.ts:1')), run.stdout);
  });
});


test('S2-6: a rule that leaves an interval of ten minutes judges 200 files within the time of a rule that leaves nothing, plus one wait of 2 seconds', { timeout: 120_000 }, async () => {
  const judge = "files.flatMap((file) => file.lines.flatMap((text, i) => (text.includes('console.log') ? [{ line: i + 1, message: 'writes to the terminal with console.log' }] : [])))";
  const times: number[] = [];
  for (const left of ['', 'setInterval(() => {}, 600000); ']) {
    await withSample(async (s) => {
      setRule(s, 'no-console', `export function check({ files }) { ${left}return ${judge}; }\n`);
      for (let i = 0; i < 200; i++) write(s, `src/core/f${i}.ts`, i === 7 ? BREACH : 'export const x = 1;\n');
      const run = await check(s);
      assert.equal(run.code, 1, run.stdout);
      assert.ok(run.stdout.split('\n').includes(finding('src/core/f7.ts:1')), run.stdout);
      times.push(run.ms);
    });
  }
  assert.ok(times[1]! - times[0]! <= LEFT_RUNNING_EXTRA_MS, `${times[1]} ms against ${times[0]} ms`);
});

test('S2-6: a rule that leaves nothing running adds no wait: one file judged by it takes the time of a run that starts no rule, plus starting the runner', async () => {
  await withSample(async (s) => {
    setRule(s, 'no-console', "export function check({ files }) { return files.flatMap((file) => file.lines.flatMap((text, i) => (text.includes('console.log') ? [{ line: i + 1, message: 'writes to the terminal with console.log' }] : []))); }\n");
    git(s, 'add', '-A');
    git(s, 'commit', '-q', '-m', 'rule');
    append(s, 'README.md', 'more\n');
    const none = await check(s, '--base', 'HEAD');
    assert.equal(none.code, 0, none.stdout);
    write(s, 'src/core/a.ts', BREACH);
    const one = await check(s, '--base', 'HEAD');
    assert.equal(one.code, 1, one.stdout);
    assert.ok(one.ms - none.ms <= NOTHING_LEFT_EXTRA_MS, `${one.ms} ms with the rule against ${none.ms} ms without`);
  });
});
