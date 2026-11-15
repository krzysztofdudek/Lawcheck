import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../../dist/config.js';
import { ollama } from '../../dist/providers/ollama.js';

const config = { ...DEFAULT_CONFIG, provider: 'ollama' as const, model: 'm', timeout: 300 };

function stubFetch(reply: unknown) {
  const original = globalThis.fetch;
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    seen.push({ url: String(url), headers: init.headers, body: init.body });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  return { seen, restore: () => (globalThis.fetch = original) };
}

test('reviewer-slice §6: ready needs no key, and refuses an invalid endpoint', () => {
  assert.equal(ollama(config, {}).ready(), null);
  assert.equal(ollama(config, { LAWCHECK_REVIEWER_ENDPOINT: 'http://h:11434' }).ready(), null);
  assert.equal(ollama(config, { LAWCHECK_REVIEWER_ENDPOINT: 'ftp://h' }).ready(), 'LAWCHECK_REVIEWER_ENDPOINT is no http: or https: address');
});

test('reviewer-slice §6: the request goes to localhost:11434 by default, and carries no key', async () => {
  const stub = stubFetch({ model: 'm', message: { role: 'assistant', content: 'the answer' }, done: true });
  try {
    const keys = { LAWCHECK_REVIEWER_KEY: 'l', OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a', GOOGLE_API_KEY: 'g' };
    assert.deepEqual(await ollama({ ...config, temperature: 0.4 }, keys).ask('p'), { answer: 'the answer' });
    await ollama(config, { ...keys, LAWCHECK_REVIEWER_ENDPOINT: 'http://h:1/' }).ask('p');
    assert.deepEqual(stub.seen.map(({ url }) => url), ['http://localhost:11434/api/chat', 'http://h:1/api/chat']);
    assert.equal(stub.seen[0]!.body, JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'p' }], stream: false, format: 'json', options: { temperature: 0.4 } }));
    for (const { headers } of stub.seen) assert.deepEqual(Object.keys(headers), ['content-type']);
  } finally {
    stub.restore();
  }
});

test('reviewer-slice §6: an answer that is absent or no string is empty', async () => {
  for (const reply of [{}, { message: {} }, { message: { content: 1 } }]) {
    const stub = stubFetch(reply);
    try {
      assert.deepEqual(await ollama(config, {}).ask('p'), { answer: '' });
    } finally {
      stub.restore();
    }
  }
});
