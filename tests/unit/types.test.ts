import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLaw } from '../../dist/law.js';
import { decode, filesOfTypes, isBinary, splitLines, typeFiles } from '../../dist/types.js';
import { TextTooLarge } from '../../dist/limits.js';

const SAMPLE = readFileSync(new URL('../sample/.lawcheck/law.yaml', import.meta.url), 'utf8');

test('check-slice §2: lines split at \\n and \\r\\n; a lone \\r stays; a final line end adds nothing', () => {
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('\n'), ['']);
  assert.deepEqual(splitLines('ab\r\ncd\r\n'), ['ab', 'cd']);
  assert.deepEqual(splitLines('a\rb\nc'), ['a\rb', 'c']);
  assert.deepEqual(splitLines('a\n\n'), ['a', '']);
});

test('check-slice §2: text drops a byte-order mark and replaces invalid bytes', () => {
  assert.equal(decode(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), 'a');
  assert.equal(decode(Buffer.from([0x61, 0xff])), 'a\ufffd');
});

test('check-slice §2: a NUL byte in the first 8,000 bytes makes a file binary', () => {
  assert.equal(isBinary(Buffer.from('a\0b')), true);
  assert.equal(isBinary(Buffer.concat([Buffer.alloc(8000, 0x61), Buffer.from([0])])), false);
});

test('check-slice §2: each file gets its deepest type, and the rules on the way down', () => {
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

test('check-slice §2: overlaps and unreadable files', () => {
  const { law } = parseLaw(SAMPLE + '  core:\n    paths: ["src/core/**"]\n');
  const { overlaps } = typeFiles('/nowhere', ['src/core/a.ts'], law!, () => Buffer.from('x\n'));
  assert.equal(overlaps.length, 1);
  assert.match(overlaps[0]!.message, /'source' and 'core'/);
  const { unreadable } = typeFiles('/nowhere', ['src/core/a.ts'], law!, () => {
    throw Object.assign(new Error('denied'), { code: 'EACCES' });
  });
  assert.deepEqual(unreadable.map((e) => [e.code, e.file]), [['file-unreadable', 'src/core/a.ts']]);
});

const lawOf = (text: string) => parseLaw(`lawcheck: 0.1.0\n${text}`).law!;
const bytes = (text: string) => Buffer.from(text);

test('R-44: a NUL byte at the last place of the first 8,000 makes a file binary', () => {
  assert.equal(isBinary(Buffer.concat([Buffer.alloc(7999, 0x61), Buffer.from([0])])), true);
  assert.equal(isBinary(Buffer.concat([Buffer.alloc(7998, 0x61), Buffer.from([0]), Buffer.alloc(5, 0x61)])), true);
  assert.equal(isBinary(Buffer.alloc(0)), false);
});

test('R-44: a file the law ignores is never read or typed, and a binary file is neither typed nor untyped', () => {
  const law = lawOf('required: ["src/**"]\nignored: ["src/gen/**"]\ntypes:\n  all:\n    paths: ["src/**"]\n');
  const read: string[] = [];
  const result = typeFiles('/nowhere', ['src/a.ts', 'src/gen/g.ts', 'src/z.bin'], law, (path) => {
    read.push(path);
    return path === 'src/z.bin' ? Buffer.from([0x61, 0, 0x62]) : bytes('x\n');
  });
  assert.deepEqual(read, ['src/a.ts', 'src/z.bin']);
  assert.deepEqual(result.typed.map((f) => f.path), ['src/a.ts']);
  assert.deepEqual([result.untyped, result.unreadable, result.overlaps], [[], [], []]);
});

test('R-44: a text file that the law requires and no type takes is untyped, in the order given, and a file that cannot be told from binary counts as text', () => {
  const law = lawOf('required: ["src/**", "!src/**/*.css"]\ntypes:\n  code:\n    paths: ["src/**/*.ts"]\n  script:\n    paths: ["src/**/*.js"]\n    content: "^#!"\n');
  const result = typeFiles(
    '/nowhere',
    ['src/b.html', 'src/a.ts', 'src/c.js', 'src/s.css', 'src/d.dat', 'src/e.txt', 'other/f.txt'],
    law,
    (path) => bytes(path === 'src/c.js' ? 'no shebang\n' : 'x\n'),
    (path) => {
      if (path === 'src/d.dat') return true;
      if (path === 'src/e.txt') throw new Error('cannot tell');
      return false;
    },
  );
  assert.deepEqual(result.typed.map((f) => f.path), ['src/a.ts']);
  assert.deepEqual(result.untyped, ['src/b.html', 'src/c.js', 'src/e.txt']);
});

test('R-44: a file that matches two types of one level is an overlap, named with its types, and is neither typed nor untyped', () => {
  const law = lawOf('required: ["src/**"]\ntypes:\n  a:\n    paths: ["src/**"]\n  b:\n    paths: ["src/**"]\n  c:\n    paths: ["src/**"]\n  d:\n    paths: ["lib/**"]\n');
  const three = typeFiles('/nowhere', ['src/x.ts'], law, () => bytes('x\n'));
  assert.deepEqual(three.overlaps, [{ code: 'type-overlap', file: 'src/x.ts', line: null, message: "the file matches the types 'a', 'b' and 'c' of one level" }]);
  assert.deepEqual([three.typed, three.untyped], [[], []]);
  const four = lawOf('types:\n  a:\n    paths: ["src/**"]\n  b:\n    paths: ["src/**"]\n  c:\n    paths: ["src/**"]\n  d:\n    paths: ["src/**"]\n');
  assert.equal(typeFiles('/nowhere', ['src/x.ts'], four, () => bytes('x\n')).overlaps[0]!.message, "the file matches the types 'a', 'b', 'c' and 'd' of one level");
  const nested = lawOf('types:\n  top:\n    paths: ["src/**"]\n    types:\n      one:\n        paths: ["src/**"]\n      two:\n        paths: ["src/**"]\n');
  const deep = typeFiles('/nowhere', ['src/x.ts', 'src/y.ts'], nested, () => bytes('x\n'));
  assert.deepEqual(deep.typed, []);
  assert.deepEqual(deep.overlaps.map((o) => [o.file, o.message]), [['src/x.ts', "the file matches the types 'one' and 'two' of one level"], ['src/y.ts', "the file matches the types 'one' and 'two' of one level"]]);
});

test('R-44: files that cannot be read are listed in the order given, and a run past its text limit stops there', () => {
  const law = lawOf('types:\n  all:\n    paths: ["src/**"]\n');
  const denied = (code: string) => Object.assign(new Error(code), { code });
  const read: string[] = [];
  const result = typeFiles('/nowhere', ['src/a.ts', 'src/b.ts', 'src/c.ts'], law, (path) => {
    read.push(path);
    if (path === 'src/c.ts') return bytes('x\n');
    throw denied(path === 'src/a.ts' ? 'EACCES' : 'EISDIR');
  });
  assert.deepEqual(result.unreadable.map((e) => [e.code, e.file, e.message]), [['file-unreadable', 'src/a.ts', 'the file cannot be read (EACCES)'], ['file-unreadable', 'src/b.ts', 'the file cannot be read (EISDIR)']]);
  assert.deepEqual(result.typed.map((f) => f.path), ['src/c.ts']);
  const stopped: string[] = [];
  const full = typeFiles('/nowhere', ['src/a.ts', 'src/b.ts', 'src/c.ts'], law, (path) => {
    stopped.push(path);
    if (path === 'src/b.ts') throw new TextTooLarge(path, 123456789);
    return bytes('x\n');
  });
  assert.deepEqual(stopped, ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(full.typed.map((f) => f.path), ['src/a.ts']);
  assert.deepEqual(full.unreadable.map((e) => [e.code, e.file]), [['text-too-large', 'src/b.ts']]);
});

test('R-44: a file keeps each rule of its types once, in the order they come down the chain', () => {
  const law = lawOf('rules:\n  r1:\n    why: x\n  r2:\n    why: x\n  r3:\n    why: x\ntypes:\n  top:\n    paths: ["src/**"]\n    rules: [r1, r2]\n    types:\n      inner:\n        paths: ["src/in/**"]\n        rules: [r2, r3, r1]\n');
  const { typed } = typeFiles('/nowhere', ['src/in/a.ts', 'src/b.ts'], law, () => bytes('x\n'));
  assert.deepEqual(typed.map((f) => [f.path, f.type.id, f.rules]), [['src/in/a.ts', 'inner', ['r1', 'r2', 'r3']], ['src/b.ts', 'top', ['r1', 'r2']]]);
  const of = filesOfTypes(typed, law);
  assert.deepEqual([...of.keys()].sort(), ['inner', 'top']);
  assert.deepEqual(of.get('top'), ['src/b.ts', 'src/in/a.ts']);
  assert.deepEqual(of.get('inner'), ['src/in/a.ts']);
  const unordered = filesOfTypes(typeFiles('/nowhere', ['src/in/a.ts', 'src/c.ts', 'src/b.ts'], law, () => bytes('x\n')).typed, law);
  assert.deepEqual(unordered.get('top'), ['src/b.ts', 'src/c.ts', 'src/in/a.ts']);
});
