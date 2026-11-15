import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plural, renderErrors, renderReport } from '../../dist/output.js';

function finding(file: string, line: number | undefined, debt = false) {
  const f: Record<string, unknown> = { code: 'r', rule: 'r', severity: debt ? 'warning' : 'error', debt, file, type: 't', message: 'm', why: 'w' };
  if (line !== undefined) f.line = line;
  return f as never;
}

test('a count of 1 takes the singular', () => {
  assert.equal(plural(1, 'changed file'), '1 changed file');
  assert.equal(plural(0, 'waiver'), '0 waivers');
});

test('a whole-file finding prints its file alone, and why follows the first finding of a code', () => {
  const text = renderReport({ mode: 'change', base: 'main', changed: 2, findings: [finding('a.ts', undefined), finding('b.ts', 3)], debt: [], waivers: [] }, false);
  assert.equal(text, ['lawcheck: FAIL  2 errors in 2 changed files (against main)', '', 'a.ts  error[r]  m', '  why:  w', 'b.ts:3  error[r]  m', '', 'next: fix a.ts', ''].join('\n'));
});

test('without a base the first line says every file counts as changed', () => {
  const text = renderReport({ mode: 'change', base: null, changed: 1, findings: [], debt: [], waivers: [] }, false);
  assert.equal(text, 'lawcheck: PASS  1 file (no base: every file counts as changed)\n');
});

test('one more finding takes the singular', () => {
  const findings = Array.from({ length: 51 }, (_, i) => finding('a.ts', i + 1));
  const text = renderReport({ mode: 'change', base: 'main', changed: 1, findings, debt: [], waivers: [] }, false);
  assert.ok(text.includes('\n... 1 more finding (--json lists all)\n'));
});

test('a whole-file finding has no line in JSON, and a passing run has no next', () => {
  const document = JSON.parse(renderReport({ mode: 'full', base: null, changed: 1, findings: [], debt: [finding('a.ts', undefined, true)], waivers: [] }, true));
  assert.equal('line' in document.findings[0], false);
  assert.deepEqual(document.scope, { mode: 'full', base: null, files: 1, law_changed: false });
  assert.equal(document.next, null);
  assert.equal(document.result, 'pass');
});

test('exit 2 prints a lawcheck-error/1 document with null places', () => {
  const document = JSON.parse(renderErrors([{ code: 'usage', file: null, line: null, message: 'x' }], true));
  assert.equal(document.schema, 'lawcheck-error/1');
  assert.deepEqual(Object.keys(document.errors[0]), ['code', 'file', 'line', 'message', 'why']);
  assert.equal(document.next.text, 'run lawcheck check as its usage line says: lawcheck check --help');
  assert.equal(document.next.command, 'lawcheck check --help');
});

test('the reviewer calls end the first line, in both forms, and reviews stand before next in JSON', () => {
  const reviews = { missing: 0, calls_made: 1, passes_recorded: 1 };
  assert.equal(renderReport({ mode: 'change', base: 'main', changed: 1, findings: [], debt: [], waivers: [], reviews, next: null }, false), 'lawcheck: PASS  1 changed file (against main), 1 reviewer call\n');
  assert.equal(
    renderReport({ mode: 'full', base: 'main', changed: 0, findings: [], debt: [], waivers: [], reviews: { ...reviews, calls_made: 2 }, next: null }, false),
    'lawcheck: PASS  nothing changed against main, 2 reviewer calls\n\ndebt (outside this change): none\n',
  );
  const document = JSON.parse(renderReport({ mode: 'change', base: 'main', changed: 1, findings: [finding('a.ts', 1)], debt: [], waivers: [], reviews, next: { command: 'c', text: 'c  (1 reviewer call)' } }, true));
  assert.deepEqual(Object.keys(document), ['schema', 'result', 'scope', 'summary', 'findings', 'waivers', 'unresolved', 'reviews', 'next']);
  assert.deepEqual(document.next, { command: 'c', text: 'c  (1 reviewer call)' });
});

test('an error may carry its own next', () => {
  const text = renderErrors([{ code: 'too-many-reviews', file: null, line: null, message: 'm', next: 'ask first' }], false);
  assert.ok(text.endsWith('\nnext: ask first\n'));
  assert.ok(text.includes('  why:  reviewer.max_calls bounds what one run spends\n'));
});
