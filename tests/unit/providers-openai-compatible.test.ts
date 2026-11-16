import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_CONFIG } from '../../dist/config.js';
import { openaiCompatible } from '../../dist/providers/openai-compatible.js';

const config = { ...DEFAULT_CONFIG, provider: 'openai-compatible' as const, model: 'm' };

test('test 64: ready needs a valid endpoint, and no key', () => {
  assert.match(openaiCompatible(config, {}).ready()!, /LAWCHECK_REVIEWER_ENDPOINT/);
  assert.match(openaiCompatible(config, { LAWCHECK_REVIEWER_ENDPOINT: 'x' }).ready()!, /no URL/);
  assert.equal(openaiCompatible(config, { LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1' }).ready(), null);
});

test('tests 404, 64: the request and the answer', async () => {
  const seen: { url?: string; headers?: Record<string, unknown>; body?: string }[] = [];
  const replies = [
    JSON.stringify({ choices: [{ message: { content: 'the answer' } }] }),
    JSON.stringify({ choices: [{ message: { content: 5 } }] }),
    JSON.stringify({}),
  ];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c)).on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body });
      res.end(replies[seen.length - 1]);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
  try {
    const keyed = openaiCompatible({ ...config, temperature: 0.2 }, { LAWCHECK_REVIEWER_ENDPOINT: endpoint, LAWCHECK_REVIEWER_KEY: 'k', OPENAI_API_KEY: 'o' });
    assert.deepEqual(await keyed.ask('hello'), { answer: 'the answer' });
    assert.equal(seen[0]!.url, '/v1/chat/completions');
    assert.equal(seen[0]!.headers!.authorization, 'Bearer k');
    assert.equal(seen[0]!.body, JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hello' }], temperature: 0.2, response_format: { type: 'json_object' } }));
    const bare = openaiCompatible(config, { LAWCHECK_REVIEWER_ENDPOINT: endpoint, OPENAI_API_KEY: 'o' });
    assert.deepEqual(await bare.ask('x'), { answer: '' });
    assert.equal(seen[1]!.headers!.authorization, undefined);
    assert.deepEqual(await bare.ask('x'), { answer: '' });
  } finally {
    await new Promise((done) => server.close(done));
  }
});
