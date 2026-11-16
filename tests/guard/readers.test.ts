import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSource } from './source.ts';
import { readConstants } from './constants.ts';
import { acceptanceRows, fencedBlocks, invariantRows, ledgerRows, readWeakenings, rulings } from './markdown.ts';
import { parseAnchor } from './guard.ts';

test('question 95: the suite guard, test ids are the names of test, it and describe calls, and nothing a comment, a string or a regex holds', () => {
  const src = readSource([
    "// test.only('in a comment')",
    "/* it.skip('in a block comment') */",
    "const s = \"test.only('in a string')\";",
    "const r = /'/;",
    "const q = /test\\('in a regex'\\)/;",
    "test('test 1: plain', () => {});",
    "describe(\"group\", () => { it('inner', async (t) => { await t.test('child', () => {}); }); });",
    'test(`test ${n}: generated`, () => {});',
    'test(`test 2: a template`, () => {});',
    "if (/x/.test('y')) {}",
    "test('test 3: \\'quoted\\' and \\u00e9', () => {});",
    "const q = (p: string) => `'${p.replace(/'/g, `'\\\\''`)}'`;",
    "test('test 4: after a regex with a quote inside a template', () => {});",
  ].join('\n'));
  assert.deepEqual(src.tests.map((t) => [t.id, t.dynamic, t.line]), [
    ['test 1: plain', false, 6],
    ['group', false, 7],
    ['inner', false, 7],
    ['child', false, 7],
    ['test ${…}: generated', true, 8],
    ['test 2: a template', false, 9],
    ["test 3: 'quoted' and é", false, 11],
    ['test 4: after a regex with a quote inside a template', false, 13],
  ]);
  assert.deepEqual(src.markers, []);
});

test('question 95: the suite guard, only, skip and todo are found in each form node:test takes', () => {
  const src = readSource([
    "test.only('a', () => {});",
    "it.skip('b', () => {});",
    "describe.todo('c');",
    "test('d', { skip: 'no file mode on Windows' }, () => {});",
    "test('e', { only: true, timeout: 5 }, () => {});",
    "test('f', { todo: 'later' }, () => {});",
    "test('g', { skip: false, only: false }, () => {});",
    "test('h', (t) => { t.skip('a reason'); t.todo(); t.runOnly(true); });",
    "test('i', () => { if (process.platform === 'win32') return; });",
    "test('j', (t) => { if (process.platform === 'win32') return t.skip('x'); });",
    "test('k', () => { if (process.platform === 'win32') { return; } });",
  ].join('\n'));
  assert.deepEqual(src.markers.map((m) => [m.kind, m.line, m.text, m.strings]), [
    ['only', 1, 'test.only("a")', []],
    ['skip', 2, 'it.skip("b")', []],
    ['todo', 3, 'describe.todo("c")', []],
    ['skip', 4, "'no file mode on Windows'", ['no file mode on Windows']],
    ['only', 5, 'true', []],
    ['todo', 6, "'later'", ['later']],
    ['skip', 8, "'a reason'", ['a reason']],
    ['todo', 8, '', []],
    ['only', 8, 'runOnly(true)', []],
    ['skip', 9, "if (process.platform === 'win32') return, with no skip", []],
    ['skip', 10, "'x'", ['x']],
    ['skip', 11, "if (process.platform === 'win32') return, with no skip", []],
  ]);
});

test('question 95: the suite guard, the numbers are read as data, and a value that is not a plain constant is named unreadable', () => {
  const values = readConstants([
    'export const SEED = 20261115;',
    'export const CASES: number = 1_000;',
    'export const NEGATIVE = -2;',
    'export const BUDGET = { cli: 20e3, hook: { start: 0x10 } } as const;',
    "export const SLOW = ['a', \"b\"] as const;",
    'export const PRODUCT = 20 * 1000;',
    'const HIDDEN = 5;',
    "export const NAME = 'x';",
  ].join('\n'));
  assert.deepEqual(Object.fromEntries(values), {
    SEED: { kind: 'number', value: 20261115 },
    CASES: { kind: 'number', value: 1000 },
    NEGATIVE: { kind: 'number', value: -2 },
    'BUDGET.cli': { kind: 'number', value: 20000 },
    'BUDGET.hook.start': { kind: 'number', value: 16 },
    SLOW: { kind: 'list', items: ['a', 'b'] },
    PRODUCT: { kind: 'unreadable', text: '20 * 1000' },
    NAME: { kind: 'text', value: 'x' },
  });
});

test('question 95: the suite guard, spec rows, invariants, ledger rows, rulings and example blocks are read from markdown', () => {
  const spec = [
    '## 6. Output',
    '',
    '<!-- example: pass-run -->',
    '```',
    'lawcheck: PASS',
    '```',
    '',
    '```yaml',
    'a: 1',
    '```',
    '',
    '| # | Do | See |',
    '|---|---|---|',
    '| 1 | nothing | `a \\| b`, exit 0 |',
    '| 2 | more | exit 1 |',
    '',
    '| Id | Promise |',
    '|---|---|',
    '| `I-frame-1` | No text starts a line. |',
  ].join('\n');
  assert.deepEqual(acceptanceRows(spec).map((r) => [r.key, r.line]), [['row 1', 14], ['row 2', 15]]);
  assert.deepEqual(invariantRows(spec).map((r) => r.key), ['I-frame-1']);
  assert.deepEqual(fencedBlocks(spec).map((b) => [b.key, b.content]), [['example pass-run', '\nlawcheck: PASS'], ['block 2 under "6. Output"', 'yaml\na: 1']]);
  assert.deepEqual(ledgerRows('| S3-1 | security | open |\n|---|---|---|\n| x | S1-12 | fixed |').map((r) => r.key), ['S3-1', 'S1-12']);
  assert.deepEqual([...rulings('## 1. One\ntext\n## 12. Twelve\n### 13. not one')], ['1', '12']);
});

test('question 95: the suite guard, a record of tests/weakenings.md has six cells and a date, and a malformed one is named', () => {
  const ledger = readWeakenings([
    '| Date | What | Kind | Reason | Anchor | Approved by |',
    '|---|---|---|---|---|---|',
    '| 2026-11-15 | `a \\| b` | test-removed | gone | row 1 | reviewer r1 |',
    '| 15.11.2026 | x | test-removed | gone | row 1 | reviewer r1 |',
    '| 2026-11-15 | x | test-removed | gone | row 1 |',
    '| 2026-11-15 | x | test-removed |  | row 1 | reviewer r1 |',
  ].join('\n'));
  assert.deepEqual(ledger.records.map((r) => [r.line, r.what, r.approvedBy]), [[3, 'a | b', 'reviewer r1']]);
  assert.deepEqual(ledger.malformed.map((m) => [m.line, m.why]), [[4, 'its date is not YYYY-MM-DD'], [5, 'it has 5 cells, the table has 6'], [6, 'a cell is empty']]);
});

test('question 95: the suite guard, an anchor is a row, an invariant, a finding, a ruling, a Runes version or a path', () => {
  assert.deepEqual(['row 21', 'test 21', 'I-frame-1', 'S3-1', 'ruling 73', 'Runes 1.2.0', 'runes v1.2.0-beta.1', 'tests/guard/**', 'package.json#scripts.test', 'because I said so'].map((a) => {
    const parsed = parseAnchor(a);
    return parsed && [parsed.type, parsed.key];
  }), [['row', 'row 21'], ['row', 'row 21'], ['invariant', 'I-frame-1'], ['ledger', 'S3-1'], ['ruling', '73'], ['runes', '1.2.0'], ['runes', '1.2.0-beta.1'], ['path', 'tests/guard/**'], ['path', 'package.json'], null]);
});
