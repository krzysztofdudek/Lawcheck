import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePaths, splitZ } from '../../dist/files.js';

test('a path with an invalid UTF-8 byte is left out', () => {
  const output = Buffer.concat([
    Buffer.from('src/a.ts\0', 'utf8'),
    Buffer.from([0x73, 0x72, 0x63, 0x2f, 0xff, 0x2e, 0x74, 0x73, 0x00]),
    Buffer.from('src/żółw.ts\0src/with space\t.ts\0', 'utf8'),
  ]);
  assert.deepEqual(splitZ(output), ['src/a.ts', 'src/żółw.ts', 'src/with space\t.ts']);
});

test('empty output holds no path', () => {
  assert.deepEqual(splitZ(Buffer.alloc(0)), []);
});

test('paths compare by UTF-16 code units', () => {
  assert.deepEqual(['b', 'B', 'a', 'ż', 'z'].sort(comparePaths), ['B', 'a', 'b', 'z', 'ż']);
});
