import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ARM_EVENTS, breachOf, checksIn, errorOf, isFixed, makeRepository, readTranscript, removeSessionState, ROOT, runsLawcheck, settleFolder } from '../agent/run.ts';
import type { RunEntry } from '../agent/run.ts';
import { apiImports, armState, breachIn, CLAUDE_REPOSITORY, FILM, FILM_REPOSITORY, hostBreach, hostErrorOf, PROMPT, PROOF, repositoryFor, stopsOf, verdictOf } from '../agent/trial.ts';
import type { HostEntry } from '../agent/trial.ts';
import { readCodex } from '../agent/codex.ts';
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

const hookLine = (caller: string, exit: number, errors: string[]) => ({ caller, args: ['check', './src/core/loyalty.ts'], exit, errors });
const FORBIDDEN = 'src/core/loyalty.ts:1  error[forbidden-use]  core uses src/api/format.ts of type api; core may use core';

test('test 925: the trial of another agent counts an import of the API code as the film\'s pilot does, and a breach only from the arm\'s own hooks', () => {
  assert.deepEqual(apiImports({ 'src/core/loyalty.ts': "import { x } from './price.ts';\nimport { formatMoney } from '../api/format.ts';\n", 'src/api/orders.ts': "import { y } from '../api/format.ts';\n", 'src/core/b.ts': "const f = await import('../api/format.ts');\n" }), ['src/core/b.ts:1', 'src/core/loyalty.ts:2']);
  assert.equal(hostBreach([hookLine('edit', 1, [FORBIDDEN])], 'edit'), true);
  assert.equal(hostBreach([hookLine('stop', 1, [FORBIDDEN])], 'edit'), false);
  assert.equal(hostBreach([hookLine('agent', 1, [FORBIDDEN])], 'stop'), false);
  assert.equal(hostBreach([hookLine('stop', 1, ['src/api/orders.ts:1  error[forbidden-use]  x'])], 'stop'), false);
  assert.equal(stopsOf([hookLine('stop', 1, []), hookLine('agent', 0, []), hookLine('stop', 1, [])]), 2);
  const coded = { caller: 'edit', args: ['check', './src/core/discount.js'], exit: 1, errors: [LINE] };
  assert.equal(breachIn(CLAUDE_REPOSITORY, [coded], 'edit'), true);
  assert.equal(breachIn(FILM_REPOSITORY, [coded], 'edit'), false);
  assert.equal(breachIn(FILM_REPOSITORY, [hookLine('edit', 1, [FORBIDDEN])], 'edit'), true);
  const none = (imports: number) => ({ none: { repository: FILM_REPOSITORY, runs: 10, sessions: 10, counted: 0, list: Array.from({ length: 10 }, (_, i) => ({ run: i + 1, error: null, breach: false, primed: false, imports: i < imports ? ['src/core/a.ts:1'] : [], stops: 0, checks: null, clean: true, log: [], files: {}, seconds: 1, reply: '' })) } });
  assert.equal(repositoryFor('edit', none(2)), CLAUDE_REPOSITORY);
  assert.equal(repositoryFor('stop', none(3)), FILM_REPOSITORY);
  assert.equal(repositoryFor('start', none(0)), FILM_REPOSITORY);
  const session = { completed: true, errors: [], shell: ['npm test'] };
  assert.equal(hostErrorOf('stop', session, [hookLine('edit', 1, [])], {}, false, 0), "a log line whose caller is not agent and not one of the arm's events");
  assert.equal(hostErrorOf('none', session, [hookLine('agent', 0, [])], {}, false, 0), null);
  assert.equal(hostErrorOf('none', { ...session, completed: false }, [], {}, false, 0), 'a session that did not end with a completed turn');
  assert.equal(hostErrorOf('none', { ...session, shell: ['lawcheck check'] }, [], {}, false, 0), 'a shell call that runs lawcheck while the log holds no agent line');
});

test('test 926: the trial reads a Codex session from what codex exec --json prints and from its rollout', () => {
  const stdout = [
    { type: 'item.completed', item: { type: 'error', message: '`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.' } },
    { type: 'item.completed', item: { type: 'command_execution', command: 'npm test' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'first' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'last' } },
    { type: 'turn.completed' },
  ].map((event) => JSON.stringify(event)).join('\n');
  assert.deepEqual(readCodex(stdout, ['{"text":"Lawcheck checks this repository\'s code"}']), { completed: true, errors: [], shell: ['npm test'], reply: 'last', primed: true });
  const failed = readCodex(JSON.stringify({ type: 'item.completed', item: { type: 'error', message: 'SessionStart Failed' } }), []);
  assert.deepEqual([failed.completed, failed.errors, failed.primed], [false, ['SessionStart Failed'], false]);
});

test('test 927: the verdict of a trial of another agent holds each arm to its threshold, scaled to the sessions of ruling proby-wtyczek-oszczednie, and settles an arm as soon as the rest cannot change it', () => {
  const entry = (run: number, fields: Partial<HostEntry> = {}): HostEntry => ({ run, error: null, breach: false, primed: true, imports: [], stops: 0, checks: null, clean: true, log: [], files: {}, seconds: 1, reply: '', ...fields });
  const arm = (list: HostEntry[]) => ({ repository: FILM_REPOSITORY, runs: list.length, sessions: list.filter((e) => e.error === null).length, counted: list.filter((e) => e.error === null && e.breach).length, list: list.map((e, i) => ({ ...e, run: i + 1 })) });
  const many = (n: number, fields: Partial<HostEntry> = {}) => Array.from({ length: n }, (_, i) => entry(i + 1, fields));
  const good = { none: arm(many(10, { imports: ['src/core/a.ts:1'] })), start: arm([...many(9), entry(10, { clean: false })]), edit: arm([...many(4, { breach: true }), ...many(3)]), stop: arm([entry(1, { breach: true, clean: false }), ...many(4, { breach: true })]), limit: arm(many(3, { stops: 4 })) };
  const verdict = verdictOf(good);
  assert.equal(verdict.passes, true, verdict.lines.join('\n'));
  assert.ok(verdict.lines.includes('none: 10 of 10 sessions import the API code into src/core'));
  for (const [name, record] of Object.entries(good)) assert.equal(armState(name, record), 'pass', name);
  assert.equal(verdictOf({ ...good, start: arm([...many(8), ...many(2, { clean: false })]) }).passes, false);
  assert.equal(armState('start', arm(many(2, { clean: false }))), 'fail');
  assert.equal(armState('start', arm([entry(1, { primed: false })])), 'fail');
  assert.equal(armState('start', arm([entry(1, { imports: ['src/core/a.ts:1'] })])), 'fail');
  assert.equal(armState('start', arm(many(9))), 'open');
  assert.equal(armState('edit', arm([...many(2, { breach: true, clean: false })])), 'fail');
  assert.equal(armState('edit', arm([...many(3, { breach: true }), ...many(11)])), 'open');
  assert.equal(armState('edit', arm([...many(3, { breach: true }), ...many(12)])), 'fail');
  assert.equal(verdictOf({ ...good, stop: arm(many(3, { breach: true })) }).passes, false);
  assert.equal(armState('limit', arm([entry(1, { stops: 5 })])), 'fail');
  assert.equal(armState('none', arm([...many(5), ...many(10, { error: 'the 15 minutes' })])), 'fail');
  assert.equal(verdictOf({ ...good, limit: arm([...many(2, { stops: 4 }), entry(3, { stops: 3 })]) }).passes, false);
  const { limit, ...missing } = good;
  assert.ok(limit !== undefined);
  assert.equal(verdictOf(missing).passes, false);
  const { edit, stop, ...proof } = good;
  assert.ok(edit !== undefined && stop !== undefined);
  assert.equal(verdictOf({ ...proof, edit: arm(many(12)) }, PROOF.codex).passes, true, 'ruling codex-dowod: Codex stands on the arms with no plugin, the whole plugin and three returns');
  assert.equal(verdictOf({ ...proof, edit: arm(many(12)) }).passes, false);
  assert.equal(verdictOf(missing, PROOF.codex).passes, false);
});

const FILM_CORE: Record<string, string | null> = { 'src/core/price.ts': readFileSync(join(FILM, 'shop', 'src', 'core', 'price.ts'), 'utf8') };
const RESULT_CODEX = join(ROOT, 'tests', 'agent', 'result-codex.json');

test('test 928: the plugin for Codex ships only with a trial of real Codex sessions that passes the thresholds of its proof, ruling codex-dowod', () => {
  assert.ok(existsSync(join(ROOT, 'plugin', '.codex-plugin', 'plugin.json')));
  assert.ok(existsSync(RESULT_CODEX), 'tests/agent/result-codex.json is missing: run npm run agent-trial -- --host codex');
  const result = JSON.parse(readFileSync(RESULT_CODEX, 'utf8'));
  assert.equal(result.schema, 'lawcheck-agent-trial-host/0');
  assert.equal(result.host, 'codex');
  assert.equal(result.prompt, PROMPT);
  for (const [name, record] of Object.entries(result.arms) as [string, { repository: string; runs: number; sessions: number; counted: number; list: HostEntry[] }][]) {
    assert.equal(record.repository, repositoryFor(name, result.arms), name);
    assert.equal(record.runs, record.list.length, name);
    assert.deepEqual(record.list.map((entry) => entry.run), record.list.map((_, i) => i + 1), name);
    assert.equal(record.sessions, record.list.filter((entry) => entry.error === null).length, name);
    assert.equal(record.counted, record.list.filter((entry) => entry.error === null && entry.breach).length, name);
    for (const entry of record.list) {
      assert.equal(entry.breach, breachIn(record.repository, entry.log, name), `${name} run ${entry.run}`);
      assert.equal(entry.stops, stopsOf(entry.log), `${name} run ${entry.run}`);
      if (record.repository === FILM_REPOSITORY) assert.deepEqual(entry.imports, apiImports(Object.fromEntries(Object.entries({ ...FILM_CORE, ...entry.files }).filter(([path, text]) => path.startsWith('src/core/') && text !== null)) as Record<string, string>), `${name} run ${entry.run}`);
      for (const place of ['/tmp', homedir(), '/home/']) assert.ok(!entry.reply.includes(place), `${name} run ${entry.run}: ${entry.reply}`);
    }
  }
  const verdict = verdictOf(result.arms, PROOF.codex);
  assert.equal(result.passes, verdict.passes);
  assert.ok(verdict.passes, verdict.lines.filter((line) => line.startsWith('fail')).join('\n'));
});
