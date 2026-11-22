import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DOCS_DIR, forTerminal, page, topicList, topics } from '../../dist/docs.js';

test('commands-slice §7: every topic has its page, whose first line is its title', () => {
  assert.equal(topics().length, 33);
  for (const { id, title } of topics()) {
    assert.ok(existsSync(`${DOCS_DIR}${id}.md`), id);
    assert.equal(page(id).split('\n')[0], `# ${title}`);
  }
});

test('commands-slice §7: the list names the topics in order', () => {
  const lines = topicList(topics()).split('\n');
  assert.equal(lines[0], 'lawcheck docs: 33 topics; lawcheck docs <topic> prints one');
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
