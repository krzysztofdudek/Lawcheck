import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ALLOWED_NAMES } from './allowed-names.ts';

// It reads capitalised words and the first word of code spans and command lines; a tool written in lower case in plain prose is out of its reach.
const REPO = new URL('../../', import.meta.url);
const ALLOWED = new Set(Object.values(ALLOWED_NAMES).flat());

export function namesOf(text: string): Set<string> {
  const names = new Set<string>();
  const kept: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) kept.push(line);
    else {
      const command = /^\$ (\S+)/.exec(line);
      if (command !== null) names.add(command[1]!);
    }
  }
  const prose = kept
    .join('\n')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/`([^`]+)`/g, (_, span: string) => {
      const first = span.trim().split(/\s+/)[0]!;
      if (/^[A-Za-z][\w.+#-]*$/.test(first)) names.add(first);
      return ' ';
    });
  for (const match of prose.matchAll(/(?<![A-Za-z0-9_])[A-Z][A-Za-z0-9]*(?:\+\+|#)?/g)) names.add(match[0]);
  return names;
}

function strings(source: string): string[] {
  return [...source.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]!);
}

function jsonStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) jsonStrings(item, out);
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) jsonStrings(item, out);
  return out;
}

function pages(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(new URL(dir, REPO), { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) walk(`${path}/`);
      else if (entry.name === 'LICENSE') continue;
      else if (entry.name.endsWith('.md')) out[path] = [readFileSync(new URL(path, REPO), 'utf8')];
      else if (entry.name.endsWith('.json')) out[path] = jsonStrings(JSON.parse(readFileSync(new URL(path, REPO), 'utf8')));
      else if (entry.name.endsWith('.mjs')) out[path] = strings(readFileSync(new URL(path, REPO), 'utf8'));
    }
  };
  walk('docs/');
  walk('plugin/');
  out['README.md'] = [readFileSync(new URL('README.md', REPO), 'utf8')];
  out['.claude-plugin/marketplace.json'] = jsonStrings(JSON.parse(readFileSync(new URL('.claude-plugin/marketplace.json', REPO), 'utf8')));
  return out;
}

function refused(found: Record<string, string[]>): string[] {
  const out: string[] = [];
  for (const [file, texts] of Object.entries(found)) {
    const seen = new Set<string>();
    for (const text of texts) for (const name of namesOf(text)) if (!ALLOWED.has(name) && !seen.has(name)) out.push(`${file}: ${name}`), seen.add(name);
  }
  return out;
}

test('S5-1: no page of README.md, docs/ or plugin/ names a tool, or any word, outside the allow-list', () => {
  const found = pages();
  assert.ok(Object.keys(found).filter((f) => f.startsWith('docs/')).length >= 12);
  assert.ok(Object.keys(found).some((f) => f.startsWith('plugin/')));
  assert.deepEqual(refused(found), []);
});

test('S5-1 control: a name is found in every place a page can put it, and the list is one list', () => {
  const page = [
    '# A page',
    '',
    'Frobnicator starts a sentence.',
    'It moves from [Quuxlint](https://example.com/Zed) here, and Gloop\'s docs say so.',
    '- Wibble heads a list item',
    '| Cell | Wobble in a cell |',
    'After an entity&nbsp;Flumox follows, and `blarg run` is a command, and `plain` is one word.',
    '```sh',
    '$ snorf --now',
    'Hidden words in a fence',
    '```',
  ].join('\n');
  const names = [...namesOf(page)].sort();
  for (const name of ['Frobnicator', 'Quuxlint', 'Gloop', 'Wibble', 'Wobble', 'Flumox', 'blarg', 'plain', 'snorf']) assert.ok(names.includes(name), name);
  for (const name of ['Hidden', 'Zed', 'example']) assert.ok(!names.includes(name), name);
  assert.deepEqual(refused({ 'a.md': [page] }).map((r) => r.split(': ')[1]).sort(), ['Cell', 'Flumox', 'Frobnicator', 'Gloop', 'Quuxlint', 'Wibble', 'Wobble', 'blarg', 'plain', 'snorf'].filter((n) => !ALLOWED.has(n)).sort());
  const all = Object.values(ALLOWED_NAMES).flat();
  assert.equal(new Set(all).size, all.length);
});
