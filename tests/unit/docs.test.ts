import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { DOCS_DIR, fitChangelog, forTerminal, page, topicList, topics } from '../../dist/docs.js';

test('commands-slice §7: every topic has its page, whose first line is its title', () => {
  assert.equal(topics().length, readdirSync(DOCS_DIR).filter((name) => name.endsWith('.md')).length);
  for (const { id, title } of topics()) {
    assert.ok(existsSync(`${DOCS_DIR}${id}.md`), id);
    assert.equal(page(id).split('\n')[0], `# ${title}`);
  }
});

test('commands-slice §7: the list names the topics in order', () => {
  const lines = topicList(topics()).split('\n');
  assert.equal(lines[0], `lawcheck docs: ${topics().length} topics; lawcheck docs <topic> prints one`);
  assert.deepEqual(lines.filter((line) => line.startsWith('  ')), topics().map((t) => `  ${t.id}  ${t.title}`));
});

test('test 414: the list names the topics under their sections, each section once, in the order of docs/topics.json', () => {
  const list = [
    { id: 'a', title: 'A page', section: 'Start' },
    { id: 'b', title: 'B page', section: 'Start' },
    { id: 'c', title: 'C page', section: 'Reference' },
  ];
  assert.equal(topicList(list), 'lawcheck docs: 3 topics; lawcheck docs <topic> prints one\n\nStart\n  a  A page\n  b  B page\n\nReference\n  c  C page\n');
});

test('test 415: a link to a page of docs/ prints as the command that prints that page, and any other link, or a link in a code block or in inline code, stays as written', () => {
  const ids = ['law', 'codes'];
  const text = [
    'See [the law file](law.md) and [the codes](codes.md#law-invalid).',
    'Read [the site](https://example.com/law.md), [a file](../README.md) and [no page](nope.md).',
    'Write `[the law file](law.md)` or ``a `[link](law.md)` here``, then [the law file](law.md).',
    '```',
    '[the law file](law.md)',
    '```',
    '',
  ].join('\n');
  assert.equal(
    forTerminal(text, ids),
    [
      'See the law file (lawcheck docs law) and the codes (lawcheck docs codes).',
      'Read [the site](https://example.com/law.md), [a file](../README.md) and [no page](nope.md).',
      'Write `[the law file](law.md)` or ``a `[link](law.md)` here``, then the law file (lawcheck docs law).',
      '```',
      '[the law file](law.md)',
      '```',
      '',
    ].join('\n'),
  );
});

test('commands-slice §7: the package ships docs', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { files: string[] };
  assert.ok(manifest.files.includes('docs'));
});

test('test 1413: a changelog over the limit prints its first section whole, then whole releases while they fit, then the line that names the whole changelog; one within the limit prints as written', () => {
  const whole = 'The older releases are not printed here. The whole changelog is in `docs/changelog.md` of the installed package and at https://docs.lawcheck.dev/changelog.html.';
  const head = '# Changelog\n\nIntro.\n\n';
  const unreleased = `## [Unreleased]\n\n### Added\n\n- ${'u'.repeat(300)}\n\n\`\`\`text\n## not a section\n\`\`\`\n\n`;
  const three = `## [3] - 2026-01-03\n\n- ${'c'.repeat(100)}\n\n`;
  const two = `## [2] - 2026-01-02\n\n- ${'b'.repeat(100)}\n\n`;
  const one = `## [1] - 2026-01-01\n\n- ${'a'.repeat(400)}\n\nNext: [Supported environments](support.md)\n`;
  const text = head + unreleased + three + two + one;
  const tail = `${whole}\n`;
  assert.equal(fitChangelog(text, [...text].length), text);
  assert.equal(fitChangelog(text, [...text].length - 1), head + unreleased + three + two + tail);
  assert.equal(fitChangelog(text, [...(head + unreleased + three + two + tail)].length - 1), head + unreleased + three + tail);
  // The first release that does not fit ends the page: an older and shorter one is not printed in its place.
  const long = head + unreleased + three + `## [2] - 2026-01-02\n\n- ${'b'.repeat(5000)}\n\n` + one;
  assert.equal(fitChangelog(long, 1000), head + unreleased + three + tail);
  // The first section is never cut, whatever the limit.
  assert.equal(fitChangelog(text, 10), head + unreleased + tail);
  assert.equal(fitChangelog('# Changelog\n\n' + 'x'.repeat(50), 10), '# Changelog\n\n' + 'x'.repeat(50));
  // The limit counts characters, not UTF-16 units.
  const astral = '# Changelog\n\n## a\n\n' + '\u{1D4B3}'.repeat(20) + '\n\n## b\n';
  assert.equal(fitChangelog(astral, [...astral].length), astral);
});
