import { test } from 'node:test';
import { generateKeyPairSync, verify } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { example } from '../harness/examples.ts';
import { countPasses, readFailure, readPasses, readVerdicts, reviewKey, SIGNED_PASS, signingKey, verdictLines, VerdictWriter } from '../../dist/verdicts.js';

const FRAME = example('reviewer-frame');

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

function key(filePath: string, fileText: string, waived: number[] = [], ruleText = RULE_TEXT): string {
  return reviewKey({ frame: FRAME, ruleId: 'clear-errors', why: WHY, ruleText, context: [{ path: 'docs/errors.md', text: ERRORS }], filePath, fileText, waived });
}

test('reviewer-slice §5: the keys of section 5', () => {
  assert.equal(key('src/core/refund.ts', F, [4]), 'bec7eb69fcc74507cad562d7d51f13eb');
  assert.equal(key('src/core/refund.ts', F2, [4]), '416ae89429881606bc1ead8e5e1f0e8b');
  assert.equal(key('src/core/refund.ts', F2.replace(/\n/g, '\r\n'), [4]), '416ae89429881606bc1ead8e5e1f0e8b');
  assert.equal(key('src/core/price.ts', readFileSync(new URL('src/core/price.ts', S), 'utf8')), '04359891722bcd49bac46a26fbb25f2a');
  assert.equal(key('src/core/tax.ts', readFileSync(new URL('src/core/tax.ts', S), 'utf8')), '3a171a910b49c962ed47f9b9795cfc97');
});

test('R-97: the key holds the waived lines wherever the file\'s own waivers of the rule do not fix them, as section 5 gives for a type with waivers: false', () => {
  assert.equal(key('src/core/refund.ts', F, []), '6f51331b77067b387d491f4c17650a20');
  assert.equal(key('src/core/refund.ts', F2, []), '83bb2e0c70b1c1e605fe3098479d4acc');
  assert.equal(key('src/core/refund.ts', F2.replace(/\n/g, '\r\n'), []), '83bb2e0c70b1c1e605fe3098479d4acc');
  assert.notEqual(key('src/core/refund.ts', F, [2]), key('src/core/refund.ts', F, []));
  assert.notEqual(key('src/core/refund.ts', F, [2]), key('src/core/refund.ts', F, [4]));
});

test('reviewer-slice §5: a lone carriage return stays in the key, and every part moves it', () => {
  const base = key('src/core/refund.ts', F, [4]);
  assert.notEqual(key('src/core/refund.ts', F.replace('\n', '\r'), [4]), base);
  assert.notEqual(key('src/core/other.ts', F, [4]), base);
  assert.notEqual(key('src/core/refund.ts', F, [4], RULE_TEXT + ' '), base);
  assert.equal(key('src/core/refund.ts', F, [4], RULE_TEXT.replace(/\n/g, '\r\n')), base);
});

test('reviewer-slice §5: the verdicts file is read line by line, with CR removed and every other line ignored', () => {
  assert.deepEqual(verdictLines('04359891722bcd49bac46a26fbb25f2a clear-errors\r\ngarbage\r\n<<<<<<< HEAD\r\n0123 x\n'), ['04359891722bcd49bac46a26fbb25f2a clear-errors']);
  assert.deepEqual(verdictLines('04359891722BCD49BAC46A26FBB25F2A clear-errors\n04359891722bcd49bac46a26fbb25f2a Clear\n'), []);
});

function withRoot(body: (root: string) => Promise<void> | void) {
  const root = mkdtempSync(join(tmpdir(), 'lawcheck-verdicts-'));
  mkdirSync(join(root, '.lawcheck'));
  return Promise.resolve(body(root)).finally(() => rmSync(root, { recursive: true, force: true }));
}

test('reviewer-slice §5: a recorded pass sorts, drops lines that do not match, writes the attributes once and removes the cache file', async () => {
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

test('reviewer-slice §5: a cache file that does not parse, names another rule or fails the check is ignored', async () => {
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

test('R-38: a signed pass is the pair, the signer and the signature of the pair by the key whose 32 bytes are the JWK d of an Ed25519 key, and it counts only under that signer', async () => {
  await withRoot(async (root) => {
    const alice = generateKeyPairSync('ed25519');
    const d = alice.privateKey.export({ format: 'jwk' }).d!;
    const x = alice.publicKey.export({ format: 'jwk' }).x!;
    const own = signingKey(d)!;
    assert.equal(own.publicKey, x);
    for (const text of ['', `${d}A`, `${d.slice(0, 42)}B`, Buffer.from(d, 'base64url').toString('base64')]) assert.equal(signingKey(text), null, text);
    writeFileSync(join(root, '.lawcheck/verdicts'), 'ffffffffffffffffffffffffffffffff z\n');
    const writer = new VerdictWriter(root, { name: 'alice', key: own.key });
    writer.ready(['r']);
    await writer.pass('00000000000000000000000000000001', 'r');
    assert.equal(writer.added, 1);
    const lines = readFileSync(join(root, '.lawcheck/verdicts'), 'utf8').split('\n');
    assert.equal(lines.length, 3);
    const [hash, rule, name, signature] = lines[0]!.split(' ');
    assert.deepEqual([hash, rule, name], ['00000000000000000000000000000001', 'r', 'alice']);
    assert.ok(verify(null, Buffer.from(`${SIGNED_PASS} ${hash} ${rule}`), alice.publicKey, Buffer.from(signature!, 'base64url')));
    assert.deepEqual(verdictLines(`${lines[0]}\r\n${lines[0]!.slice(0, -1)}\n${lines[0]} x\n`), [lines[0]]);
    const pair = '00000000000000000000000000000001 r';
    assert.ok(readPasses(root, null).has(pair));
    assert.ok(readPasses(root, new Map([['alice', x]])).has(pair));
    assert.ok(!readPasses(root, new Map([['bob', x]])).has(pair));
    assert.ok(readPasses(root, new Map([['bob', x]])).uncounted(pair));
    assert.ok(!readPasses(root, new Map([['alice', x]])).uncounted('00000000000000000000000000000002 r'));
    assert.ok(!readPasses(root, new Map([['alice', x]])).has('ffffffffffffffffffffffffffffffff z'));
    assert.ok(readPasses(root, null).has('ffffffffffffffffffffffffffffffff z'));
    assert.deepEqual(countPasses(root, new Set([pair])), { held: 2, needed: 1 });
  });
});
