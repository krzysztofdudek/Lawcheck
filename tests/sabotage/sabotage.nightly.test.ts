import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEntries } from './run.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RUN = join(ROOT, 'tests', 'sabotage', 'run.ts');
const LIST = join(ROOT, 'tests', 'sabotage', 'list.json');

function sabotage(entries: unknown[]): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-sabotage-test-'));
  try {
    const list = join(dir, 'list.json');
    writeFileSync(list, JSON.stringify(entries));
    const run = spawnSync(process.execPath, [RUN, '--list', list], { cwd: ROOT, encoding: 'utf8' });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const limit = readEntries(readFileSync(LIST, 'utf8')).find((e) => e.id === 'limit-50')!;

test('sabotage list (section 12): every break of the list turns its test red', () => {
  const entries = readEntries(readFileSync(LIST, 'utf8'));
  const run = spawnSync(process.execPath, [RUN], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const lines = run.stdout.trimEnd().split('\n');
  assert.equal(lines.at(-1), `sabotage: PASS  every one of ${entries.length} breaks turned its test red`);
  for (const e of entries) assert.ok(lines.includes(`| ${e.id} | ${e.promise} | ${e.file} | ${e.killedBy} | killed |`), run.stdout);
});

test('sabotage list (section 12): a break its test does not catch fails the run', () => {
  const run = sabotage([{ ...limit, id: 'same-limit', replace: 'const limit = 50 ;' }]);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.equal(run.stdout, [
    '| Entry | Promise | Break | Test | Result |',
    '|---|---|---|---|---|',
    `| same-limit | row 45 | src/output.ts | ${limit.killedBy} | SURVIVED: '${limit.killedBy}' is green with the break in place |`,
    '',
    'sabotage: FAIL  1 of 1 breaks did not turn their test red: same-limit',
    '',
  ].join('\n'));
});

test('sabotage list (section 12): an entry that no longer applies, names no test, or breaks the build fails the run', () => {
  const run = sabotage([
    { ...limit, id: 'gone', find: 'const limit = 5000;' },
    { ...limit, id: 'no-test', killedBy: 'test 999: nothing' },
    { ...limit, id: 'no-build', replace: 'const limit: string = 50;' },
  ]);
  assert.equal(run.status, 1, run.stdout + run.stderr);
  const lines = run.stdout.split('\n');
  assert.ok(lines.includes(`| gone | row 45 | src/output.ts | ${limit.killedBy} | error: its find text occurs 0 times in src/output.ts, not once |`), run.stdout);
  assert.ok(lines.includes("| no-test | row 45 | src/output.ts | test 999: nothing | error: no test is named 'test 999: nothing' |"), run.stdout);
  assert.ok(lines.includes(`| no-build | row 45 | src/output.ts | ${limit.killedBy} | error: the broken code does not build: |`), run.stdout);
  assert.ok(run.stdout.endsWith('sabotage: FAIL  3 of 3 breaks did not turn their test red: gone, no-test, no-build\n'), run.stdout);
});

test('sabotage list (section 12): a list with a missing field or a repeated id is refused before anything is built', () => {
  assert.throws(() => readEntries(JSON.stringify([{ ...limit, killedBy: '' }])), /^Error: entry 1 has no killedBy$/);
  assert.throws(() => readEntries(JSON.stringify([limit, limit])), /^Error: the id 'limit-50' is used twice$/);
  assert.throws(() => readEntries(JSON.stringify([{ ...limit, replace: limit.find }])), /^Error: entry 'limit-50' replaces its text with itself$/);
  const run = sabotage([limit, limit]);
  assert.equal(run.status, 2);
  assert.equal(run.stdout, '');
  assert.equal(run.stderr, "sabotage: could not run: the id 'limit-50' is used twice\n");
});
