import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexArguments, codexServers } from '../../dist/providers/codex.js';

test('the arguments: codex exec with its tools off, the model only when set, and the prompt on standard input', () => {
  const head = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--ignore-rules', '--color', 'never'];
  const off = ['--disable', 'shell_tool', '--disable', 'view_image', '--disable', 'multi_agent', '--disable', 'goals', '--disable', 'hooks', '--disable', 'plugins', '--disable', 'apps', '-c', 'web_search=disabled'];
  assert.deepEqual(codexArguments('m'), [...head, ...off, '--model', 'm', '-']);
  assert.deepEqual(codexArguments(null), [...head, ...off, '-']);
});

test('the MCP servers codex would start are switched off by name, and a name codex cannot address stops the call', () => {
  const head = codexArguments(null).slice(0, -1);
  assert.deepEqual(codexArguments('m', ['a', 'b-c_1']), [...head, '-c', 'mcp_servers.a.enabled=false', '-c', 'mcp_servers.b-c_1.enabled=false', '--model', 'm', '-']);
  assert.deepEqual(codexServers('[{"name":"a","enabled":true},{"name":"off","enabled":false},{"name":"b-c_1"}]'), { args: ['a', 'b-c_1'] });
  assert.deepEqual(codexServers('[]'), { args: [] });
  assert.deepEqual(codexServers('[{"name":"odd.name"}]'), {
    failure: 'codex would start the MCP server "odd.name", and a server whose name holds another character than a letter, a digit, _ or - cannot be switched off for one call',
    resend: false,
    fix: 'rename the server in ~/.codex/config.toml, or set enabled = false under [mcp_servers."odd.name"]',
  });
  const fix = 'run codex mcp list --json and fix what it says';
  assert.deepEqual(codexServers('{'), { failure: 'codex mcp list --json printed no JSON', resend: false, fix });
  assert.deepEqual(codexServers('{}'), { failure: 'codex mcp list --json printed no list', resend: false, fix });
  assert.deepEqual(codexServers('[{}]'), { failure: 'codex mcp list --json printed a server without a name', resend: false, fix });
});
