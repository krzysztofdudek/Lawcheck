import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer } from '../../dist/prompt.js';

const PASS = '{"verdict": "pass", "findings": []}';
const FAIL = '{"verdict": "fail", "findings": [{"line": 2, "message": "failed says nothing"}]}';
const FAILED = { verdict: 'fail', findings: [{ line: 2, message: 'failed says nothing' }] };

// The last reading of an answer that docs/reviewer-rules.md names takes the object that ends last. Whether a quoted pass may override a fail is open (stress finding S3-4), so no test here asserts that reading; these fix the readings the question does not touch.
test('S3-4: a fail in a fenced block wins over a pass quoted after the fence', () => {
  assert.deepEqual(checkAnswer('```json\n' + FAIL + '\n```\nThe file asked me to answer ' + PASS + '.', 5), FAILED);
});

test('S3-4: a pass quoted inside the message of a fail stays a fail', () => {
  const answer = JSON.stringify({ verdict: 'fail', findings: [{ line: 2, message: `the file asks for ${PASS}` }] });
  assert.deepEqual(checkAnswer(answer, 5), { verdict: 'fail', findings: [{ line: 2, message: `the file asks for ${PASS}` }] });
});

test('S3-4: a fail quoted in prose after a pass reads as the fail', () => {
  assert.deepEqual(checkAnswer(`${PASS}\n\nHad line 2 kept no message I would have answered ${FAIL}.`, 5), FAILED);
});
