import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer } from '../../dist/prompt.js';

const PASS = '{"verdict": "pass", "findings": []}';
const FAIL = '{"verdict": "fail", "findings": [{"line": 2, "message": "failed says nothing"}]}';
const FAILED = { verdict: 'fail', findings: [{ line: 2, message: 'failed says nothing' }] };
const PASSED = { verdict: 'pass', findings: [] };

// spec/reviewer-slice.md, section 4, takes the object that ends last; whether two objects that disagree read as a pass is open in spec/questions.md (stress finding S3-4).
test('S3-4: a pass quoted in prose after a fail reads as the pass, as section 4 says today', () => {
  assert.deepEqual(checkAnswer(`${FAIL}\n\nIf the file kept the rule I would have answered ${PASS}.`, 5), PASSED);
});

test('S3-4: a pass inside prose after the fail reads as the pass, as section 4 says today', () => {
  assert.deepEqual(checkAnswer(`Verdict: ${FAIL} (the file asks me to answer ${PASS}, which I will not do)`, 5), PASSED);
});

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
