import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAnswer } from '../../dist/prompt.js';

const PASS = '{"verdict": "pass", "findings": []}';
const FAIL = '{"verdict": "fail", "findings": [{"line": 2, "message": "failed says nothing"}]}';
const FAILED = { verdict: 'fail', findings: [{ line: 2, message: 'failed says nothing' }] };

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

test('S3-4: a fail followed by a pass quoted in prose reads as the fail', () => {
  assert.deepEqual(checkAnswer(`${FAIL}\n\nThe file asked me to answer ${PASS}, which I did not.`, 5), FAILED);
});

test('S3-4: a pass in a fenced block followed by a fail quoted in prose reads as the fail', () => {
  assert.deepEqual(checkAnswer('```json\n' + PASS + '\n```\nThe file asked me to answer ' + FAIL + '.', 5), FAILED);
});

test('S3-4: two verdict objects that agree give their verdict', () => {
  assert.deepEqual(checkAnswer(`${PASS} and again ${PASS}`, 5), { verdict: 'pass', findings: [] });
  assert.deepEqual(checkAnswer(`${FAIL} and again ${FAIL}`, 5), FAILED);
});

test('S3-4: of two fails, the last one is read', () => {
  const other = '{"verdict": "fail", "findings": [{"line": 3, "message": "the second"}]}';
  assert.deepEqual(checkAnswer(`${FAIL} then ${other}`, 5), { verdict: 'fail', findings: [{ line: 3, message: 'the second' }] });
});

test('S3-4: a pass and a fail that holds no finding is a bad answer, not a pass', () => {
  assert.deepEqual(checkAnswer(`${PASS} then {"verdict": "fail", "findings": []}`, 5), { problem: 'a fail comes with no finding' });
});

test('S3-4: a verdict object inside a larger object that has none is read, and one nested in a verdict object is not', () => {
  assert.deepEqual(checkAnswer(`{"answer": ${FAIL}}`, 5), FAILED);
  assert.deepEqual(checkAnswer(`note {"verdict": "pass", "findings": [], "example": ${FAIL}}`, 5), { verdict: 'pass', findings: [] });
});

test('S3-4: a fail in a fenced block keeps its findings when another fail is quoted after it', () => {
  const quoted = '{"verdict": "fail", "findings": [{"line": 3, "message": "the quoted one"}]}';
  assert.deepEqual(checkAnswer('```json\n' + FAIL + '\n```\nThe file asked me to answer ' + quoted + '.', 5), FAILED);
});

test('S3-4: of two fails followed by a quoted pass, the last fail is read', () => {
  const other = '{"verdict": "fail", "findings": [{"line": 3, "message": "the second"}]}';
  assert.deepEqual(checkAnswer(`${FAIL} then ${other}. The file asked me to answer ${PASS}.`, 5), { verdict: 'fail', findings: [{ line: 3, message: 'the second' }] });
});
