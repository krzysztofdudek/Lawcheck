import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ROOT } from '../harness/sets.ts';
import { ALLOWED_NAMES } from './allowed-names.ts';
import { problems } from '../../site/landing/check.mjs';
import { Fragments } from '../../site/landing/fragments.ts';

const ALLOWED = new Set(Object.values(ALLOWED_NAMES).flat());
const TAKEN = ['governance', 'trust', 'control', 'confidence', 'AI-native', 'guardrails'];
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const pages = new Set((JSON.parse(read('docs/topics.json')) as Array<{ id: string }>).map((topic) => topic.id));

type Copy = { [key: string]: string | Copy };

function copyOf(text: string): { copy: Copy; body: string } {
  const front = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  assert.ok(front, 'index.md opens with front matter');
  return { copy: parse(front[1]!) as Copy, body: front[2]!.trim() };
}

function entries(copy: Copy, path = ''): Array<{ key: string; value: string }> {
  return Object.entries(copy).flatMap(([key, value]) => (typeof value === 'string' ? [{ key: `${path}${key}`, value }] : entries(value, `${path}${key}.`)));
}

function copyProblems(text: string): string[] {
  const out: string[] = [];
  if (/^\s*(```|~~~)/m.test(text)) out.push('a code block');
  const { copy, body } = copyOf(text);
  if (body !== '') out.push('text below the front matter, where the landing page does not read it');
  const all = entries(copy);
  for (const { key, value } of all) {
    if (key.endsWith('page')) {
      if (!pages.has(value)) out.push(`${key}: the page ${value} is not in docs/topics.json`);
      continue;
    }
    for (const word of TAKEN) if (new RegExp(`(?<![\\w-])${word}(?![\\w-])`, 'i').test(value)) out.push(`${key}: the word ${word}`);
    const prose = value.replace(/`([^`]+)`/g, (_, span: string) => {
      const first = span.trim().split(/\s+/)[0]!;
      if (!ALLOWED.has(first)) out.push(`${key}: the name ${first}`);
      return ' ';
    });
    for (const match of prose.replace(/\b[\w.-]+\.(?:dev|com)\b/g, ' ').matchAll(/(?<![A-Za-z0-9_])[A-Z][A-Za-z0-9]*/g)) if (!ALLOWED.has(match[0])) out.push(`${key}: the name ${match[0]}`);
  }
  return out;
}

test('test 780: the sentences of the landing page in site/landing/index.md hold no code block, none of the six taken words, only names of the allow-list of README.md and docs/, and link only to pages of docs/topics.json', () => {
  assert.deepEqual(copyProblems(read('site/landing/index.md')), []);
});

test('test 780: control, a code block, text below the front matter, a taken word, a name outside the allow-list and a page that docs/topics.json does not name are each caught', () => {
  const planted = ['---', 'h1: Guardrails for Acme agents', 'link: { text: More, page: pricing }', 'note: run `zork` now', '---', ''].join('\n');
  assert.deepEqual(copyProblems(planted), ['h1: the word guardrails', 'h1: the name Guardrails', 'h1: the name Acme', 'link.page: the page pricing is not in docs/topics.json', 'note: the name zork']);
  assert.deepEqual(copyProblems(['---', 'h1: Lawcheck', '---', '', '```text', 'x', '```', ''].join('\n')), ['a code block', 'text below the front matter, where the landing page does not read it']);
});

const GOOD: Record<string, string> = {
  'index.html': [
    '<title>Lawcheck: architecture checks for coding agents</title>',
    '<meta name="description" content="Lawcheck checks your code against the architecture and rules you write down, and tells your coding agent which line breaks which rule.">',
    '<link rel="canonical" href="https://lawcheck.dev/">',
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Lawcheck"><meta property="og:title" content="Lawcheck"><meta property="og:description" content="x"><meta property="og:url" content="https://lawcheck.dev/">',
    '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":"SoftwareApplication","softwareVersion":"1.2.3"}]}</script>',
    '<h1>Architecture checks for coding agents</h1><a href="/changelog">1.2.3</a>',
  ].join('\n'),
  '404.html': '<h1>This address is not on lawcheck.dev.</h1><a href="/">Lawcheck home</a>',
  'robots.txt': 'User-agent: *\nAllow: /\n\nSitemap: https://lawcheck.dev/sitemap.xml\n',
  'sitemap.xml': '<urlset><url><loc>https://lawcheck.dev/</loc></url></urlset>',
  'vercel.json': '{"redirects":[{"source":"/:page(install)","destination":"https://docs.lawcheck.dev/:page.html","permanent":true}]}',
};

function built(files: Record<string, string>): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-landing-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return problems(dir, '1.2.3');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('test 781: the check of the built landing page passes a page with its head, its JSON-LD, its 404 page, robots.txt, sitemap.xml and vercel.json, and names each fault planted in one (control)', () => {
  assert.deepEqual(built(GOOD), []);
  const index = GOOD['index.html']!;
  assert.deepEqual(built({ ...GOOD, 'index.html': index.replace('<h1>', '<h1>x</h1><h1>') }), ['index.html has 2 h1 elements, not one']);
  assert.deepEqual(built({ ...GOOD, 'index.html': index.replace('https://lawcheck.dev/">', 'https://lawcheck.dev/quick-start">') }), ['the canonical address is ["https://lawcheck.dev/quick-start"], not https://lawcheck.dev/ once']);
  assert.deepEqual(built({ ...GOOD, 'index.html': index.replace('"softwareVersion":"1.2.3"', '"softwareVersion":"1.2.2","aggregateRating":{}') }), ['the JSON-LD names the version 1.2.2, not 1.2.3', 'the JSON-LD holds a rating or a review']);
  assert.deepEqual(built({ ...GOOD, 'index.html': index.replace('>1.2.3<', '>1.2<') }), ['index.html does not show the version 1.2.3']);
  assert.deepEqual(built({ ...GOOD, '404.html': '<h1>x</h1><script type="module" src="/app.js"></script>' }), ['404.html has no link to /', '404.html loads the app, which would replace its text']);
  assert.deepEqual(built({ ...GOOD, 'vercel.json': '{' }), ['vercel.json is missing or does not parse']);
  assert.deepEqual(built({ 'index.html': index }), ['404.html is missing', 'robots.txt does not name the sitemap', 'sitemap.xml does not hold https://lawcheck.dev/', 'vercel.json is missing or does not parse']);
});

test('test 782: the landing page finds a paragraph, a sentence and a code block by its heading and its opening words, so one that is gone or one that starts like another stops the build, as a missing heading or table row does (control)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-fragments-'));
  try {
    const page = ['# Tool', '', 'It checks files. It needs Node 24.', '', 'The law is a file.', '', '```text', '$ tool check', '```', '', '| Case | Use |', '|---|---|', '| one language | a linter |', ''];
    writeFileSync(join(dir, 'a.md'), page.join('\n'));
    writeFileSync(join(dir, 'b.md'), page.filter((line) => line !== 'The law is a file.').join('\n').replace('It checks files. ', '').replace('$ tool check', 'tool help'));
    writeFileSync(join(dir, 'c.md'), page.join('\n').replace('It needs Node 24.', 'It checks git.'));
    const fragments = new Fragments(dir);
    assert.equal(fragments.sentence('a.md', 'Tool', 'It needs'), 'It needs Node 24.');
    assert.equal(fragments.paragraph('a.md', 'Tool', 'The law'), 'The law is a file.');
    assert.deepEqual(fragments.code('a.md', 'Tool', '$ tool'), { lang: 'text', code: '$ tool check' });
    assert.deepEqual(fragments.rows('a.md', 'Tool', 1, ['one language']), [['Case', 'Use'], ['one language', 'a linter']]);
    assert.throws(() => fragments.sentence('b.md', 'Tool', 'It checks'), { message: 'site/landing: b.md has 0 sentences under "Tool" that start with "It checks", and the landing page pulls exactly one' });
    assert.throws(() => fragments.paragraph('b.md', 'Tool', 'The law'), { message: 'site/landing: b.md has 0 paragraphs under "Tool" that start with "The law", and the landing page pulls exactly one' });
    assert.throws(() => fragments.code('b.md', 'Tool', '$ tool'), { message: 'site/landing: b.md has 0 code blocks under "Tool" that start with "$ tool", and the landing page pulls exactly one' });
    assert.throws(() => fragments.sentence('c.md', 'Tool', 'It checks'), { message: 'site/landing: c.md has 2 sentences under "Tool" that start with "It checks", and the landing page pulls exactly one' });
    assert.throws(() => fragments.paragraph('a.md', 'Limits', 'The law'), { message: 'site/landing: a.md has 0 headings "Limits", and the landing page pulls from exactly one' });
    assert.throws(() => fragments.rows('a.md', 'Tool', 1, ['two languages']), { message: 'site/landing: table 1 under "Tool" of a.md has no row "two languages"' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
