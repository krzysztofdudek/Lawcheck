import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_CONFIG } from '../../dist/config.js';
import { anthropic } from '../../dist/providers/anthropic.js';

const config = { ...DEFAULT_CONFIG, provider: 'anthropic' as const, model: 'm' };

test('a key goes only where it was given', () => {
  assert.equal(anthropic(config, { ANTHROPIC_API_KEY: 'a' }).ready(), null);
  assert.equal(anthropic(config, { LAWCHECK_REVIEWER_KEY: 'l' }).ready(), null);
  assert.match(anthropic(config, {}).ready()!, /key/);
  assert.match(anthropic(config, { LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1', ANTHROPIC_API_KEY: 'a' }).ready()!, /LAWCHECK_REVIEWER_KEY/);
  assert.equal(anthropic(config, { LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1', LAWCHECK_REVIEWER_KEY: 'l' }).ready(), null);
  assert.match(anthropic(config, { LAWCHECK_REVIEWER_ENDPOINT: 'gopher://h', LAWCHECK_REVIEWER_KEY: 'l' }).ready()!, /http/);
});

test('the request, and the text items joined', async () => {
  const seen: { url?: string; headers?: Record<string, unknown>; body?: string }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c)).on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body });
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'a' }, { type: 'tool_use', text: 'no' }, { type: 'text', text: 'b' }] }));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  try {
    const provider = anthropic(config, { LAWCHECK_REVIEWER_ENDPOINT: endpoint, LAWCHECK_REVIEWER_KEY: 'l', ANTHROPIC_API_KEY: 'a' });
    assert.deepEqual(await provider.ask('p'), { answer: 'ab' });
    assert.equal(seen[0]!.url, '/v1/messages');
    assert.equal(seen[0]!.headers!['x-api-key'], 'l');
    assert.equal(seen[0]!.headers!['anthropic-version'], '2023-06-01');
    assert.equal(seen[0]!.body, JSON.stringify({ model: 'm', max_tokens: 8192, temperature: 0, messages: [{ role: 'user', content: 'p' }] }));
  } finally {
    await new Promise((done) => server.close(done));
  }
});
