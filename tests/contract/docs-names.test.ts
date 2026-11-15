import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ALLOWED_NAMES } from './allowed-names.ts';

const DOCS = new URL('../../docs/', import.meta.url);
const ALLOWED = new Set(Object.values(ALLOWED_NAMES).flat());

function prose(text: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    else if (!fenced) out.push(line.replace(/`[^`]*`/g, ' '));
  }
  return out;
}

function capitalised(lines: string[]): { name: string; line: string }[] {
  const found: { name: string; line: string }[] = [];
  for (const line of lines) {
    for (const sentence of line.split(/(?<=[.!?:;])\s+|\s\|\s|^[-*#>|\d.\s]+/)) {
      const words = sentence.split(/\s+/).map((w) => w.replace(/^[("'*_\[]+|[)"'*_\].,;:!?]+$/g, '')).filter((w) => w !== '');
      words.forEach((word, i) => {
        if (!/^[A-Z][A-Za-z0-9+#-]*$/.test(word)) return;
        if (i === 0) return;
        found.push({ name: word, line: sentence });
      });
    }
  }
  return found;
}

function refusedNames(pages: Record<string, string>): string[] {
  const refused: string[] = [];
  for (const [file, text] of Object.entries(pages)) {
    for (const { name, line } of capitalised(prose(text))) {
      if (!ALLOWED.has(name)) refused.push(`${file}: ${name} in "${line.trim().slice(0, 80)}"`);
    }
  }
  return refused;
}

test('S5-1: no docs page names a tool outside the allowed list', () => {
  const pages: Record<string, string> = {};
  for (const file of readdirSync(DOCS).filter((f) => f.endsWith('.md')).sort()) pages[file] = readFileSync(new URL(file, DOCS), 'utf8');
  assert.ok(Object.keys(pages).length >= 12);
  assert.deepEqual(refusedNames(pages), []);
});

test('S5-1 control: a page that names a tool in the middle of a sentence is refused', () => {
  const refused = refusedNames({ 'a.md': '# A page\n\nMove here from Frobnicator.\n\nTools like Quuxlint read the same files.\n\nPlain words, and `Hidden` in code, and Lawcheck.\n' });
  assert.deepEqual(refused.map((r) => r.split(' in ')[0]), ['a.md: Frobnicator', 'a.md: Quuxlint']);
});
