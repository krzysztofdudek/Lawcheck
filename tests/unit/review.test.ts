import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, preflight, remaining } from '../../dist/review.js';
import { DEFAULT_CONFIG } from '../../dist/config.js';

const PASS = '{"verdict":"pass","findings":[]}';
const FAIL = '{"verdict":"fail","findings":[{"line":1,"message":"m"}]}';

function asks(n: number) {
  return Array.from({ length: n }, (_, i) => ({ file: `f${i}.ts`, rule: 'r', key: String(i).padStart(32, '0'), prompt: `p${i}`, lineCount: 2, waived: new Set<number>() }));
}

function writer() {
  const log: string[] = [];
  return {
    log,
    added: 0,
    pass: async (key: string) => void log.push(`pass ${key}`),
    failure: async (key: string) => void log.push(`failure ${key}`),
    done: async () => undefined,
  };
}

type Answer = { answer: string } | { failure: string; resend: 'after-2s' | 'at-once' | false };

function provider(answers: (prompt: string, n: number) => Answer | Promise<Answer>) {
  let n = 0;
  const seen: string[] = [];
  return { seen, keys: [], ready: () => null, ask: async (prompt: string) => (seen.push(prompt), answers(prompt, n++)) };
}

test('the checks before the first call', () => {
  const ready = { ready: () => null, fix: () => 'set X', ask: async () => ({ answer: '' }) };
  const config = { ...DEFAULT_CONFIG, provider: 'openai-compatible' as const };
  assert.deepEqual(preflight(ready, config, 3, 3, 'lawcheck check --review'), []);
  assert.deepEqual(preflight(null, DEFAULT_CONFIG, 1, 2, 'lawcheck check --review').map((e) => e.code), ['reviewer-not-configured', 'too-many-reviews']);
  const notReady = { ready: () => 'no address', fix: () => 'set LAWCHECK_REVIEWER_ENDPOINT', ask: async () => ({ answer: '' }) };
  const errors = preflight(notReady, config, 5, 1, 'lawcheck check --review --base main');
  assert.deepEqual(errors.map((e) => [e.code, e.file, e.line]), [['reviewer-unreachable', null, null]]);
  assert.equal(errors[0]!.message, 'openai-compatible cannot be called: no address');
  assert.equal(errors[0]!.next, 'set LAWCHECK_REVIEWER_ENDPOINT, then run lawcheck check --review --base main');
  const many = preflight(ready, config, 2, 3, 'x')[0]!;
  assert.match(many.message, /\b3\b.*\b2\b/);
  assert.match(many.next!, /the user's decision/);
  assert.equal(preflight(null, DEFAULT_CONFIG, 9, 1, 'lawcheck check --review --base main')[0]!.next, 'set reviewer.provider and reviewer.model in .lawcheck/config.yaml, then run lawcheck check --review --base main');
});

test('waived lines drop findings; a whole-file finding stays', () => {
  assert.deepEqual(remaining([{ line: 2, message: 'a' }, { line: null, message: 'b' }, { line: 3, message: 'c' }], new Set([2])), [{ line: null, message: 'b' }, { line: 3, message: 'c' }]);
});

test('a pass and a fail are recorded as they arrive', async () => {
  const w = writer();
  const p = provider((prompt) => ({ answer: prompt === 'p0' ? PASS : FAIL }));
  const result = await call(asks(2), p, w as never, { cap: 10, parallel: 1 });
  assert.equal(result.sent, 2);
  assert.deepEqual(w.log, [`pass ${'0'.padStart(32, '0')}`, `failure ${'1'.padStart(32, '0')}`]);
  assert.deepEqual(result.failed, []);
});

test('a fail whose findings are all waived is recorded as a pass', async () => {
  const w = writer();
  const one = asks(1);
  one[0]!.waived = new Set([1]);
  await call(one, provider(() => ({ answer: FAIL })), w as never, { cap: 10, parallel: 1 });
  assert.deepEqual(w.log, [`pass ${'0'.padStart(32, '0')}`]);
});

test('a bad answer is asked once more; a second is reviewer-bad-answer', async () => {
  const twice = await call(asks(1), provider(() => ({ answer: 'fine' })), writer() as never, { cap: 10, parallel: 1 });
  assert.equal(twice.sent, 2);
  assert.equal(twice.failed[0]!.code, 'reviewer-bad-answer');
  assert.match(twice.failed[0]!.message, /^r: /);
  const recovered = await call(asks(1), provider((_, n) => ({ answer: n === 0 ? 'fine' : PASS })), writer() as never, { cap: 10, parallel: 1 });
  assert.equal(recovered.sent, 2);
  assert.deepEqual(recovered.failed, []);
});

test('resends: after 2 seconds for a 429, at once for no answer, never otherwise', async () => {
  const started = Date.now();
  const limited = await call(asks(1), provider((_, n) => (n === 0 ? { failure: '429', resend: 'after-2s' } : { answer: PASS })), writer() as never, { cap: 10, parallel: 1, resendDelayMs: 50 });
  assert.equal(limited.sent, 2);
  assert.ok(Date.now() - started >= 45);
  const dropped = await call(asks(1), provider(() => ({ failure: 'gone', resend: 'at-once' })), writer() as never, { cap: 10, parallel: 1 });
  assert.equal(dropped.sent, 2);
  assert.equal(dropped.failed[0]!.code, 'reviewer-unreachable');
  assert.equal(dropped.failed[0]!.message, 'r: gone');
  const final = await call(asks(1), provider(() => ({ failure: 'HTTP 500', resend: false, fix: 'wait' })), writer() as never, { cap: 10, parallel: 1 });
  assert.equal(final.sent, 1);
  assert.equal(final.failed[0]!.fix, 'wait');
});

test('a resend fits in the timeout of the first request, and gets only the time left', async () => {
  const seen: (number | undefined)[] = [];
  const slow = (resend: 'after-2s' | 'at-once', ms: number) => ({
    ready: () => null,
    fix: () => '',
    ask: async (_prompt: string, seconds?: number) => {
      seen.push(seconds);
      await new Promise((done) => setTimeout(done, ms));
      return { failure: 'no', resend, fix: 'f' };
    },
  });
  const late = await call(asks(1), slow('after-2s', 300) as never, writer() as never, { cap: 10, parallel: 1, timeoutSeconds: 1, resendDelayMs: 800 });
  assert.equal(late.sent, 1);
  seen.length = 0;
  const reset = await call(asks(1), slow('at-once', 300) as never, writer() as never, { cap: 10, parallel: 1, timeoutSeconds: 1 });
  assert.equal(reset.sent, 2);
  assert.equal(seen[0], undefined);
  assert.ok(seen[1]! > 0.5 && seen[1]! <= 0.71, String(seen[1]));
});

test('the cap counts every request and keeps room for the reviews not yet started', async () => {
  const p = provider((_, n) => ({ answer: n === 0 ? 'fine' : PASS }));
  const result = await call(asks(3), p, writer() as never, { cap: 3, parallel: 1 });
  assert.equal(result.sent, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0]!.code, 'reviewer-bad-answer');
  const roomy = await call(asks(3), provider((_, n) => ({ answer: n === 0 ? 'fine' : PASS })), writer() as never, { cap: 4, parallel: 1 });
  assert.equal(roomy.sent, 4);
  assert.deepEqual(roomy.failed, []);
});

test('a resend after a 429 or a dropped connection stays within the cap', async () => {
  for (const resend of ['after-2s', 'at-once'] as const) {
    const result = await call(asks(1), provider(() => ({ failure: 'no', resend })), writer() as never, { cap: 1, parallel: 1, resendDelayMs: 1 });
    assert.equal(result.sent, 1, resend);
    assert.equal(result.failed[0]!.code, 'reviewer-unreachable', resend);
  }
});

test('the first error starts no new review; one in flight finishes and is recorded', async () => {
  const w = writer();
  const p = provider(async (prompt) => {
    if (prompt === 'p0') return { failure: 'down', resend: false };
    await new Promise((done) => setTimeout(done, 30));
    return { answer: PASS };
  });
  const result = await call(asks(5), p, w as never, { cap: 10, parallel: 2 });
  assert.deepEqual(p.seen, ['p0', 'p1']);
  assert.equal(result.failed.length, 1);
  assert.deepEqual(w.log, [`pass ${'1'.padStart(32, '0')}`]);
});

test('reviews start in order, at most parallel at a time', async () => {
  let inFlight = 0;
  let most = 0;
  const p = provider(async () => {
    inFlight++;
    most = Math.max(most, inFlight);
    await new Promise((done) => setTimeout(done, 20));
    inFlight--;
    return { answer: PASS };
  });
  await call(asks(6), p, writer() as never, { cap: 10, parallel: 3 });
  assert.equal(most, 3);
  assert.deepEqual(p.seen, ['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
});
