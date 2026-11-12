import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLaw } from '../../dist/law.js';
import { decode, filesOfTypes, isBinary, splitLines, typeFiles } from '../../dist/types.js';

const SAMPLE = readFileSync(new URL('../sample/.lawcheck/law.yaml', import.meta.url), 'utf8');

test('lines split at \\n and \\r\\n; a lone \\r stays; a final line end adds nothing', () => {
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('\n'), ['']);
  assert.deepEqual(splitLines('ab\r\ncd\r\n'), ['ab', 'cd']);
  assert.deepEqual(splitLines('a\rb\nc'), ['a\rb', 'c']);
  assert.deepEqual(splitLines('a\n\n'), ['a', '']);
});

test('text drops a byte-order mark and replaces invalid bytes', () => {
  assert.equal(decode(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), 'a');
  assert.equal(decode(Buffer.from([0x61, 0xff])), 'a\ufffd');
});

test('a NUL byte in the first 8,000 bytes makes a file binary', () => {
  assert.equal(isBinary(Buffer.from('a\0b')), true);
  assert.equal(isBinary(Buffer.concat([Buffer.alloc(8000, 0x61), Buffer.from([0])])), false);
});

test('each file gets its deepest type, and the rules on the way down', () => {
  const { law } = parseLaw(SAMPLE);
  const texts: Record<string, string> = {
    'src/core/a.ts': 'x\n',
    'src/cli/b.ts': 'x\n',
    'src/c.ts': 'x\n',
    'src/d.d.ts': 'x\n',
    'tools/e.mjs': '#!/usr/bin/env node\n',
    'tools/f.mjs': 'no shebang\n',
    'README.md': '# Sample\n',
  };
  const read: string[] = [];
  const { typed, unreadable, overlaps } = typeFiles('/nowhere', Object.keys(texts).sort(), law!, (path) => {
    read.push(path);
    return Buffer.from(texts[path]!);
  });
  assert.deepEqual(unreadable, []);
  assert.deepEqual(overlaps, []);
  assert.deepEqual(
    typed.map((f) => [f.path, f.type.id, f.rules]),
    [
      ['src/c.ts', 'source', ['no-todo']],
      ['src/cli/b.ts', 'command', ['no-todo']],
      ['src/core/a.ts', 'library', ['no-todo', 'no-console']],
      ['tools/e.mjs', 'script', ['no-todo']],
    ],
  );
  assert.ok(!read.includes('README.md'));
  assert.ok(!read.includes('src/d.d.ts'));
  const of = filesOfTypes(typed, law!);
  assert.deepEqual(of.get('source'), ['src/c.ts', 'src/cli/b.ts', 'src/core/a.ts']);
  assert.deepEqual(of.get('library'), ['src/core/a.ts']);
  assert.deepEqual(of.get('command'), ['src/cli/b.ts']);
});

test('overlaps and unreadable files', () => {
  const { law } = parseLaw(SAMPLE + '  core:\n    paths: ["src/core/**"]\n');
  const { overlaps } = typeFiles('/nowhere', ['src/core/a.ts'], law!, () => Buffer.from('x\n'));
  assert.equal(overlaps.length, 1);
  assert.match(overlaps[0]!.message, /'source' and 'core'/);
  const { unreadable } = typeFiles('/nowhere', ['src/core/a.ts'], law!, () => {
    throw Object.assign(new Error('denied'), { code: 'EACCES' });
  });
  assert.deepEqual(unreadable.map((e) => [e.code, e.file]), [['file-unreadable', 'src/core/a.ts']]);
});
