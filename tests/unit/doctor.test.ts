import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctorText, runChecks } from '../../dist/doctor.js';

const SAMPLE = new URL('../sample', import.meta.url).pathname;
const ENV = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

function sample(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-doctor-'));
  cpSync(SAMPLE, dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...ENV }, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 's');
  return body(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const states = (checks: { id: string; state: string }[]) => Object.fromEntries(checks.map((c) => [c.id, c.state]));

test('node below 24 fails, and the rest still runs', async () => {
  await sample(async (dir) => {
    const checks = await runChecks({ cwd: dir, env: {}, base: 'main', reviewer: false, nodeVersion: '22.1.0' });
    assert.equal(checks[0]!.state, 'fail');
    assert.equal(checks[0]!.message, 'Node 22.1.0; Lawcheck needs 24 or later');
    assert.deepEqual(checks[0]!.next, { command: null, text: 'install Node 24 or later' });
    assert.equal(states(checks).law, 'ok');
  });
});

test('LAWCHECK_BASE is named as the base source', async () => {
  await sample(async (dir) => {
    const checks = await runChecks({ cwd: dir, env: { LAWCHECK_BASE: 'main' }, base: null, reviewer: false });
    assert.equal(checks.find((c) => c.id === 'base')!.message, 'main, from LAWCHECK_BASE; the change holds 0 files');
  });
});

test('a grammar that does not load fails readers', async () => {
  await sample(async (dir) => {
    const checks = await runChecks({ cwd: dir, env: {}, base: 'main', reviewer: false, grammarDir: join(dir, 'nowhere') });
    const readers = checks.find((c) => c.id === 'readers')!;
    assert.equal(readers.state, 'fail');
    assert.match(readers.message, /^the grammar of typescript cannot be loaded: /);
  });
});

test('a skipped check names the first check it waits for', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-doctor-'));
  try {
    const checks = await runChecks({ cwd: dir, env: {}, base: null, reviewer: false });
    assert.deepEqual(
      checks.map((c) => `${c.state} ${c.id} ${c.state === 'skip' ? c.message : ''}`.trim()),
      ['ok node', 'fail git', 'skip law needs git', 'skip config needs git', 'skip types needs law', 'skip base needs git', 'skip law-change needs base', 'skip readers needs types', 'skip reviewer needs law'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the first line counts problems and notes, and each note and fail has its next line', () => {
  const text = doctorText([
    { id: 'a', state: 'ok', message: 'm', next: null },
    { id: 'b', state: 'note', message: 'n', next: { command: null, text: 'do n' } },
    { id: 'c', state: 'fail', message: 'f', next: { command: 'lawcheck init', text: 'lawcheck init' } },
    { id: 'd', state: 'skip', message: 'needs c', next: null },
  ]);
  assert.equal(text, 'lawcheck: FAIL  4 checks, 1 problem, 1 note\n\nok  a  m\nnote  b  n\n  next: do n\nfail  c  f\n  next: lawcheck init\nskip  d  needs c\n');
});
