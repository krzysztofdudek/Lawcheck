import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openai, withFake, writeFakeClaude } from '../acceptance/fake-reviewer.ts';
import { F, F_PATH, lawcheck, pathWith, withR, write } from '../acceptance/helpers.ts';

// The owner's ruling klucz-zastapiony: every spelling of the one exact key in a reply's text is written as [key], and the reply is read as it came.
function masked(text: string, key: string): string {
  return text.split(key).join('[key]');
}

// A JSON string that writes every character of the text as a \u escape, as a model or a proxy may.
function escapedEverywhere(text: string): string {
  return `"${[...text].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')}"`;
}

const KEYS = ['e', '2', 'x', 'pass', 'k"e\\y', 'sk-canary-61f0c2d9'];

function failing(message: string, escaped: boolean): string {
  const text = escaped ? escapedEverywhere(message) : JSON.stringify(message);
  return `{"verdict": "fail", "findings": [{"line": 2, "message": ${text}}]}`;
}

for (const key of KEYS) {
  for (const escaped of [false, true]) {
    test(`S3-2: the key ${JSON.stringify(key)}${escaped ? ', written with \\u escapes,' : ''} is replaced in the parsed message, and the answer is still read (I-secret-1)`, async () => {
      const message = `the key is ${key}`;
      await withFake(
        async (fake) => {
          await withR(async (r) => {
            write(r, F_PATH, F);
            const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.url, LAWCHECK_REVIEWER_KEY: key };
            const run = await lawcheck(r, ['check', '--review', '--base', 'main', '--json'], env);
            assert.equal(run.code, 1, run.stdout);
            const document = JSON.parse(run.stdout);
            assert.deepEqual(document.findings.filter((f: { code: string }) => f.code === masked('clear-errors', key)).map((f: { message: string }) => f.message), [masked(message, key)]);
            const tried = await lawcheck(r, ['try', 'clear-errors', F_PATH, '--json'], env);
            assert.equal(tried.code, 1, tried.stdout);
            const run0 = JSON.parse(tried.stdout).runs[0];
            assert.equal(run0.findings[0].message, masked(message, key));
            if (key.length > 4) {
              for (const out of [run.stdout, tried.stdout]) {
                assert.ok(!out.includes(key) && !out.includes(JSON.stringify(key).slice(1, -1)) && !out.includes(escapedEverywhere(key).slice(1, -1)), out);
              }
            }
          });
        },
        () => openai(failing(message, escaped)),
      );
    });
  }
}

test('S3-2: a key that is a word of the JSON answer leaves the answer readable: a pass is a pass (I-secret-1)', async () => {
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const run = await lawcheck(r, ['check', '--review', '--base', 'main'], { LAWCHECK_REVIEWER_ENDPOINT: fake.url, LAWCHECK_REVIEWER_KEY: 'pass' });
        assert.equal(run.code, 0, run.stdout);
      });
    },
    () => openai('{"verdict": "pass", "findings": []}'),
  );
});

for (const key of ['e', 'k"e\\y']) {
  test(`S3-2: claude-code with the key ${JSON.stringify(key)} in its environment: the answer is read, and the key is replaced in its message (I-secret-1)`, async () => {
    await withR(async (r, dir) => {
      write(r, '.lawcheck/config.yaml', 'reviewer:\n  provider: claude-code\n');
      write(r, F_PATH, F);
      const env = { PATH: pathWith(writeFakeClaude(`${dir}/bin`)), FAKE_CLAUDE_MODE: 'echo-answer', LAWCHECK_REVIEWER_KEY: key, ANTHROPIC_API_KEY: 'zz-other-key-9a1b' };
      const run = await lawcheck(r, ['check', '--review', '--base', 'main', '--json'], env);
      assert.equal(run.code, 1, run.stdout);
      const messages = JSON.parse(run.stdout).findings.filter((f: { code: string }) => f.code === masked('clear-errors', key)).map((f: { message: string }) => f.message);
      const once = `the key is ${key} and zz-other-key-9a1b`.split('zz-other-key-9a1b').join('\u0000').split(key).join('[key]').split('\u0000').join('[key]');
      assert.deepEqual(messages, [once]);
    });
  });
}

test('S3-2: each provider names as its key the one it sends: anthropic its own key at its own address, LAWCHECK_REVIEWER_KEY at an endpoint (I-secret-1)', async () => {
  const { createProvider } = await import('../../dist/providers/index.js');
  const config = (provider: string) => ({ provider, model: 'm', timeout: 60, temperature: 0, maxChars: 50000, parallel: 1, maxCalls: 10 });
  const own = { ANTHROPIC_API_KEY: 'sk-ant-own', LAWCHECK_REVIEWER_KEY: 'sk-lawcheck' };
  const withEndpoint = { ...own, LAWCHECK_REVIEWER_ENDPOINT: 'http://127.0.0.1:9' };
  assert.deepEqual(createProvider(config('anthropic'), own)!.keys, ['sk-ant-own']);
  assert.deepEqual(createProvider(config('anthropic'), withEndpoint)!.keys, ['sk-lawcheck']);
  assert.deepEqual(createProvider(config('anthropic'), { LAWCHECK_REVIEWER_KEY: 'sk-lawcheck' })!.keys, ['sk-lawcheck']);
  assert.deepEqual(createProvider(config('openai-compatible'), withEndpoint)!.keys, ['sk-lawcheck']);
  assert.deepEqual(createProvider(config('openai-compatible'), { LAWCHECK_REVIEWER_ENDPOINT: 'http://127.0.0.1:9' })!.keys, []);
  assert.deepEqual(createProvider(config('claude-code'), own)!.keys, ['sk-lawcheck', 'sk-ant-own']);
});

test('S3-2: nothing but the exact key is replaced: another key-shaped value, a prefix of the key and a percent-encoded copy print as they came (I-secret-1)', async () => {
  const key = 'sk-canary-5d2e8f';
  const others = 'sk-other-77aa31 sk-canary %73k%2Dcanary%2D5d2e8f SK-CANARY-5D2E8F';
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const run = await lawcheck(r, ['check', '--review', '--base', 'main', '--json'], { LAWCHECK_REVIEWER_ENDPOINT: fake.url, LAWCHECK_REVIEWER_KEY: key });
        assert.equal(run.code, 1, run.stdout);
        const messages = JSON.parse(run.stdout).findings.filter((f: { code: string }) => f.code === 'clear-errors').map((f: { message: string }) => f.message);
        assert.deepEqual(messages, [`[key] ${others}`]);
      });
    },
    () => openai(failing(`${key} ${others}`, false)),
  );
});
