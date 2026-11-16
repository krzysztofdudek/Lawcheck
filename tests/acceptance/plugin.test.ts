import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, relative, sep } from 'node:path';
import { withFake } from './fake-reviewer.ts';
import { alive, append, D, D_PATH, F, F_PATH, git, GIT_ENV, inTemp, LAW, lawcheck, makeR, makeSample, newRepository, ROOT, write } from './helpers.ts';
import type { Expect, Run, Running } from './helpers.ts';
import { example } from '../harness/examples.ts';
import { DEADLINES_VARIABLE, fakeWrites, platformSkip, startHook, startProgram, testFolder } from '../harness/tool.ts';
import { fakeGit, installedLawcheck, removeFakeGit } from '../harness/fakes.ts';
import { PAST_USER_SET_MS, TEST_HOOK_DEADLINES, USER_SET_DEADLINE_S } from '../numbers.ts';
import { DEADLINES } from '../../plugin/hooks/start.mjs';
import { Bench, deadlineScenario, edited, ended, GIT_DIR, hook, json, NODE_DIR, nothing, PLUGIN, Session, startAndPromptScenario, SYSTEM_ENV, where, withBench } from './plugin-bench.ts';
import type { HookRun } from './plugin-bench.ts';

const spec = readFileSync(join(ROOT, 'spec', 'plugin-slice.md'), 'utf8');
const BROKEN_LAW = LAW.replace('status: advisory', 'statuss: advisory');

const NO_ROOT = 'The Lawcheck plugin is on, and this directory has no law (.lawcheck/law.yaml here or above).\nStart one with lawcheck init only when the user asks for it.';
const D_OUTPUT = [
  'lawcheck: FAIL  1 error, 1 warning in 1 named file, 1 waiver',
  '',
  'src/core/discount.ts:2  error[no-console]  writes to the terminal with console.log',
  '  why:  Only the command layer writes to the terminal.',
  'src/core/discount.ts:3  warning[no-todo]  TODO without an issue number',
  '  why:  A TODO without an issue number gets forgotten.',
  '',
  'next: fix src/core/discount.ts:2',
].join('\n');
const TEST17_CHECK = example('check-law-invalid');

const editHeader = (rel: string, cmd = 'lawcheck') => `Lawcheck: after this edit, ${rel} breaks the law of this repository. ${cmd} check ./${rel} printed:`;
const editErrorHeader = (rel: string, cmd = 'lawcheck') => `Lawcheck could not check ${rel} after this edit. ${cmd} check ./${rel} printed:`;
const stopHeader = (cmd = 'lawcheck') =>
  `Lawcheck: the files that changed in this turn break the law of this repository. Fix the code, then finish; if a fix needs the user's word, tell the user what blocks you and finish. ${cmd} check on those files printed:`;
const stopErrorHeader = (cmd = 'lawcheck') =>
  `Lawcheck could not check the files that changed in this turn, and the turn changed files under .lawcheck/. Fix what the error names, then finish; if that needs the user's word, tell the user and finish. ${cmd} check on those files printed:`;
const released = (cmd = 'lawcheck') => ({ systemMessage: `lawcheck: the turn ended while lawcheck check still fails on the files that changed in it; ${cmd} check shows why.` });
const handBack = (text: string) => ({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: text } });
const started = (text: string) => ({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });


function specBlock(after: string): string {
  const at = spec.indexOf(after);
  const start = spec.indexOf('```json\n', at) + '```json\n'.length;
  return spec.slice(start, spec.indexOf('```\n', start));
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path, base) : [relative(base, path).split(sep).join('/')];
  });
}

test('test 152: the files of the plugin', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const plugin = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
  const expectedPlugin = JSON.parse(specBlock('### 4.3 `plugin/.claude-plugin/plugin.json`'));
  expectedPlugin.version = manifest.version;
  assert.deepEqual(plugin, expectedPlugin);
  const marketplace = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const expectedMarketplace = JSON.parse(specBlock('### 4.2 `.claude-plugin/marketplace.json`').replace('"<description>"', JSON.stringify(expectedPlugin.description)));
  assert.deepEqual(marketplace, expectedMarketplace);
  assert.deepEqual(JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')), JSON.parse(specBlock('### 4.4 `plugin/hooks/hooks.json`')));
  const files = walk(PLUGIN).sort();
  const modules = files.filter((file) => file.endsWith('.mjs'));
  assert.deepEqual(files.filter((file) => !file.endsWith('.mjs')), ['.claude-plugin/plugin.json', 'LICENSE', 'hooks/hooks.json']);
  assert.ok(modules.includes('hooks/lawcheck-hook.mjs'));
  for (const file of modules) {
    assert.equal(dirname(file), 'hooks', file);
    const source = readFileSync(join(PLUGIN, file), 'utf8');
    const specifiers = [...source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3]!);
    assert.ok(specifiers.length > 0, file);
    for (const specifier of specifiers) {
      const ok = specifier.startsWith('node:') || (specifier.startsWith('./') && !specifier.slice(2).includes('/') && modules.includes(`hooks/${specifier.slice(2)}`));
      assert.ok(ok, `${file} imports ${specifier}`);
    }
    assert.doesNotMatch(source, /\brequire\(/, file);
  }
  assert.ok(!manifest.files.some((entry: string) => entry === 'plugin' || entry.startsWith('plugin/')));
});

test('test 154: the session start gives prime at the root, for every source', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const primed = (await lawcheck(s, ['prime'])).stdout.replace(/\n$/, '');
    const session = new Session(bench, s);
    for (const source of ['startup', 'resume', 'clear', 'compact', 'fork']) json(await session.start(source), started(primed), source);
    json(await new Session(bench, join(s, 'src/core')).start(), started(primed), 'src/core');
    const log = bench.log();
    assert.equal(log.length, 6);
    for (const line of log) assert.deepEqual(line, { args: ['prime'], cwd: s });
    assert.deepEqual(bench.sessions(), []);
  });
});

test('test 155: without a law, and the old state files', async () => {
  await withBench(async (bench, dir) => {
    const sessions = join(bench.data, 'sessions');
    mkdirSync(sessions, { recursive: true });
    const day = 24 * 60 * 60;
    const now = Date.now() / 1000;
    for (const [name, days] of [['old.json', 8], ['young.json', 6]] as const) {
      writeFileSync(join(sessions, name), '{}\n');
      utimesSync(join(sessions, name), now - days * day, now - days * day);
    }
    const repo = newRepository(dir);
    json(await new Session(bench, repo).start(), started(NO_ROOT), 'a repository without a law');
    const outside = testFolder('lawcheck-outside-');
    try {
      json(await new Session(bench, outside.dir).start(), started(NO_ROOT), 'outside git');
    } finally {
      outside.remove();
    }
    assert.deepEqual(bench.log(), []);
    assert.deepEqual(bench.sessions(), ['young.json']);
  });
});

test('test 156: prime that does not run', async () => {
  const notRun = (cmd: string, reason: string, install: string) =>
    started(`This repository has a Lawcheck law (.lawcheck/law.yaml), and ${cmd} prime did not run: ${reason}.\nInstall it with ${install}, then start a new session. Until then, read .lawcheck/law.yaml for the law.`);
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    bench.remove('lawcheck');
    json(await new Session(bench, s).start(), notRun('lawcheck', 'lawcheck was not found', 'npm i -g lawcheck@alpha'), 'no lawcheck');
    write(s, '.lawcheck/config.yaml', 'runner: pnpm\n');
    json(await new Session(bench, s).start(), notRun('pnpm exec lawcheck', 'pnpm was not found', 'pnpm install'), 'no pnpm');
    rmSync(join(s, '.lawcheck/config.yaml'));
    bench.script('lawcheck', ["process.stderr.write('boom\\n');", 'process.exitCode = 1;']);
    json(await new Session(bench, s).start(), notRun('lawcheck', 'boom', 'npm i -g lawcheck@alpha'), 'boom');
  });
});

test('test 157: prime with a broken law', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    write(s, '.lawcheck/law.yaml', BROKEN_LAW);
    const primed = await lawcheck(s, ['prime']);
    assert.equal(primed.code, 2);
    const run = await new Session(bench, s).start();
    json(run, started(primed.stdout.replace(/\n$/, '')));
    assert.ok(run.json.hookSpecificOutput.additionalContext.endsWith(TEST17_CHECK.replace('then run lawcheck check', 'then run lawcheck prime again')));
  });
});

test('test 158: every runner starts the same Lawcheck with its own words', async () => {
  const runners: [string, string[], string][] = [
    ['npx', ['--no-install', 'lawcheck'], 'npx --no-install lawcheck'],
    ['pnpm', ['exec', 'lawcheck'], 'pnpm exec lawcheck'],
    ['yarn', ['run', 'lawcheck'], 'yarn run lawcheck'],
    ['bun', ['x', '--no-install', 'lawcheck'], 'bun x --no-install lawcheck'],
  ];
  await withBench(async (bench, dir) => {
    for (const [name, words] of runners) bench.runner(name, words.length, name === 'yarn');
    const global = makeSample(join(dir, 'global'));
    const primed = (await lawcheck(global, ['prime'])).stdout.replace(/\n$/, '');
    for (const [name, words, cmd] of runners) {
      const s = makeSample(join(dir, name));
      write(s, '.lawcheck/config.yaml', `runner: ${name}\n`);
      bench.clearLog();
      const session = new Session(bench, s, `s-${name}`);
      const start = await session.start();
      const expectedPrime = primed.replace(/^(.*)$/m, `$1 Start it here as: ${cmd}`);
      json(start, started(expectedPrime), `${name} session start`);
      await session.prompt();
      write(s, D_PATH, D);
      json(await session.stop(), handBack(`${stopHeader(cmd)}\n\n${D_OUTPUT}`), `${name} stop`);
      json(await session.edit(D_PATH), edited(`${editHeader(D_PATH, cmd)}\n\n${D_OUTPUT}`), `${name} edit`);
      const calls = bench.runners();
      assert.equal(calls.length, 3, name);
      for (const call of calls) {
        assert.equal(call.runner, name);
        assert.deepEqual(call.args.slice(0, words.length), words, name);
      }
      assert.deepEqual(calls.map((call) => call.args.slice(words.length)), [['prime'], ['check', `./${D_PATH}`], ['check', `./${D_PATH}`]]);
    }
    const s = makeSample(join(dir, 'make'));
    write(s, '.lawcheck/config.yaml', 'runner: make\n');
    bench.clearLog();
    const session = new Session(bench, s, 's-make');
    json(
      await session.start(),
      started(
        'This repository has a Lawcheck law (.lawcheck/law.yaml), and .lawcheck/config.yaml sets runner to make, which is none of global, npx, pnpm, yarn, bun, so Lawcheck was not started.\nRead .lawcheck/law.yaml for the law, and tell the user that the runner setting is wrong.',
      ),
    );
    await session.prompt();
    write(s, D_PATH, D);
    nothing(await session.edit(D_PATH), 'make edit');
    nothing(await session.stop(), 'make stop');
    assert.deepEqual(bench.runners(), []);
    assert.deepEqual(bench.log(), []);
  });
});

test('test 159: an edit that breaks the law, by Write, by Edit, from another directory, and a notebook', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    write(s, D_PATH, D);
    const session = new Session(bench, s);
    const expected = edited(`${editHeader(D_PATH)}\n\n${D_OUTPUT}`);
    json(await session.edit(D_PATH, 'Write'), expected, 'Write');
    json(await session.edit(D_PATH, 'Edit'), expected, 'Edit');
    json(await session.edit(D_PATH, 'Write', { cwd: '/' }), expected, 'cwd /');
    assert.deepEqual(bench.log(), Array.from({ length: 3 }, () => ({ args: ['check', `./${D_PATH}`], cwd: s })));
    write(s, 'notes/a.ipynb', '{"cells": []}\n');
    nothing(await session.edit('notes/a.ipynb', 'NotebookEdit'), 'notebook');
    assert.deepEqual(bench.log().at(-1), { args: ['check', './notes/a.ipynb'], cwd: s });
  });
});

test('test 160: edits that pass, and inputs the hook leaves alone', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(join(dir, 's'));
    const session = new Session(bench, s);
    append(s, 'src/cli/main.ts', '// end\n');
    nothing(await session.edit('src/cli/main.ts'), 'main.ts');
    append(s, 'src/core/tax.ts', '// more\n');
    nothing(await session.edit('src/core/tax.ts'), 'tax.ts');
    await withFake(async (fake) => {
      const r = makeR(join(dir, 'r'));
      write(r, F_PATH, F);
      nothing(await new Session(bench, r, 's1', { LAWCHECK_REVIEWER_ENDPOINT: fake.url }).edit(F_PATH), 'F');
      assert.equal(fake.requests.length, 0);
    });
    bench.clearLog();
    const lawless = newRepository(join(dir, 'lawless'));
    write(lawless, 'src/a.ts', 'console.log(1);\n');
    nothing(await new Session(bench, lawless).edit('src/a.ts'), 'no law');
    nothing(await session.edit('src/core/gone.ts'), 'gone');
    nothing(await session.run('edit', { tool_name: 'Bash', tool_input: { command: 'ls' } }), 'Bash');
    nothing(await session.run('edit', { tool_name: 'Write', tool_input: { content: 'x' } }), 'no file_path');
    assert.deepEqual(bench.log(), []);
  });
});

test('test 161: a broken law reaches the agent once', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    write(s, '.lawcheck/law.yaml', BROKEN_LAW);
    const session = new Session(bench, s);
    json(await session.edit('.lawcheck/law.yaml'), edited(`${editErrorHeader('.lawcheck/law.yaml')}\n\n${TEST17_CHECK}`));
    append(s, 'src/cli/main.ts', '// end\n');
    nothing(await session.edit('src/cli/main.ts'), 'the same output');
    write(s, '.lawcheck/law.yaml', LAW.replace('why: Only the command layer', 'whyy: Only the command layer'));
    const other = await session.edit('.lawcheck/law.yaml');
    assert.ok(other.json?.hookSpecificOutput?.additionalContext.startsWith(`${editErrorHeader('.lawcheck/law.yaml')}\n\nlawcheck: ERROR  `), other.stdout);
    assert.match(other.json.hookSpecificOutput.additionalContext, /whyy/);
    nothing(await session.edit('.lawcheck/law.yaml'), 'the second output again');
  });
});

test('test 162: the two switches', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    write(s, D_PATH, D);
    const session = new Session(bench, s);
    for (const value of ['false', '0', 'No', ' off ']) nothing(await session.edit(D_PATH, 'Write', {}, { CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT: value }), value);
    assert.deepEqual(bench.log(), []);
    for (const value of ['true', '1', '']) {
      json(await session.edit(D_PATH, 'Write', {}, { CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT: value }), edited(`${editHeader(D_PATH)}\n\n${D_OUTPUT}`), JSON.stringify(value));
    }
  });
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    const off = { CLAUDE_PLUGIN_OPTION_CHECK_BEFORE_STOP: 'false' };
    nothing(await session.prompt(off));
    write(s, D_PATH, D);
    nothing(await session.stop({}, off));
    assert.deepEqual(bench.sessions(), []);
    assert.deepEqual(bench.log(), []);
  });
});

test('test 163: the deadline, and a hook that is stopped', async () => {
  await deadlineScenario(TEST_HOOK_DEADLINES, 'started');
});

test('R-86: the session-start and prompt hooks each end at their own deadline', async () => {
  await startAndPromptScenario(TEST_HOOK_DEADLINES);
});

test('plugin-slice §5: the plugin ships deadlines of 25 seconds for session-start and edit, 15 for prompt and 145 for stop, each its timeout in hooks.json less 5', () => {
  const sentence = /\*\*One deadline per hook\*\*, its `timeout` less (\d+) seconds: (\d+) seconds for `session-start` and `edit`, (\d+) for `prompt`, (\d+) for `stop`/.exec(spec);
  assert.ok(sentence, 'spec/plugin-slice.md, section 5, names the deadlines');
  const [less, startAndEdit, prompt, stop] = sentence.slice(1).map(Number) as [number, number, number, number];
  assert.deepEqual(DEADLINES, { 'session-start': startAndEdit, prompt, edit: startAndEdit, stop });
  const hooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks as Record<string, { hooks: { args: string[]; timeout: number }[] }[]>;
  const timeouts = Object.fromEntries(Object.values(hooks).flatMap((groups) => groups.flatMap((group) => group.hooks.map((entry) => [entry.args.at(-1)!, entry.timeout - less]))));
  assert.deepEqual(timeouts, DEADLINES);
});

test('R-87: the hook a user runs keeps its shipped deadline for every event when the variable of the test entry is set', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const primed = (await lawcheck(s, ['prime'])).stdout.replace(/\n$/, '');
    bench.script('lawcheck', [`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${PAST_USER_SET_MS});`, ...installedLawcheck(bench.logFile)]);
    const session = new Session(bench, s, 's1', { [DEADLINES_VARIABLE]: JSON.stringify(Object.fromEntries(Object.keys(DEADLINES).map((event) => [event, USER_SET_DEADLINE_S]))) });
    const waited = (run: HookRun, event: string) => assert.ok(run.ms >= PAST_USER_SET_MS, `${event}: the hook ended after ${run.ms} ms, before what it started answered`);
    append(s, 'src/cli/main.ts', '// end\n');
    const [start, edit] = await Promise.all([session.start(), session.edit('src/cli/main.ts')]);
    json(start, started(primed), 'session-start');
    waited(start, 'session-start');
    nothing(edit, 'edit');
    waited(edit, 'edit');
    fakeWrites(bench.bin, ['fake-git-waited']);
    const slowGit = fakeGit(bench.bin, where('git'), { firstWaitMs: PAST_USER_SET_MS });
    const prompt = await session.prompt(slowGit);
    nothing(prompt, 'prompt');
    waited(prompt, 'prompt');
    assert.equal(bench.state().open, true);
    removeFakeGit(bench.bin);
    write(s, D_PATH, D);
    const stop = await session.stop();
    json(stop, handBack(`${stopHeader()}\n\n${D_OUTPUT}`), 'stop');
    waited(stop, 'stop');
    assert.deepEqual(bench.checks(), [['check', './src/cli/main.ts'], ['check', `./${D_PATH}`]]);
  });
});

test('R-88: the test entry of the hooks refuses a deadline as long as the shipped one, and no program a hook starts sees its variable', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    append(s, 'src/cli/main.ts', '// end\n');
    const input = new Session(bench, s).input('edit', { tool_name: 'Write', tool_input: { file_path: join(s, 'src/cli/main.ts') }, tool_response: {} });
    for (const [event, seconds] of Object.entries(DEADLINES)) {
      const refused = await startHook(event, input, bench.env(), { deadlines: { [event]: seconds }, stderr: `${DEADLINES_VARIABLE} gives ${event} ${seconds} seconds, and a test deadline is shorter than the shipped ${seconds}\n` }).ended;
      assert.equal(refused.code, 1, event);
      assert.equal(refused.stdout, '', event);
    }
    assert.deepEqual(bench.log(), []);
    const seen = join(dir, 'seen');
    fakeWrites(dir, ['seen']);
    bench.script('lawcheck', [`appendFileSync(${JSON.stringify(seen)}, JSON.stringify(process.env[${JSON.stringify(DEADLINES_VARIABLE)}] ?? null) + '\\n');`, ...installedLawcheck(bench.logFile)]);
    nothing(await startHook('edit', input, bench.env(), { deadlines: { edit: TEST_HOOK_DEADLINES.edit } }).ended);
    assert.equal(readFileSync(seen, 'utf8'), 'null\n');
    assert.equal(bench.checks().length, 1);
  });
});

test('plugin-slice §5: the call ends 2 seconds after Lawcheck exits while a child holds its output', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    write(s, D_PATH, D);
    const pid = join(dir, 'child');
    fakeWrites(dir, ['child']);
    bench.script('lawcheck', [
      "const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: ['ignore', 'inherit', 'inherit'] });",
      `writeFileSync(${JSON.stringify(pid)}, String(c.pid));`,
      "process.stdout.write('lawcheck: PASS  1 named file\\n');",
      'c.unref();',
    ]);
    const run = await new Session(bench, s).edit(D_PATH);
    nothing(run);
    assert.ok(run.ms < 5000, String(run.ms));
    if (platformSkip('the child left behind is ended') === null) assert.ok(await ended(Number(readFileSync(pid, 'utf8').trim())));
  });
});

test('test 164: a long output is fitted', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    write(s, D_PATH, D);
    const body = Array.from({ length: 400 }, (_, i) => `${String(i + 1).padStart(3, '0')} ${'x'.repeat(56)}`);
    const printed = ['lawcheck: FAIL  400 errors in 1 named file', '', ...body, '', 'next: fix a.ts:1'];
    writeFileSync(join(dir, 'long.txt'), printed.join('\n') + '\n');
    bench.script('lawcheck', [`process.stdout.write(readFileSync(${JSON.stringify(join(dir, 'long.txt'))}));`, 'process.exitCode = 1;']);
    const run = await new Session(bench, s).edit(D_PATH);
    assert.equal(run.code, 0);
    const text: string = run.json.hookSpecificOutput.additionalContext;
    assert.ok([...text].length <= 9000, String([...text].length));
    const lines = text.split('\n');
    assert.equal(lines[0], editHeader(D_PATH));
    assert.equal(lines[1], '');
    assert.equal(lines[2], printed[0]);
    const more = lines[lines.length - 2]!;
    const k = /^\.\.\. (\d+) more lines not shown; run the command yourself to see them all$/.exec(more);
    assert.ok(k, more);
    const kept = lines.slice(3, -2);
    assert.deepEqual(kept, printed.slice(1, 1 + kept.length));
    assert.equal(Number(k![1]), printed.length - 2 - kept.length);
    assert.equal(lines[lines.length - 1], 'next: fix a.ts:1');
    const nextOne = printed[1 + kept.length]!;
    assert.ok([...text].length + 1 + [...nextOne].length > 8999, 'the next line would not fit');
  });
});

test('test 165: the prompt opens a turn in the state', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    nothing(await session.prompt());
    const first = bench.state();
    assert.equal(first.root, s);
    assert.equal(first.prompt_id, 'p1');
    assert.equal(first.open, true);
    assert.equal(first.head, git(s, 'rev-parse', 'HEAD').trim());
    assert.deepEqual(first.files, {});
    assert.equal(first.blocks, 0);
    write(s, D_PATH, D);
    nothing(await session.prompt());
    const second = bench.state();
    assert.equal(second.prompt_id, 'p2');
    assert.equal(second.started, first.started);
    assert.equal(second.head, first.head);
    assert.deepEqual(second.files, first.files);
    nothing(await new Session(bench, s, '../x').prompt());
    const lawless = newRepository(join(dir, 'lawless'));
    nothing(await new Session(bench, lawless, 's2').prompt());
    assert.deepEqual(bench.sessions(), ['s1.json']);
    assert.deepEqual(bench.log(), []);
  });
});

test('test 166 and 167: the hand-back, and the guard', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    write(s, D_PATH, D);
    json(await session.stop(), handBack(`${stopHeader()}\n\n${D_OUTPUT}`), '166');
    assert.deepEqual(bench.checks(), [['check', `./${D_PATH}`]]);
    json(await session.stop(), released(), '167 the same output');
    await session.prompt();
    const runs: HookRun[] = [];
    for (let i = 0; i < 4; i++) {
      append(s, D_PATH, 'console.log(1);\n');
      runs.push(await session.stop());
    }
    for (const run of runs.slice(0, 3)) assert.equal(run.json?.hookSpecificOutput?.hookEventName, 'Stop', run.stdout);
    json(runs[3]!, released(), 'the fourth');
    await session.prompt();
    append(s, D_PATH, 'console.log(1);\n');
    const again = await session.stop();
    assert.equal(again.json?.hookSpecificOutput?.hookEventName, 'Stop', again.stdout);
    for (let i = 0; i < 2; i++) {
      append(s, D_PATH, 'console.log(1);\n');
      assert.equal((await session.stop()).json?.hookSpecificOutput?.hookEventName, 'Stop');
    }
    assert.equal(bench.state().blocks, 3);
    const otherPrompt = await session.run('stop', { prompt_id: 'p-other', stop_hook_active: false, background_tasks: [] });
    assert.equal(otherPrompt.json?.hookSpecificOutput?.hookEventName, 'Stop', otherPrompt.stdout);
    assert.equal(bench.state().blocks, 1);
  });
});

test('test 168: a fix lets the agent finish, and an empty turn checks nothing', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    write(s, D_PATH, D);
    assert.equal((await session.stop()).json?.hookSpecificOutput?.hookEventName, 'Stop');
    write(s, D_PATH, 'export const d = 1;\n');
    nothing(await session.stop(), 'fixed');
    assert.equal(bench.state().open, false);
    bench.clearLog();
    await session.prompt();
    nothing(await session.stop(), 'empty turn');
    assert.deepEqual(bench.checks(), []);
  });
});

test('test 169: what counts as changed in the turn', async () => {
  const fresh = async (body: (bench: Bench, s: string, session: Session) => Promise<void>) =>
    withBench(async (bench, dir) => {
      const s = makeSample(dir);
      await body(bench, s, new Session(bench, s));
    });
  const handedOn = (bench: Bench, run: HookRun, path: string) => {
    assert.equal(run.json?.hookSpecificOutput?.hookEventName, 'Stop', run.stdout);
    assert.deepEqual(bench.checks(), [['check', `./${path}`]]);
  };
  await fresh(async (bench, s, session) => {
    write(s, D_PATH, D);
    await session.prompt();
    nothing(await session.stop(), 'written before the turn');
    assert.deepEqual(bench.checks(), []);
  });
  await fresh(async (bench, s, session) => {
    await session.prompt();
    appendFileSync(join(s, 'src/core/price.ts'), 'console.log(3);\n');
    handedOn(bench, await session.stop(), 'src/core/price.ts');
  });
  await fresh(async (bench, s, session) => {
    write(s, D_PATH, D);
    await session.prompt();
    git(s, 'add', D_PATH);
    git(s, 'commit', '-q', '-m', 'discount');
    handedOn(bench, await session.stop(), D_PATH);
  });
  await fresh(async (bench, s, session) => {
    append(s, 'README.md', 'More.\n');
    git(s, 'commit', '-q', '-am', 'readme');
    write(s, D_PATH, D);
    await session.prompt();
    git(s, 'add', D_PATH);
    git(s, 'commit', '-q', '--amend', '-m', 'readme and discount');
    const run = await session.stop();
    assert.equal(run.json?.hookSpecificOutput?.hookEventName, 'Stop', run.stdout);
    assert.deepEqual(bench.checks(), [['check', './README.md', `./${D_PATH}`]]);
  });
  await fresh(async (bench, s, session) => {
    git(s, 'checkout', '-q', '-b', 'older', 'main');
    append(s, 'src/core/price.ts', 'console.log(2);\n');
    const hourBack = `${Math.floor(Date.now() / 1000) - 3600} +0000`;
    execFileSync('git', ['commit', '-q', '-am', 'older'], { cwd: s, env: { ...GIT_ENV, GIT_COMMITTER_DATE: hourBack, GIT_AUTHOR_DATE: hourBack } });
    git(s, 'checkout', '-q', 'work');
    write(s, D_PATH, D);
    await session.prompt();
    git(s, 'add', D_PATH);
    git(s, 'commit', '-q', '-m', 'discount');
    git(s, 'merge', '-q', '--no-edit', '--no-ff', 'older');
    handedOn(bench, await session.stop(), D_PATH);
  });
  await fresh(async (bench, s, session) => {
    await session.prompt();
    rmSync(join(s, 'src/core/tax.ts'));
    nothing(await session.stop(), 'deleted');
    assert.deepEqual(bench.checks(), []);
  });
  await fresh(async (bench, s, session) => {
    await session.prompt();
    write(s, '.lawcheck/.local/x.json', '{}\n');
    nothing(await session.stop(), '.lawcheck/.local');
    assert.deepEqual(bench.checks(), []);
  });
  await fresh(async (bench, s, session) => {
    append(s, 'src/core/price.ts', '// end\n');
    await session.prompt();
    const later = new Date(Date.now() + 5000);
    utimesSync(join(s, 'src/core/price.ts'), later, later);
    nothing(await session.stop(), 'touched');
    assert.deepEqual(bench.checks(), []);
  });
});

test('test 170: a checkout brings in no one else\'s commits', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    git(s, 'checkout', '-q', '-b', 'other');
    append(s, 'src/core/price.ts', 'console.log(2);\n');
    git(s, 'add', '-A');
    const hourBack = `${Math.floor(Date.now() / 1000) - 3600} +0000`;
    execFileSync('git', ['commit', '-q', '-m', 'other'], { cwd: s, env: { ...GIT_ENV, GIT_COMMITTER_DATE: hourBack, GIT_AUTHOR_DATE: hourBack } });
    git(s, 'checkout', '-q', 'work');
    const session = new Session(bench, s);
    await session.prompt();
    git(s, 'checkout', '-q', 'other');
    nothing(await session.stop());
    assert.deepEqual(bench.checks(), []);
  });
});

test('test 171: a turn that never reached a stop is checked with the next', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    write(s, D_PATH, D);
    await session.prompt();
    json(await session.stop(), handBack(`${stopHeader()}\n\n${D_OUTPUT}`));
  });
});

test('test 172: a stop without a state', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    write(s, D_PATH, D);
    const session = new Session(bench, s, 's9');
    json(await session.stop(), handBack(`${stopHeader()}\n\n${D_OUTPUT}`));
    nothing(await session.stop({ stop_hook_active: true }));
  });
});

test('test 173: a broken law, touched by the turn or not', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    write(s, '.lawcheck/law.yaml', BROKEN_LAW);
    json(await session.stop(), handBack(`${stopErrorHeader()}\n\n${TEST17_CHECK}`));
  });
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    write(s, '.lawcheck/law.yaml', BROKEN_LAW);
    git(s, 'commit', '-q', '-am', 'broken law');
    const session = new Session(bench, s);
    await session.prompt();
    append(s, 'src/cli/main.ts', '// end\n');
    json(await session.stop(), { systemMessage: 'lawcheck: lawcheck check could not judge the files that changed in this turn; lawcheck check shows why.' });
  });
});

test('test 174: more than 1,000 files', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    mkdirSync(join(s, 'notes'));
    for (let i = 1; i <= 1001; i++) writeFileSync(join(s, 'notes', `${i}.md`), `${i}\n`);
    json(await session.stop(), { systemMessage: 'lawcheck: 1001 files changed in this turn, more than the 1000 the check before finishing takes, so it did not run; lawcheck check shows the result.' });
    assert.deepEqual(bench.checks(), []);
  });
});

test('test 175: a check that does not run is told once per session', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    bench.remove('lawcheck');
    const session = new Session(bench, s);
    await session.prompt();
    write(s, D_PATH, D);
    json(await session.stop(), { systemMessage: 'lawcheck: the check before the agent finished did not run: lawcheck was not found.' });
    await session.prompt();
    append(s, D_PATH, '// more\n');
    nothing(await session.stop(), 'told already');
    bench.script('lawcheck', ["process.stdout.write('lawcheck: ERROR  1 error\\n\\nerror[usage]  x\\n');", 'process.exitCode = 2;']);
    const other = new Session(bench, s, 's2');
    nothing(await other.edit(D_PATH), 'edit with an old lawcheck');
    await other.prompt();
    append(s, D_PATH, '// again\n');
    json(await other.stop(), { systemMessage: 'lawcheck: the check before the agent finished did not run: this lawcheck does not take check <paths>; update it.' });
  });
});

test('test 176: a background agent keeps the turn open and says so; a background shell does not', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    write(s, D_PATH, D);
    json(await session.stop({ background_tasks: [{ id: 't1', type: 'subagent', status: 'running' }] }), {
      systemMessage: 'lawcheck: the check before the agent finished waits for the background task t1 (subagent), which may still be writing files; it runs at the first stop after that task ends.',
    });
    assert.deepEqual(bench.checks(), []);
    assert.equal(bench.state().open, true);
    json(await session.stop({ background_tasks: [] }), handBack(`${stopHeader()}\n\n${D_OUTPUT}`));
  });
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    write(s, D_PATH, D);
    const tasks = [{ id: 'b1', type: 'shell', status: 'running', description: 'npm run dev' }, { id: 'm1', type: 'monitor', status: 'running' }, { id: 't2', type: 'subagent', status: 'completed' }];
    json(await session.stop({ background_tasks: tasks }), handBack(`${stopHeader()}\n\n${D_OUTPUT}`));
    assert.deepEqual(bench.checks(), [['check', `./${D_PATH}`]]);
  });
});

test('test 177: no hook asks the reviewer', async () => {
  await withFake(async (fake) => {
    await withBench(async (bench, dir) => {
      const r = makeR(dir);
      write(r, F_PATH, F);
      const session = new Session(bench, r, 's1', { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
      nothing(await session.edit(F_PATH), 'edit');
      await session.prompt();
      append(r, F_PATH, '// more\n');
      nothing(await session.stop(), 'stop');
      assert.ok(bench.checks().length === 2);
      assert.equal(fake.requests.length, 0);
      assert.equal(existsSync(join(r, '.lawcheck/verdicts')), false);
    });
  });
});

test('test 178: a failure of the hook itself', async () => {
  await withBench(async (bench, dir) => {
    for (const [event, input] of [['stop', 'not json'], ['nope', JSON.stringify({ session_id: 's1', cwd: dir, hook_event_name: 'Stop' })]] as const) {
      const run = await hook(bench, event, input, {}, undefined, { stderr: /^lawcheck plugin: [^\n]+\n$/ });
      assert.equal(run.stdout, '', event);
      assert.match(run.stderr, /^lawcheck plugin: /, event);
      assert.equal(run.code, 1, event);
    }
  });
});

test('test 179: the trial refuses to start without claude', async () => {
  await inTemp(async (dir) => {
    const empty = join(dir, 'tmp');
    mkdirSync(empty);
    const run = await startProgram(join(ROOT, 'tests', 'agent', 'run.ts'), [], ROOT, {}, {
      env: { PATH: [GIT_DIR, NODE_DIR].join(delimiter), ...SYSTEM_ENV, TMPDIR: empty, TEMP: empty, TMP: empty, HOME: dir },
      stderr: /claude/,
    }).ended;
    const result = { code: run.code, out: run.stdout + run.stderr };
    assert.equal(result.code, 2, result.out);
    assert.equal(result.out.trim().split('\n').length, 1, result.out);
    assert.match(result.out, /claude/);
    assert.deepEqual(readdirSync(empty), []);
  });
});

const BACKSLASH = 'src/core/back\\slash.js';
const BACKSLASH_OUTPUT = [
  'lawcheck: FAIL  1 error in 1 named file',
  '',
  "src/core/back\\\\slash.js:1  error[no-console]  writes to the terminal with console.log",
  '  why:  Only the command layer writes to the terminal.',
  '',
  'next: fix src/core/back\\\\slash.js:1',
].join('\n');
const BACKSLASH_LAW = LAW.replace('paths: ["src/**/*.ts", "!src/**/*.d.ts"]', 'paths: ["src/**/*.{ts,js}", "!src/**/*.d.ts"]');

test('S6-4: an edit of a file with a backslash in its name checks that file', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    write(s, '.lawcheck/law.yaml', BACKSLASH_LAW);
    writeFileSync(join(s, BACKSLASH), "console.log('x');\n");
    const run = await new Session(bench, s).edit(BACKSLASH);
    json(run, edited(`${editHeader('src/core/back\\\\slash.js')}\n\n${BACKSLASH_OUTPUT}`));
    assert.deepEqual(bench.checks(), [['check', './src/core/back\\\\slash.js']]);
  });
});

test('S6-6: a session_id of 5,000 characters keeps its state under its hash, and the hooks go on', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const id = 'x'.repeat(5000);
    const session = new Session(bench, s, id);
    nothing(await session.prompt(), 'prompt');
    const file = `${createHash('sha256').update(id).digest('hex')}.long.json`;
    assert.deepEqual(bench.sessions(), [file]);
    assert.equal(JSON.parse(readFileSync(join(bench.data, 'sessions', file), 'utf8')).open, true);
    write(s, D_PATH, D);
    json(await session.stop(), handBack(`${stopHeader()}\n\n${D_OUTPUT}`), 'stop');
    json(await session.stop(), released(), 'the same output again is let go, so the state was read');
    nothing(await new Session(bench, s, 'y'.repeat(128)).prompt(), 'an id of 128 characters');
    assert.deepEqual(bench.sessions(), [file, `${'y'.repeat(128)}.json`].sort());
  });
});

test('S6-8: a byte-order mark before the runner line, and the hook and the tool read the same runner', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    bench.runner('npx', 2);
    write(s, '.lawcheck/config.yaml', '\ufeffrunner: npx\n');
    write(s, D_PATH, D);
    json(await new Session(bench, s).edit(D_PATH), edited(`${editHeader(D_PATH, 'npx --no-install lawcheck')}\n\n${D_OUTPUT}`));
    assert.deepEqual(bench.runners().map((r) => r.runner), ['npx']);
    const prime = await lawcheck(s, ['prime']);
    assert.ok(prime.stdout.split('\n')[0]!.endsWith(' Start it here as: npx --no-install lawcheck'), prime.stdout.split('\n')[0]);
    const checked = await lawcheck(s, ['check', `./${D_PATH}`]);
    assert.equal(checked.code, 1, checked.stdout);
  });
});

test('S6-10: the check before finishing sees a file whose name holds a line break', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    writeFileSync(join(s, 'src/core/new\nline.ts'), "console.log('x');\n");
    const run = await session.stop();
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.json?.hookSpecificOutput?.hookEventName, 'Stop', run.stdout);
    assert.deepEqual(bench.checks(), [['check', './src/core/new\\nline.ts']]);
    assert.ok(run.json.hookSpecificOutput.additionalContext.includes("src/core/new\\nline.ts:1  error[no-console]  writes to the terminal with console.log"));
  });
});

test('R-24: a file whose name starts with a double quote does not stop the check before finishing from seeing the rest', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    writeFileSync(join(s, '"q.ts'), 'export const q = 1;\n');
    write(s, D_PATH, D);
    const run = await session.stop();
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.json?.hookSpecificOutput?.hookEventName, 'Stop', run.stdout);
    assert.deepEqual(bench.checks(), [['check', './"q.ts', `./${D_PATH}`]]);
  });
});

test('S6-10: with the law below the top of the work tree, the check before finishing sees the turn\'s files', async () => {
  await withBench(async (bench, dir) => {
    const repo = makeSample(dir, { under: 'pkg' });
    const s = join(repo, 'pkg');
    const session = new Session(bench, s);
    await session.prompt();
    write(s, D_PATH, D);
    const run = await session.stop();
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.json?.hookSpecificOutput?.hookEventName, 'Stop', run.stdout);
    assert.deepEqual(bench.checks(), [['check', `./${D_PATH}`]]);
  });
});
