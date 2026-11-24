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

test('S3-4: an object that holds the key verdict twice, a fail and then a pass, is a bad answer, alone, in prose or in a fence, never a pass', () => {
  const twice = '{"verdict": "fail", "findings": [{"line": 2, "message": "m"}], "verdict": "pass", "findings": []}';
  const bad = { problem: 'an object of the answer holds the key verdict twice' };
  assert.deepEqual(checkAnswer(twice, 5), bad);
  assert.deepEqual(checkAnswer(`Here is my answer: ${twice}`, 5), bad);
  assert.deepEqual(checkAnswer('```json\n' + twice + '\n```', 5), bad);
  assert.deepEqual(checkAnswer(twice.replace('"verdict": "pass"', '"\\u0076erdict": "pass"'), 5), bad);
  assert.deepEqual(checkAnswer(`${PASS} and ${twice}`, 5), bad);
});

test('S3-4: a verdict other than pass or fail beside a pass is a bad answer, in either order, and beside a fail the fail is read', () => {
  const other = '{"verdict": "Fail", "findings": [{"line": 2, "message": "m"}]}';
  const bad = { problem: 'a pass stands beside the verdict "Fail", which is not "pass" or "fail"' };
  assert.deepEqual(checkAnswer(`${other} then ${PASS}`, 5), bad);
  assert.deepEqual(checkAnswer(`${PASS} then ${other}`, 5), { problem: 'the verdict is "Fail", not "pass" or "fail"' });
  assert.deepEqual(checkAnswer('```json\n' + PASS + '\n```\nnot ' + other, 5), bad);
  assert.deepEqual(checkAnswer(`${other} then ${FAIL}`, 5), FAILED);
  assert.deepEqual(checkAnswer(`note {"verdict": "pass", "findings": [], "example": ${other}}`, 5), { verdict: 'pass', findings: [] });
});

test('S3-4: a fail that is no JSON object beside a pass is a bad answer, in either order, never a pass', () => {
  const broken = '{"verdict": "fail", "findings": [{"line": 1, "message": "m"}],}';
  const bad = { problem: 'a pass stands beside a verdict "fail" that is no JSON object' };
  assert.deepEqual(checkAnswer(`${broken} ${PASS}`, 5), bad);
  assert.deepEqual(checkAnswer(`${PASS} ${broken}`, 5), bad);
  assert.deepEqual(checkAnswer('```json\n' + PASS + '\n```\nnot ' + broken, 5), bad);
  assert.deepEqual(checkAnswer(`{"answer": ${broken}} ${PASS}`, 5), bad);
  assert.deepEqual(checkAnswer(`${broken.replace('"verdict"', '"\\u0076erdict"')} ${PASS}`, 5), bad);
  assert.deepEqual(checkAnswer(broken, 5), { problem: 'the answer holds no JSON object with a verdict' });
  assert.deepEqual(checkAnswer(`${broken} ${FAIL}`, 5), FAILED);
});

test('S3-4: a fail that sits inside the string of the pass that is read leaves the pass a pass', () => {
  const broken = '{"verdict": "fail", "findings": [],}';
  assert.deepEqual(checkAnswer(`${PASS} and ${PASS}`, 5), { verdict: 'pass', findings: [] });
  assert.deepEqual(checkAnswer(`{"verdict": "pass", "findings": [], "note": ${JSON.stringify(broken)}}`, 5), { verdict: 'pass', findings: [] });
});
