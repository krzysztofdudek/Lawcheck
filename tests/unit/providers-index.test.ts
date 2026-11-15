import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../../dist/config.js';
import { createProvider, endpointOf, ownKey, variable } from '../../dist/providers/index.js';

test('reviewer-slice §6: the endpoint: http or https, trailing slashes removed, empty counts as absent', () => {
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

test('reviewer-slice §6: the provider is chosen by name, and none without one', () => {
  assert.equal(createProvider(DEFAULT_CONFIG, {}), null);
  for (const name of ['anthropic', 'openai', 'google', 'openai-compatible', 'ollama', 'claude-code', 'codex', 'gemini-cli', 'copilot-cli'] as const) {
    const provider = createProvider({ ...DEFAULT_CONFIG, provider: name, model: 'm' }, {});
    assert.equal(typeof provider!.ready, 'function');
    assert.equal(typeof provider!.ask, 'function');
  }
});

test('reviewer-slice §6: a key under a provider name goes only to its own address', () => {
  const own = 'https://own.example/v1';
  const keyed = (env: Record<string, string>) => ownKey(env, 'p', own, 'OWN_KEY');
  assert.deepEqual(keyed({ OWN_KEY: 'a', LAWCHECK_REVIEWER_KEY: 'l' }), { key: 'a', problem: null, fix: 'set OWN_KEY to the key alone, with no space or line break', keyName: 'OWN_KEY', base: own, keyed: { url: own, key: 'a' } });
  assert.deepEqual(keyed({ LAWCHECK_REVIEWER_KEY: 'l' }).keyed, { url: own, key: 'l' });
  assert.deepEqual(keyed({}), { key: null, problem: 'p needs a key in OWN_KEY or LAWCHECK_REVIEWER_KEY', fix: 'set OWN_KEY to your p key', keyName: 'LAWCHECK_REVIEWER_KEY', base: own, keyed: null });
  assert.deepEqual(keyed({ LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1/', OWN_KEY: 'a' }), {
    key: null,
    problem: 'with LAWCHECK_REVIEWER_ENDPOINT set, p sends LAWCHECK_REVIEWER_KEY alone, and it is not set',
    fix: 'set LAWCHECK_REVIEWER_KEY to the key for http://h/v1, or unset LAWCHECK_REVIEWER_ENDPOINT to call https://own.example/v1 with OWN_KEY',
    keyName: 'LAWCHECK_REVIEWER_KEY',
    base: 'http://h/v1',
    keyed: null,
  });
  assert.deepEqual(keyed({ LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1/', OWN_KEY: 'a', LAWCHECK_REVIEWER_KEY: 'l' }).keyed, { url: 'http://h/v1', key: 'l' });
  const wrong = keyed({ LAWCHECK_REVIEWER_ENDPOINT: 'gopher://h', LAWCHECK_REVIEWER_KEY: 'l' });
  assert.deepEqual([wrong.problem, wrong.fix, wrong.keyed], ['LAWCHECK_REVIEWER_ENDPOINT is no http: or https: address', 'set LAWCHECK_REVIEWER_ENDPOINT to an http: or https: address with no user, password, query or fragment', null]);
  const broken = keyed({ OWN_KEY: 'a\nb' });
  assert.deepEqual([broken.problem, broken.fix, broken.keyed], ['OWN_KEY holds a character an HTTP header cannot carry', 'set OWN_KEY to the key alone, with no space or line break', null]);
});
