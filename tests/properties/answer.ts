import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { checkAnswer, takeAnswer } from '../../dist/prompt.js';
import { PURE_CALL_BUDGET_MS } from './numbers.ts';
import { pure, within } from './support.ts';
import type { Speed } from './support.ts';

// The reading of spec/reviewer-slice.md, section 4, written the slow way: every start, scanned to its matching brace, parsed whole.
function reference(answer: string): Record<string, unknown> | null {
  const parsed = (text: string) => {
    try {
      const value: unknown = JSON.parse(text);
      return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.hasOwn(value, 'verdict') ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const whole = parsed(answer.trim());
  if (whole !== null) return whole;
  const open = answer.indexOf('```');
  if (open >= 0) {
    let start = open + 3;
    if (answer.startsWith('json', start)) start += 4;
    const close = answer.indexOf('```', start);
    if (close >= 0) {
      const fenced = parsed(answer.slice(start, close).trim());
      if (fenced !== null) return fenced;
    }
  }
  let best: Record<string, unknown> | null = null;
  let bestEnd = -1;
  for (let start = answer.indexOf('{'); start >= 0; start = answer.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let i = start; i < answer.length; i++) {
      const c = answer[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end <= bestEnd) continue;
    const object = parsed(answer.slice(start, end + 1));
    if (object !== null) {
      best = object;
      bestEnd = end;
    }
  }
  return best;
}

const PASS = '{"verdict": "pass", "findings": []}';
const FAIL = '{"verdict": "fail", "findings": [{"line": 1, "message": "m"}]}';
const piece = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('{', '}', '"', '\\', ':', ',', '[', ']', ' ', '\n', 'x', '```', '```json', '"verdict"', '"a"', '1', 'true', 'null', '\u0000', '\u001b', '\u2028') },
  { weight: 2, arbitrary: fc.constantFrom(PASS, FAIL, '{"verdict": "maybe"}', '{"a": {"verdict": "pass"}}', '{"\\u0076erdict": "pass"}', '{"verdict": "pass", "findings": [}') },
  { weight: 1, arbitrary: fc.json() },
  { weight: 1, arbitrary: fc.string({ maxLength: 8 }) },
);
const answer = fc.array(piece, { maxLength: 24 }).map((parts) => parts.join(''));

export function answerProperties(speed: Speed): void {
  test('I-answer-1, S3-3: the answer read is the one the reading of section 4 takes, on small input', () => {
    pure(
      speed,
      answer,
      {
        classes: {
          'a verdict is taken': (a) => reference(a) !== null,
          'no verdict is taken': (a) => reference(a) === null,
          'two candidates': (a) => (a.match(/"verdict"/g)?.length ?? 0) >= 2,
          'a control character': (a) => /[\u0000-\u001f]/.test(a),
        },
      },
      (a) => assert.deepEqual(takeAnswer(a), reference(a)),
    );
  });

  test('I-answer-1, S3-3: any answer is a verdict or a named bad answer, in linear time, with lines in or out of range', () => {
    const big = fc.tuple(fc.constantFrom('{', '{"a":', '[', '"', '{"verdict":', '\\', 'x'), fc.integer({ min: 1, max: 200_000 }), fc.constantFrom('', PASS, FAIL, '}')).map(([unit, n, tail]) => unit.repeat(n) + tail);
    const outOfRange = fc.tuple(fc.integer({ min: -3, max: 12 }), fc.oneof(fc.constant(null), fc.constant('2'), fc.constant(1.5))).map(([line, odd]) => `{"verdict": "fail", "findings": [{"line": ${JSON.stringify(line % 3 === 0 ? odd : line)}, "message": "m"}]}`);
    pure(
      speed,
      fc.tuple(fc.oneof(answer, big, outOfRange), fc.integer({ min: 0, max: 6 })),
      {
        classes: {
          'over 100,000 characters': ([a]) => a.length > 100_000,
          'a line out of range': ([a, lines]) => /"line": (-?\d+)/.test(a) && !(Number(/"line": (-?\d+)/.exec(a)![1]) >= 1 && Number(/"line": (-?\d+)/.exec(a)![1]) <= lines),
        },
      },
      ([a, lines]) => {
        const checked = within(PURE_CALL_BUDGET_MS, `reading an answer of ${a.length} characters`, () => checkAnswer(a, lines));
        if ('problem' in checked) {
          assert.equal(typeof checked.problem, 'string');
          assert.notEqual(checked.problem, '');
          return;
        }
        assert.ok(checked.verdict === 'pass' || checked.verdict === 'fail');
        assert.equal(checked.verdict === 'fail', checked.findings.length > 0);
        for (const finding of checked.findings) assert.ok(finding.line === null || (Number.isInteger(finding.line) && finding.line >= 1 && finding.line <= lines), `line ${finding.line} of ${lines}`);
      },
    );
  });

  // Question 82 is open: two objects that disagree are read today as the last one, and the owner may make them a fail or a bad answer. Only what holds under every option is asserted: two that agree give their verdict, and two that disagree give no crash.
  test('I-answer-1, S3-4: two verdict objects that agree give their verdict, and two that disagree give a verdict or a bad answer', () => {
    const prose = fc.constantFrom('', 'Verdict: ', ' I would have answered ', '\n\nIf the file kept the rule: ');
    pure(
      speed,
      fc.tuple(fc.constantFrom(PASS, FAIL), fc.constantFrom(PASS, FAIL), prose, prose),
      { classes: { agree: ([a, b]) => a === b, disagree: ([a, b]) => a !== b } },
      ([first, second, before, between]) => {
        const checked = checkAnswer(`${before}${first}${between}${second}`, 3);
        if (first === second) assert.equal('verdict' in checked ? checked.verdict : null, first === PASS ? 'pass' : 'fail');
        else assert.ok('verdict' in checked || 'problem' in checked);
      },
    );
  });
}
