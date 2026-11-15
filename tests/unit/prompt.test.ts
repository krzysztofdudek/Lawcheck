import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { example, exampleText } from '../harness/examples.ts';
import { buildPrompt, checkAnswer, cleanMessage, FRAME, numbered, size, takeAnswer } from '../../dist/prompt.js';

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

test('the prompt for F is section 4 exactly, and holds 2,127 characters', () => {
  const prompt = promptOfF();
  assert.equal(FRAME, SPEC_FRAME);
  assert.equal(prompt, SPEC_FRAME + '\n\n' + PROMPT_TAIL);
  assert.equal(size(prompt), 2127);
});

test('numbered lines, the empty file, CRLF, a path that needs quoting and waived lines', () => {
  assert.deepEqual(numbered(''), []);
  assert.deepEqual(numbered('a\r\n\r\nb\rc\n'), ['1| a', '2|', '3| b\\rc']);
  const prompt = buildPrompt({ why: 'w', ruleText: '\r\n  rule\r\ntext \n\n', context: [], filePath: 'a "b".ts', fileText: '', waived: [2, 7] });
  assert.ok(prompt.endsWith('<rule>\nrule\ntext\n</rule>\n\n<file path="a \\"b\\".ts">\n</file>\n\n<waived>\n2, 7\n</waived>'), prompt);
  assert.ok(promptOfF(F, []).endsWith('<waived>\nnone\n</waived>'));
});

test('the size counts code points', () => {
  assert.equal(size('a😀b'), 3);
});

const PASS = '{"verdict": "pass", "findings": []}';
const FAIL = '{"verdict": "fail", "findings": [{"line": 2, "message": "m"}]}';

test('each form of answer is read', () => {
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

test('the first candidate taken is checked, and nothing else is tried', () => {
  assert.deepEqual(takeAnswer('```json\n{"verdict": "PASS"}\n```\n' + PASS), { verdict: 'PASS' });
  assert.ok('problem' in checkAnswer('```json\n{"verdict": "PASS"}\n```\n' + PASS, 5));
});

test('every bad answer is named', () => {
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

test('a message keeps one space per line break and is trimmed', () => {
  assert.equal(cleanMessage(' a\nb\r\nc\rd  '), 'a b c d');
});
