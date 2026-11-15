import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ALLOWED_NAMES } from './allowed-names.ts';
import { stringsOf } from './spec-map.ts';

// It reads capitalised words and the first word of code spans and command lines; a tool written in lower case in plain prose is out of its reach.
const REPO = new URL('../../', import.meta.url);
const ALLOWED = new Set(Object.values(ALLOWED_NAMES).flat());

const LAUNCHERS = /(?<![\w.-])(?:npx|bunx|npm exec|pnpm dlx|yarn dlx|bun x)\s+((?:-\S*\s+)*)(@?[A-Za-z][\w./@-]*)/g;

export function namesOf(text: string, document = true): { names: Set<string>; problems: string[] } {
  const names = new Set<string>();
  const problems: string[] = [];
  const launched = (line: string): void => {
    for (const match of line.matchAll(LAUNCHERS)) names.add(match[2]!);
  };
  const kept: string[] = [];
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) kept.push(line);
    else {
      const command = /^\$ (\S+)/.exec(line);
      if (command !== null) names.add(command[1]!);
      launched(line);
    }
  }
  if (fenced && document) problems.push('a code fence is never closed');
  const prose = kept
    .join('\n')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/`([^`]+)`/g, (_, span: string) => {
      const first = span.trim().split(/\s+/)[0]!;
      if (/^[A-Za-z][\w.+#-]*$/.test(first)) names.add(first);
      launched(span);
      return ' ';
    });
  for (const match of prose.matchAll(/(?<![A-Za-z0-9_])[A-Z][A-Za-z0-9]*(?:\+\+|#)?/g)) names.add(match[0]);
  return { names, problems };
}

function jsonStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) jsonStrings(item, out);
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) jsonStrings(item, out);
  return out;
}

const PROSE_FILES = /\.(md|mdx|txt)$/;

function pages(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const read = (path: string): string => readFileSync(new URL(path, REPO), 'utf8');
  const walk = (dir: string, take: (path: string) => void): void => {
    for (const entry of readdirSync(new URL(dir, REPO), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}${entry.name}/`, take);
      else take(`${dir}${entry.name}`);
    }
  };
  walk('docs/', (path) => {
    if (PROSE_FILES.test(path)) out[path] = [read(path)];
  });
  walk('src/', (path) => {
    if (path.endsWith('.ts')) out[path] = stringsOf(read(path));
  });
  walk('plugin/', (path) => {
    if (path.endsWith('/LICENSE')) return;
    if (PROSE_FILES.test(path)) out[path] = [read(path)];
    else if (path.endsWith('.json')) out[path] = jsonStrings(JSON.parse(read(path)));
    else out[path] = stringsOf(read(path));
  });
  for (const path of ['README.md', 'CHANGELOG.md']) out[path] = [read(path)];
  out['.claude-plugin/marketplace.json'] = jsonStrings(JSON.parse(read('.claude-plugin/marketplace.json')));
  const manifest = JSON.parse(read('package.json')) as { description: string; keywords: string[] };
  out['package.json'] = [manifest.description, ...manifest.keywords.map((keyword) => `\`${keyword}\``)];
  return out;
}

function refused(found: Record<string, string[]>): string[] {
  const out: string[] = [];
  for (const [file, texts] of Object.entries(found)) {
    const seen = new Set<string>();
    for (const text of texts) {
      const read = namesOf(text, PROSE_FILES.test(file));
      for (const problem of read.problems) out.push(`${file}: ${problem}`);
      for (const name of read.names) if (!ALLOWED.has(name) && !seen.has(name)) out.push(`${file}: ${name}`), seen.add(name);
    }
  }
  return out;
}

test('S5-1: no page of README.md, CHANGELOG.md, docs/, plugin/, the messages of src/ or package.json names a tool, or any word, outside the allow-list', () => {
  const found = pages();
  assert.ok(Object.keys(found).filter((f) => f.startsWith('docs/')).length >= 12);
  assert.ok(Object.keys(found).some((f) => f.startsWith('plugin/hooks/') && f.endsWith('.mjs')));
  assert.ok(Object.keys(found).some((f) => f.startsWith('src/')));
  assert.deepEqual(refused(found), []);
});

test('S5-1: control, a name is found in every place a page can put it, and the list is one list', () => {
  const page = [
    '# A page',
    '',
    'Frobnicator starts a sentence.',
    "It moves from [Quuxlint](https://example.com/Zed) here, and Gloop's docs say so.",
    '- Wibble heads a list item',
    '| Cell | Wobble in a cell |',
    'After an entity&nbsp;Flumox follows, and `blarg run` is a command, and `plain` is one word.',
    'Run `npx --no-install husky install` or `pnpm dlx lefthook run` or `npm exec -- zorp` or `yarn dlx grib`.',
    '```sh',
    '$ snorf --now',
    'npx -y fizzbin start',
    'Hidden words in a fence',
    '```',
  ].join('\n');
  const read = namesOf(page);
  for (const name of ['Frobnicator', 'Quuxlint', 'Gloop', 'Wibble', 'Wobble', 'Flumox', 'blarg', 'plain', 'snorf', 'husky', 'lefthook', 'zorp', 'grib', 'fizzbin']) assert.ok(read.names.has(name), name);
  for (const name of ['Hidden', 'Zed', 'example']) assert.ok(!read.names.has(name), name);
  assert.deepEqual(read.problems, []);
  assert.deepEqual(namesOf(['text', '```', '$ npx x'].join('\n')).problems, ['a code fence is never closed']);
  const found = refused({ 'a.md': [page], 'b.txt': ['Zibble is named in a text file.'] });
  for (const name of ['Frobnicator', 'Gloop', 'husky', 'lefthook', 'fizzbin', 'Zibble']) assert.ok(found.some((f) => f.endsWith(`: ${name}`)), name);
  const all = Object.values(ALLOWED_NAMES).flat();
  assert.equal(new Set(all).size, all.length);
});
