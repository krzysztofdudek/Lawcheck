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

// What Cursor maps for a Claude Code hook, from Cursor's documentation of third-party hooks and the code of Cursor Agent CLI 2026.11.22.
const CURSOR_EVENTS: Record<string, string> = { SessionStart: 'sessionStart', UserPromptSubmit: 'beforeSubmitPrompt', PostToolUse: 'postToolUse', Stop: 'stop' };

export async function scenario(page: Page): Promise<void> {
  const manifest = readJson('package.json');
  const marketplace = readJson('.claude-plugin/marketplace.json');
  const plugin = marketplace.plugins.find((entry: { source: string }) => entry.source === './plugin');
  assert.equal(page.text('block 1 under "1. Install Lawcheck"'), `$ npm install --global ${manifest.name}@alpha`);
  const repository = /github\.com\/([^/]+\/[^/]+?)\.git$/.exec(manifest.repository.url)?.[1];
  assert.equal(page.text('block 1 under "2. Add the plugin"'), `claude plugin marketplace add ${repository}\nclaude plugin install ${plugin.name}@${marketplace.name}`);

  const text = read('docs/cursor.md');
  const rows = [...text.matchAll(/^\| `(\w+)` \| `(\w+)` \|/gm)].map((row) => [row[1], row[2]]);
  const hooks = readJson('plugin/hooks/hooks.json').hooks;
  assert.deepEqual(Object.fromEntries(rows), CURSOR_EVENTS, 'the table gives the Cursor event of each hook of the plugin');
  assert.deepEqual(Object.keys(hooks), Object.keys(CURSOR_EVENTS), 'the plugin has the four hooks the table names');
  assert.ok(new RegExp(hooks.PostToolUse[0].matcher).test('Write'), 'the page says the check after an edit runs for the tool Cursor calls Write');
  assert.ok(text.includes('Cursor calls the tool that writes a file `Write`'));

  for (const sentence of ['at most three returns in a turn', 'Cursor shows the user no message that a hook of this plugin sends', 'No session of Cursor ran the plugin.', 'Windows.', 'The Cursor editor.']) assert.ok(text.includes(sentence), sentence);
  for (const heading of ['Three returns at most', 'The end of a turn', 'The notices the user gets', 'The settings', 'SessionStart']) assert.ok(read('docs/plugin.md').includes(`\n## ${heading}\n`) || read('docs/plugin.md').includes(`\n### ${heading}\n`), heading);

  const readme = read('README.md');
  assert.ok(readme.includes('I ran no session of Cursor with the plugin, because that needs a Cursor account. `lawcheck docs cursor` says what each hook does there and what I did not check.'));
  assert.ok(read('CHANGELOG.md').includes('No session of Cursor ran the plugin, because that needs a Cursor account; `lawcheck docs cursor` says what was checked and what was not.'));
  assert.ok(read('site/landing/facts.ts').includes("fragments.paragraph('README.md', 'Your coding agent', 'In Cursor, the plugin for Claude Code')"));
  assert.ok(read('site/landing/Landing.vue').includes('data.tryIt.cursor'));
}
