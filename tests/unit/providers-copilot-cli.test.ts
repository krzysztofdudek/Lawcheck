import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../../dist/config.js';
import { copilotArguments, copilotCli, copilotServers, findCopilot } from '../../dist/providers/copilot-cli.js';

test('the arguments: silent, no questions, no instructions, no MCP server, no tool, no temporary folder', () => {
  const head = ['--silent', '--no-ask-user', '--no-custom-instructions', '--disable-builtin-mcps'];
  const tail = ['--available-tools=lawcheck-offers-no-tool', '--disallow-temp-dir', '--no-auto-update'];
  assert.deepEqual(copilotArguments('m'), [...head, ...tail, '--model', 'm']);
  assert.deepEqual(copilotArguments(null, ['a', 'b c']), [...head, '--disable-mcp-server', 'a', '--disable-mcp-server', 'b c', ...tail]);
});

test('the servers copilot would start, from copilot mcp list --json', () => {
  assert.deepEqual(copilotServers('{"mcpServers":{"a":{"source":"user","enabled":true},"b c":{"source":"plugin"},"off":{"enabled":false}}}'), { args: ['a', 'b c'] });
  assert.deepEqual(copilotServers('{"mcpServers":{}}'), { args: [] });
  const fix = 'run copilot mcp list --json and fix what it says';
  assert.deepEqual(copilotServers('nope'), { failure: 'copilot mcp list --json printed no JSON', resend: false, fix });
  assert.deepEqual(copilotServers('[]'), { failure: 'copilot mcp list --json printed no mcpServers', resend: false, fix });
});

test('a copilot in the folder of the VS Code extension is passed over', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-copilot-'));
  try {
    const stub = join(dir, 'globalStorage', 'github.copilot-chat', 'copilotCli');
    const real = join(dir, 'bin');
    const name = process.platform === 'win32' ? 'copilot.cmd' : 'copilot';
    for (const folder of [stub, real]) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, name), '#!/bin/sh\n');
      chmodSync(join(folder, name), 0o755);
    }
    const separator = process.platform === 'win32' ? ';' : ':';
    assert.equal(findCopilot({ PATH: [stub, real].join(separator) }), join(real, name));
    assert.equal(findCopilot({ PATH: stub }), null);
    assert.equal(copilotCli({ ...DEFAULT_CONFIG, provider: 'copilot-cli' }, { PATH: stub }).ready(), 'the program copilot is not on PATH');
    assert.equal(copilotCli({ ...DEFAULT_CONFIG, provider: 'copilot-cli' }, { PATH: real }).ready(), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
