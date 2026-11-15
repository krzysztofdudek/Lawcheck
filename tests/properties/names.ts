import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import fc from 'fast-check';
import { bytesOfName, canonicalName, nameOf } from '../../dist/names.js';
import * as hooks from '../../plugin/hooks/names.mjs';
import { check, lawcheck, makeSample, temp } from '../acceptance/helpers.ts';
import { TOOL_RUN_BUDGET_MS } from './numbers.ts';
import { pure, tool } from './support.ts';
import type { Speed } from './support.ts';

const piece = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...'abcXYZ019._- ').map((c) => Buffer.from(c)) },
  {
    weight: 2,
    arbitrary: fc.constantFrom('\n', '\r', '\t', '\x1b[2K', '\x07', '\u202e', '\u2028', '\u200f', '::', '::error::', '##vso[', '*', '\\', '\\n', '\\x41', 'ż', '€', '😀').map((c) => Buffer.from(c)),
  },
  { weight: 1, arbitrary: fc.integer({ min: 0x80, max: 0xff }).map((b) => Buffer.from([b])) },
);
const segment = fc.oneof(
  { weight: 8, arbitrary: fc.array(piece, { minLength: 1, maxLength: 8 }).map((parts) => Buffer.concat(parts)) },
  { weight: 1, arbitrary: fc.integer({ min: 200, max: 252 }).map((n) => Buffer.from('l'.repeat(n))) },
);
const bytes = fc.array(segment, { minLength: 1, maxLength: 3 }).map((parts) => Buffer.concat(parts.flatMap((part, i) => (i === 0 ? [part] : [Buffer.from('/'), part]))));
const source = bytes.map((b) => Buffer.concat([b, Buffer.from('.ts')]));

const strict = new TextDecoder('utf-8', { fatal: true });
const valid = (b: Buffer) => {
  try {
    strict.decode(b);
    return true;
  } catch {
    return false;
  }
};
const control = (b: Buffer) => b.some((x) => x < 0x20 || x === 0x7f);

// What a file system refuses in a name, by platform; such a case is left out and counted.
function refused(name: Buffer): string | null {
  const text = name.toString('latin1');
  if (process.platform === 'win32' && (/[\x00-\x1f\\*"<>|?:]/.test(text) || / $|\.$/.test(text) || !valid(name))) return 'Windows refuses it';
  if (process.platform === 'darwin' && !valid(name)) return 'macOS refuses a name that is not valid UTF-8';
  if (name.toString('latin1').split('/').some((part) => part === '' || part === '.' || part === '..' || Buffer.byteLength(part, 'latin1') > 255)) return 'no file system takes this segment';
  return null;
}

export function namesProperties(speed: Speed): void {
  test('I-files-1: a name maps back to its bytes, holds no line break, and the hooks write it the same way', () => {
    pure(
      speed,
      bytes,
      { classes: { 'a control character': control, 'invalid UTF-8': (b) => !valid(b), 'a backslash': (b) => b.includes(0x5c) } },
      (b) => {
        const name = nameOf(b);
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
    const names = fc.uniqueArray(source, { minLength: 1, maxLength: 4, selector: (b) => b.toString('hex') });
    await tool(
      speed,
      names,
      { classes: { 'a control character': (list) => list.some(control), 'a backslash': (list) => list.some((b) => b.includes(0x5c)), 'a segment over 200 bytes': (list) => list.some((b) => b.toString('latin1').split('/').some((p) => p.length > 200)) } },
      async (list) => {
        const kept = list.filter((b) => refused(Buffer.concat([Buffer.from('src/core/'), b])) === null);
        filtered += list.length - kept.length;
        if (kept.length === 0) return;
        const t = temp();
        try {
          const s = makeSample(t.dir);
          const written: Buffer[] = [];
          for (const name of kept) {
            const full = Buffer.concat([Buffer.from(`${s}/src/core/`), name]);
            const parts = name.toString('latin1').split('/');
            let ok = true;
            for (let i = 1; i < parts.length; i++) {
              const dir = Buffer.concat([Buffer.from(`${s}/src/core/`), Buffer.from(parts.slice(0, i).join('/'), 'latin1')]);
              try {
                mkdirSync(dir, { recursive: true });
              } catch {
                ok = false;
              }
            }
            if (!ok) continue;
            try {
              writeFileSync(full, "console.log('x');\n");
              written.push(Buffer.concat([Buffer.from('src/core/'), name]));
            } catch {
              // A path where a directory of one name is a file of another.
            }
          }
          const run = await check(s, '--full', '--base', 'main', '--json');
          assert.ok(run.ms <= TOOL_RUN_BUDGET_MS);
          assert.equal(run.code, 1, run.stdout);
          const document = JSON.parse(run.stdout);
          const judged = new Set<string>(document.findings.filter((f: { code: string }) => f.code === 'no-console').map((f: { file: string }) => f.file));
          for (const file of written) {
            const name = nameOf(file);
            assert.ok(judged.has(name), `${JSON.stringify(name)} was not judged: ${run.stdout}`);
            assert.ok(existsSync(Buffer.concat([Buffer.from(`${s}/`), bytesOfName(name)])));
          }
          const text = await check(s, '--full', '--base', 'main');
          assert.equal(text.stdout.split('\n').filter((line) => /^src\/core\/[^\n]*  error\[no-console\]  /.test(line)).length, written.length, text.stdout);
          for (const file of written.slice(0, 2)) {
            const explained = await lawcheck(s, ['explain', nameOf(file)]);
            assert.equal(explained.code, 0, explained.stdout);
            assert.equal(explained.stdout.split('\n')[1], '  type:  library  (source > library)  Code the commands call.', explained.stdout);
          }
        } finally {
          t.remove();
        }
      },
    );
    process.stdout.write(`I-files-1: ${filtered} generated names left out on ${process.platform}, which its file system refuses\n`);
  });
}
