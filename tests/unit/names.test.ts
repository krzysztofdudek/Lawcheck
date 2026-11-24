import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesOfName, cannotExist, nameOf, quotedLine } from '../../dist/names.js';

const cases: [string, number[], string][] = [
  ['an overlong two-byte form of NUL', [0x61, 0xc0, 0x80], 'a\\xc0\\x80'],
  ['an overlong two-byte form of a slash', [0xc1, 0xaf], '\\xc1\\xaf'],
  ['an overlong three-byte form', [0xe0, 0x80, 0xaf], '\\xe0\\x80\\xaf'],
  ['an overlong four-byte form', [0xf0, 0x80, 0x80, 0xaf], '\\xf0\\x80\\x80\\xaf'],
  ['a surrogate half', [0xed, 0xa0, 0x80], '\\xed\\xa0\\x80'],
  ['a code point past U+10FFFF', [0xf4, 0x90, 0x80, 0x80], '\\xf4\\x90\\x80\\x80'],
  ['a lead byte F5', [0xf5, 0x80], '\\xf5\\x80'],
  ['a truncated sequence before ASCII', [0xe2, 0x82, 0x61], '\\xe2\\x82a'],
  ['a lone continuation byte', [0x80], '\\x80'],
  ['valid two, three and four-byte forms', [0xc5, 0xbc, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80], 'ż€😀'],
  ['a backslash, a line feed and a carriage return', [0x5c, 0x0a, 0x0d], '\\\\\\n\\r'],
];

for (const [what, bytes, name] of cases) {
  test(`S1-2: ${what} is written as section 2 says, and maps back`, () => {
    assert.equal(nameOf(Buffer.from(bytes)), name);
    assert.deepEqual([...bytesOfName(name)], bytes);
  });
}

test('S1-14: a path for --stdin-paths is C-quoted from the top of the work tree, whatever bytes it holds', () => {
  assert.equal(quotedLine('pkg/', Buffer.from('src/"q.ts')).toString('latin1'), '"pkg/src/\\"q.ts"\n');
  assert.equal(quotedLine('', Buffer.from([0x61, 0x0a, 0x0d, 0x5c, 0xff, 0x09])).toString('latin1'), '"a\\012\\015\\\\\\377\\011"\n');
});

test('R-93: a name counts in bytes on Linux and macOS and in UTF-16 units on Windows, so 86 CJK characters exist on Windows only, and 85 exist everywhere', () => {
  const cjk = (n: number) => `src/${'\u4e2d'.repeat(n)}`;
  for (const platform of ['linux', 'darwin', 'win32'] as const) {
    assert.equal(cannotExist('/r', cjk(85), platform), false, platform);
    assert.equal(cannotExist('/r', `src/${'a'.repeat(255)}`, platform), false, platform);
    assert.equal(cannotExist('/r', `src/${'a'.repeat(256)}`, platform), true, platform);
  }
  assert.equal(cannotExist('/r', cjk(86), 'linux'), true);
  assert.equal(cannotExist('/r', cjk(86), 'darwin'), true);
  assert.equal(cannotExist('/r', cjk(86), 'win32'), false);
  assert.equal(cannotExist('/r', `src/${'\u{1f600}'.repeat(128)}`, 'win32'), true, 'an emoji is two UTF-16 units');
});

test('R-93: a path counts in bytes up to 4,095 on Linux and macOS, and in UTF-16 units up to 32,767 on Windows', () => {
  const deep = (n: number) => `${'d/'.repeat(n)}f`;
  assert.equal(cannotExist('/r', deep(2200), 'linux'), true);
  assert.equal(cannotExist('/r', deep(2200), 'win32'), false);
  assert.equal(cannotExist('/r', deep(17000), 'win32'), true);
});
