import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { main } from '../../dist/cli.js';
import { CASES_PURE, REACH_SHARE, SEED } from './numbers.ts';
import { expectedField, expectedLine, jsonProblem, outputProblem } from './oracle.ts';

const CONTROLS = ['\x00', '\x07', '\b', '\t', '\n', '\r', '\x1b', '\x1b[2K', '\x1b[1A', '\x1b]8;;http://x\x07', '\x7f', '\x85', '\x9b'];
const BIDI = ['\u00ad', '\u180e', '\u200b', '\u2060', '\u206a', '\u206f', '\ufeff', '\ufff9', '\ufffb', '\u{e0001}', '\u{e007f}', '\u061c', '\u200e', '\u200f', '\u2028', '\u2029', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069'];
const CI = ['::error title=x::y', '::stop-commands::t', '##[group]g', '##vso[task.setvariable variable=a]b', ' ::warning::w', '\u00a0::error::n', '\u3000##[error]e'];

const piece = fc.oneof(
  { weight: 5, arbitrary: fc.string({ maxLength: 6 }) },
  { weight: 2, arbitrary: fc.constantFrom(...CONTROLS) },
  { weight: 2, arbitrary: fc.constantFrom(...BIDI) },
  { weight: 1, arbitrary: fc.constantFrom(...CI) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 3 }) },
);
const hostile = fc.array(piece, { minLength: 1, maxLength: 12 }).map((pieces) => pieces.join(''));
const atStart = fc.tuple(fc.constantFrom(...CI, ''), hostile).map(([start, rest]) => start + rest);

const context = { cwd: '/', env: {}, warn: () => undefined };

function finding(file: string, message: string) {
  return { code: 'r', rule: 'r', severity: 'error' as const, debt: false, file, line: 1, type: 't', message, why: 'a rule' };
}

test('I-out-1: no file name, message or base forges a line or puts a forbidden character into text output, and one finding is one line', async () => {
  const reach = { control: 0, bidi: 0, ci: 0, lineBreak: 0 };
  await fc.assert(
    fc.asyncProperty(atStart, hostile, hostile, async (file, message, base) => {
      const all = file + message + base;
      if (CONTROLS.some((c) => all.includes(c))) reach.control++;
      if (BIDI.some((c) => all.includes(c))) reach.bidi++;
      if (CI.some((c) => file.startsWith(c) && c !== '')) reach.ci++;
      if (/[\n\r]/.test(all)) reach.lineBreak++;
      const report = { mode: 'change' as const, base, changed: 1, findings: [finding(file, message)], debt: [], waivers: [] };
      const result = await main(['check', '--base', 'x'], context, async () => ({ report }));
      assert.equal(result.code, 1);
      assert.equal(outputProblem(result.stdout), null);
      const lines = result.stdout.split('\n');
      assert.equal(lines[0], expectedLine(`lawcheck: FAIL  1 error in 1 changed file (against ${expectedField(base)})`));
      assert.equal(lines[2], expectedLine(`${expectedField(file)}:1  error[r]  ${expectedField(message)}`));
      assert.equal(lines.filter((line) => line.includes('  error[r]  ')).length, 1);
      assert.equal(lines.at(-2), expectedLine(`next: fix ${expectedField(file)}:1`));
      const json = await main(['check', '--base', 'x', '--json'], context, async () => ({ report }));
      assert.equal(jsonProblem(json.stdout), null);
      const document = JSON.parse(json.stdout);
      assert.equal(document.findings[0].file, file);
      assert.equal(document.findings[0].message, message);
      assert.equal(document.scope.base, base);
    }),
    { seed: SEED, numRuns: CASES_PURE },
  );
  for (const [kind, count] of Object.entries(reach)) assert.ok(count >= CASES_PURE * REACH_SHARE, `${kind}: ${count} of ${CASES_PURE} cases`);
});

test('I-out-1: an error message the tool did not write stays on one line of text output', async () => {
  await fc.assert(
    fc.asyncProperty(hostile, async (message) => {
      const result = await main(['check'], context, async () => ({ errors: [{ code: 'base-unreachable', file: null, line: null, message }] }));
      assert.equal(result.code, 2);
      assert.equal(outputProblem(result.stdout), null);
      assert.equal(result.stdout.split('\n')[2], expectedLine(`error[base-unreachable]  ${expectedField(message)}`));
      const json = await main(['check', '--json'], context, async () => ({ errors: [{ code: 'base-unreachable', file: null, line: null, message }] }));
      assert.equal(jsonProblem(json.stdout), null);
      assert.equal(JSON.parse(json.stdout).errors[0].message, message);
    }),
    { seed: SEED, numRuns: CASES_PURE },
  );
});

test('I-out-1: the joiners U+200C and U+200D, which scripts and emoji need, print as they are', async () => {
  const message = 'k\u200cx \u{1f469}\u200d\u{1f4bb}';
  const report = { mode: 'change' as const, base: 'main', changed: 1, findings: [finding('a.ts', message)], debt: [], waivers: [] };
  const result = await main(['check', '--base', 'main'], context, async () => ({ report }));
  assert.ok(result.stdout.includes(`a.ts:1  error[r]  ${message}`), result.stdout);
});
