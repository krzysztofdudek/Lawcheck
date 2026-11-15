import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import fc from 'fast-check';
import { isBinary, splitLines } from '../../dist/types.js';
import { parseWaivers } from '../../dist/waivers.js';
import { check, LAW, makeSample, makeU, temp, U_LAW, write } from '../acceptance/helpers.ts';
import { PURE_CALL_BUDGET_MS } from './numbers.ts';
import { pure, tool, within } from './support.ts';
import type { Speed } from './support.ts';

// The lines of spec/check-slice.md, section 3, read the slow way: split at \n, a \r before it taken off, and a final line end adding no line.
function lines(text: string): string[] {
  if (text === '') return [];
  const out: string[] = [];
  let line = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      out.push(line.endsWith('\r') ? line.slice(0, -1) : line);
      line = '';
    } else line += text[i];
  }
  if (line !== '') out.push(line);
  return out;
}

const RULES = new Set(['no-console', 'no-todo', 'forbidden-use']);
const unit = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom('a', ' ', 'x;', 'console.log(1);', 'TODO', '//', '--', '*/', '-->', '<!--', "import '../cli/main.js';", 'lawcheck-waive forbidden-use -- r') },
  { weight: 3, arbitrary: fc.constantFrom('\n', '\r\n', '\r', '\u2028', '\u2029', '\u0085', '\v', '\f', '\u001c') },
  { weight: 2, arbitrary: fc.constantFrom('lawcheck-waive', 'lawcheck-waive no-console -- r', 'lawcheck-waive no-such -- r', 'lawcheck-waive no-todo', 'lawcheck-waive-file', '`lawcheck-waive <rule id> -- <reason>`') },
  { weight: 1, arbitrary: fc.constantFrom('\u0000', '\ufeff', '\ud800', 'ż', '😀') },
);
const text = fc.array(unit, { maxLength: 40 }).map((parts) => parts.join(''));
const separators = (t: string) => /[\r\u2028\u2029\u0085\v\f\u001c]/.test(t);

function utf16(t: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, 'utf16le')]);
}

export function contentsProperties(speed: Speed): void {
  test('I-lines-1: lines split as section 3 says, and every waiver sits on a line of the file and covers one', () => {
    pure(
      speed,
      text,
      { classes: { 'a line separator other than \\n': separators, 'a waiver marker': (t) => t.includes('lawcheck-waive'), 'a NUL or a byte-order mark': (t) => /[\u0000\ufeff]/.test(t) } },
      (t) => {
        const split = within(PURE_CALL_BUDGET_MS, 'splitLines', () => splitLines(t));
        assert.deepEqual(split, lines(t));
        const { waivers, problems } = parseWaivers(split, RULES);
        for (const item of [...waivers, ...problems]) assert.ok(item.line >= 1 && item.line <= split.length, `line ${item.line} of ${split.length}`);
        for (const waiver of waivers) assert.ok(waiver.covers === null || (waiver.covers >= waiver.line && waiver.covers <= split.length));
        assert.ok(new Set([...waivers, ...problems].map((item) => item.line)).size === waivers.length + problems.length, 'a line holds at most one waiver or problem');
      },
    );
  });

  test('I-lines-1: a file is binary exactly when its first 8,000 bytes hold a NUL', () => {
    const at = fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 7999 }), fc.integer({ min: 8000, max: 8999 }));
    const bytes = fc.tuple(fc.integer({ min: 0, max: 9000 }), at).map(([length, nul]) => {
      const b = Buffer.alloc(nul === null ? length : Math.max(length, nul + 1), 0x61);
      if (nul !== null) b[nul] = 0;
      return b;
    });
    pure(speed, bytes, { classes: { 'a NUL before 8,000': (b) => b.subarray(0, 8000).includes(0), 'a NUL after 8,000': (b) => b.includes(0) && !b.subarray(0, 8000).includes(0) }, least: { 'a NUL after 8,000': 0.1 } }, (b) => {
      assert.equal(isBinary(b), b.subarray(0, 8000).includes(0));
    });
  });

  test('I-lines-1: for any text of a judged file, every finding lies inside it, and the text and JSON forms agree', async () => {
    const content = fc.oneof({ weight: 5, arbitrary: text.map((t) => ({ t, utf16: false })) }, { weight: 1, arbitrary: text.map((t) => ({ t, utf16: true })) });
    await tool(
      speed,
      fc.tuple(content, fc.boolean(), fc.boolean()),
      { classes: { 'a line separator other than \\n': ([{ t }]) => separators(t), 'a waiver marker': ([{ t }]) => t.includes('lawcheck-waive'), 'waivers off': ([, off]) => off, 'uses read': ([, , uses]) => uses } },
      async ([{ t, utf16: wide }, off, uses]) => {
        const dir = temp();
        try {
          const s = uses ? makeU(dir.dir) : makeSample(dir.dir);
          if (off) write(s, '.lawcheck/law.yaml', (uses ? U_LAW : LAW).replace('  source:\n    about: Everything that ships.\n', '  source:\n    about: Everything that ships.\n    waivers: false\n'));
          const raw = wide ? utf16(t) : Buffer.from(t);
          writeFileSync(join(s, 'src/core/g.ts'), raw);
          const json = await check(s, '--base', 'main', '--json');
          const text = await check(s, '--base', 'main');
          assert.equal(json.code, text.code);
          assert.ok(json.code === 0 || json.code === 1, json.stdout);
          const document = JSON.parse(json.stdout);
          const fileLines = raw.subarray(0, 8000).includes(0) ? null : lines(new TextDecoder('utf-8', { ignoreBOM: true }).decode(raw)).length;
          const own = document.findings.filter((f: { file: string }) => f.file === 'src/core/g.ts');
          if (fileLines === null) assert.deepEqual(own, [], 'a binary file is never judged');
          for (const f of own) if (f.line !== undefined) assert.ok(f.line >= 1 && f.line <= fileLines!, `line ${f.line} of ${fileLines}`);
          if (off) assert.ok(!own.some((f: { code: string }) => f.code.startsWith('waiver-')), 'a type with waivers: false reads no waiver');
          if (off) assert.deepEqual(document.waivers.filter((w: { file: string }) => w.file === 'src/core/g.ts'), []);
          const printed = text.stdout.split('\n');
          for (const f of document.findings.slice(0, 50)) {
            const place = f.line === undefined ? f.file : `${f.file}:${f.line}`;
            assert.ok(printed.some((line) => line.startsWith(`${place}  ${f.severity}[${f.code}]  `)), `${place} ${f.code} is in the JSON and not in the text`);
          }
          assert.equal(printed.filter((line) => /^\S[^\n]*  (error|warning)\[[a-z0-9-]+\]  /.test(line)).length, Math.min(document.findings.length, 50));
        } finally {
          dir.remove();
        }
      },
    );
  });
}
