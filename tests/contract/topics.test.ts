import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const DOCS = new URL('../../docs/', import.meta.url);

export function topicsProblems(files: string[], topics: { id: string }[]): string[] {
  const problems: string[] = [];
  const ids = topics.map((t) => t.id);
  for (const id of new Set(ids.filter((id, at) => ids.indexOf(id) !== at))) problems.push(`docs/topics.json names ${id} more than once`);
  for (const id of ids) if (!files.includes(`${id}.md`)) problems.push(`docs/topics.json names ${id}, and docs/${id}.md does not exist`);
  for (const file of files) if (file.endsWith('.md') && !ids.includes(file.slice(0, -'.md'.length))) problems.push(`docs/${file} is not in docs/topics.json`);
  return problems;
}

test('test 418: docs/topics.json and the pages of docs/ name each other one to one', () => {
  const topics = JSON.parse(readFileSync(new URL('topics.json', DOCS), 'utf8')) as { id: string }[];
  assert.deepEqual(topicsProblems(readdirSync(DOCS), topics), []);
});

test('test 700: docs/changelog.md is CHANGELOG.md, byte for byte', () => {
  assert.equal(readFileSync(new URL('changelog.md', DOCS), 'utf8'), readFileSync(new URL('../CHANGELOG.md', DOCS), 'utf8'));
});

test('test 419: control, a page with no entry, an entry with no page, and an id named twice are each named', () => {
  const files = ['law.md', 'codes.md', 'topics.json'];
  const topics = [{ id: 'law' }, { id: 'codes' }];
  assert.deepEqual(topicsProblems(files, topics), []);
  assert.deepEqual(topicsProblems([...files, 'extra.md'], topics), ['docs/extra.md is not in docs/topics.json']);
  assert.deepEqual(topicsProblems(['law.md', 'topics.json'], topics), ['docs/topics.json names codes, and docs/codes.md does not exist']);
  assert.deepEqual(topicsProblems(files, [...topics, { id: 'law' }]), ['docs/topics.json names law more than once']);
});
