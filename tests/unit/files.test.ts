import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePaths, splitZ } from '../../dist/files.js';

test('S1-2: a path with an invalid UTF-8 byte is kept, the byte written as \\x and two digits', () => {
  const output = Buffer.concat([
    Buffer.from('src/a.ts\0', 'utf8'),
    Buffer.from([0x73, 0x72, 0x63, 0x2f, 0xff, 0x2e, 0x74, 0x73, 0x00]),
    Buffer.from('src/żółw.ts\0src/with space\t.ts\0', 'utf8'),
    Buffer.from([0x61, 0xc3, 0x00, 0x62, 0xed, 0xa0, 0x80, 0x00, 0x63, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x00]),
  ]);
  assert.deepEqual(splitZ(output), ['src/a.ts', 'src/\\xff.ts', 'src/żółw.ts', 'src/with space\t.ts', 'a\\xc3', 'b\\xed\\xa0\\x80', 'c€\\xf0\\x9f']);
});

test('check-slice §4: empty output holds no path', () => {
  assert.deepEqual(splitZ(Buffer.alloc(0)), []);
});

test('check-slice §4: paths compare by UTF-16 code units', () => {
  assert.deepEqual(['b', 'B', 'a', 'ż', 'z'].sort(comparePaths), ['B', 'a', 'b', 'z', 'ż']);
});

test('S1-2: a path that holds a line break, a carriage return or a backslash is kept, each written as an escape', () => {
  assert.deepEqual(splitZ(Buffer.from('src/a\nb.ts\0src/c\rd.ts\0src/e.ts\0src/f\\g.ts\0src/h\\nb.ts\0', 'utf8')), ['src/a\\nb.ts', 'src/c\\rd.ts', 'src/e.ts', 'src/f\\\\g.ts', 'src/h\\\\nb.ts']);
});
