import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lawcheck, newRepository, write } from '../acceptance/helpers.ts';
import { exampleText } from '../harness/examples.ts';
import { CopilotSession, json, nothing, withBench } from '../acceptance/plugin-bench.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "Lawcheck in GitHub Copilot CLI"': SCENARIO,
  'block 1 under "1. Install Lawcheck"': SCENARIO,
  'block 1 under "2. Add the plugin"': SCENARIO,
  'block 1 under "3. Start a session"': SCENARIO,
  'block 1 under "4. See the check after an edit"': SCENARIO,
  'block 1 under "5. See the check before the agent finishes"': SCENARIO,
  'block 2 under "5. See the check before the agent finishes"': SCENARIO,
  'block 1 under "6. Switch off one of the checks"': SCENARIO,
};

const read = (path: string): any => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const TOTAL = 'export function total(price: number): number {\n  console.log(price);\n  return price;\n}\n';

export async function scenario(page: Page): Promise<void> {
  const manifest = read('package.json');
  const marketplace = read('.claude-plugin/marketplace.json');
  const plugin = marketplace.plugins.find((entry: { source: string }) => entry.source === './plugin');
  assert.equal(read('plugin/.plugin/plugin.json').name, plugin.name);
  assert.equal(page.text('block 1 under "1. Install Lawcheck"'), `$ npm install --global ${manifest.name}@alpha`);
  const repository = /github\.com\/([^/]+\/[^/]+?)\.git$/.exec(manifest.repository.url)?.[1];
  assert.equal(page.text('block 1 under "2. Add the plugin"'), `copilot plugin marketplace add ${repository}\ncopilot plugin install ${plugin.name}@${marketplace.name}`);
  const off = /^(LAWCHECK_PLUGIN_CHECK_AFTER_EDIT)=(\S+) copilot$/.exec(page.text('block 1 under "6. Switch off one of the checks"'));
  assert.ok(off, 'the line starts copilot with one variable');

  await withBench(async (bench, dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': page.text('block 1 under "Lawcheck in GitHub Copilot CLI"'), '.lawcheck/rules/no-console.mjs': exampleText('first-law-rule'), 'src/core/price.ts': 'export const price = 1;\n' });
    const session = new CopilotSession(bench, repo);
    assert.equal(page.text('block 1 under "3. Start a session"'), '$ lawcheck prime');
    const primed = await lawcheck(repo, ['prime']);
    json(await session.start(), { additionalContext: primed.stdout.replace(/\n$/, '') }, 'the session start gives the agent the text of prime');

    nothing(await session.prompt(), 'the prompt');
    write(repo, 'src/core/total.ts', TOTAL);
    json(await session.write('create', 'src/core/total.ts'), { additionalContext: page.text('block 1 under "4. See the check after an edit"') }, 'the edit by create');
    json(await session.stop(), { decision: 'block', reason: page.text('block 1 under "5. See the check before the agent finishes"') }, 'the first end of the turn');
    json(await session.stop({ stop_hook_active: true }), { decision: 'block', reason: page.text('block 2 under "5. See the check before the agent finishes"') }, 'the same output twice in a row: the agent goes back once to tell the user');
    nothing(await session.prompt({}, 'the reason of the hand-back'), 'the prompt event the message opens');
    nothing(await session.stop({ stop_hook_active: true }), 'the end of the turn in which the agent told the user');

    nothing(await session.prompt(), 'the next prompt');
    write(repo, 'src/core/shell.ts', 'console.log(1);\n');
    nothing(await session.run('edit', { toolName: 'bash', toolArgs: { command: "cat > src/core/shell.ts <<'EOF'\nconsole.log(1);\nEOF" } }), 'a file written through the shell gets no check after the edit');
    const caught = await session.stop();
    assert.equal(caught.json?.decision, 'block', 'the end of the turn catches the file written through the shell');
    assert.match(String(caught.json?.reason), /src\/core\/shell\.ts:1 {2}error\[no-console\]/);

    nothing(await session.write('edit', 'src/core/total.ts', { [off[1]!]: off[2]! }), 'an edit with the check after an edit switched off');
  });
}
