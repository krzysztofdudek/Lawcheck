import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, parseConfig, readConfig } from '../../dist/config.js';

const BASE = 'reviewer:\n  provider: openai-compatible\n  model: test-model\n';

function problems(text: string) {
  const parsed = parseConfig(text);
  return 'problems' in parsed ? parsed.problems : [];
}

test('reviewer-slice §6: an empty file, or one of comments, sets nothing', () => {
  assert.deepEqual(parseConfig(''), { config: DEFAULT_CONFIG });
  assert.deepEqual(parseConfig('# nothing yet\n\n# still nothing\n'), { config: DEFAULT_CONFIG });
});

test('reviewer-slice §6: the defaults and every key', () => {
  assert.deepEqual(parseConfig(BASE), { config: { ...DEFAULT_CONFIG, provider: 'openai-compatible', model: 'test-model' } });
  assert.deepEqual(parseConfig('reviewer:\n  provider: claude-code\n'), {
    config: { ...DEFAULT_CONFIG, provider: 'claude-code', timeout: 300, parallel: 1, temperature: null },
  });
  assert.deepEqual(
    parseConfig('reviewer:\n  provider: anthropic\n  model: m\n  timeout: 86400\n  temperature: 0.5\n  max_chars: 1\n  parallel: 9\n  max_calls: 0\n'),
    { config: { provider: 'anthropic', model: 'm', timeout: 86400, temperature: 0.5, maxChars: 1, parallel: 9, maxCalls: 0 } },
  );
  for (const provider of ['codex', 'gemini-cli', 'copilot-cli'] as const) {
    assert.deepEqual(parseConfig(`reviewer:\n  provider: ${provider}\n`), {
      config: { ...DEFAULT_CONFIG, provider, timeout: 300, parallel: 1, temperature: null },
    });
  }
  assert.deepEqual(parseConfig('reviewer:\n  provider: ollama\n  model: m\n'), { config: { ...DEFAULT_CONFIG, provider: 'ollama', model: 'm', timeout: 300 } });
  assert.deepEqual(parseConfig(`reviewer:\n  provider: codex\n  model: ${'m'.repeat(256)}\n`), { config: { ...DEFAULT_CONFIG, provider: 'codex', model: 'm'.repeat(256), timeout: 300, parallel: 1, temperature: null } });
  for (const provider of ['openai', 'google'] as const) {
    assert.deepEqual(parseConfig(`reviewer:\n  provider: ${provider}\n  model: m\n`), { config: { ...DEFAULT_CONFIG, provider, model: 'm' } });
  }
  assert.deepEqual(parseConfig('reviewer:\n  max_calls: 3\n'), { config: { ...DEFAULT_CONFIG, maxCalls: 3 } });
});

test('reviewer-slice §6: each config-invalid message', () => {
  const cases: [string, number, RegExp][] = [
    [BASE.replace('openai-compatible', 'gemini'), 2, /^the provider 'gemini' is unknown; this version has anthropic, openai, google, openai-compatible, ollama, claude-code, codex, gemini-cli, copilot-cli$/],
    [BASE.replace('openai-compatible', 'codx'), 2, /^the provider 'codx' is unknown \(did you mean 'codex'\?\)/],
    [BASE.replace('openai-compatible', 'claude-cod'), 2, /^the provider 'claude-cod' is unknown \(did you mean 'claude-code'\?\)/],
    [BASE.replace('openai-compatible', 'mistral'), 2, /^the provider 'mistral' is unknown; this version has/],
    [BASE.replace('openai-compatible', '12'), 2, /provider takes a string, not 12/],
    [BASE.replace('reviewer:', 'reviewr:'), 1, /^unknown key 'reviewr' at the top of the config \(did you mean 'reviewer'\?\)$/],
    [BASE + 'keys: { anthropic: x }\n', 4, /^a key never goes into a committed file; set LAWCHECK_REVIEWER_KEY, or the provider's own ANTHROPIC_API_KEY, OPENAI_API_KEY or GOOGLE_API_KEY, in the environment$/],
    [BASE + '  keys: x\n', 4, /^a key never goes into a committed file/],
    [BASE + '  endpoint: http://localhost\n', 4, /^reviewer\.endpoint is not read: the address comes from the variable LAWCHECK_REVIEWER_ENDPOINT$/],
    [BASE + '  modle: x\n', 4, /^unknown key 'modle' in 'reviewer' \(did you mean 'model'\?\)$/],
    [BASE + '  runner: x\n', 4, /^unknown key 'runner' in 'reviewer'$/],
    [BASE + 'scripts: x\n', 4, /^unknown key 'scripts' at the top of the config$/],
    [BASE + '  max_calls: -1\n', 4, /^reviewer\.max_calls takes an integer of at least 0, not -1$/],
    [BASE + '  parallel: 0\n', 4, /^reviewer\.parallel takes an integer of at least 1, not 0$/],
    [BASE + '  timeout: "60"\n', 4, /^reviewer\.timeout takes an integer of seconds from 1 to 86400, not the string "60"$/],
    [BASE + '  timeout: 86401\n', 4, /^reviewer\.timeout takes an integer of seconds from 1 to 86400, not 86401$/],
    [BASE + '  timeout: 0\n', 4, /86400, not 0$/],
    [BASE + '  max_chars: 1.5\n', 4, /^reviewer\.max_chars takes an integer of at least 1, not 1\.5$/],
    [BASE + '  temperature: -1\n', 4, /^reviewer\.temperature takes a number of at least 0, not -1$/],
    [BASE + '  temperature: hot\n', 4, /^reviewer\.temperature takes a number of at least 0, not the string "hot"$/],
    ['reviewer:\n  provider: claude-code\n  temperature: 0.5\n', 3, /^the provider claude-code takes no temperature: the claude program runs at its own$/],
    ['reviewer:\n  provider: claude-code\n  temperature: 0\n', 3, /takes no temperature/],
    ['reviewer:\n  provider: openai-compatible\n', 1, /^the provider 'openai-compatible' needs reviewer\.model$/],
    ['reviewer:\n  provider: anthropic\n', 1, /^the provider 'anthropic' needs reviewer\.model$/],
    ['reviewer:\n  provider: openai\n', 1, /^the provider 'openai' needs reviewer\.model$/],
    ['reviewer:\n  provider: google\n', 1, /^the provider 'google' needs reviewer\.model$/],
    ['reviewer:\n  provider: ollama\n', 1, /^the provider 'ollama' needs reviewer\.model$/],
    ['reviewer:\n  provider: codex\n  temperature: 0\n', 3, /^the provider codex takes no temperature: the codex program runs at its own$/],
    ['reviewer:\n  provider: gemini-cli\n  temperature: 0\n', 3, /^the provider gemini-cli takes no temperature: the gemini program runs at its own$/],
    ['reviewer:\n  provider: copilot-cli\n  temperature: 0\n', 3, /^the provider copilot-cli takes no temperature: the copilot program runs at its own$/],
    [BASE.replace('test-model', '""'), 3, /^reviewer\.model takes a non-empty string of at most 256 characters with no control character, not the string ""$/],
    [BASE.replace('test-model', '"a\\nb"'), 3, /with no control character, not the string "a\\nb"$/],
    [BASE.replace('test-model', '"a\\u0000b"'), 3, /^reviewer\.model takes a non-empty string of at most 256 characters with no control character, not the string "a\\u0000b"$/],
    [BASE.replace('test-model', 'm'.repeat(257)), 3, /^reviewer\.model takes a non-empty string of at most 256 characters with no control character, not a string of 257 characters$/],
    ['reviewer:\n', 1, /^'reviewer' takes a mapping, not nothing$/],
    ['reviewer: [1]\n', 1, /'reviewer' takes a mapping, not a sequence/],
    ['- reviewer\n', 1, /^the config takes a mapping, not a sequence$/],
    ['reviewer:\n  ~: x\n', 2, /^the key '~' is no string; write it in quotes$/],
    ['reviewer:\n  provider: [\n', 3, /^the config does not parse/],
    [BASE + '  model: twice\n', 4, /does not parse/],
  ];
  for (const [text, line, message] of cases) {
    const found = problems(text);
    assert.equal(found.length, 1, `${JSON.stringify(text)}: ${JSON.stringify(found)}`);
    assert.equal(found[0]!.line, line, `${JSON.stringify(text)}: ${JSON.stringify(found)}`);
    assert.match(found[0]!.message, message, JSON.stringify(text));
  }
});

test('reviewer-slice §6: the file is read from the disk at the root, when it exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'lawcheck-config-'));
  try {
    assert.deepEqual(readConfig(root), { config: DEFAULT_CONFIG });
    mkdirSync(join(root, '.lawcheck'));
    writeFileSync(join(root, '.lawcheck/config.yaml'), BASE);
    assert.equal((readConfig(root) as { config: { model: string } }).config.model, 'test-model');
    rmSync(join(root, '.lawcheck/config.yaml'));
    mkdirSync(join(root, '.lawcheck/config.yaml'));
    assert.ok('problems' in readConfig(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
