import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DOCS_DIR, page, topicList, TOPICS } from '../../dist/docs.js';

test('commands-slice §7: every topic has its page, whose first line is its title', () => {
  assert.equal(TOPICS.length, 12);
  for (const { id, title } of TOPICS) {
    assert.ok(existsSync(`${DOCS_DIR}${id}.md`), id);
    assert.equal(page(id).split('\n')[0], `# ${title}`);
  }
});

test('commands-slice §7: the list names the topics in order', () => {
  const lines = topicList().split('\n');
  assert.equal(lines[0], 'lawcheck docs: 12 topics; lawcheck docs <topic> prints one');
  assert.deepEqual(lines.slice(2, 14), TOPICS.map((t) => `${t.id}  ${t.title}`));
});

test('commands-slice §7: the package ships docs', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { files: string[] };
  assert.ok(manifest.files.includes('docs'));
});
