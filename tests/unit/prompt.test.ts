import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { example, exampleText } from '../harness/examples.ts';
import { buildPrompt, checkAnswer, cleanMessage, FRAME, numbered, size, takeAnswer } from '../../dist/prompt.js';
import { ANSWER_BUDGET_MS } from '../numbers.ts';

const R = new URL('../reviewer-sample/', import.meta.url);

const F = exampleText('reviewer-f');

const SPEC_FRAME = example('reviewer-frame');

export const PROMPT_TAIL = example('reviewer-prompt-f');

function promptOfF(fileText = F, waived = [4]): string {
  return buildPrompt({
    why: 'An error a caller sees says what happened and what to do next.',
    ruleText: readFileSync(new URL('.lawcheck/rules/clear-errors.md', R), 'utf8'),
    context: [{ path: 'docs/errors.md', text: readFileSync(new URL('docs/errors.md', R), 'utf8') }],
    filePath: 'src/core/refund.ts',
    fileText,
    waived,
  });
}

test('reviewer-slice §4: the prompt for F is section 4 exactly, and holds 2,127 characters', () => {
  const prompt = promptOfF();
  assert.equal(FRAME, SPEC_FRAME);
  assert.equal(prompt, SPEC_FRAME + '\n\n' + PROMPT_TAIL);
  assert.equal(size(prompt), 2127);
});

test('reviewer-slice §4: numbered lines, the empty file, CRLF, a path that needs quoting and waived lines', () => {
  assert.deepEqual(numbered(''), []);
  assert.deepEqual(numbered('a\r\n\r\nb\rc\n'), ['1| a', '2|', '3| b\\rc']);
  const prompt = buildPrompt({ why: 'w', ruleText: '\r\n  rule\r\ntext \n\n', context: [], filePath: 'a "b".ts', fileText: '', waived: [2, 7] });
  assert.ok(prompt.endsWith('<rule>\nrule\ntext\n</rule>\n\n<file path="a \\"b\\".ts">\n</file>\n\n<waived>\n2, 7\n</waived>'), prompt);
  assert.ok(promptOfF(F, []).endsWith('<waived>\nnone\n</waived>'));
});

test('reviewer-slice §4: the size counts code points', () => {
  assert.equal(size('a😀b'), 3);
});

const PASS = '{"verdict": "pass", "findings": []}';
const FAIL = '{"verdict": "fail", "findings": [{"line": 2, "message": "m"}]}';

test('reviewer-slice §4: each form of answer is read', () => {
  assert.deepEqual(checkAnswer(`  ${FAIL}\n`, 5), { verdict: 'fail', findings: [{ line: 2, message: 'm' }] });
  assert.deepEqual(checkAnswer('```json\n' + FAIL + '\n```', 5), { verdict: 'fail', findings: [{ line: 2, message: 'm' }] });
  assert.deepEqual(checkAnswer('Here:\n```\n' + PASS + '\n```\nDone.', 5), { verdict: 'pass', findings: [] });
  assert.deepEqual(checkAnswer('The file breaks it. ' + FAIL, 5), { verdict: 'fail', findings: [{ line: 2, message: 'm' }] });
  assert.deepEqual(checkAnswer(FAIL + ' That is all.', 5), { verdict: 'fail', findings: [{ line: 2, message: 'm' }] });
  assert.deepEqual(checkAnswer(FAIL + ' {"note": 1}', 5), { verdict: 'fail', findings: [{ line: 2, message: 'm' }] });
  assert.deepEqual(checkAnswer(PASS + ' then ' + FAIL, 5), { verdict: 'fail', findings: [{ line: 2, message: 'm' }] });
  assert.deepEqual(checkAnswer('{"verdict": "fail", "findings": [{"line": null, "message": "a } { b"}]} trailing }', 5), {
    verdict: 'fail',
    findings: [{ line: null, message: 'a } { b' }],
  });
  assert.deepEqual(checkAnswer('{"verdict": "pass"}', 5), { verdict: 'pass', findings: [] });
  assert.deepEqual(checkAnswer('{"verdict": "fail", "findings": [{"message": "whole"}], "extra": 1}', 5), { verdict: 'fail', findings: [{ line: null, message: 'whole' }] });
});

test('reviewer-slice §4: the first candidate taken is checked, and nothing else is tried', () => {
  assert.deepEqual(takeAnswer('```json\n{"verdict": "PASS"}\n```\n' + PASS), { verdict: 'PASS' });
  assert.ok('problem' in checkAnswer('```json\n{"verdict": "PASS"}\n```\n' + PASS, 5));
});

test('reviewer-slice §4: every bad answer is named', () => {
  const bad = [
    'fine',
    '[]',
    '',
    '{"verdict": "pass", "findings": [{"line": 2, "message": "x"}]}',
    '{"verdict": "fail", "findings": []}',
    '{"verdict": "fail"}',
    '{"verdict": "PASS", "findings": []}',
    '{"verdict": "pass", "findings": {}}',
    '{"verdict": "fail", "findings": [{"line": 0, "message": "x"}]}',
    '{"verdict": "fail", "findings": [{"line": 6, "message": "x"}]}',
    '{"verdict": "fail", "findings": [{"line": "2", "message": "x"}]}',
    '{"verdict": "fail", "findings": [{"line": 1.5, "message": "x"}]}',
    '{"verdict": "fail", "findings": [{"line": 2, "message": "  "}]}',
    '{"verdict": "fail", "findings": [{"line": 2}]}',
    '{"verdict": "fail", "findings": ["x"]}',
    '{"verdict": "fail", "findings": [null]}',
  ];
  for (const answer of bad) assert.ok('problem' in checkAnswer(answer, 5), answer);
});

test('reviewer-slice §4: a message keeps one space per line break and is trimmed', () => {
  assert.equal(cleanMessage(' a\nb\r\nc\rd  '), 'a b c d');
});

function timed<T>(body: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = body();
  return { value, ms: performance.now() - started };
}

test('S3-3: an answer of one megabyte of { before the verdict is read within the budget', () => {
  const { value, ms } = timed(() => takeAnswer('{'.repeat(1 << 20) + '{"verdict":"pass","findings":[]}'));
  assert.deepEqual(value, { verdict: 'pass', findings: [] });
  assert.ok(ms <= ANSWER_BUDGET_MS, `took ${Math.round(ms)} ms`);
});

test('S3-3: an answer of 50,000 nested objects around the verdict is read within the budget', () => {
  const depth = 50_000;
  const { value, ms } = timed(() => takeAnswer('{"a":'.repeat(depth) + '{"verdict":"fail","findings":[{"line":1,"message":"m"}]}' + '}'.repeat(depth)));
  assert.deepEqual(value, { verdict: 'fail', findings: [{ line: 1, message: 'm' }] });
  assert.ok(ms <= ANSWER_BUDGET_MS, `took ${Math.round(ms)} ms`);
});

test('S3-3: one megabyte of { with no verdict is a bad answer, within the budget', () => {
  const { value, ms } = timed(() => checkAnswer('{'.repeat(1 << 20), 3));
  assert.deepEqual(value, { problem: 'the answer holds no JSON object with a verdict' });
  assert.ok(ms <= ANSWER_BUDGET_MS, `took ${Math.round(ms)} ms`);
});

test('S3-3: a reviewer line of 1e400 is named as Infinity, not as null', () => {
  assert.deepEqual(checkAnswer('{"verdict": "fail", "findings": [{"line": 1e400, "message": "m"}]}', 3), { problem: 'a finding is at line Infinity, outside lines 1 to 3' });
});
