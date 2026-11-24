import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "The Claude Code plugin"': SCENARIO,
  'block 1 under "SessionStart"': 'tests/acceptance/plugin.test.ts > S6-5: with a reviewer rule and no reviewer set, prime says so and the session start tells the user once',
  'block 1 under "The end of a turn"': 'tests/acceptance/plugin.test.ts > test 851: the end of a turn that added a waiver or changed the law tells the user once, and a waiver from before the turn is not named',
};

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));

const SETUP_SENTENCES = [
  '**Advice**, such as `/lawcheck:setup what could be better here?`: the agent writes at most three boundaries or rules that the code does not hold today into `.lawcheck/advice.md`.',
  'lays out at most seven steps, each one change of the law that `lawcheck check` passes on the day it goes in.',
  'Nothing in either file is law, and no command of Lawcheck reads them.',
  'A line goes into `.lawcheck/law.yaml` only when you say yes to that item or that step, and a yes to the whole plan writes no law.',
  'The skill never offers advice or a target on its own.',
];

export async function scenario(page: Page): Promise<void> {
  const text = readFileSync(new URL('../../docs/plugin.md', import.meta.url), 'utf8');
  const section = text.slice(text.indexOf('\n## The setup skill\n'), text.indexOf('\n## The settings\n'));
  for (const sentence of SETUP_SENTENCES) assert.ok(section.includes(sentence), `the part "The setup skill" lacks "${sentence}"`);
  const marketplace = read('.claude-plugin/marketplace.json') as { name: string; plugins: { name: string; source: string }[] };
  const manifest = read('package.json') as { repository: { url: string } };
  const repository = /github\.com\/([^/]+\/[^/]+?)\.git$/.exec(manifest.repository.url)?.[1];
  assert.ok(repository, manifest.repository.url);
  const plugin = marketplace.plugins.find((entry) => entry.source === './plugin');
  assert.ok(plugin, 'the marketplace lists the plugin of plugin/');
  assert.equal(page.text('block 1 under "The Claude Code plugin"'), [
    `claude plugin marketplace add ${repository}`,
    `claude plugin install ${plugin.name}@${marketplace.name}`,
  ].join('\n'));
}
