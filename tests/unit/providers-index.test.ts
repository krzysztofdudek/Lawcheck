import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../../dist/config.js';
import { createProvider, endpointOf, variable } from '../../dist/providers/index.js';

test('the endpoint: http or https, trailing slashes removed, empty counts as absent', () => {
  assert.equal(endpointOf({}), null);
  assert.equal(endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: '' }), null);
  assert.deepEqual(endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: 'http://127.0.0.1:9/v1/' }), { url: 'http://127.0.0.1:9/v1' });
  assert.deepEqual(endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: 'https://example.com//' }), { url: 'https://example.com' });
  assert.ok('problem' in endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: 'not a url' })!);
  assert.ok('problem' in endpointOf({ LAWCHECK_REVIEWER_ENDPOINT: 'ftp://127.0.0.1/v1' })!);
  assert.equal(variable({ A: '' }, 'A'), null);
  assert.equal(variable({ A: 'x' }, 'A'), 'x');
});

test('the provider is chosen by name, and none without one', () => {
  assert.equal(createProvider(DEFAULT_CONFIG, {}), null);
  for (const name of ['openai-compatible', 'anthropic', 'claude-code'] as const) {
    const provider = createProvider({ ...DEFAULT_CONFIG, provider: name, model: 'm' }, {});
    assert.equal(typeof provider!.ready, 'function');
    assert.equal(typeof provider!.ask, 'function');
  }
});
