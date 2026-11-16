import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { anthropic, defaultAnswer, google, ollama, openai, startFake, whyOf, withFake, writeFakeProgram } from './fake-reviewer.ts';
import type { Fake, Recorded, Reply } from './fake-reviewer.ts';
import { F, F_PATH, lawcheck, pathWith, PROMPT_F, run, SECOND, withR, write } from './helpers.ts';
import { fakeWrites, testFolder } from '../harness/tool.ts';
import { HTTP_TIMEOUT_RUN_MS, RESEND_LEFT_BOUND_MS, RESEND_REPLY_DELAY_MS, RESEND_WAIT_MS } from '../numbers.ts';

const UNREACHABLE = 'src/core/refund.ts  error[reviewer-unreachable]  ';
const AGAIN = 'then run the same command again; what was answered is kept, so it asks only the rest';
const PASSED = 'lawcheck: PASS  1 changed file (against main), 1 waiver, 1 reviewer call\n';

function stopped(error: string, code: 'reviewer-unreachable' | 'reviewer-bad-answer', next: string): string {
  return `lawcheck: ERROR  1 error\n\n${error}\n  why:  ${whyOf(code)}\n\nnext: ${next}\n`;
}

const failedWith = (message: string, fix: string) => stopped(`${UNREACHABLE}clear-errors: ${message}`, 'reviewer-unreachable', `${fix}, ${AGAIN}`);

function placeless(stdout: string, message: string, next: string): string {
  return `lawcheck: ERROR  1 error\n\nerror[reviewer-unreachable]  ${message}\n  why:  ${whyOf('reviewer-unreachable')}\n\nnext: ${next}\n`;
}

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

function unready(stdout: string): boolean {
  return stdout.split('\n').some((line) => line.startsWith('error[reviewer-unreachable]  '));
}

function speaking(http: Http, answer: (request: Recorded) => Reply) {
  return (request: Recorded) => (request.path === http.path ? answer(request) : { status: 404, body: '' });
}

test('test 400: openai', async () => {
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
        assert.ok(unready(result.stdout), result.stdout);
        assert.equal(result.code, 2);
      }, configOf('openai'));
    }
    assert.equal(fake.requests.length, 1);
  }, speaking(http, (request) => openai(defaultAnswer(request.prompt))));
});

test('test 401: google', async () => {
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
        assert.ok(unready(result.stdout), result.stdout);
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

test('test 402: ollama', async () => {
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
      assert.ok(unready(result.stdout), result.stdout);
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
  expect: (result: { stdout: string; stderr: string; code: number | null; ms: number }, fake: Fake, http: Http) => void;
}

const baseOf = (http: Http, fake: Fake) => (http.provider === 'ollama' ? fake.base : fake.url);
const keyFixOf = (http: Http, fake: Fake) =>
  http.provider === 'ollama' ? `the server at ${fake.base} wants a key, which this provider never sends; reach it as openai-compatible with LAWCHECK_REVIEWER_KEY` : 'check the key in LAWCHECK_REVIEWER_KEY';

function badTwice(result: { stdout: string; code: number | null }, fake: Fake) {
  const line = result.stdout.split('\n')[2]!;
  assert.ok(line.startsWith('src/core/refund.ts  error[reviewer-bad-answer]  clear-errors: the answer is no verdict twice ('), result.stdout.slice(0, 500));
  assert.equal(result.stdout, stopped(line, 'reviewer-bad-answer', 'run the same command again; what was answered is kept, so it asks only the rest'));
  assert.equal(result.code, 2);
  assert.equal(fake.requests.length, 2);
}

const CASES: Case[] = [
  {
    name: 'a pass',
    respond: (http) => () => http.reply('{"verdict":"pass","findings":[]}'),
    expect: (result, fake) => {
      assert.equal(result.stdout, PASSED);
      assert.equal(result.code, 0);
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
  { name: 'a malformed answer', respond: (http) => () => http.reply('fine'), expect: (result, fake) => badTwice(result, fake) },
  { name: 'a reply without the answer', respond: (http) => () => ({ body: http.empty }), expect: (result, fake) => badTwice(result, fake) },
  { name: 'an answer of 3 MiB', respond: (http) => () => http.reply('x'.repeat(3 * 1024 * 1024)), expect: (result, fake) => badTwice(result, fake) },
  {
    name: 'HTTP 500',
    respond: () => () => ({ status: 500, body: 'oops' }),
    expect: (result, fake, http) => {
      assert.equal(result.stdout, failedWith('HTTP 500 Internal Server Error', `wait until the reviewer at ${baseOf(http, fake)} works again`));
      assert.equal(result.code, 2);
      assert.equal(fake.requests.length, 1);
    },
  },
  {
    name: 'HTTP 401 with the error of the vendor',
    respond: (http) => () => ({ status: 401, body: http.error }),
    expect: (result, fake, http) => {
      assert.equal(result.stdout, failedWith('HTTP 401 Unauthorized: bad key', keyFixOf(http, fake)));
      assert.equal(result.code, 2);
      assert.equal(fake.requests.length, 1);
    },
  },
  {
    name: 'HTTP 429 once',
    respond: (http) => (request) => (request.index === 0 ? { status: 429, body: '{}' } : http.reply(defaultAnswer(request.prompt))),
    expect: (result, fake) => {
      assert.equal(result.stdout, SECOND.replace('1 reviewer call', '2 reviewer calls'));
      assert.equal(result.code, 1);
      assert.equal(fake.requests.length, 2);
      assert.ok(fake.requests[1]!.start - fake.requests[0]!.start >= RESEND_WAIT_MS);
    },
  },
  {
    name: 'a redirect',
    respond: () => () => ({ status: 307, headers: { location: 'http://127.0.0.1:9/v1' }, body: '' }),
    expect: (result, fake) => {
      assert.equal(result.stdout, failedWith('HTTP 307 Temporary Redirect', 'set LAWCHECK_REVIEWER_ENDPOINT to the address that answers without a redirect'));
      assert.equal(fake.requests.length, 1);
    },
  },
  {
    name: 'an HTML page',
    respond: () => () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body>Sign in</body></html>' }),
    expect: (result, fake, http) => {
      assert.equal(result.stdout, failedWith('HTTP 200, and the reply is no JSON', `check that ${baseOf(http, fake)} is the address of the provider's API`));
      assert.equal(fake.requests.length, 1);
    },
  },
  ...(['a closed connection', 'a cut reply'] as const).map(
    (name): Case => ({
      name,
      respond: (http) => (request) => (name === 'a closed connection' ? { close: true } : { cut: (http.reply(defaultAnswer(request.prompt)) as { body: string }).body.slice(0, 40) }),
      expect: (result, fake, http) => {
        const base = baseOf(http, fake);
        const line = result.stdout.split('\n')[2]!;
        assert.ok(line.startsWith(`${UNREACHABLE}clear-errors: the connection to ${base} ended before the reply did (`), result.stdout);
        assert.equal(result.stdout, stopped(line, 'reviewer-unreachable', `start the reviewer at ${base}, or set LAWCHECK_REVIEWER_ENDPOINT to the address where it runs, ${AGAIN}`));
        assert.equal(result.code, 2);
        assert.equal(fake.requests.length, 2);
      },
    }),
  ),
  {
    name: 'a reply over 4 MiB',
    respond: (http) => () => http.reply('x'.repeat(4 * 1024 * 1024)),
    expect: (result, fake, http) => {
      assert.equal(result.stdout, failedWith('the reply holds more than 4 MiB, so it is not read', `check that ${baseOf(http, fake)} is the address of the provider's API`));
      assert.equal(result.code, 2);
      assert.equal(fake.requests.length, 1);
    },
  },
  {
    name: 'a timeout',
    respond: () => () => ({ hang: true }),
    extra: '  timeout: 1\n',
    expect: (result, fake, http) => {
      assert.equal(result.stdout, failedWith('the reviewer gave no answer within 1 seconds', `raise reviewer.timeout in .lawcheck/config.yaml, or check that the reviewer at ${baseOf(http, fake)} works`));
      assert.ok(result.ms < HTTP_TIMEOUT_RUN_MS, `${result.ms} ms`);
      assert.equal(fake.requests.length, 1);
    },
  },
];

async function answers(http: Http): Promise<void> {
  {
    await Promise.all(
      CASES.map((one) =>
        withFake(
          async (fake) => {
            await withR(async (r) => {
              write(r, F_PATH, F);
              const result = await run(r, fake, ['--review', '--base', 'main'], http.env(fake));
              try {
                one.expect(result, fake, http);
                assert.equal(result.stderr, `lawcheck: 1 reviewer call to ${http.provider}\n`);
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
    const gone = await startFake();
    const base = http.provider === 'ollama' ? gone.base : gone.url;
    await gone.close();
    await withR(async (r) => {
      write(r, F_PATH, F);
      const result = await run(r, null, ['--review', '--base', 'main'], { ...http.env(gone), LAWCHECK_REVIEWER_ENDPOINT: base });
      assert.equal(result.stdout, failedWith(`nothing answers at ${base}: the connection was refused (ECONNREFUSED)`, `start the reviewer at ${base}, or set LAWCHECK_REVIEWER_ENDPOINT to the address where it runs`), http.provider);
      assert.equal(result.code, 2);
    }, configOf(http.provider));
  }
}

test('test 403: what openai answers', () => answers(HTTP[0]!));
test('test 403: what google answers', () => answers(HTTP[1]!));
test('test 403: what ollama answers', () => answers(HTTP[2]!));

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

const VENDOR_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY'];
const LAWCHECK_VARIABLES = ['LAWCHECK_REVIEWER_ENDPOINT', 'LAWCHECK_REVIEWER_KEY'];
const SIGN_IN: Record<string, string[]> = {
  claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_PROVIDER_API_KEY', 'COPILOT_PROVIDER_API_KEY_COMMAND', 'COPILOT_PROVIDER_BEARER_TOKEN'],
};
const PROGRAM_PROVIDERS = [['claude-code', 'claude'], ['codex', 'codex'], ['gemini-cli', 'gemini'], ['copilot-cli', 'copilot']] as const;

function leftNothing(where: string, texts: string[], files: string[], secrets: string[]) {
  for (const text of texts) for (const secret of secrets) assert.ok(!text.includes(secret), `${where}: ${text.slice(0, 500)}`);
  for (const file of files) {
    const text = readFileSync(file, 'latin1');
    for (const secret of secrets) assert.ok(!text.includes(secret), `${where}: ${file}`);
  }
}

test('test 404: the key canary', async () => {
  await Promise.all(KEYED.map(async (keyed) => {
    const canary = `canary-${randomBytes(12).toString('hex')}`;
    const own = `own-${randomBytes(12).toString('hex')}`;
    const others = Object.fromEntries(VENDOR_KEYS.filter((name) => name !== keyed.own).map((name) => [name, `other-${randomBytes(12).toString('hex')}`]));
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
        const folder = testFolder('lawcheck-canary-');
        const tmp = folder.dir;
        try {
          const env: NodeJS.ProcessEnv = {
            LAWCHECK_REVIEWER_ENDPOINT: keyed.provider === 'ollama' ? fake.base : fake.url,
            LAWCHECK_REVIEWER_KEY: canary,
            ...(keyed.own === null ? {} : { [keyed.own]: own }),
            ...others,
            TMPDIR: tmp,
            TMP: tmp,
            TEMP: tmp,
          };
          const outputs: string[] = [];
          for (const args of [['check', '--review', '--base', 'main'], ['check', '--review', '--base', 'main', '--json', '--full'], ['doctor', '--base', 'main', '--reviewer'], ['doctor', '--base', 'main', '--json']]) {
            const result = await lawcheck(r, args, env);
            outputs.push(result.stdout, result.stderr);
          }
          const secrets = [canary, own, ...Object.values(others)];
          leftNothing(keyed.provider, outputs, [...filesUnder(r).filter((path) => !path.startsWith(join(r, '.git'))), ...filesUnder(tmp)], secrets);
          assert.ok(fake.requests.length >= 3, `${keyed.provider}: ${fake.requests.length} requests`);
          for (const request of fake.requests) {
            const all = JSON.stringify(request.headers) + request.body + request.path;
            for (const value of [own, ...Object.values(others)]) assert.ok(!all.includes(value), `${keyed.provider}: a key travelled where it was not given`);
            if (keyed.provider === 'ollama') assert.ok(!all.includes(canary), 'ollama sent a key');
            else {
              assert.ok(keyed.header(request)?.endsWith(canary), `${keyed.provider}: ${keyed.header(request)}`);
              assert.equal(all.split(canary).length, 2, `${keyed.provider}: the key is in more than its header`);
            }
          }
        } finally {
          folder.remove();
        }
      }, configOf(keyed.provider, '  parallel: 1\n'));
    }, replies);
  }));
  await Promise.all(PROGRAM_PROVIDERS.map(async ([provider, name]) => {
    await withR(async (r, dir) => {
      write(r, F_PATH, F);
      const folder = testFolder('lawcheck-canary-');
      const tmp = folder.dir;
      try {
        const secrets = Object.fromEntries([...LAWCHECK_VARIABLES, ...Object.values(SIGN_IN).flat()].map((variable) => [variable, `canary-${randomBytes(12).toString('hex')}`]));
        const upper = name.toUpperCase();
        fakeWrites(dir, ['record.json']);
        const env: NodeJS.ProcessEnv = { ...secrets, PATH: pathWith(writeFakeProgram(join(dir, 'bin'), name)), [`FAKE_${upper}_RECORD`]: join(dir, 'record.json'), TMPDIR: tmp, TMP: tmp, TEMP: tmp };
        const outputs: string[] = [];
        for (const args of [['check', '--review', '--base', 'main'], ['doctor', '--base', 'main', '--reviewer']]) {
          const result = await lawcheck(r, args, env);
          outputs.push(result.stdout, result.stderr);
        }
        const seen = JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8')) as { env: Record<string, string> };
        const got = Object.keys(seen.env).filter((key) => key in secrets).sort();
        assert.deepEqual(got, [...SIGN_IN[name]].sort(), `${provider} got ${got.join(', ')}`);
        for (const variable of SIGN_IN[name]) assert.equal(seen.env[variable], secrets[variable], `${provider}: ${variable}`);
        const foreign = Object.entries(secrets).filter(([variable]) => !SIGN_IN[name].includes(variable)).map(([, value]) => value);
        leftNothing(provider, [JSON.stringify(seen.env)], [], foreign);
        leftNothing(provider, outputs, [...filesUnder(r).filter((path) => !path.startsWith(join(r, '.git'))), ...filesUnder(tmp)], Object.values(secrets));
      } finally {
        folder.remove();
      }
    }, configOf(provider));
  }));
});

test('test 405: a key under a provider name goes to that provider alone', async () => {
  const second = await startFake();
  try {
    for (const provider of ['openai', 'google']) {
      await withFake(
        async (fake) => {
          await withR(async (r) => {
            write(r, F_PATH, F);
            const keys = { LAWCHECK_REVIEWER_KEY: 'k1', ANTHROPIC_API_KEY: 'k3', OPENAI_API_KEY: 'k2', GOOGLE_API_KEY: 'k4' };
            const result = await run(r, fake, ['--review', '--base', 'main'], keys);
            assert.equal(result.stdout, failedWith('HTTP 307 Temporary Redirect', 'set LAWCHECK_REVIEWER_ENDPOINT to the address that answers without a redirect'));
            assert.equal(result.code, 2);
            assert.equal(second.requests.length, 0);
            assert.equal(fake.requests.length, 1);
            const sent = JSON.stringify(fake.requests[0]!.headers) + fake.requests[0]!.body + fake.requests[0]!.path;
            for (const key of ['k2', 'k3', 'k4']) assert.ok(!sent.includes(key), `${provider}: ${key}`);
            assert.ok(sent.includes('k1'));
          }, configOf(provider));
        },
        () => ({ status: 307, headers: { location: `${second.url}/chat/completions` }, body: '' }),
      );
    }
  } finally {
    await second.close();
  }
  for (const [provider, name] of PROGRAM_PROVIDERS) {
    await withR(async (r, dir) => {
      write(r, F_PATH, F);
      const keys = { LAWCHECK_REVIEWER_KEY: 'k1', LAWCHECK_REVIEWER_ENDPOINT: 'http://127.0.0.1:1/v1', ANTHROPIC_API_KEY: 'k3', OPENAI_API_KEY: 'k2', GOOGLE_API_KEY: 'k4', GEMINI_API_KEY: 'k5', GH_TOKEN: 'k6' };
      const upper = name.toUpperCase();
      fakeWrites(dir, ['record.json']);
      const result = await run(r, null, ['--review', '--base', 'main'], { ...keys, PATH: pathWith(writeFakeProgram(join(dir, 'bin'), name)), [`FAKE_${upper}_RECORD`]: join(dir, 'record.json') });
      assert.equal(result.stdout, SECOND, provider);
      const seen = JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8')) as { env: Record<string, string> };
      const arrived = Object.entries(keys).filter(([variable]) => variable in seen.env).map(([variable]) => variable).sort();
      assert.deepEqual(arrived, Object.keys(keys).filter((variable) => SIGN_IN[name].includes(variable)).sort(), provider);
    }, configOf(provider));
  }
});

test('test 411: the timeout bounds a request and its resend', async () => {
  for (const [name, reply] of [['429', { status: 429, body: '{}', delayMs: RESEND_REPLY_DELAY_MS }], ['a dropped connection', { close: true }]] as const) {
    await withFake(
      async (fake) => {
        await withR(async (r) => {
          write(r, F_PATH, F);
          const result = await run(r, fake, ['--review', '--base', 'main']);
          assert.equal(result.code, 2, `${name}: ${result.stdout}`);
          if (name === '429') {
            assert.equal(result.stdout, failedWith('HTTP 429 Too Many Requests', "wait until the provider's rate limit allows another call"));
            assert.equal(fake.requests.length, 1);
          } else {
            assert.equal(result.stdout, failedWith('the reviewer gave no answer within 3 seconds', `raise reviewer.timeout in .lawcheck/config.yaml, or check that the reviewer at ${fake.url} works`));
            assert.equal(fake.requests.length, 2);
            const resend = fake.requests[1]!;
            assert.ok(resend.end - resend.start < RESEND_LEFT_BOUND_MS, `the resend lasted ${resend.end - resend.start} ms with 0.5 seconds left`);
          }
        }, configOf('openai-compatible', '  timeout: 3\n'));
      },
      name === '429' ? () => reply : async (request) => {
        if (request.index === 0) {
          await new Promise((done) => setTimeout(done, RESEND_REPLY_DELAY_MS));
          return { close: true };
        }
        return { hang: true };
      },
    );
  }
});

test('test 412: doctor asks the Ollama server whether it is there, and names its address', async () => {
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        const result = await lawcheck(r, ['doctor', '--base', 'main'], { LAWCHECK_REVIEWER_ENDPOINT: fake.base });
        assert.ok(result.stdout.split('\n').includes(`ok  reviewer  1 reviewer rule; ollama can be called at ${fake.base} (lawcheck doctor --reviewer makes one call)`), result.stdout);
        assert.equal(result.code, 0);
        assert.deepEqual(fake.requests.map((request) => `${request.method} ${request.path}`), ['GET /api/version']);
      }, configOf('ollama'));
    },
    (request) => (request.path === '/api/version' ? { body: '{"version":"0.40.16"}' } : { status: 404, body: '' }),
  );
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        const result = await lawcheck(r, ['doctor', '--base', 'main'], { LAWCHECK_REVIEWER_ENDPOINT: fake.base });
        assert.ok(result.stdout.split('\n').includes(`fail  reviewer  1 reviewer rule; ollama cannot be called: ${fake.base}/api/version answered HTTP 404, so no Ollama server is there`), result.stdout);
        assert.ok(result.stdout.split('\n').includes('  next: set LAWCHECK_REVIEWER_ENDPOINT to the address of the Ollama server, then run lawcheck doctor'), result.stdout);
        assert.equal(result.code, 2);
      }, configOf('ollama'));
    },
    () => ({ status: 404, body: '' }),
  );
  const gone = await startFake();
  await gone.close();
  await withR(async (r) => {
    const result = await lawcheck(r, ['doctor', '--base', 'main'], { LAWCHECK_REVIEWER_ENDPOINT: gone.base });
    assert.ok(result.stdout.split('\n').includes(`fail  reviewer  1 reviewer rule; ollama cannot be called: nothing answers at ${gone.base}: the connection was refused (ECONNREFUSED)`), result.stdout);
    assert.ok(result.stdout.split('\n').includes(`  next: start the server at ${gone.base}, or set LAWCHECK_REVIEWER_ENDPOINT to the address where it runs, then run lawcheck doctor`), result.stdout);
    assert.equal(result.code, 2);
  }, configOf('ollama'));
});

test('test 413: the next line of a reviewer that cannot be called names the fix', async () => {
  const review = 'then run lawcheck check --review --base main';
  const cases: [string, NodeJS.ProcessEnv, string, string][] = [
    ['anthropic', {}, 'anthropic cannot be called: anthropic needs a key in ANTHROPIC_API_KEY or LAWCHECK_REVIEWER_KEY', `set ANTHROPIC_API_KEY to your anthropic key, ${review}`],
    ['openai', { LAWCHECK_REVIEWER_ENDPOINT: 'http://127.0.0.1:1/v1', OPENAI_API_KEY: 'k2' }, 'openai cannot be called: with LAWCHECK_REVIEWER_ENDPOINT set, openai sends LAWCHECK_REVIEWER_KEY alone, and it is not set', `set LAWCHECK_REVIEWER_KEY to the key for http://127.0.0.1:1/v1, or unset LAWCHECK_REVIEWER_ENDPOINT to call https://api.openai.com/v1 with OPENAI_API_KEY, ${review}`],
    ['google', { GOOGLE_API_KEY: 'k\n4' }, 'google cannot be called: GOOGLE_API_KEY holds a character an HTTP header cannot carry', `set GOOGLE_API_KEY to the key alone, with no space or line break, ${review}`],
    ['openai-compatible', {}, 'openai-compatible cannot be called: openai-compatible needs the address of its endpoint in LAWCHECK_REVIEWER_ENDPOINT', `set LAWCHECK_REVIEWER_ENDPOINT to the base address of the server, such as http://localhost:8000/v1, ${review}`],
    ['ollama', { LAWCHECK_REVIEWER_ENDPOINT: 'ftp://h' }, 'ollama cannot be called: LAWCHECK_REVIEWER_ENDPOINT is no http: or https: address', `set LAWCHECK_REVIEWER_ENDPOINT to an http: or https: address with no user, password, query or fragment, ${review}`],
  ];
  await Promise.all(
    cases.map(([provider, env, message, next]) =>
      withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, null, ['--review', '--base', 'main'], env);
        assert.equal(result.stdout, placeless(result.stdout, message, next), provider);
        assert.equal(result.stderr, '');
        assert.equal(result.code, 2);
      }, configOf(provider, '  max_calls: 50\n')),
    ),
  );
});
