import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import fc from 'fast-check';
import { bytesOfName, canonicalName, nameOf } from '../../dist/names.js';
import * as hooks from '../../plugin/hooks/names.mjs';
import { check, lawcheck, makeSample, temp } from '../acceptance/helpers.ts';
import { TOOL_RUN_BUDGET_MS } from '../numbers.ts';
import { pure, tool } from './support.ts';
import type { Speed } from './support.ts';

const piece = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...'abcXYZ019._- ').map((c) => Buffer.from(c)) },
  {
    weight: 2,
    arbitrary: fc.constantFrom('\n', '\r', '\t', '\x1b[2K', '\x07', '\u202e', '\u2028', '\u200f', '::', '::error::', '##vso[', '*', '\\', '\\n', '\\x41', 'ż', '€', '😀', '\ufeff').map((c) => Buffer.from(c)),
  },
  { weight: 1, arbitrary: fc.integer({ min: 0x80, max: 0xff }).map((b) => Buffer.from([b])) },
  { weight: 2, arbitrary: fc.oneof(
    fc.tuple(fc.constantFrom(0xc0, 0xc1), fc.integer({ min: 0x80, max: 0xbf })).map((b) => Buffer.from(b)),
    fc.tuple(fc.constant(0xe0), fc.integer({ min: 0x80, max: 0x9f }), fc.integer({ min: 0x80, max: 0xbf })).map((b) => Buffer.from(b)),
    fc.tuple(fc.constant(0xf0), fc.integer({ min: 0x80, max: 0x8f }), fc.integer({ min: 0x80, max: 0xbf }), fc.integer({ min: 0x80, max: 0xbf })).map((b) => Buffer.from(b)),
    fc.tuple(fc.constant(0xed), fc.integer({ min: 0xa0, max: 0xbf }), fc.integer({ min: 0x80, max: 0xbf })).map((b) => Buffer.from(b)),
    fc.tuple(fc.constant(0xf4), fc.integer({ min: 0x90, max: 0xbf }), fc.integer({ min: 0x80, max: 0xbf }), fc.integer({ min: 0x80, max: 0xbf })).map((b) => Buffer.from(b)),
    fc.tuple(fc.integer({ min: 0xe1, max: 0xf3 }), fc.integer({ min: 0x80, max: 0xbf })).map((b) => Buffer.from(b)),
  ) },
);
const segment = fc.oneof(
  { weight: 8, arbitrary: fc.array(piece, { minLength: 1, maxLength: 8 }).map((parts) => Buffer.concat(parts)) },
  { weight: 1, arbitrary: fc.integer({ min: 200, max: 252 }).map((n) => Buffer.from('l'.repeat(n))) },
);
const bytes = fc.array(segment, { minLength: 1, maxLength: 3 }).map((parts) => Buffer.concat(parts.flatMap((part, i) => (i === 0 ? [part] : [Buffer.from('/'), part]))));
const source = bytes.map((b) => Buffer.concat([b, Buffer.from('.ts')]));

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const valid = (b: Buffer) => {
  try {
    strict.decode(b);
    return true;
  } catch {
    return false;
  }
};
const control = (b: Buffer) => b.some((x) => x < 0x20 || x === 0x7f);
const LEADS = /[\xc0\xc1\xf5-\xff]|\xe0[\x80-\x9f]|\xed[\xa0-\xbf]|\xf0[\x80-\x8f]|\xf4[\x90-\xbf]|[\xc2-\xf4](?![\x80-\xbf])/;
const multiByte = (b: Buffer) => LEADS.test(b.toString('latin1'));

// The grammar of spec/check-slice.md, section 2, read the slow way and apart from the tool: at each byte, the shortest run of one to four bytes that a strict decoder reads as one character is that character; a byte that starts none is \xHH.
function referenceName(b: Buffer): string {
  let out = '';
  for (let at = 0; at < b.length; ) {
    let taken = 0;
    for (let n = 1; n <= 4 && at + n <= b.length && taken === 0; n++) {
      try {
        const ch = strict.decode(b.subarray(at, at + n));
        if ([...ch].length === 1) {
          out += ch === '\\' ? '\\\\' : ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch;
          taken = n;
        }
      } catch {
        // Not a character of n bytes.
      }
    }
    if (taken === 0) {
      out += `\\x${b[at]!.toString(16).padStart(2, '0')}`;
      taken = 1;
    }
    at += taken;
  }
  return out;
}

// The bytes a name stands for, read from the spec's escapes.
function referenceBytes(name: string): Buffer {
  const parts: Buffer[] = [];
  for (let i = 0; i < name.length; i++) {
    const rest = name.slice(i);
    const hex = /^\\x([0-9a-f]{2})/.exec(rest);
    if (rest.startsWith('\\\\')) parts.push(Buffer.from('\\')), i++;
    else if (rest.startsWith('\\n')) parts.push(Buffer.from('\n')), i++;
    else if (rest.startsWith('\\r')) parts.push(Buffer.from('\r')), i++;
    else if (hex !== null) parts.push(Buffer.from([parseInt(hex[1]!, 16)])), (i += 3);
    else {
      const point = name.codePointAt(i)!;
      const ch = String.fromCodePoint(point);
      parts.push(Buffer.from(ch));
      i += ch.length - 1;
    }
  }
  return Buffer.concat(parts);
}

// What a file system refuses in a name, by platform; such a case is left out and counted.
function refused(name: Buffer): string | null {
  const text = name.toString('latin1');
  if (process.platform === 'win32' && (/[\x00-\x1f\\*"<>|?:]/.test(text) || / $|\.$/.test(text) || !valid(name))) return 'Windows refuses it';
  // git for Windows keeps the old limit of 260 characters a path unless core.longpaths is set, and the test's folder takes about a hundred of them.
  if (process.platform === 'win32' && name.length > 120) return 'Windows takes a path of at most 260 characters';
  if (process.platform === 'darwin' && !valid(name)) return 'macOS refuses a name that is not valid UTF-8';
  if (name.toString('latin1').split('/').some((part) => part === '' || part === '.' || part === '..' || Buffer.byteLength(part, 'latin1') > 255)) return 'no file system takes this segment';
  return null;
}

export function namesProperties(speed: Speed): void {
  test('I-files-1: a name maps back to its bytes, holds no line break, and the hooks write it the same way', () => {
    pure(
      speed,
      bytes,
      { classes: { 'a control character': control, 'invalid UTF-8': (b) => !valid(b), 'an invalid multi-byte sequence': multiByte, 'a backslash': (b) => b.includes(0x5c), 'a byte-order mark': (b) => b.includes(Buffer.from('\ufeff')) }, least: { 'a byte-order mark': 0.05 } },
      (b) => {
        const name = nameOf(b);
        assert.equal(name, referenceName(b));
        assert.deepEqual(referenceBytes(name), b);
        assert.doesNotMatch(name, /[\n\r]/);
        assert.deepEqual(bytesOfName(name), b);
        assert.equal(hooks.nameOf(b), name);
        assert.deepEqual(hooks.bytesOfName(name), bytesOfName(name));
        if (process.platform !== 'win32') assert.equal(canonicalName(name), name);
      },
    );
  });

  test('I-files-1: every file a type matches is judged, whatever bytes its name holds, and its JSON path maps back to the file on disk', async () => {
    let filtered = 0;
    const allowed = source.filter((b) => {
      const ok = refused(Buffer.concat([Buffer.from('src/core/'), b])) === null;
      if (!ok) filtered++;
      return ok;
    });
    const prefixes = (list: Buffer[]) => {
      const names = list.map((b) => b.toString('latin1'));
      return !names.some((a) => names.some((b) => b.startsWith(`${a.slice(0, -3)}/`) || b.startsWith(`${a}/`)));
    };
    const names = fc.uniqueArray(allowed, { minLength: 1, maxLength: 4, selector: (b) => b.toString('hex') }).filter(prefixes);
    const windows = process.platform === 'win32';
    const classes: Record<string, (list: Buffer[]) => boolean> = windows
      ? { 'a bidi mark or a line separator': (list) => list.some((b) => /\u202e|\u2028|\u200f/.test(b.toString('utf8'))), 'a character outside ASCII': (list) => list.some((b) => b.some((x) => x >= 0x80)) }
      : { 'a control character': (list) => list.some(control), 'a backslash': (list) => list.some((b) => b.includes(0x5c)), 'a segment over 200 bytes': (list) => list.some((b) => b.toString('latin1').split('/').some((p) => p.length > 200)), ...(process.platform === 'linux' ? { 'an invalid multi-byte sequence': (list: Buffer[]) => list.some(multiByte) } : {}) };
    await tool(speed, names, { classes }, async (list) => {
      const t = temp();
      try {
        const s = makeSample(t.dir);
        const written: Buffer[] = [];
        for (const name of list) {
          const parts = name.toString('latin1').split('/');
          if (parts.length > 1) mkdirSync(Buffer.concat([Buffer.from(`${s}/src/core/`), Buffer.from(parts.slice(0, -1).join('/'), 'latin1')]), { recursive: true });
          writeFileSync(Buffer.concat([Buffer.from(`${s}/src/core/`), name]), "console.log('x');\n");
          written.push(Buffer.concat([Buffer.from('src/core/'), name]));
        }
        const run = await check(s, '--full', '--base', 'main', '--json');
        assert.ok(run.ms <= TOOL_RUN_BUDGET_MS);
        assert.equal(run.code, 1, run.stdout);
        const document = JSON.parse(run.stdout);
        const judged = new Set<string>(document.findings.filter((f: { code: string }) => f.code === 'no-console').map((f: { file: string }) => f.file));
        for (const file of written) {
          const name = referenceName(file);
          assert.ok(judged.has(name), `${JSON.stringify(name)} was not judged: ${run.stdout}`);
        }
        for (const name of judged) if (name.startsWith('src/core/') && name !== 'src/core/price.ts') assert.ok(existsSync(Buffer.concat([Buffer.from(`${s}/`), referenceBytes(name)])), `${name} maps to no file on disk`);
        const text = await check(s, '--full', '--base', 'main');
        assert.equal(text.stdout.split('\n').filter((line) => /^src\/core\/[^\n]*  error\[no-console\]  /.test(line)).length, written.length, text.stdout);
        for (const file of written.slice(0, 2)) {
          const explained = await lawcheck(s, ['explain', referenceName(file)]);
          assert.equal(explained.code, 0, explained.stdout);
          assert.equal(explained.stdout.split('\n')[1], '  type:  library  (source > library)  Code the commands call.', explained.stdout);
        }
      } finally {
        t.remove();
      }
    });
    process.stdout.write(`I-files-1: ${filtered} generated names left out on ${process.platform}, which its file system refuses\n`);
  });
}
