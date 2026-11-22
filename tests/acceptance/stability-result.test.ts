import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ROOT } from './helpers.ts';

const FIXTURE = join(ROOT, 'tests', 'stability', 'fixture');

// The fixture of the measurement, by the SHA-256 of each file, as it was measured.
function expectedFixture(): Map<string, string> {
  return new Map(Object.entries(JSON.parse(readFileSync(join(ROOT, 'tests', 'stability', 'expected', 'fixture.json'), 'utf8')) as Record<string, string>));
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [relative(FIXTURE, join(dir, entry.name)).split(sep).join('/')],
  );
}

test('test 78: the fixture is the measured one byte for byte, and the committed result follows from its pairs', () => {
  const expected = expectedFixture();
  assert.equal(expected.size, 35);
  assert.deepEqual(walk(FIXTURE).sort(), [...expected.keys()].sort());
  for (const [path, sha] of expected) assert.equal(createHash('sha256').update(readFileSync(join(FIXTURE, path))).digest('hex'), sha, path);

  const text = readFileSync(join(ROOT, 'tests', 'stability', 'result.json'), 'utf8');
  assert.ok(!text.includes('://'));
  const result = JSON.parse(text);
  assert.equal(result.schema, 'lawcheck-stability/1');
  assert.ok(result.model === null || typeof result.model === 'string');
  assert.notEqual(result.model, 'test-model');
  assert.equal(result.runs, 10);
  assert.equal(result.pairs.length, 30);
  const labels = JSON.parse(readFileSync(join(ROOT, 'tests', 'stability', 'labels.json'), 'utf8')) as { file: string; rule: string; label: string; borderline: boolean; why?: string; reading?: string }[];
  assert.equal(labels.length, 30);
  assert.ok(labels.every((l) => expected.has(l.file)), 'every labelled file is in the fixture');
  assert.ok(labels.every((l) => l.borderline === (typeof l.why === 'string' && typeof l.reading === 'string')));
  assert.deepEqual(result.pairs.map((p: Record<string, unknown>) => ({ file: p.file, rule: p.rule, label: p.label, borderline: p.borderline })), labels.map(({ file, rule, label, borderline }) => ({ file, rule, label, borderline })));
  for (const pair of result.pairs) {
    assert.equal(pair.verdicts.length, 10, pair.file);
    assert.ok(pair.verdicts.every((v: string) => v === 'pass' || v === 'fail'), pair.file);
    assert.equal(pair.messages.length, 10, pair.file);
    pair.messages.forEach((list: string[], run: number) => assert.equal(list.length > 0, pair.verdicts[run] === 'fail', `${pair.file} run ${run + 1}`));
  }
  const share = (x: number) => Math.round(x * 1000) / 1000;
  const groups: Record<string, (p: { borderline: boolean }) => boolean> = { all: () => true, clear: (p) => !p.borderline, borderline: (p) => p.borderline };
  for (const [name, member] of Object.entries(groups)) {
    const pairs = result.pairs.filter(member);
    const agreeing = pairs.filter((p: { verdicts: string[] }) => p.verdicts.every((v) => v === p.verdicts[0])).length;
    assert.deepEqual(result.agreement[name], { pairs: pairs.length, agreeing, share: share(agreeing / pairs.length) }, name);
    const pairwise = pairs.reduce((sum: number, p: { verdicts: string[] }) => {
      let same = 0;
      for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) if (p.verdicts[i] === p.verdicts[j]) same++;
      return sum + same / 45;
    }, 0);
    assert.equal(result.pairwise_agreement[name], share(pairwise / pairs.length), name);
    const matching = pairs.reduce((sum: number, p: { verdicts: string[]; label: string }) => sum + p.verdicts.filter((v) => v === p.label).length, 0);
    assert.deepEqual(result.label_match[name], { verdicts: pairs.length * 10, matching, share: share(matching / (pairs.length * 10)) }, name);
  }
  assert.ok(result.label_match.clear.share >= 0.9, `label_match.clear.share is ${result.label_match.clear.share}`);
  const succeeded = result.attempts.filter((a: { exit: number }) => a.exit !== 2);
  assert.deepEqual(succeeded.map((a: { run: number }) => a.run), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
