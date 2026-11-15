import { test } from 'node:test';
import { platformSkip } from '../harness/tool.ts';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../../dist/config.js';
import { claudeArguments, claudeCode, readOutput } from '../../dist/providers/claude-code.js';

test('the arguments, with --model only when a model is set', () => {
  const tail = ['--tools', '', '--disable-slash-commands', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence'];
  assert.deepEqual(claudeArguments('m'), ['--print', '--output-format', 'json', '--model', 'm', ...tail]);
  assert.deepEqual(claudeArguments(null), ['--print', '--output-format', 'json', ...tail]);
});

test('the output: the envelope, raw text, and the failures', () => {
  assert.deepEqual(readOutput(0, null, '{"type":"result","is_error":false,"result":"A"}\n', ''), { answer: 'A' });
  assert.deepEqual(readOutput(0, null, 'plain answer', ''), { answer: 'plain answer' });
  assert.deepEqual(readOutput(0, null, '{"type":"other","result":"A"}', ''), { answer: '{"type":"other","result":"A"}' });
  assert.deepEqual(readOutput(1, null, '{"type":"result","is_error":true,"result":"Not logged in"}', ''), { failure: 'Not logged in', resend: false });
  assert.deepEqual(readOutput(0, null, '{"type":"result","is_error":true,"result":"limit"}', ''), { failure: 'limit', resend: false });
  assert.deepEqual(readOutput(3, null, 'out\n', 'one\nboom\n\n'), { failure: 'boom', resend: false });
  assert.deepEqual(readOutput(3, null, 'first\nlast\n', ''), { failure: 'last', resend: false });
  assert.equal((readOutput(1, null, '', 'x'.repeat(400)) as { failure: string }).failure.length, 300);
  assert.ok('failure' in readOutput(null, 'SIGTERM', '', ''));
});

test('claude is looked up on PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-path-'));
  try {
    const name = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    writeFileSync(join(dir, name), '#!/bin/sh\n');
    if (platformSkip('a claude that is not executable') === null) {
      assert.match(claudeCode({ ...DEFAULT_CONFIG, provider: 'claude-code' }, { PATH: dir }).ready()!, /not on PATH/);
      chmodSync(join(dir, name), 0o755);
    }
    assert.equal(claudeCode({ ...DEFAULT_CONFIG, provider: 'claude-code' }, { PATH: dir }).ready(), null);
    assert.match(claudeCode({ ...DEFAULT_CONFIG, provider: 'claude-code' }, { PATH: join(dir, 'nonexistent') }).ready()!, /not on PATH/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
