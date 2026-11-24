import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../harness/sets.ts';

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

// Ruling cursor-bez-sesji: no session of Cursor has run the plugin, so a text about Cursor says only that Cursor loads it through its support for Claude Code plugins and that no session has run it.
const PAGES = ['README.md', 'CHANGELOG.md', 'docs/changelog.md', 'docs/index.md', 'docs/other-tools.md', 'docs/other-agents.md', 'docs/plugin.md', 'docs/cursor.md'];

test('test 1310: every text about Cursor says that no session of Cursor has run the plugin and claims nothing of the hooks or entries Cursor would need (control)', () => {
  for (const page of PAGES) {
    const text = read(page);
    assert.match(text, /[Nn]o session of Cursor (has|ran)/, `${page} says that no session of Cursor has run the plugin`);
    assert.ok(!text.includes('.cursor/hooks.json'), `${page} claims nothing of the entries that Cursor's hooks need`);
  }
  assert.ok(!read('docs/cursor.md').includes('| `PostToolUse` |'), 'docs/cursor.md has no table of what each hook does in Cursor');
  assert.ok(read('docs/cursor.md').includes('Cursor loads a plugin only when `enabledPlugins` holds `true` for it'));
  assert.ok(read('README.md').includes("loads through Cursor's support for Claude Code plugins"));
  assert.ok(read('docs/index.md').includes("Cursor loads the plugin through its support for Claude Code plugins. No session of Cursor has run the plugin."));
});

test('test 1311: the Copilot CLI texts of the README, the docs home and other-tools say that the check after an edit never ran in the recorded sessions, and the record shows it (control)', () => {
  const record = JSON.parse(read('tests/agent/result-copilot.json')) as { arms: Record<string, { list: Array<{ log: Array<{ caller: string }> }> }> };
  const callers = new Set(Object.values(record.arms).flatMap((arm) => arm.list.flatMap((session) => session.log.map((call) => call.caller))));
  assert.ok(callers.has('stop'), 'the record holds sessions in which the check before the end of a turn ran');
  assert.ok(!callers.has('edit'), 'no recorded Copilot CLI session ran the check after an edit');
  assert.ok(read('README.md').includes('its check after an edit never ran in the 24 recorded sessions'));
  assert.ok(read('docs/index.md').includes('Its check after an edit never ran in the 24 recorded sessions'));
  assert.ok(read('docs/other-tools.md').includes('and in Copilot CLI before the agent ends its turn'));
});
