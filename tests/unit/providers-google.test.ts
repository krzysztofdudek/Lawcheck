import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../../dist/config.js';
import { google } from '../../dist/providers/google.js';

const config = { ...DEFAULT_CONFIG, provider: 'google' as const, model: 'm' };

function stubFetch(reply: unknown) {
  const original = globalThis.fetch;
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    seen.push({ url: String(url), headers: init.headers, body: init.body });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  return { seen, restore: () => (globalThis.fetch = original) };
}

test('test 401: ready: a key, and only LAWCHECK_REVIEWER_KEY with an endpoint', () => {
  assert.equal(google(config, { GOOGLE_API_KEY: 'g' }).ready(), null);
  assert.equal(google(config, { LAWCHECK_REVIEWER_KEY: 'l' }).ready(), null);
  assert.equal(google(config, {}).ready(), 'google needs a key in GOOGLE_API_KEY or LAWCHECK_REVIEWER_KEY');
  assert.match(google(config, { LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1', GOOGLE_API_KEY: 'g' }).ready()!, /sends LAWCHECK_REVIEWER_KEY alone/);
});

test('test 401: the request: the model in the path, the key in x-goog-api-key and never in the address', async () => {
  const stub = stubFetch({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'thinking', thought: true }, { inlineData: {} }, { text: 'b' }] } }] });
  try {
    assert.deepEqual(await google({ ...config, model: 'gemini x/1' }, { GOOGLE_API_KEY: 'g', LAWCHECK_REVIEWER_KEY: 'l' }).ask('p'), { answer: 'ab' });
    await google(config, { LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1beta/', LAWCHECK_REVIEWER_KEY: 'l', GOOGLE_API_KEY: 'g' }).ask('p');
    assert.deepEqual(
      stub.seen.map(({ url, headers }) => [url, headers['x-goog-api-key']]),
      [
        ['https://generativelanguage.googleapis.com/v1beta/models/gemini%20x%2F1:generateContent', 'g'],
        ['http://h/v1beta/models/m:generateContent', 'l'],
      ],
    );
    assert.equal(stub.seen[1]!.body, JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'p' }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }));
    assert.ok(stub.seen.every(({ url }) => !url.includes('key')));
  } finally {
    stub.restore();
  }
});

test('test 401: a reply without parts is an empty answer', async () => {
  for (const reply of [{}, { candidates: [] }, { candidates: [{ content: { parts: 'x' } }] }, { candidates: [{ finishReason: 'SAFETY' }] }]) {
    const stub = stubFetch(reply);
    try {
      assert.deepEqual(await google(config, { GOOGLE_API_KEY: 'g' }).ask('p'), { answer: '' }, JSON.stringify(reply));
    } finally {
      stub.restore();
    }
  }
});
