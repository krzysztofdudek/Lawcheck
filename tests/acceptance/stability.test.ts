import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileLines, filePath, ollama, openai, withFake, writeFakeClaude, writeFakeProgram } from './fake-reviewer.ts';
import type { Recorded } from './fake-reviewer.ts';
import { GIT_ENV, inTemp, pathWith, ROOT } from './helpers.ts';
import type { Expect, Run } from './helpers.ts';
import { startProgram } from '../harness/tool.ts';
import { STABILITY_PROVIDER_RUNS, STABILITY_RUNS } from '../numbers.ts';
import type { System } from '../numbers.ts';

const SCRIPT = join(ROOT, 'tests', 'stability', 'run.ts');
const LABELS = JSON.parse(readFileSync(join(ROOT, 'tests', 'stability', 'labels.json'), 'utf8')) as { file: string; rule: string; label: string; borderline: boolean }[];

function stability(env: NodeJS.ProcessEnv, expect: Expect = {}): Promise<Run> {
  return startProgram(SCRIPT, [], ROOT, GIT_ENV, { ...expect, env }).ended;
}

function byLabel(fail: (request: Recorded, count: number) => 'pass' | 'fail' | 500, message = 'labelled fail') {
  const counts = new Map<string, number>();
  return (request: Recorded) => {
    const file = filePath(request.prompt);
    const count = (counts.get(file) ?? 0) + 1;
    counts.set(file, count);
    const verdict = fail(request, count);
    if (verdict === 500) return { status: 500, body: '{}' };
    assert.ok(fileLines(request.prompt).length > 0);
    return openai(JSON.stringify(verdict === 'pass' ? { verdict: 'pass', findings: [] } : { verdict: 'fail', findings: [{ line: 1, message }] }));
  };
}

const labelOf = (request: Recorded) => LABELS.find((label) => label.file === filePath(request.prompt))!.label as 'pass' | 'fail';

test('test 76: the measurement against the fake', async () => {
  await inTemp(async (dir) => {
    const out = join(dir, 'result.json');
    await withFake(
      async (fake) => {
        const result = await stability({ LAWCHECK_REVIEWER_ENDPOINT: fake.url, LAWCHECK_STABILITY_MODEL: 'test-model', LAWCHECK_BASE: 'main', LAWCHECK_STABILITY_OUT: out });
        assert.equal(result.code, 0, result.stderr);
        const text = readFileSync(out, 'utf8');
        assert.ok(text.endsWith('}\n'));
        assert.ok(!text.includes('127.0.0.1'));
        const document = JSON.parse(text);
        assert.equal(text, JSON.stringify(document, null, 2) + '\n');
        assert.equal(document.schema, 'lawcheck-stability/1');
        assert.match(document.date, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(document.lawcheck, '0.1.0-alpha.5');
        assert.equal(document.verdict_format, 'lawcheck-verdict/2');
        assert.equal(document.provider, 'openai-compatible');
        assert.equal(document.model, 'test-model');
        assert.equal(document.temperature_sent, 0);
        assert.equal(document.runs, 10);
        assert.equal(document.note, null);
        assert.deepEqual(document.agreement, {
          all: { pairs: 30, agreeing: 29, share: 0.967 },
          clear: { pairs: 22, agreeing: 22, share: 1 },
          borderline: { pairs: 8, agreeing: 7, share: 0.875 },
        });
        assert.deepEqual(document.pairwise_agreement, { all: 0.993, clear: 1, borderline: 0.975 });
        assert.deepEqual(document.label_match, {
          all: { verdicts: 300, matching: 299, share: 0.997 },
          clear: { verdicts: 220, matching: 220, share: 1 },
          borderline: { verdicts: 80, matching: 79, share: 0.988 },
        });
        assert.deepEqual(document.baseline, {
          pairwise_agreement: { all: 1, clear: 1, borderline: 1 },
          label_match: {
            all: { verdicts: 30, matching: 19, share: 0.633 },
            clear: { verdicts: 22, matching: 16, share: 0.727 },
            borderline: { verdicts: 8, matching: 3, share: 0.375 },
          },
        });
        const wrong = document.pairs.filter((p: { baseline: string; label: string; borderline: boolean }) => !p.borderline && p.baseline !== p.label).map((p: { file: string }) => p.file);
        assert.deepEqual(wrong, ['src/handlers/update-tags.ts', 'src/handlers/checkout.ts', 'src/services/sessions.ts', 'src/domain/vat.ts', 'src/util/round.ts', 'src/util/increment.ts']);
        assert.equal(document.attempts.length, 11);
        const failed = document.attempts.filter((a: { exit: number }) => a.exit === 2);
        assert.deepEqual(failed, [{ run: 2, attempt: 1, exit: 2, calls_made: null, errors: [{ code: 'reviewer-unreachable', file: 'src/domain/price.ts' }] }]);
        assert.ok(document.attempts.filter((a: { exit: number }) => a.exit !== 2).every((a: { calls_made: number; errors: unknown[] }) => a.calls_made === 30 && a.errors.length === 0));
        const handle = document.pairs.find((p: { file: string }) => p.file === 'src/util/handle.ts');
        assert.deepEqual(handle.verdicts, ['pass', 'pass', 'fail', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
        assert.deepEqual(handle.messages[2], ['labelled fail']);
        assert.deepEqual(
          document.pairs.map((p: { file: string; rule: string; label: string; borderline: boolean }) => ({ file: p.file, rule: p.rule, label: p.label, borderline: p.borderline })),
          LABELS.map(({ file, rule, label, borderline }) => ({ file, rule, label, borderline })),
        );
        const clamp = document.pairs.find((p: { file: string }) => p.file === 'src/util/clamp.ts');
        assert.deepEqual(clamp.messages, Array.from({ length: 10 }, () => ['labelled fail']));
      },
      byLabel((request, count) => {
        const file = filePath(request.prompt);
        if (file === 'src/util/handle.ts' && count === 3) return 'fail';
        if (file === 'src/domain/price.ts' && count === 2) return 500;
        return labelOf(request);
      }),
    );
  });
});

test('test 76: the measurement through claude-code', async () => {
  await inTemp(async (dir) => {
    const out = join(dir, 'result.json');
    const bin = writeFakeClaude(join(dir, 'bin'));
    const result = await stability({
      PATH: pathWith(bin),
      FAKE_CLAUDE_RECORD: join(dir, 'record.json'),
      LAWCHECK_STABILITY_PROVIDER: 'claude-code',
      LAWCHECK_STABILITY_MODEL: 'test-model',
      LAWCHECK_STABILITY_NOTE: 'run on the host',
      LAWCHECK_STABILITY_OUT: out,
      LAWCHECK_STABILITY_RUNS: String(STABILITY_RUNS[process.platform as System]),
    });
    assert.equal(result.code, 0, result.stderr);
    const document = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(document.provider, 'claude-code');
    assert.equal(document.model, 'test-model');
    assert.equal(document.temperature_sent, null);
    assert.equal(document.note, 'run on the host');
    assert.ok(document.attempts.every((a: { calls_made: number }) => a.calls_made === 30));
    const args = JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8')).args as string[];
    assert.deepEqual(args.slice(3, 5), ['--model', 'test-model']);
  });
});

test('test 77: the measurement refuses to run, and its result holds the key only as [key]', async () => {
  await inTemp(async (dir) => {
    const out = join(dir, 'result.json');
    await withFake(async (fake) => {
      const noEndpoint = await stability({ LAWCHECK_STABILITY_MODEL: 'test-model', LAWCHECK_STABILITY_OUT: out });
      assert.equal(noEndpoint.code, 2);
      assert.match(noEndpoint.stderr, /LAWCHECK_REVIEWER_ENDPOINT/);
      const noModel = await stability({ LAWCHECK_REVIEWER_ENDPOINT: fake.url, LAWCHECK_STABILITY_OUT: out });
      assert.equal(noModel.code, 2);
      assert.match(noModel.stderr, /LAWCHECK_STABILITY_MODEL/);
      assert.equal(fake.requests.length, 0);
      const secret = await stability({ LAWCHECK_REVIEWER_ENDPOINT: fake.url, LAWCHECK_STABILITY_MODEL: 'test-model', LAWCHECK_REVIEWER_KEY: 'k-secret', LAWCHECK_STABILITY_OUT: out });
      assert.equal(secret.code, 0, secret.stderr);
      assert.equal(fake.requests.length, 300);
      assert.ok(!readFileSync(out, 'utf8').includes('k-secret'));
      assert.ok(readFileSync(out, 'utf8').includes('"[key]"'));
      rmSync(out);
    }, byLabel(() => 'fail', 'k-secret'));
    await withFake(async (fake) => {
      const quoted = await stability({ LAWCHECK_REVIEWER_ENDPOINT: fake.url, LAWCHECK_STABILITY_MODEL: 'test-model', LAWCHECK_REVIEWER_KEY: 'k-secret', LAWCHECK_STABILITY_OUT: out });
      assert.equal(quoted.code, 0, quoted.stderr);
      assert.ok(!readFileSync(out, 'utf8').includes('k-secret'));
      assert.ok(readFileSync(out, 'utf8').includes('it quotes [key]'));
    }, byLabel(() => 'fail', 'it quotes k-secret'));
  });
});

test('test 410: the measurement through ollama, codex and copilot-cli', async () => {
  const runs = STABILITY_PROVIDER_RUNS;
  await inTemp(async (dir) => {
    await withFake(
      async (fake) => {
        const out = join(dir, 'ollama.json');
        const result = await stability({ LAWCHECK_STABILITY_PROVIDER: 'ollama', LAWCHECK_REVIEWER_ENDPOINT: fake.base, LAWCHECK_STABILITY_MODEL: 'test-model', LAWCHECK_STABILITY_OUT: out, LAWCHECK_STABILITY_RUNS: String(runs) });
        assert.equal(result.code, 0, result.stderr);
        const document = JSON.parse(readFileSync(out, 'utf8'));
        assert.equal(document.provider, 'ollama');
        assert.equal(document.model, 'test-model');
        assert.equal(document.temperature_sent, 0);
        assert.deepEqual(document.label_match.all, { verdicts: 30 * runs, matching: 30 * runs, share: 1 });
        assert.equal(fake.requests.length, 30 * runs);
        assert.ok(fake.requests.every((request) => request.path === '/api/chat'));
        assert.ok(!readFileSync(out, 'utf8').includes('127.0.0.1'));
        const noModel = await stability({ LAWCHECK_STABILITY_PROVIDER: 'ollama', LAWCHECK_STABILITY_OUT: join(dir, 'none.json') });
        assert.equal(noModel.code, 2);
        assert.match(noModel.stderr, /^stability: set LAWCHECK_STABILITY_MODEL\n$/);
        assert.ok(!existsSync(join(dir, 'none.json')));
      },
      (request) => {
        const label = labelOf(request);
        return ollama(JSON.stringify(label === 'pass' ? { verdict: 'pass', findings: [] } : { verdict: 'fail', findings: [{ line: 1, message: 'labelled fail' }] }));
      },
    );
    for (const [provider, name] of [['codex', 'codex'], ['copilot-cli', 'copilot']] as const) {
      const out = join(dir, `${provider}.json`);
      const bin = writeFakeProgram(join(dir, `bin-${name}`), name);
      const upper = name.toUpperCase();
      const result = await stability({ PATH: pathWith(bin), [`FAKE_${upper}_RECORD`]: join(dir, `${name}.record.json`), LAWCHECK_STABILITY_PROVIDER: provider, LAWCHECK_STABILITY_OUT: out, LAWCHECK_STABILITY_RUNS: String(runs) });
      assert.equal(result.code, 0, `${provider}: ${result.stderr}`);
      const document = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(document.provider, provider);
      assert.equal(document.model, null);
      assert.equal(document.temperature_sent, null);
      assert.ok(document.attempts.every((a: { calls_made: number }) => a.calls_made === 30), provider);
      const args = JSON.parse(readFileSync(join(dir, `${name}.record.json`), 'utf8')).args as string[];
      assert.ok(!args.includes('--model'), `${provider}: ${args.join(' ')}`);
    }
    const refused = await stability({ LAWCHECK_STABILITY_PROVIDER: 'gemini-cli', LAWCHECK_STABILITY_OUT: join(dir, 'none.json') });
    assert.equal(refused.code, 2);
    assert.equal(refused.stderr, 'stability: LAWCHECK_STABILITY_PROVIDER takes openai-compatible, ollama, claude-code, codex or copilot-cli\n');
    assert.ok(!existsSync(join(dir, 'none.json')));
  });
});
