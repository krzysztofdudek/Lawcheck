import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../../dist/config.js';
import { openai } from '../../dist/providers/openai.js';

const config = { ...DEFAULT_CONFIG, provider: 'openai' as const, model: 'm' };

function stubFetch(reply: unknown, status = 200) {
  const original = globalThis.fetch;
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  globalThis.fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    seen.push({ url: String(url), headers: init.headers, body: init.body });
    return new Response(JSON.stringify(reply), { status });
  }) as typeof fetch;
  return { seen, restore: () => (globalThis.fetch = original) };
}

test('ready: a key, and only LAWCHECK_REVIEWER_KEY with an endpoint', () => {
  assert.equal(openai(config, { OPENAI_API_KEY: 'o' }).ready(), null);
  assert.equal(openai(config, { LAWCHECK_REVIEWER_KEY: 'l' }).ready(), null);
  assert.equal(openai(config, {}).ready(), 'openai needs a key in OPENAI_API_KEY or LAWCHECK_REVIEWER_KEY');
  assert.match(openai(config, { LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1', OPENAI_API_KEY: 'o' }).ready()!, /sends LAWCHECK_REVIEWER_KEY alone/);
});

test('without an endpoint, OPENAI_API_KEY goes to api.openai.com before LAWCHECK_REVIEWER_KEY, in the body of chat completions', async () => {
  const stub = stubFetch({ choices: [{ message: { role: 'assistant', content: 'the answer' } }] });
  try {
    assert.deepEqual(await openai({ ...config, temperature: 0.3 }, { OPENAI_API_KEY: 'o', LAWCHECK_REVIEWER_KEY: 'l' }).ask('p'), { answer: 'the answer' });
    await openai(config, { LAWCHECK_REVIEWER_KEY: 'l' }).ask('p');
    await openai(config, { LAWCHECK_REVIEWER_ENDPOINT: 'http://h/v1/', LAWCHECK_REVIEWER_KEY: 'l', OPENAI_API_KEY: 'o' }).ask('p');
    assert.deepEqual(
      stub.seen.map(({ url, headers }) => [url, headers.authorization]),
      [
        ['https://api.openai.com/v1/chat/completions', 'Bearer o'],
        ['https://api.openai.com/v1/chat/completions', 'Bearer l'],
        ['http://h/v1/chat/completions', 'Bearer l'],
      ],
    );
    assert.equal(stub.seen[0]!.body, JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'p' }], temperature: 0.3, response_format: { type: 'json_object' } }));
  } finally {
    stub.restore();
  }
});

test('an answer that is absent or no string is empty, and no call is made without a key', async () => {
  const stub = stubFetch({ choices: [{ message: { content: 5 } }] });
  try {
    assert.deepEqual(await openai(config, { OPENAI_API_KEY: 'o' }).ask('p'), { answer: '' });
    assert.ok('failure' in (await openai(config, {}).ask('p')));
    assert.equal(stub.seen.length, 1);
  } finally {
    stub.restore();
  }
});
