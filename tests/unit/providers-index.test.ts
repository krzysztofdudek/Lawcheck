import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../../dist/config.js';
import { createProvider, endpointOf, ownKey, variable } from '../../dist/providers/index.js';

test('the endpoint: http or https, trailing slashes removed, empty counts as absent', () => {
  assert.equal(endpointOf({}), null);
  assert.equal(endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: '' }), null);
  assert.deepEqual(endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: 'http://127.0.0.1:9/v1/' }), { url: 'http://127.0.0.1:9/v1' });
  assert.deepEqual(endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: 'https://example.com//' }), { url: 'https://example.com' });
  assert.ok('problem' in endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: 'not a url' })!);
  assert.ok('problem' in endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: 'ftp://127.0.0.1/v1' })!);
  const secret = endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: 'http://user:s3cr3t@127.0.0.1:9/v1' })!;
  assert.ok('problem' in secret && /user or a password/.test(secret.problem) && !secret.problem.includes('s3cr3t'));
  assert.ok('problem' in endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: 'http://user@127.0.0.1:9/v1' })!);
  assert.ok('problem' in endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1?x=1' })!);
  assert.ok('problem' in endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1#top' })!);
  assert.ok('problem' in endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1?' })!);
  assert.equal(variable({ A: '' }, 'A'), null);
  assert.equal(variable({ A: 'x' }, 'A'), 'x');
});

test('the provider is chosen by name, and none without one', () => {
  assert.equal(createProvider(DEFAULT_CONFIG, {}), null);
  for (const name of ['anthropic', 'openai', 'google', 'openai-compatible', 'ollama', 'claude-code', 'codex', 'gemini-cli', 'copilot-cli'] as const) {
    const provider = createProvider({ ...DEFAULT_CONFIG, provider: name, model: 'm' }, {});
    assert.equal(typeof provider!.ready, 'function');
    assert.equal(typeof provider!.ask, 'function');
  }
});

test('a key under a provider name goes only to its own address', () => {
  const own = 'https://own.example/v1';
  assert.deepEqual(ownKey({ OWN_KEY: 'a', LAWCHECK_REVIEWER_KEY: 'l' }, 'p', own, 'OWN_KEY'), { problem: null, keyed: { url: own, key: 'a' } });
  assert.deepEqual(ownKey({ LAWCHECK_REVIEWER_KEY: 'l' }, 'p', own, 'OWN_KEY'), { problem: null, keyed: { url: own, key: 'l' } });
  assert.deepEqual(ownKey({}, 'p', own, 'OWN_KEY'), { problem: 'p needs a key in OWN_KEY or LAWCHECK_REVIEWER_KEY', keyed: null });
  assert.deepEqual(ownKey({ LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1/', OWN_KEY: 'a' }, 'p', own, 'OWN_KEY'), {
    problem: 'with LAWCHECK_REVIEWER_ENDPOINT set, p sends LAWCHECK_REVIEWER_KEY alone, and it is not set',
    keyed: null,
  });
  assert.deepEqual(ownKey({ LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1/', OWN_KEY: 'a', LAWCHECK_REVIEWER_KEY: 'l' }, 'p', own, 'OWN_KEY'), { problem: null, keyed: { url: 'http://h/v1', key: 'l' } });
  assert.deepEqual(ownKey({ LAWCHECK_REVIEWER_ENDPOINT: 'gopher://h', LAWCHECK_REVIEWER_KEY: 'l' }, 'p', own, 'OWN_KEY'), { problem: 'LAWCHECK_REVIEWER_ENDPOINT is no http: or https: address', keyed: null });
  assert.deepEqual(ownKey({ OWN_KEY: 'a\nb' }, 'p', own, 'OWN_KEY'), { problem: 'OWN_KEY holds a character an HTTP header cannot carry', keyed: null });
});
