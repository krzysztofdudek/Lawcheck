import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "1. Install Lawcheck"': SCENARIO,
  'block 1 under "2. Add the plugin"': SCENARIO,
};

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const readJson = (path: string): any => JSON.parse(read(path));

export async function scenario(page: Page): Promise<void> {
  const manifest = readJson('package.json');
  const marketplace = readJson('.claude-plugin/marketplace.json');
  const plugin = marketplace.plugins.find((entry: { source: string }) => entry.source === './plugin');
  assert.equal(page.text('block 1 under "1. Install Lawcheck"'), `$ npm install --global ${manifest.name}@alpha`);
  const repository = /github\.com\/([^/]+\/[^/]+?)\.git$/.exec(manifest.repository.url)?.[1];
  assert.equal(page.text('block 1 under "2. Add the plugin"'), `claude plugin marketplace add ${repository}\nclaude plugin install ${plugin.name}@${marketplace.name}`);

  // Ruling cursor-bez-sesji: every text says only that Cursor loads the plugin through its support for Claude Code plugins and that no Cursor session has run it.
  const text = read('docs/cursor.md');
  for (const sentence of ['Cursor loads a plugin only when `enabledPlugins` holds `true` for it', 'No session of Cursor ran the plugin.', 'The hooks of the plugin that run in Cursor', 'Windows.', 'The Cursor editor.']) assert.ok(text.includes(sentence), sentence);
  for (const file of ['README.md', 'CHANGELOG.md', 'docs/changelog.md', 'docs/index.md', 'docs/other-tools.md', 'docs/other-agents.md', 'docs/plugin.md', 'docs/cursor.md']) assert.ok(read(file).includes('No session of Cursor ') || read(file).includes('no session of Cursor '), `${file} says that no session of Cursor has run the plugin`);
  for (const file of ['README.md', 'CHANGELOG.md', 'docs/changelog.md', 'docs/index.md', 'docs/other-tools.md', 'docs/other-agents.md', 'docs/plugin.md', 'docs/cursor.md']) assert.ok(!read(file).includes('.cursor/hooks.json'), `${file} claims nothing of the entries that Cursor's hooks need`);

  const readme = read('README.md');
  assert.ok(readme.includes('No session of Cursor has run the plugin. `lawcheck docs cursor` says what was checked and what was not.'));
  assert.ok(read('CHANGELOG.md').includes('No session of Cursor has run the plugin; `lawcheck docs cursor` says what was checked and what was not.'));
  assert.ok(read('site/landing/facts.ts').includes("fragments.paragraph('README.md', 'Your coding agent', 'In Cursor, the plugin for Claude Code')"));
  assert.ok(read('site/landing/Landing.vue').includes('data.tryIt.cursor'));
}
