import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { anthropic, defaultAnswer, openai, withFake, writeFakeClaude } from '../acceptance/fake-reviewer.ts';
import type { Fake, Reply } from '../acceptance/fake-reviewer.ts';
import { F, F_PATH, lawcheck, pathWith, withR, write } from '../acceptance/helpers.ts';
import type { Run } from '../acceptance/helpers.ts';

const KEY = `sk-canary-${randomBytes(12).toString('hex')}`;
const OTHER_KEY = `sk-other-${randomBytes(12).toString('hex')}`;

// Every file under a folder, .git aside: git stores what the tool wrote compressed, and the tool writes nothing there.
function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '.git') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files(path, out);
    else out.push(path);
  }
  return out;
}

function holding(dir: string, secret: string, except: string[] = []): string[] {
  return files(dir).filter((path) => !except.includes(path) && readFileSync(path).includes(secret));
}

// The shapes of reply that do not echo the key; an endpoint that echoes it is open in spec/questions.md (stress finding S3-2).
type Shape = (index: number) => Reply;
const SHAPES: Record<string, { openai: Shape; anthropic: Shape }> = {
  fail: { openai: () => openai(defaultAnswer(PROMPT_HOLDER.prompt)), anthropic: () => anthropic(defaultAnswer(PROMPT_HOLDER.prompt)) },
  pass: { openai: () => openai('{"verdict": "pass", "findings": []}'), anthropic: () => anthropic('{"verdict": "pass", "findings": []}') },
  'bad answer twice': { openai: () => openai('no verdict'), anthropic: () => anthropic('no verdict') },
  '401': { openai: () => ({ status: 401, body: '{"error":{"message":"Incorrect API key provided."}}' }), anthropic: () => ({ status: 401, body: '{"error":{"message":"invalid x-api-key"}}' }) },
  '429 then pass': {
    openai: (i) => (i === 0 ? { status: 429, body: '{}' } : openai('{"verdict": "pass", "findings": []}')),
    anthropic: (i) => (i === 0 ? { status: 429, body: '{}' } : anthropic('{"verdict": "pass", "findings": []}')),
  },
  '500 HTML': { openai: () => ({ status: 500, headers: { 'content-type': 'text/html' }, body: '<html>down</html>' }), anthropic: () => ({ status: 500, body: '<html>down</html>' }) },
  'closed connection': { openai: () => ({ close: true }), anthropic: () => ({ close: true }) },
};
const PROMPT_HOLDER = { prompt: '' };

function assertNoKey(runs: Run[], dir: string, secret: string, fake: Fake | null, header: { name: string; value: string } | null): void {
  for (const run of runs) assert.ok(!(run.stdout + run.stderr).includes(secret), run.stdout + run.stderr);
  assert.deepEqual(holding(dir, secret), []);
  for (const request of fake?.requests ?? []) {
    assert.ok(!request.body.includes(secret), 'a request body holds the key');
    for (const [name, value] of Object.entries(request.headers)) {
      if (header !== null && name === header.name) assert.equal(value, header.value);
      else assert.ok(!String(value).includes(secret), `the header ${name} holds the key`);
    }
  }
}

const COMMANDS = [['check', '--review', '--base', 'main'], ['check', '--review', '--base', 'main', '--json'], ['check', '--base', 'main'], ['try', 'clear-errors', F_PATH, '--times', '2'], ['doctor', '--reviewer'], ['doctor', '--reviewer', '--json']];

for (const provider of ['openai-compatible', 'anthropic'] as const) {
  for (const [shape, replies] of Object.entries(SHAPES)) {
    test(`S3-2: the key of ${provider} appears in no output, file, temporary file or request but its own header, for a reply that is ${shape}`, async () => {
      let index = 0;
      await withFake(
        async (fake) => {
          await withR(async (r, dir) => {
            const temp = join(dir, 'tmp');
            mkdirSync(temp);
            write(r, '.lawcheck/config.yaml', `reviewer:\n  provider: ${provider}\n  model: test-model\n`);
            write(r, F_PATH, F);
            const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.url, LAWCHECK_REVIEWER_KEY: KEY, ANTHROPIC_API_KEY: OTHER_KEY, TMPDIR: temp, TEMP: temp, TMP: temp };
            const runs: Run[] = [];
            for (const args of COMMANDS) runs.push(await lawcheck(r, args, env));
            assert.ok(fake.requests.length > 0);
            const header = provider === 'openai-compatible' ? { name: 'authorization', value: `Bearer ${KEY}` } : { name: 'x-api-key', value: KEY };
            assert.ok(fake.requests.every((request) => request.headers[header.name] === header.value), 'the key travels in its own header');
            assertNoKey(runs, dir, KEY, fake, header);
            assertNoKey(runs, dir, OTHER_KEY, fake, null);
          });
        },
        (request) => {
          PROMPT_HOLDER.prompt = request.prompt;
          return replies[provider === 'openai-compatible' ? 'openai' : 'anthropic'](index++);
        },
      );
    });
  }
}

for (const mode of ['answer', 'raw', 'error', 'boom', 'expired']) {
  test(`S3-2: a key in the environment of claude-code appears in no output, file or temporary file, with claude in mode ${mode}`, async () => {
    await withR(async (r, dir) => {
      const temp = join(dir, 'tmp');
      mkdirSync(temp);
      const record = join(dir, 'record.json');
      write(r, '.lawcheck/config.yaml', 'reviewer:\n  provider: claude-code\n');
      write(r, F_PATH, F);
      const env = { PATH: pathWith(writeFakeClaude(join(dir, 'bin'))), FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_RECORD: record, LAWCHECK_REVIEWER_KEY: KEY, ANTHROPIC_API_KEY: OTHER_KEY, TMPDIR: temp, TEMP: temp, TMP: temp };
      const runs: Run[] = [];
      for (const args of COMMANDS) runs.push(await lawcheck(r, args, env));
      for (const secret of [KEY, OTHER_KEY]) {
        for (const run of runs) assert.ok(!(run.stdout + run.stderr).includes(secret), run.stdout + run.stderr);
        assert.deepEqual(holding(dir, secret, [record]), []);
      }
      if (mode !== 'expired') assert.ok(!(JSON.parse(readFileSync(record, 'utf8')).stdin as string).includes(KEY));
    });
  });
}
