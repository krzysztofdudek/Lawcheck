import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexArguments } from '../../dist/providers/codex.js';

test('the arguments: codex exec with its tools off, the model only when set, and the prompt on standard input', () => {
  const head = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--ignore-rules', '--color', 'never'];
  const off = ['--disable', 'shell_tool', '--disable', 'view_image', '--disable', 'multi_agent', '--disable', 'goals', '--disable', 'hooks', '--disable', 'plugins', '--disable', 'apps', '-c', 'web_search=disabled'];
  assert.deepEqual(codexArguments('m'), [...head, ...off, '--model', 'm', '-']);
  assert.deepEqual(codexArguments(null), [...head, ...off, '-']);
});
