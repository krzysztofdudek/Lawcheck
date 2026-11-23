import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lawcheck, newRepository, write } from '../acceptance/helpers.ts';
import { exampleText } from '../harness/examples.ts';
import { json, nothing, Session, withBench } from '../acceptance/plugin-bench.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "Lawcheck in Claude Code"': SCENARIO,
  'block 1 under "1. Install Lawcheck"': SCENARIO,
  'block 1 under "2. Add the plugin"': SCENARIO,
  'block 1 under "3. Start a session"': SCENARIO,
  'block 1 under "4. See the check after an edit"': SCENARIO,
  'block 1 under "5. See the check before the agent finishes"': SCENARIO,
  'block 2 under "5. See the check before the agent finishes"': SCENARIO,
  'block 1 under "6. Switch off one of the checks"': SCENARIO,
  'block 1 under "7. Let the agent write the first law"': SCENARIO,
};

const read = (path: string): any => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const TOTAL = 'export function total(price: number): number {\n  console.log(price);\n  return price;\n}\n';

export async function scenario(page: Page): Promise<void> {
  const manifest = read('package.json');
  const marketplace = read('.claude-plugin/marketplace.json');
  const plugin = marketplace.plugins.find((entry: { source: string }) => entry.source === './plugin');
  const id = `${plugin.name}@${marketplace.name}`;
  assert.match(manifest.version, /-alpha\.\d+$/, 'the package is published under the tag alpha');
  assert.equal(page.text('block 1 under "1. Install Lawcheck"'), `$ npm install --global ${manifest.name}@alpha`);
  const repository = /github\.com\/([^/]+\/[^/]+?)\.git$/.exec(manifest.repository.url)?.[1];
  assert.equal(page.text('block 1 under "2. Add the plugin"'), `claude plugin marketplace add ${repository}\nclaude plugin install ${id}`);

  const configure = /^\$ echo '(.*)' \| claude plugin configure (\S+) --values-stdin$/.exec(page.text('block 1 under "6. Switch off one of the checks"'));
  assert.ok(configure, 'the line pipes a JSON object to claude plugin configure');
  assert.equal(configure[2], id);
  const values = JSON.parse(configure[1]!) as Record<string, string>;
  assert.deepEqual(Object.keys(values), ['check_after_edit']);
  assert.ok(Object.hasOwn(read('plugin/.claude-plugin/plugin.json').userConfig, 'check_after_edit'));
  const skill = readFileSync(new URL('../../plugin/skills/setup/SKILL.md', import.meta.url), 'utf8');
  assert.equal(page.text('block 1 under "7. Let the agent write the first law"'), `/${plugin.name}:${/^name: (\S+)$/m.exec(skill)?.[1]}`, 'the command names the plugin and its skill');

  await withBench(async (bench, dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': page.text('block 1 under "Lawcheck in Claude Code"'), '.lawcheck/rules/no-console.mjs': exampleText('first-law-rule'), 'src/core/price.ts': 'export const price = 1;\n' });
    const session = new Session(bench, repo);
    assert.equal(page.text('block 1 under "3. Start a session"'), '$ lawcheck prime');
    const primed = await lawcheck(repo, ['prime']);
    json(await session.start(), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: primed.stdout.replace(/\n$/, '') } }, 'the session start gives the agent the text of prime');

    nothing(await session.prompt(), 'the prompt');
    write(repo, 'src/core/total.ts', TOTAL);
    json(await session.edit('src/core/total.ts'), { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: page.text('block 1 under "4. See the check after an edit"') } }, 'the edit');
    json(await session.stop(), { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: page.text('block 1 under "5. See the check before the agent finishes"') } }, 'the first end of the turn');
    json(await session.stop({ stop_hook_active: true }), { systemMessage: page.text('block 2 under "5. See the check before the agent finishes"') }, 'the same output twice in a row lets the agent finish');

    const off = { CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT: values.check_after_edit };
    nothing(await session.edit('src/core/total.ts', 'Write', {}, off), 'an edit with the check after an edit switched off');
  });
}
