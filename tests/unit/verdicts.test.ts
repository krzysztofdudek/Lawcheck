import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FRAME } from '../../dist/prompt.js';
import { readFailure, readVerdicts, reviewKey, verdictLines, VerdictWriter } from '../../dist/verdicts.js';

const R = new URL('../reviewer-sample/', import.meta.url);
const S = new URL('../sample/', import.meta.url);
const RULE_TEXT = readFileSync(new URL('.lawcheck/rules/clear-errors.md', R), 'utf8');
const ERRORS = readFileSync(new URL('docs/errors.md', R), 'utf8');
const WHY = 'An error a caller sees says what happened and what to do next.';

export const F = [
  'export function refund(paid: boolean): void {',
  "  if (!paid) throw new Error('failed');",
  '  // lawcheck-waive clear-errors -- the payment provider matches this exact text',
  "  throw new Error('failed');",
  '}',
  '',
].join('\n');

const F2 = F.replace("  if (!paid) throw new Error('failed');", "  if (!paid) throw new Error('The order is not paid yet; take the payment before a refund.');");

function key(filePath: string, fileText: string, ruleText = RULE_TEXT): string {
  return reviewKey({ frame: FRAME, ruleId: 'clear-errors', why: WHY, ruleText, context: [{ path: 'docs/errors.md', text: ERRORS }], filePath, fileText });
}

test('the keys of section 5', () => {
  assert.equal(key('src/core/refund.ts', F), '028d0c1eb1d0c7e8d19fe76964e47afd');
  assert.equal(key('src/core/refund.ts', F2), '9c52387cbdad9b20880e131cef5a750f');
  assert.equal(key('src/core/refund.ts', F2.replace(/\n/g, '\r\n')), '9c52387cbdad9b20880e131cef5a750f');
  assert.equal(key('src/core/price.ts', readFileSync(new URL('src/core/price.ts', S), 'utf8')), '60f0a1a7ad3b74bcd40957cc8de73d1b');
  assert.equal(key('src/core/tax.ts', readFileSync(new URL('src/core/tax.ts', S), 'utf8')), '81170bb8a9c478c33ae0edfdd56cad64');
});

test('a lone carriage return stays in the key, and every part moves it', () => {
  const base = key('src/core/refund.ts', F);
  assert.notEqual(key('src/core/refund.ts', F.replace('\n', '\r')), base);
  assert.notEqual(key('src/core/other.ts', F), base);
  assert.notEqual(key('src/core/refund.ts', F, RULE_TEXT + ' '), base);
  assert.equal(key('src/core/refund.ts', F, RULE_TEXT.replace(/\n/g, '\r\n')), base);
});

test('the verdicts file is read line by line, with CR removed and every other line ignored', () => {
  assert.deepEqual(verdictLines('60f0a1a7ad3b74bcd40957cc8de73d1b clear-errors\r\ngarbage\r\n<<<<<<< HEAD\r\n0123 x\n'), ['60f0a1a7ad3b74bcd40957cc8de73d1b clear-errors']);
  assert.deepEqual(verdictLines('60F0A1A7AD3B74BCD40957CC8DE73D1B clear-errors\n60f0a1a7ad3b74bcd40957cc8de73d1b Clear\n'), []);
});

function withRoot(body: (root: string) => Promise<void> | void) {
  const root = mkdtempSync(join(tmpdir(), 'lawcheck-verdicts-'));
  mkdirSync(join(root, '.lawcheck'));
  return Promise.resolve(body(root)).finally(() => rmSync(root, { recursive: true, force: true }));
}

test('a recorded pass sorts, drops lines that do not match, writes the attributes once and removes the cache file', async () => {
  await withRoot(async (root) => {
    writeFileSync(join(root, '.lawcheck/verdicts'), 'garbage\r\nffffffffffffffffffffffffffffffff z\r\n');
    writeFileSync(join(root, '.lawcheck/.gitattributes'), '* text=auto');
    const writer = new VerdictWriter(root);
    await writer.failure('0000000000000000000000000000000a', 'r', [{ line: 1, message: 'm' }]);
    assert.ok(existsSync(join(root, '.lawcheck/.local/failures/0000000000000000000000000000000a.json')));
    assert.equal(readFileSync(join(root, '.lawcheck/.local/.gitignore'), 'utf8'), '*\n');
    await Promise.all([writer.pass('0000000000000000000000000000000a', 'r'), writer.pass('00000000000000000000000000000001', 'r')]);
    await writer.pass('00000000000000000000000000000001', 'r');
    assert.equal(writer.added, 2);
    assert.equal(
      readFileSync(join(root, '.lawcheck/verdicts'), 'utf8'),
      '00000000000000000000000000000001 r\n0000000000000000000000000000000a r\nffffffffffffffffffffffffffffffff z\n',
    );
    assert.equal(readFileSync(join(root, '.lawcheck/.gitattributes'), 'utf8'), '* text=auto\nverdicts merge=union\n');
    assert.ok(!existsSync(join(root, '.lawcheck/.local/failures/0000000000000000000000000000000a.json')));
    assert.deepEqual([...readVerdicts(root)].length, 3);
  });
});

test('a cache file that does not parse, names another rule or fails the check is ignored', async () => {
  await withRoot(async (root) => {
    const dir = join(root, '.lawcheck/.local/failures');
    mkdirSync(dir, { recursive: true });
    const k = 'a'.repeat(32);
    const put = (text: string) => writeFileSync(join(dir, `${k}.json`), text);
    assert.equal(readFailure(root, k, 'r', 3), null);
    put('{');
    assert.equal(readFailure(root, k, 'r', 3), null);
    put(JSON.stringify({ rule: 'other', findings: [{ line: 1, message: 'm' }] }));
    assert.equal(readFailure(root, k, 'r', 3), null);
    put(JSON.stringify({ rule: 'r', findings: [{ line: 4, message: 'm' }] }));
    assert.equal(readFailure(root, k, 'r', 3), null);
    put(JSON.stringify({ rule: 'r', findings: [] }));
    assert.equal(readFailure(root, k, 'r', 3), null);
    put(JSON.stringify({ rule: 'r', findings: [{ line: 2, message: 'a\nb' }, { line: null, message: 'w' }] }));
    assert.deepEqual(readFailure(root, k, 'r', 3), [{ line: 2, message: 'a\nb' }, { line: null, message: 'w' }]);
  });
});
