import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../../dist/config.js';
import { copilotArguments, copilotCli, findCopilot } from '../../dist/providers/copilot-cli.js';

test('the arguments: silent, no questions, no instructions, no built-in servers, no shell, writes, addresses or memory', () => {
  const head = ['--silent', '--no-ask-user', '--no-custom-instructions', '--disable-builtin-mcps', '--deny-tool', 'shell', '--deny-tool', 'write', '--deny-tool', 'url', '--deny-tool', 'memory', '--no-auto-update'];
  assert.deepEqual(copilotArguments('m'), [...head, '--model', 'm']);
  assert.deepEqual(copilotArguments(null), head);
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
