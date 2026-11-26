import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ROOT } from '../harness/sets.ts';
import { ALLOWED_NAMES } from './allowed-names.ts';
import { heroProblems, phoneProblems, problems, tutorialProblems } from '../../site/landing/check.mjs';
import { problems as docsCardProblems } from '../../site/check-docs-card.mjs';
import { CARD, cardHead, cardProblems, pngProblems } from '../../site/theme/card.mjs';
import { CATEGORY, FINDING, og } from '../../site/theme/og.mjs';
import { Fragments, isAhead } from '../../site/landing/fragments.ts';

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

const png = (width: number, height: number, bytes = 1000): Buffer => {
  const file = Buffer.alloc(bytes);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(file);
  file.writeUInt32BE(width, 16);
  file.writeUInt32BE(height, 20);
  return file;
};

const cardTags = (): string => cardHead().map(([, attributes]) => `<meta ${Object.entries(attributes as Record<string, string>).map(([key, value]) => `${key}="${value.replace(/"/g, '&quot;')}"`).join(' ')}>`).join('');

const GOOD: Record<string, string | Buffer> = {
  'index.html': [
    '<title>Lawcheck: architecture and rule checks for coding agents</title>',
    '<meta name="description" content="Lawcheck checks your code against the architecture and rules you write down, and tells your coding agent which line breaks which rule.">',
    '<link rel="canonical" href="https://lawcheck.dev/">',
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Lawcheck"><meta property="og:title" content="Lawcheck"><meta property="og:description" content="x"><meta property="og:url" content="https://lawcheck.dev/">',
    cardTags(),
    '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":"SoftwareApplication","softwareVersion":"1.2.3"}]}</script>',
    '<h1>Architecture and rule checks for coding agents</h1><a href="/changelog">1.2.3</a>',
    '<figure id="film" class="film hero-film"><div class="film-frame"><pre><code><span class="line">src/core/discount.ts:1  error[forbidden-use]  core may not use api</span></code></pre></div></figure>',
  ].join('\n'),
  'og.png': png(1200, 630),
  '404.html': '<h1>This address has no page.</h1><a href="/">Lawcheck home</a>',
  'robots.txt': 'User-agent: *\nAllow: /\n\nSitemap: https://lawcheck.dev/sitemap.xml\n',
  'sitemap.xml': '<urlset><url><loc>https://lawcheck.dev/</loc></url></urlset>',
  'vercel.json': '{"redirects":[{"source":"/:page(install)","destination":"https://docs.lawcheck.dev/:page.html","permanent":true}]}',
};

function built(files: Record<string, string | Buffer>): string[] {
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
  const index = GOOD['index.html'] as string;
  assert.deepEqual(built({ ...GOOD, 'index.html': index.replace('<h1>', '<h1>x</h1><h1>') }), ['index.html has 2 h1 elements, not one']);
  assert.deepEqual(built({ ...GOOD, 'index.html': index.replace('https://lawcheck.dev/">', 'https://lawcheck.dev/quick-start">') }), ['the canonical address is ["https://lawcheck.dev/quick-start"], not https://lawcheck.dev/ once']);
  assert.deepEqual(built({ ...GOOD, 'index.html': index.replace('"softwareVersion":"1.2.3"', '"softwareVersion":"1.2.2","aggregateRating":{}') }), ['the JSON-LD names the version 1.2.2, not 1.2.3', 'the JSON-LD holds a rating or a review']);
  assert.deepEqual(built({ ...GOOD, 'index.html': index.replace('>1.2.3<', '>1.2<') }), ['index.html does not show the version 1.2.3']);
  assert.deepEqual(built({ ...GOOD, '404.html': '<h1>x</h1><script type="module" src="/app.js"></script>' }), ['404.html has no link to /', '404.html loads the app, which would replace its text']);
  assert.deepEqual(built({ ...GOOD, 'vercel.json': '{' }), ['vercel.json is missing or does not parse']);
  assert.deepEqual(built({ ...GOOD, 'index.html': index.replace(/<meta name="twitter:card"[^>]*>/, '') }), ['index.html: twitter:card is [], not summary_large_image once']);
  assert.deepEqual(built({ ...GOOD, 'og.png': png(1200, 600) }), ['og.png is 1200 by 600, not 1200 by 630']);
  assert.deepEqual(built({ 'index.html': index }), ['og.png is missing', '404.html is missing', 'robots.txt does not name the sitemap', 'sitemap.xml does not hold https://lawcheck.dev/', 'vercel.json is missing or does not parse']);
});

const CHAPTERS = [
  { page: 'quick-start', files: { mp4: { name: 'quick-start.mp4' }, vtt: { name: 'quick-start.vtt' }, jpg: { name: 'quick-start.jpg' } } },
  { page: 'ci', files: { mp4: { name: 'ci.mp4' }, vtt: { name: 'ci.vtt' }, jpg: { name: 'ci.jpg' } } },
];
const card = (page: string): string => `<li id="tutorial-${page}" class="chapter"><button type="button" class="button chapter-play">Play</button><a href="https://docs.lawcheck.dev/${page}.html">Read the page</a></li>`;
const TUTORIAL = `<section id="tutorial" class="wrap tutorial"><ol class="chapters">${CHAPTERS.map((chapter) => card(chapter.page)).join('')}</ol></section>`;

function tutorialOf(index: string, chapters: unknown[], present: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-tutorial-'));
  try {
    mkdirSync(join(dir, 'film'));
    for (const name of present) writeFileSync(join(dir, 'film', name), 'x');
    return tutorialProblems(index, dir, chapters);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('test 1034: the check of the built landing page wants the section #tutorial with one card per listed chapter, in order, each with its files, its link and a Play button, and nothing of a chapter loaded before a click, and wants no such section when no chapter is listed (control)', () => {
  const files = CHAPTERS.flatMap((chapter) => Object.values(chapter.files).map((file) => file.name));
  assert.deepEqual(tutorialOf(TUTORIAL, CHAPTERS, files), []);
  assert.deepEqual(tutorialOf('<main></main>', [], []), []);
  assert.deepEqual(tutorialOf(TUTORIAL, [], []), ['index.html shows the tutorial, and film/published.json lists no chapter']);
  assert.deepEqual(tutorialOf('<main></main>', CHAPTERS, files), ['index.html has 0 sections with the id tutorial, not one', 'the tutorial shows the chapters [], and film/published.json lists [quick-start, ci]', 'the card of the chapter quick-start has no link to its page', 'the card of the chapter ci has no link to its page', 'the tutorial has 0 Play buttons, not 2']);
  assert.deepEqual(tutorialOf(`<section id="tutorial">${card('ci')}${card('quick-start')}</section>`, CHAPTERS, files), ['the tutorial shows the chapters [ci, quick-start], and film/published.json lists [quick-start, ci]']);
  assert.deepEqual(tutorialOf(TUTORIAL, CHAPTERS, files.filter((name) => name !== 'ci.vtt')), ['film/ci.vtt of the chapter ci is missing']);
  assert.deepEqual(tutorialOf(TUTORIAL.replace('<a href="https://docs.lawcheck.dev/ci.html">', '<a href="https://docs.lawcheck.dev/index.html">'), CHAPTERS, files), ['the card of the chapter ci has no link to its page']);
  assert.deepEqual(tutorialOf(TUTORIAL.replace('class="button chapter-play"', 'class="chapter-play"'), CHAPTERS, files), ['the tutorial has 1 Play buttons, not 2']);
  assert.deepEqual(tutorialOf(`${TUTORIAL}<video poster="/film/ci.jpg"></video>`, CHAPTERS, files), ['index.html loads a video, a track or an image of a chapter before a click']);
});

const LOOP = { seconds: 28.9, files: { mp4: { name: 'loop.mp4' }, webm: { name: 'loop.webm' }, gif: { name: 'loop.gif' } } };
const STILL = '<figure id="film" class="film hero-film"><div class="film-frame"><span class="line mark">src/core/discount.ts:1  error[forbidden-use]  core may not use api</span></div></figure>';
const PLAYER = '<figure id="film" class="film hero-film"><video class="film-loop" aria-label="Claude Code imports the HTTP handlers into the business logic." autoplay muted loop playsinline><source src="/film/loop.webm" type="video/webm"><source src="/film/loop.mp4" type="video/mp4"></video></figure>';

function heroOf(index: string, loop: unknown, present: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-hero-'));
  try {
    mkdirSync(join(dir, 'film'));
    for (const name of present) writeFileSync(join(dir, 'film', name), 'x');
    return heroProblems(index, dir, loop);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('test 1350: the check of the built landing page wants the hero to play the loop film/published.json lists, from files the build downloaded and with a label, and to show the refusal error[forbidden-use] when no loop is listed (control)', () => {
  assert.deepEqual(heroOf(STILL, null, []), []);
  assert.deepEqual(heroOf(PLAYER, LOOP, ['loop.webm', 'loop.mp4']), []);
  assert.deepEqual(heroOf('<main></main>', null, []), ['index.html has no figure with the id film in its hero']);
  assert.deepEqual(heroOf(STILL.replace('error[forbidden-use]', 'may_use: [core]'), null, []), ['the still of the hero does not show error[forbidden-use]']);
  assert.deepEqual(heroOf(PLAYER, null, []), ['the hero plays a video, and film/published.json lists no loop', 'the still of the hero does not show error[forbidden-use]']);
  assert.deepEqual(heroOf(STILL, LOOP, ['loop.webm', 'loop.mp4']), ['the hero has no source /film/loop.webm', 'the hero has no source /film/loop.mp4', 'the video of the hero has no label']);
  assert.deepEqual(heroOf(PLAYER, LOOP, ['loop.webm']), ['film/loop.mp4 of the loop is missing']);
  assert.deepEqual(heroOf(PLAYER.replace(/ aria-label="[^"]*"/, ''), LOOP, ['loop.webm', 'loop.mp4']), ['the video of the hero has no label']);
  assert.deepEqual(tutorialOf(PLAYER, [], []), [], 'the loop of the hero is no chapter loaded before a click');
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

test('test 891: the card of the landing page and of the documentation is a PNG of 1200 by 630 pixels under 300 KB that the pages name by its full address with its text, and each fault planted in the file or in a page is named (control)', () => {
  const card = readFileSync(join(ROOT, 'site/landing/public/og.png'));
  assert.deepEqual(pngProblems(card), []);
  assert.equal(CARD.url, 'https://lawcheck.dev/og.png');
  const tags = cardTags();
  assert.deepEqual(cardProblems(tags, 'p'), []);
  assert.deepEqual(pngProblems(png(1200, 630)), []);
  assert.deepEqual(pngProblems(png(1200, 600)), ['og.png is 1200 by 600, not 1200 by 630']);
  assert.deepEqual(pngProblems(png(1200, 630, 300 * 1024)), ['og.png has 307200 bytes, not under 307200']);
  assert.deepEqual(pngProblems(Buffer.from('GIF89a and more')), ['og.png is not a PNG file']);
  assert.deepEqual(cardProblems(tags.replace('https://lawcheck.dev/og.png', '/og.png'), 'p'), [`p: og:image is ["/og.png"], not "https://lawcheck.dev/og.png" once`]);
  assert.deepEqual(cardProblems(tags.replace(/<meta property="og:image:alt"[^>]*>/, ''), 'p'), [`p: og:image:alt is [], not ${JSON.stringify(CARD.alt)} once`]);
  assert.deepEqual(cardProblems(tags.replace('summary_large_image', 'summary'), 'p'), ['p: twitter:card is ["summary"], not summary_large_image once']);
  assert.deepEqual(cardProblems(tags + tags, 'p').length, 6);
});

test('test 891: the check of the built documentation names a page without the card tags, and the finding on the card is a line that README.md shows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-docs-card-'));
  try {
    writeFileSync(join(dir, 'install.html'), `<meta property="og:url" content="https://docs.lawcheck.dev/install.html">${cardTags()}`);
    writeFileSync(join(dir, 'concepts.html'), '<meta property="og:url" content="https://docs.lawcheck.dev/concepts.html">');
    writeFileSync(join(dir, '404.html'), '<h1>x</h1>');
    const found = docsCardProblems(dir, join(ROOT, 'site/landing/public/og.png'));
    assert.equal(found.length, 6);
    assert.ok(found.every((line) => line.startsWith('concepts.html: ')));
    assert.deepEqual(docsCardProblems(dir, join(ROOT, 'brand/mark.svg')).slice(0, 1), ['og.png is not a PNG file']);
    for (const name of ['install.html', 'concepts.html']) rmSync(join(dir, name));
    assert.deepEqual(docsCardProblems(dir, join(ROOT, 'site/landing/public/og.png')), [`${dir} has no page with an og:url`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(read('README.md').includes(`${FINDING.place}  ${FINDING.code}  ${FINDING.text}`), 'the finding of the card is a line of README.md');
  const html = og(JSON.parse(read('brand/tokens.json')), { interFont: '/a.woff2', monoFont: '/b.woff2', markFile: join(ROOT, 'brand/mark.svg') });
  for (const text of [CATEGORY, FINDING.place, FINDING.code, FINDING.text]) assert.ok(html.includes(text), text);
});

const SHEET = [
  '.pair{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:32px}',
  '.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}',
  '@media(max-width:860px){.pair{grid-template-columns:minmax(0,1fr)}.cards{grid-template-columns:minmax(0,1fr)}}',
  '@media(max-width:400px){.bar-inner{gap:8px}}',
  '@font-face{font-family:x;src:url(a.woff2)}',
].join('\n');

function sheetProblems(css: string | null): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-phone-'));
  try {
    if (css !== null) {
      mkdirSync(join(dir, 'assets'));
      writeFileSync(join(dir, 'assets', 'style.css'), css);
    }
    return phoneProblems(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('test 892: the check of the built landing page passes a stylesheet that stacks its grids below 860 px, and names a grid that keeps two columns at 320, 360 and 390 px, a stylesheet that is missing, and a media query that does not reach a phone (control)', () => {
  assert.deepEqual(sheetProblems(SHEET), []);
  const broken = SHEET.replace('.pair{grid-template-columns:minmax(0,1fr)}', '.pair,.terminal pre{white-space:pre-wrap}');
  assert.deepEqual(sheetProblems(broken), [320, 360, 390].map((width) => `at ${width} px .pair keeps 2 columns (minmax(0,5fr) minmax(0,7fr)), so its blocks stand side by side on a phone`));
  assert.deepEqual(sheetProblems(SHEET.replace('max-width:860px', 'max-width:300px')), [320, 360, 390].flatMap((width) => [`at ${width} px .pair keeps 2 columns (minmax(0,5fr) minmax(0,7fr)), so its blocks stand side by side on a phone`, `at ${width} px .cards keeps 3 columns (repeat(3,minmax(0,1fr))), so its blocks stand side by side on a phone`]));
  assert.deepEqual(sheetProblems(SHEET.replace('max-width:860px', 'min-width:861px')), sheetProblems(SHEET.replace('max-width:860px', 'max-width:300px')));
  assert.deepEqual(sheetProblems(null), ['assets has no stylesheet']);
});

test('test 1009: the finding on the card and in its alt text is the whole line that README.md shows, and the alt text says it is the first line of a finding (issue 244)', () => {
  const line = `${FINDING.place}  ${FINDING.code}  ${FINDING.text}`;
  assert.ok(read('README.md').split('\n').includes(line), 'a whole line of README.md');
  assert.ok(CARD.alt.includes(`${FINDING.place} ${FINDING.code}, ${FINDING.text}.`), 'the alt text holds the line to its end');
  assert.ok(CARD.alt.includes('the first line of one finding'), 'the alt text says that more of the finding follows');
});

test('test 1007: the landing page says its build is ahead of its release while CHANGELOG.md holds text under Unreleased, and says nothing when that section is empty or gone (control)', () => {
  assert.equal(isAhead(['# Changelog', '', '## [Unreleased]', '', 'A new flag.', '', '## [1.2.3] - 2026-01-01', '', 'Old text.'].join('\n')), true);
  assert.equal(isAhead(['# Changelog', '', '## [Unreleased]', '', '## [1.2.3] - 2026-01-01', '', 'Old text.'].join('\n')), false);
  assert.equal(isAhead(['# Changelog', '', '## [Unreleased]', ''].join('\n')), false);
  assert.equal(isAhead(['# Changelog', '', '## [1.2.3] - 2026-01-01', '', 'Old text.'].join('\n')), false);
  assert.equal(isAhead('## [Unreleased]\nA new flag.'), true);
});

test('test 1140: the redirect file of the landing sends /docs, /docs/ and /docs/<page> of every page of docs/topics.json, with and without .html, in one permanent redirect to the same page of the documentation host', () => {
  const file = JSON.parse(read('site/landing/public/vercel.json')) as { redirects: Array<{ source: string; destination: string; permanent: boolean }> };
  const land = (path: string): string | undefined => {
    for (const redirect of file.redirects) {
      const named = redirect.source.match(/^\/:page\((.*)\)(\.html)?$|^\/docs\/:page\((.*)\)(\.html)?$/);
      const body = named ? `/${redirect.source.startsWith('/docs/') ? 'docs/' : ''}(?<page>${named[1] ?? named[3]})${named[2] ?? named[4] ?? ''.replace('.', '\\.')}` : redirect.source;
      const match = new RegExp(`^${body.replace(/\.html$/, '\\.html')}$`).exec(path);
      if (match) {
        assert.equal(redirect.permanent, true);
        return redirect.destination.replace(':page', match.groups?.page ?? '');
      }
    }
    return undefined;
  };
  assert.equal(land('/docs'), 'https://docs.lawcheck.dev/');
  assert.equal(land('/docs/'), 'https://docs.lawcheck.dev/');
  for (const page of pages) {
    const target = page === 'index' ? 'https://docs.lawcheck.dev/' : `https://docs.lawcheck.dev/${page}.html`;
    assert.equal(land(`/docs/${page}`), target, page);
    assert.equal(land(`/docs/${page}.html`), target, `${page}.html`);
  }
  assert.equal(land('/docs/unknown-page'), undefined);
  for (const redirect of file.redirects) {
    const listed = /\(([a-z0-9|-]+)\)/.exec(redirect.source)?.[1];
    if (listed) assert.deepEqual(listed.split('|'), [...pages].filter((id) => id !== 'index'), redirect.source);
  }
});

test('test 1426: the first contact gives the architecture and the rules equal place: README.md and docs/index.md open with the category line of the card and the landing page and the promise of the manifests, and README.md, docs/index.md and the landing page each show a law with may_use and a script rule, the rule file, and a finding of each', () => {
  const promise = `${CATEGORY}. You write down which layer may use which and script the rules your code must keep, and Lawcheck names the file and line that break them, in the hooks of Claude Code, Codex and Copilot CLI and in CI.`;
  assert.equal(copyOf(read('site/landing/index.md')).copy.h1, CATEGORY);
  assert.ok((JSON.parse(read('package.json')) as { description: string }).description.startsWith(promise), 'package.json opens with the promise');
  const fragments = new Fragments(ROOT);
  const shown = [
    { page: 'README.md', law: ['Lawcheck', 'lawcheck: 0.1.0'], rule: ['Lawcheck', 'export function check'], finding: ['Lawcheck', '$ lawcheck check'] },
    { page: 'docs/index.md', law: ['A rule and a finding', 'lawcheck: 0.1.0'], rule: ['A rule and a finding', 'export function check'], finding: ['A rule and a finding', 'lawcheck: FAIL'] },
  ];
  for (const { page, law, rule, finding } of shown) {
    assert.ok(read(page).includes(`\n${promise}`), `${page} opens with the promise`);
    const written = parse(fragments.code(page, law[0]!, law[1]!).code) as { rules: Record<string, unknown>; types: Record<string, { may_use?: string[]; rules?: string[] }> };
    const ruled = Object.values(written.types).find((type) => type.may_use !== undefined && type.rules !== undefined);
    assert.ok(ruled, `${page}: one type of the law has may_use and rules`);
    const id = ruled.rules![0]!;
    assert.ok(id in written.rules, `${page}: the law names ${id}`);
    assert.match(fragments.code(page, rule[0]!, rule[1]!).code, /^export function check\(/);
    const output = fragments.code(page, finding[0]!, finding[1]!).code;
    assert.match(output, /  error\[forbidden-use\]  /, `${page}: a finding of may_use`);
    assert.ok(output.includes(`  error[${id}]  `), `${page}: a finding of ${id}`);
  }
  const landing = read('site/landing/Landing.vue');
  for (const shownThere of ['data.law.law', 'data.law.rule', 'data.law.finding']) assert.ok(landing.includes(`v-html="${shownThere}"`), `the landing page shows ${shownThere}`);
  const facts = read('site/landing/facts.ts');
  assert.ok(facts.includes("code('README.md', 'Lawcheck', 'export function check')"), 'the landing page takes the rule file of README.md');
});
