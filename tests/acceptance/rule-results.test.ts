import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, setRule, withSample, write } from './helpers.ts';

const BREACH = 'console.log(1)\n';
const finding = (place: string) => `${place}  error[no-console]  writes to the terminal with console.log`;

const lineCases: [string, string, string][] = [
  ['null', "[{ message: 'x', line: null }]", 'returns a finding whose line is null, not an integer for src/core/x.ts'],
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

test('S2-4: a line in an empty file names the empty file', async () => {
  await withSample(async (s) => {
    setRule(s, 'no-console', "export function check() { return [{ message: 'x', line: 1 }]; }\n");
    write(s, 'src/core/x.ts', '');
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[2], '.lawcheck/rules/no-console.mjs  error[rule-crashed]  returns a finding at line 1, though the file has no lines, for src/core/x.ts');
  });
});

const background: [string, string, string][] = [
  ['a rejection in a call', "export function check({ files }) { Promise.reject(new Error('lost')); return []; }\n", 'fails in the background after its call on src/core/a.ts: lost'],
  ['a rejection of an async call left behind', "export async function check({ files }) { void (async () => { await null; throw new Error('late'); })(); return []; }\n", 'fails in the background after its call on src/core/a.ts: late'],
  ['a throw from a timer 40 ms later', "export function check() { setTimeout(() => { throw new Error('late'); }, 40); return []; }\n", 'fails in the background after its call on src/core/a.ts: late'],
  ['a rejection after a timer and several turns', "export function check() { setTimeout(() => { void (async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); throw new Error('later'); })(); }, 10); return []; }\n", 'fails in the background after its call on src/core/a.ts: later'],
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

test('S2-6: a rule that settles its own promises is judged as before (control)', async () => {
  await withSample(async (s) => {
    setRule(s, 'no-console', "export async function check({ files }) { await Promise.reject(new Error('x')).catch(() => null); return files.flatMap((file) => file.lines.flatMap((text, i) => (text.includes('console.log') ? [{ line: i + 1, message: 'writes to the terminal with console.log' }] : []))); }\n");
    write(s, 'src/core/a.ts', BREACH);
    const run = await check(s);
    assert.equal(run.code, 1);
    assert.ok(run.stdout.split('\n').includes(finding('src/core/a.ts:1')), run.stdout);
  });
});


test('S2-6: a rule that leaves a timer of a minute running is judged, within the wait the runner gives it (control)', async () => {
  await withSample(async (s) => {
    setRule(s, 'no-console', "export function check({ files }) { setTimeout(() => {}, 60000); return files.flatMap((file) => file.lines.flatMap((text, i) => (text.includes('console.log') ? [{ line: i + 1, message: 'writes to the terminal with console.log' }] : []))); }\n");
    write(s, 'src/core/a.ts', BREACH);
    const run = await check(s);
    assert.equal(run.code, 1);
    assert.ok(run.stdout.split('\n').includes(finding('src/core/a.ts:1')), run.stdout);
    assert.ok(run.ms < 15_000, `${run.ms} ms`);
  });
});
