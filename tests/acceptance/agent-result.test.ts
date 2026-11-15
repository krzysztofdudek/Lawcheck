import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ARM_EVENTS, breachOf, checksIn, errorOf, isFixed, makeRepository, readTranscript, removeSessionState, ROOT, runsLawcheck, settleFolder } from '../agent/run.ts';
import type { RunEntry } from '../agent/run.ts';
import { inTemp } from './helpers.ts';

const LINE = 'src/core/discount.js:3  error[coded-errors]  throws Error; core code throws ShopError with a code';

test('plugin-slice §10: step 5, only a line of the arm\'s own hook is a breach', () => {
  const line = (caller: string, exit = 1) => ({ caller, args: ['check', './src/core/discount.js'], exit, errors: exit === 1 ? [LINE] : [] });
  assert.equal(breachOf([line('agent')], 'edit'), false);
  assert.equal(breachOf([line('agent')], 'stop'), false);
  assert.equal(breachOf([line('edit')], 'edit'), true);
  assert.equal(breachOf([line('stop')], 'stop'), true);
  assert.equal(breachOf([line('stop')], 'edit'), false);
  assert.equal(breachOf([line('edit', 0)], 'edit'), false);
});

test('plugin-slice §10: a run removes the state file its session left in the plugin data, and nothing else', async () => {
  await inTemp((home) => {
    const sessions = join(home, '.claude', 'plugins', 'data', 'lawcheck-inline', 'sessions');
    mkdirSync(sessions, { recursive: true });
    for (const name of ['run-1.json', 'other.json']) writeFileSync(join(sessions, name), '{}\n');
    removeSessionState(home, '../other');
    removeSessionState(home, undefined);
    removeSessionState(home, 'run-1');
    assert.equal(existsSync(join(sessions, 'run-1.json')), false);
    assert.equal(existsSync(join(sessions, 'other.json')), true);
  });
});

const SAMPLES = join(ROOT, 'tests', 'agent', 'samples');
const sample = (name: string) => readTranscript(readFileSync(join(SAMPLES, name), 'utf8'));
const hookLines = [
  { caller: 'edit', args: ['check', './src/core/discount.js'], exit: 1, errors: [LINE] },
  { caller: 'edit', args: ['check', './src/core/discount.js'], exit: 0, errors: [] },
];

test('plugin-slice §10: step 4, only a Bash call that runs lawcheck needs a call of the agent in the log', () => {
  for (const command of ['lawcheck check ./x.js', 'cd work && lawcheck check x', 'lawcheck check x 2>&1 | tail -5', 'node -e 1; lawcheck prime', 'FOO=1 lawcheck check x', './bin/lawcheck check', '$(lawcheck prime)', 'echo ok || lawcheck']) {
    assert.equal(runsLawcheck(command), true, command);
  }
  for (const command of ['cat .lawcheck/law.yaml', 'ls .lawcheck', 'ls -la .lawcheck/rules && cat .lawcheck/rules/coded-errors.mjs', 'grep -r lawcheck src', 'echo lawcheck', 'cat lawcheck.md', 'git diff -- .lawcheck', 'node lawcheck-hook.mjs']) {
    assert.equal(runsLawcheck(command), false, command);
  }
  const reads = sample('reads-the-law.jsonl');
  assert.equal(reads.bashCommands.length, 4);
  assert.equal(errorOf('edit', reads, hookLines, {}, false), null);
  const runs = sample('runs-lawcheck.jsonl');
  assert.equal(errorOf('edit', runs, hookLines, {}, false), 'a Bash call that runs lawcheck while the log holds no agent line');
  const withAgent = [...hookLines, { caller: 'agent', args: ['check', 'src/core/discount.js'], exit: 0, errors: [] }];
  assert.equal(errorOf('edit', runs, withAgent, {}, false), null);
});

test('plugin-slice §10: step 8, a run that is an error keeps its transcript and log, and nothing else', async () => {
  await inTemp((dir) => {
    const make = (name: string) => {
      const folder = join(dir, name);
      mkdirSync(join(folder, 'work', 'src'), { recursive: true });
      mkdirSync(join(folder, 'origin.git'));
      for (const file of ['transcript.jsonl', 'log.jsonl']) writeFileSync(join(folder, file), '{}\n');
      return folder;
    };
    const failed = make('failed');
    assert.equal(settleFolder(failed, 'the 15 minutes', false), failed);
    assert.deepEqual(readdirSync(failed).sort(), ['log.jsonl', 'transcript.jsonl']);
    const counted = make('counted');
    assert.equal(settleFolder(counted, null, false), null);
    assert.equal(existsSync(counted), false);
    const kept = make('kept');
    assert.equal(settleFolder(kept, null, true), kept);
    assert.deepEqual(readdirSync(kept).sort(), ['log.jsonl', 'origin.git', 'transcript.jsonl', 'work']);
  });
});

const RESULT = join(ROOT, 'tests', 'agent', 'result.json');
const ENTRY_KEYS = ['run', 'error', 'breach', 'fixed', 'checks', 'log', 'files', 'seconds', 'reply'];
const CHECK_KEYS = ['clean', 'law_untouched', 'no_waiver', 'intent'];

test('test 181: the committed result of the trial', async () => {
  const result = JSON.parse(readFileSync(RESULT, 'utf8'));
  assert.deepEqual(Object.keys(result), ['schema', 'date', 'claude_code', 'model', 'effort', 'lawcheck', 'lawcheck_commit', 'arms']);
  assert.equal(result.schema, 'lawcheck-agent-trial/0');
  assert.match(result.date, /^\d{4}-\d{2}-\d{2}$/);
  for (const key of ['claude_code', 'model', 'effort', 'lawcheck', 'lawcheck_commit']) assert.equal(typeof result[key], 'string', key);
  assert.deepEqual(Object.keys(result.arms).sort(), ['edit', 'stop']);
  for (const [arm, record] of Object.entries(result.arms) as [string, { runs: number; counted: number; fixed: number; list: RunEntry[] }][]) {
    assert.deepEqual(Object.keys(record), ['runs', 'counted', 'fixed', 'list'], arm);
    assert.equal(record.runs, record.list.length, arm);
    let counted = 0;
    let fixed = 0;
    for (const [i, entry] of record.list.entries()) {
      const where = `${arm} run ${entry.run}`;
      assert.deepEqual(Object.keys(entry), ENTRY_KEYS, where);
      assert.equal(entry.run, i + 1, where);
      assert.equal(entry.breach, breachOf(entry.log, arm), where);
      for (const line of entry.log) assert.ok(line.caller === 'agent' || ARM_EVENTS[arm]!.includes(line.caller), `${where}: ${line.caller}`);
      for (const place of ['/tmp', homedir(), '/home/']) assert.ok(!entry.reply.includes(place), `${where}: ${entry.reply}`);
      if (entry.error !== null || !entry.breach) {
        assert.equal(entry.fixed, null, where);
        assert.equal(entry.checks, null, where);
        continue;
      }
      counted++;
      assert.deepEqual(Object.keys(entry.checks!), CHECK_KEYS, where);
      const again = await inTemp(async (dir) => {
        const work = makeRepository(dir);
        for (const [path, text] of Object.entries(entry.files)) {
          const full = join(work, path);
          if (text === null) rmSync(full, { force: true });
          else {
            mkdirSync(dirname(full), { recursive: true });
            writeFileSync(full, text);
          }
        }
        return await checksIn(work);
      });
      assert.deepEqual(again, entry.checks, where);
      assert.equal(entry.fixed, isFixed(again), where);
      if (entry.fixed) fixed++;
    }
    assert.equal(record.counted, counted, arm);
    assert.equal(record.fixed, fixed, arm);
    assert.equal(record.counted, 10, arm);
    assert.ok(record.fixed >= 8, `${arm}: ${record.fixed} fixed`);
  }
});
