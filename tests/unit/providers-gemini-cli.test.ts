import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { geminiArguments, NO_TOOLS_POLICY, POLICY_FILE } from '../../dist/providers/gemini-cli.js';

test('reviewer-slice §6: the arguments: text output, no extensions, no MCP server, a policy that denies every tool', () => {
  const tail = ['--skip-trust', '--approval-mode', 'plan', '--extensions', 'none', '--allowed-mcp-server-names', 'lawcheck-allows-no-mcp-server', '--policy', join('/aside', POLICY_FILE)];
  assert.deepEqual(geminiArguments('m', '/aside'), ['--output-format', 'text', '--model', 'm', ...tail]);
  assert.deepEqual(geminiArguments(null, '/aside'), ['--output-format', 'text', ...tail]);
  assert.equal(NO_TOOLS_POLICY, '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n');
});
