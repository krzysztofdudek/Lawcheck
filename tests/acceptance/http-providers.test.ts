import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anthropic, defaultAnswer, google, ollama, openai, startFake, withFake } from './fake-reviewer.ts';
import type { Fake, Recorded, Reply } from './fake-reviewer.ts';
import { F, F_PATH, lawcheck, PROMPT_F, run, SECOND, withR, write } from './helpers.ts';

const UNREACHABLE = 'src/core/refund.ts  error[reviewer-unreachable]  ';
const BAD_ANSWER = 'src/core/refund.ts  error[reviewer-bad-answer]  clear-errors';

interface Http {
  provider: 'openai' | 'google' | 'ollama';
  path: string;
  env: (fake: Fake) => NodeJS.ProcessEnv;
  reply: (answer: string) => Reply;
  empty: string;
  error: string;
}

const HTTP: Http[] = [
  {
    provider: 'openai',
    path: '/v1/chat/completions',
    env: (fake) => ({ LAWCHECK_REVIEWER_ENDPOINT: fake.url, LAWCHECK_REVIEWER_KEY: 'k1' }),
    reply: openai,
    empty: '{"choices":[]}',
    error: '{"error":{"message":"bad key","type":"invalid_request_error","code":"invalid_api_key"}}',
  },
  {
    provider: 'google',
    path: '/v1/models/test-model:generateContent',
    env: (fake) => ({ LAWCHECK_REVIEWER_ENDPOINT: fake.url, LAWCHECK_REVIEWER_KEY: 'k1' }),
    reply: (answer) => google(answer),
    empty: '{"candidates":[]}',
    error: '{"error":{"code":401,"message":"bad key","status":"UNAUTHENTICATED"}}',
  },
  {
    provider: 'ollama',
    path: '/api/chat',
    env: (fake) => ({ LAWCHECK_REVIEWER_ENDPOINT: fake.base }),
    reply: ollama,
    empty: '{"done":true}',
    error: '{"error":"bad key"}',
  },
];

const configOf = (provider: string, extra = '') => ({
  onMain: (r: string) => write(r, '.lawcheck/config.yaml', `reviewer:\n  provider: ${provider}\n  model: test-model\n${extra}`),
});

function errorLine(stdout: string, prefix: string): string | undefined {
  return stdout.split('\n').find((line) => line.startsWith(prefix));
}

function placeless(stdout: string): boolean {
  return stdout.split('\n').some((line) => line.startsWith('error[reviewer-unreachable]  '));
}

function speaking(http: Http, answer: (request: Recorded) => Reply) {
  return (request: Recorded) => (request.path === http.path ? answer(request) : { status: 404, body: '' });
}

test('test 184: openai', async () => {
  const http = HTTP[0]!;
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const result = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_REVIEWER_KEY: 'k1', OPENAI_API_KEY: 'k2' });
      assert.equal(result.stdout, SECOND);
      assert.equal(result.code, 1);
      const request = fake.requests[0]!;
      assert.equal(request.path, '/v1/chat/completions');
      assert.equal(request.headers.authorization, 'Bearer k1');
      assert.equal(request.headers['content-type'], 'application/json');
      assert.deepEqual(Object.keys(request.json), ['model', 'messages', 'temperature', 'response_format']);
      assert.equal(request.json.model, 'test-model');
      assert.equal(request.json.temperature, 0);
      assert.deepEqual(request.json.response_format, { type: 'json_object' });
      assert.deepEqual(request.json.messages, [{ role: 'user', content: PROMPT_F }]);
      assert.ok(!JSON.stringify(request.headers).includes('k2'));
    }, configOf('openai'));
    for (const env of [{ OPENAI_API_KEY: 'k2' }, { LAWCHECK_REVIEWER_ENDPOINT: undefined }]) {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--base', 'main'], env);
        assert.ok(placeless(result.stdout), result.stdout);
        assert.equal(result.code, 2);
      }, configOf('openai'));
    }
    assert.equal(fake.requests.length, 1);
  }, speaking(http, (request) => openai(defaultAnswer(request.prompt))));
});

test('test 185: google', async () => {
  const http = HTTP[1]!;
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const result = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_REVIEWER_KEY: 'k1', GOOGLE_API_KEY: 'k4' });
      assert.equal(result.stdout, SECOND);
      assert.equal(result.code, 1);
      const request = fake.requests[0]!;
      assert.equal(request.path, '/v1/models/test-model:generateContent');
      assert.equal(request.headers['x-goog-api-key'], 'k1');
      assert.equal(request.headers.authorization, undefined);
      assert.deepEqual(request.json, {
        contents: [{ role: 'user', parts: [{ text: PROMPT_F }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      });
      assert.ok(!JSON.stringify(request.headers).includes('k4'));
      assert.ok(!request.path.includes('k1'));
    }, configOf('google'));
    for (const env of [{ GOOGLE_API_KEY: 'k4' }, { LAWCHECK_REVIEWER_ENDPOINT: undefined }]) {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--base', 'main'], env);
        assert.ok(placeless(result.stdout), result.stdout);
        assert.equal(result.code, 2);
      }, configOf('google'));
    }
    assert.equal(fake.requests.length, 1);
  }, speaking(http, (request) => (request.index === 0 ? googleSplit(request) : google(defaultAnswer(request.prompt)))));
});

function googleSplit(request: Recorded): Reply {
  const answer = defaultAnswer(request.prompt);
  const cut = answer.indexOf('neither') + 3;
  return google(answer.slice(0, cut), answer.slice(cut));
}

test('test 186: ollama', async () => {
  const http = HTTP[2]!;
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const result = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_REVIEWER_ENDPOINT: `${fake.base}/`, LAWCHECK_REVIEWER_KEY: 'k1', OPENAI_API_KEY: 'k2', ANTHROPIC_API_KEY: 'k3', GOOGLE_API_KEY: 'k4' });
      assert.equal(result.stdout, SECOND);
      assert.equal(result.code, 1);
      const request = fake.requests[0]!;
      assert.equal(request.path, '/api/chat');
      assert.deepEqual(request.json, { model: 'test-model', messages: [{ role: 'user', content: PROMPT_F }], stream: false, format: 'json', options: { temperature: 0 } });
      const headers = JSON.stringify(request.headers);
      for (const key of ['k1', 'k2', 'k3', 'k4']) assert.ok(!headers.includes(key), key);
      assert.equal(request.headers.authorization, undefined);
    }, configOf('ollama'));
    await withR(async (r) => {
      write(r, F_PATH, F);
      const result = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_REVIEWER_ENDPOINT: 'ftp://127.0.0.1/' });
      assert.ok(placeless(result.stdout), result.stdout);
      assert.equal(result.code, 2);
    }, configOf('ollama'));
    assert.equal(fake.requests.length, 1);
  }, speaking(http, (request) => ollama(defaultAnswer(request.prompt))));
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--base', 'main'], http.env(fake));
        assert.equal(result.code, 2);
        assert.ok(errorLine(result.stdout, UNREACHABLE)?.endsWith("HTTP 404 Not Found: model 'test-model' not found"), result.stdout);
      }, configOf('ollama'));
    },
    () => ({ status: 404, body: `{"error":"model 'test-model' not found"}` }),
  );
});

interface Case {
  name: string;
  respond: (http: Http) => (request: Recorded) => Reply;
  extra?: string;
  expect: (result: { stdout: string; code: number | null; ms: number }, fake: Fake) => void;
}

const CASES: Case[] = [
  {
    name: 'a pass',
    respond: (http) => () => http.reply('{"verdict":"pass","findings":[]}'),
    expect: (result, fake) => {
      assert.equal(result.code, 0, result.stdout);
      assert.equal(fake.requests.length, 1);
    },
  },
  {
    name: 'a fail with lines',
    respond: (http) => (request) => http.reply(defaultAnswer(request.prompt)),
    expect: (result, fake) => {
      assert.equal(result.stdout, SECOND);
      assert.equal(result.code, 1);
      assert.equal(fake.requests.length, 1);
    },
  },
  {
    name: 'a malformed answer',
    respond: (http) => () => http.reply('fine'),
    expect: (result, fake) => {
      assert.ok(errorLine(result.stdout, BAD_ANSWER), result.stdout);
      assert.equal(result.code, 2);
      assert.equal(fake.requests.length, 2);
    },
  },
  {
    name: 'a reply without the answer',
    respond: (http) => () => ({ body: http.empty }),
    expect: (result, fake) => {
      assert.ok(errorLine(result.stdout, BAD_ANSWER), result.stdout);
      assert.equal(fake.requests.length, 2);
    },
  },
  {
    name: 'HTTP 500',
    respond: () => () => ({ status: 500, body: 'oops' }),
    expect: (result, fake) => {
      assert.ok(errorLine(result.stdout, UNREACHABLE)?.includes('HTTP 500'), result.stdout);
      assert.equal(result.code, 2);
      assert.equal(fake.requests.length, 1);
    },
  },
  {
    name: 'HTTP 401 with the error of the vendor',
    respond: (http) => () => ({ status: 401, body: http.error }),
    expect: (result, fake) => {
      assert.ok(errorLine(result.stdout, UNREACHABLE)?.endsWith('HTTP 401 Unauthorized: bad key'), result.stdout);
      assert.equal(fake.requests.length, 1);
    },
  },
  {
    name: 'HTTP 429 once',
    respond: (http) => (request) => (request.index === 0 ? { status: 429, body: '{}' } : http.reply(defaultAnswer(request.prompt))),
    expect: (result, fake) => {
      assert.equal(result.stdout, SECOND.replace('1 reviewer call', '2 reviewer calls'));
      assert.equal(fake.requests.length, 2);
      assert.ok(fake.requests[1]!.start - fake.requests[0]!.start >= 2000);
    },
  },
  {
    name: 'a redirect',
    respond: () => () => ({ status: 307, headers: { location: 'http://127.0.0.1:9/v1' }, body: '' }),
    expect: (result, fake) => {
      assert.ok(errorLine(result.stdout, UNREACHABLE)?.includes('HTTP 307'), result.stdout);
      assert.equal(fake.requests.length, 1);
    },
  },
  {
    name: 'an HTML page',
    respond: () => () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body>Sign in</body></html>' }),
    expect: (result, fake) => {
      assert.ok(errorLine(result.stdout, UNREACHABLE)?.endsWith('HTTP 200, and the reply is no JSON'), result.stdout);
      assert.equal(fake.requests.length, 1);
    },
  },
  {
    name: 'a closed connection',
    respond: () => () => ({ close: true }),
    expect: (result, fake) => {
      assert.ok(errorLine(result.stdout, UNREACHABLE)?.includes('the connection to the reviewer gave no answer'), result.stdout);
      assert.equal(fake.requests.length, 2);
    },
  },
  {
    name: 'a cut reply',
    respond: (http) => (request) => ({ cut: (http.reply(defaultAnswer(request.prompt)) as { body: string }).body.slice(0, 40) }),
    expect: (result, fake) => {
      assert.ok(errorLine(result.stdout, UNREACHABLE), result.stdout);
      assert.ok(!result.stdout.includes('error[internal]'), result.stdout);
      assert.equal(fake.requests.length, 2);
    },
  },
  {
    name: 'a huge body',
    respond: (http) => () => http.reply('x'.repeat(20 * 1024 * 1024)),
    expect: (result, fake) => {
      assert.ok(errorLine(result.stdout, BAD_ANSWER), result.stdout.slice(0, 2000));
      assert.ok(result.stdout.length < 10_000, `${result.stdout.length} characters`);
      assert.equal(fake.requests.length, 2);
    },
  },
  {
    name: 'a timeout',
    respond: () => () => ({ hang: true }),
    extra: '  timeout: 1\n',
    expect: (result, fake) => {
      assert.ok(errorLine(result.stdout, UNREACHABLE)?.endsWith('the reviewer gave no answer within 1 seconds'), result.stdout);
      assert.ok(result.ms < 10_000, `${result.ms} ms`);
      assert.equal(fake.requests.length, 1);
    },
  },
];

test('test 187: what openai, google and ollama answer', async () => {
  for (const http of HTTP) {
    await Promise.all(
      CASES.map((one) =>
        withFake(
          async (fake) => {
            await withR(async (r) => {
              write(r, F_PATH, F);
              const result = await run(r, fake, ['--review', '--base', 'main'], http.env(fake));
              try {
                one.expect(result, fake);
              } catch (error) {
                (error as Error).message = `${http.provider}, ${one.name}: ${(error as Error).message}`;
                throw error;
              }
              assert.ok(fake.requests.every((request) => request.path === http.path), `${http.provider}, ${one.name}: ${fake.requests.map((q) => q.path).join(', ')}`);
            }, configOf(http.provider, one.extra));
          },
          one.respond(http),
        ),
      ),
    );
  }
});

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(path);
  }
  return found;
}

const KEYED: { provider: string; own: string | null; header: (request: Recorded) => string | undefined }[] = [
  { provider: 'anthropic', own: 'ANTHROPIC_API_KEY', header: (request) => request.headers['x-api-key'] as string | undefined },
  { provider: 'openai', own: 'OPENAI_API_KEY', header: (request) => request.headers.authorization as string | undefined },
  { provider: 'google', own: 'GOOGLE_API_KEY', header: (request) => request.headers['x-goog-api-key'] as string | undefined },
  { provider: 'openai-compatible', own: null, header: (request) => request.headers.authorization as string | undefined },
  { provider: 'ollama', own: null, header: () => undefined },
];

test('test 188: the key canary', async () => {
  for (const keyed of KEYED) {
    const canary = `canary-${randomBytes(12).toString('hex')}`;
    const own = `own-${randomBytes(12).toString('hex')}`;
    const replies = (request: Recorded): Reply => {
      if (request.index === 1) return { status: 500, body: '{"error":{"message":"overloaded"}}' };
      const answer = defaultAnswer(request.prompt);
      if (keyed.provider === 'anthropic') return anthropic(answer);
      if (keyed.provider === 'google') return google(answer);
      if (keyed.provider === 'ollama') return ollama(answer);
      return openai(answer);
    };
    await withFake(async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const tmp = mkdtempSync(join(tmpdir(), 'lawcheck-canary-'));
        try {
          const env: NodeJS.ProcessEnv = {
            LAWCHECK_REVIEWER_ENDPOINT: keyed.provider === 'ollama' ? fake.base : fake.url,
            LAWCHECK_REVIEWER_KEY: canary,
            ...(keyed.own === null ? {} : { [keyed.own]: own }),
            TMPDIR: tmp,
            TMP: tmp,
            TEMP: tmp,
          };
          const outputs: string[] = [];
          for (const args of [['check', '--review', '--base', 'main'], ['check', '--review', '--base', 'main', '--json', '--full'], ['doctor', '--base', 'main', '--reviewer'], ['doctor', '--base', 'main', '--json']]) {
            const result = await lawcheck(r, args, env);
            outputs.push(result.stdout, result.stderr);
          }
          for (const text of outputs) {
            assert.ok(!text.includes(canary) && !text.includes(own), `${keyed.provider}: ${text}`);
          }
          for (const file of [...filesUnder(r).filter((path) => !path.startsWith(join(r, '.git'))), ...filesUnder(tmp)]) {
            const text = readFileSync(file, 'latin1');
            assert.ok(!text.includes(canary) && !text.includes(own), `${keyed.provider}: ${file}`);
          }
          assert.ok(fake.requests.length >= 3, `${keyed.provider}: ${fake.requests.length} requests`);
          for (const request of fake.requests) {
            const all = JSON.stringify(request.headers) + request.body + request.path;
            assert.ok(!all.includes(own), `${keyed.provider}: the provider's own key travelled to the endpoint in force`);
            if (keyed.provider === 'ollama') assert.ok(!all.includes(canary), 'ollama sent a key');
            else {
              assert.ok(keyed.header(request)?.endsWith(canary), `${keyed.provider}: ${keyed.header(request)}`);
              assert.equal(all.split(canary).length, 2, `${keyed.provider}: the key is in more than its header`);
            }
          }
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      }, configOf(keyed.provider, '  parallel: 1\n'));
    }, replies);
  }
});

test('test 189: a key under a provider name goes to that provider alone', async () => {
  const second = await startFake();
  try {
    for (const provider of ['openai', 'google']) {
      await withFake(
        async (fake) => {
          await withR(async (r) => {
            write(r, F_PATH, F);
            const result = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_REVIEWER_KEY: 'k1' });
            assert.ok(errorLine(result.stdout, UNREACHABLE)?.includes('HTTP 307'), result.stdout);
            assert.equal(second.requests.length, 0);
          }, configOf(provider));
        },
        () => ({ status: 307, headers: { location: `${second.url}/chat/completions` }, body: '' }),
      );
    }
  } finally {
    await second.close();
  }
});
