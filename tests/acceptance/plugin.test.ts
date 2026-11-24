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
import { Bench, CodexSession, CopilotSession, deadlineScenario, edited, ended, EVENT_NAMES, GIT_DIR, hook, json, NODE_DIR, nothing, patchOf, PLUGIN, Session, startAndPromptScenario, SYSTEM_ENV, where, withBench } from './plugin-bench.ts';
import type { HookRun } from './plugin-bench.ts';

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
const editErrorHeader = (rel: string, cmd = 'lawcheck') => `Lawcheck: after this edit, ${cmd} check ./${rel} could not check the file. It printed:`;
const stopHeader = (cmd = 'lawcheck') =>
  `Lawcheck: the files that changed in this turn break the law of this repository. Fix the code, then finish; if a fix needs the user's word, tell the user what blocks you and finish. ${cmd} check on those files printed:`;
const stopErrorHeader = (cmd = 'lawcheck') =>
  `Lawcheck: the check at the end of the turn stopped with an error, and the turn changed files under .lawcheck/. Fix what the error names, then finish; if that needs the user's word, tell the user and finish. ${cmd} check on those files printed:`;
const released = (cmd = 'lawcheck') => ({ systemMessage: `Lawcheck: the turn ended while the check of its files still fails. ${cmd} check shows why.` });
const D_WAIVER = 'Lawcheck: in this turn the agent added 1 waiver (no-console at src/core/discount.ts:4). Read them before you accept the turn.';
const withD = (output: { systemMessage: string }) => ({ systemMessage: `${output.systemMessage}\n${D_WAIVER}` });
const handBack = (text: string) => ({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: text } });
const started = (text: string) => ({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } });


function specBlock(id: string): string {
  return example(id);
}

function setRuleFile(s: string): void {
  appendFileSync(join(s, '.lawcheck/rules/no-console.mjs'), '// reviewed\n');
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
  const expectedPlugin = JSON.parse(specBlock('plugin-manifest'));
  expectedPlugin.version = manifest.version;
  assert.deepEqual(plugin, expectedPlugin);
  const marketplace = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  const expectedMarketplace = JSON.parse(specBlock('marketplace-manifest'));
  assert.deepEqual(marketplace, expectedMarketplace);
  assert.equal(marketplace.plugins[0].description, plugin.description.replace('with Write, Edit or NotebookEdit', '(with Write, Edit or NotebookEdit in Claude Code, with apply_patch in Codex, with create or edit in Copilot CLI)'));
  assert.deepEqual(JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')), JSON.parse(specBlock('hooks-manifest')));
  const files = walk(PLUGIN).sort();
  const modules = files.filter((file) => file.endsWith('.mjs'));
  assert.deepEqual(files.filter((file) => !file.endsWith('.mjs')), ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', '.plugin/plugin.json', 'LICENSE', 'hooks/codex.json', 'hooks/copilot.json', 'hooks/hooks.json']);
  assert.ok(modules.includes('hooks/lawcheck-hook.mjs'));
  for (const file of modules) {
    assert.equal(dirname(file), 'hooks', file);
    const source = readFileSync(join(PLUGIN, file), 'utf8');
    const specifiers = [...source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3]!);
    assert.ok(specifiers.length > 0 || !/\b(import|export\s[^\n]*\sfrom)\b/.test(source), file);
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

test('S6-9: a reason that ends with a full stop gets no second one', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    bench.script('lawcheck', ["process.stderr.write('error Command \"lawcheck\" not found.\\n');", 'process.exitCode = 1;']);
    json(
      await new Session(bench, s).start(),
      started('This repository has a Lawcheck law (.lawcheck/law.yaml), and lawcheck prime did not run: error Command "lawcheck" not found.\nInstall it with npm i -g lawcheck@alpha, then start a new session. Until then, read .lawcheck/law.yaml for the law.'),
    );
    const session = new Session(bench, s, 's2');
    await session.prompt();
    write(s, D_PATH, D);
    json(await session.stop(), withD({ systemMessage: 'Lawcheck: the check at the end of the turn did not run: error Command "lawcheck" not found.' }));
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
        "This repository has a Lawcheck law (.lawcheck/law.yaml), and .lawcheck/config.yaml sets runner to 'make'. The runner takes global, npx, pnpm, yarn or bun, so the plugin did not start Lawcheck.\nRead .lawcheck/law.yaml for the law, and tell the user that the runner setting is wrong.",
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

// Yarn 1 ends a failing yarn run with an info Visit line on standard output, where a passing run ends with Done in.
function yarnOne(bench: Bench): void {
  bench.script('yarn', [
    "process.stdout.write('yarn run v1.22.22\\n$ /x/node_modules/.bin/lawcheck\\n');",
    `const r = spawnSync(process.execPath, [${JSON.stringify(join(bench.bin, 'lawcheck'))}, ...process.argv.slice(4)], { stdio: ['ignore', 'pipe', 'inherit'] });`,
    'process.stdout.write(r.stdout);',
    "process.stdout.write(r.status === 0 ? 'Done in 0.10s.\\n' : 'info Visit https://yarnpkg.com/en/docs/cli/run for documentation about this command.\\n');",
    'process.exit(r.status ?? 2);',
  ]);
}

test('R-109: test 158, with runner yarn on Yarn 1 a failing check reaches the agent as it does with the global runner, in the edit, the fitted edit and the stop', async () => {
  await withBench(async (bench, dir) => {
    yarnOne(bench);
    const cmd = 'yarn run lawcheck';
    const s = makeSample(dir);
    write(s, '.lawcheck/config.yaml', 'runner: yarn\n');
    const session = new Session(bench, s);
    await session.prompt();
    write(s, D_PATH, D);
    json(await session.stop(), handBack(`${stopHeader(cmd)}\n\n${D_OUTPUT}`), 'stop');
    json(await session.edit(D_PATH), edited(`${editHeader(D_PATH, cmd)}\n\n${D_OUTPUT}`), 'edit');
    const body = Array.from({ length: 400 }, (_, i) => `${String(i + 1).padStart(3, '0')} ${'x'.repeat(56)}`);
    const printed = ['lawcheck: FAIL  400 errors in 1 named file', '', ...body, '', 'next: fix a.ts:1'];
    writeFileSync(join(dir, 'long.txt'), printed.join('\n') + '\n');
    bench.script('lawcheck', [`process.stdout.write(readFileSync(${JSON.stringify(join(dir, 'long.txt'))}));`, 'process.exitCode = 1;']);
    const text: string = (await session.edit(D_PATH)).json.hookSpecificOutput.additionalContext;
    const lines = text.split('\n');
    assert.equal(lines[lines.length - 1], 'next: fix a.ts:1');
    assert.match(lines[lines.length - 2]!, /^\.\.\. \d+ more lines? not shown; run the command yourself to see them all$/);
    assert.ok(!text.includes('info Visit'), text);
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

test('S6-3: a law error that a check the hook could run clears comes back to the agent when the law breaks the same way again', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    const broken = edited(`${editErrorHeader('.lawcheck/law.yaml')}\n\n${TEST17_CHECK}`);
    write(s, '.lawcheck/law.yaml', BROKEN_LAW);
    json(await session.edit('.lawcheck/law.yaml'), broken, 'the first break');
    write(s, '.lawcheck/law.yaml', LAW);
    nothing(await session.edit('.lawcheck/law.yaml'), 'the law fixed');
    write(s, '.lawcheck/law.yaml', BROKEN_LAW);
    json(await session.edit('.lawcheck/law.yaml'), broken, 'the same break again');
    write(s, D_PATH, D);
    nothing(await session.edit(D_PATH), 'the same output, still broken');
    write(s, '.lawcheck/law.yaml', LAW);
    json(await session.edit(D_PATH), edited(`${editHeader(D_PATH)}\n\n${D_OUTPUT}`), 'a check that breaks the law also clears it');
    write(s, '.lawcheck/law.yaml', BROKEN_LAW);
    json(await session.edit('.lawcheck/law.yaml'), broken, 'the same break after a failing check');
  });
});

test('S6-5: with a reviewer rule and no reviewer set, prime says so and the session start tells the user once', async () => {
  await withBench(async (bench, dir) => {
    const r = makeR(dir);
    rmSync(join(r, '.lawcheck/config.yaml'));
    const primed = await lawcheck(r, ['prime']);
    assert.equal(primed.code, 0);
    assert.ok(primed.stdout.includes('\n- not-reviewed: no reviewer is set in .lawcheck/config.yaml, so a plain lawcheck check and CI fail on every file a reviewer rule judges; tell the user once, since setting a reviewer is the user\'s decision.\n'), primed.stdout);
    const told = {
      ...started(primed.stdout.replace(/\n$/, '')),
      systemMessage: "Lawcheck: this repository has a reviewer rule, and .lawcheck/config.yaml sets no reviewer, so a plain lawcheck check and CI fail on every file a reviewer rule judges. Setting reviewer.provider and reviewer.model there is the user's decision; lawcheck docs providers lists the choices.",
    };
    const session = new Session(bench, r);
    json(await session.start(), told, 'the first start');
    await session.prompt();
    json(await session.start('compact'), started(primed.stdout.replace(/\n$/, '')), 'the same session again');
    json(await new Session(bench, r, 's2').start(), told, 'another session');
    write(r, '.lawcheck/config.yaml', 'reviewer:\n  provider: openai-compatible\n  model: test-model\n');
    const set = await lawcheck(r, ['prime']);
    assert.ok(set.stdout.includes('\n- not-reviewed: fix every other finding first, then run lawcheck check --review\n'), set.stdout);
    json(await new Session(bench, r, 's3').start(), started(set.stdout.replace(/\n$/, '')), 'a reviewer set');
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
  const page = readFileSync(join(ROOT, 'docs', 'plugin.md'), 'utf8');
  const row = (hook: string): [number, number] => {
    const cells = new RegExp(`^\\| \`${hook}\` \\| [^|]+ \\| (\\d+) seconds \\| (\\d+) seconds \\|$`, 'm').exec(page);
    assert.ok(cells, `docs/plugin.md names the deadline of ${hook}`);
    return [Number(cells[1]), Number(cells[2])];
  };
  const less = 5;
  assert.ok(page.includes('The deadline ends five seconds before the time Claude Code gives the hook'));
  const rows = { 'session-start': row('SessionStart'), prompt: row('UserPromptSubmit'), edit: row('PostToolUse'), stop: row('Stop') };
  for (const [given, deadline] of Object.values(rows)) assert.equal(deadline, given - less);
  assert.deepEqual(DEADLINES, Object.fromEntries(Object.entries(rows).map(([event, [, deadline]]) => [event, deadline])));
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
    nothing(await startHook('edit', input, bench.env(), { deadlines: { edit: DEADLINES.edit - 1 } }).ended);
    assert.equal(readFileSync(seen, 'utf8'), 'null\n');
    assert.equal(bench.checks().length, 1);
  });
});

test('R-110: the edit hook given the longest deadline the test entry takes waits for a lawcheck slower than its test deadline, as the test of R-88 needs on a loaded runner', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    append(s, 'src/cli/main.ts', '// end\n');
    const input = new Session(bench, s).input('edit', { tool_name: 'Write', tool_input: { file_path: join(s, 'src/cli/main.ts') }, tool_response: {} });
    const slower = TEST_HOOK_DEADLINES.edit * 1000 + 500;
    bench.script('lawcheck', [`Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${slower});`, ...installedLawcheck(bench.logFile)]);
    const run = await startHook('edit', input, bench.env(), { deadlines: { edit: DEADLINES.edit - 1 } }).ended;
    nothing(run);
    assert.ok(run.ms >= slower, `the hook ended after ${run.ms} ms, before what it started answered`);
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
    const k = /^\.\.\. (\d+) more lines? not shown; run the command yourself to see them all$/.exec(more);
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
    json(await session.stop(), withD(released()), '167 the same output');
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

test('test 954: a prompt event for the turn that is still open keeps its returns and its last output', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    write(s, D_PATH, D);
    for (let i = 0; i < 3; i++) {
      append(s, D_PATH, 'console.log(1);\n');
      assert.equal((await session.stop()).json?.hookSpecificOutput?.hookEventName, 'Stop');
    }
    const kept = bench.state();
    assert.equal(kept.blocks, 3);
    nothing(await session.run('prompt', { prompt: 'the reason of the hand-back' }), 'the same turn again');
    const again = bench.state();
    assert.equal(again.blocks, 3);
    assert.equal(again.last, kept.last);
    assert.equal(again.started, kept.started);
    append(s, D_PATH, 'console.log(1);\n');
    json(await session.stop(), withD(released()), 'the fourth stop lets the agent finish');
    assert.equal(bench.state().open, false);
  });
});

test('test 955: a prompt event with another prompt id while the turn is open starts the count again', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    write(s, D_PATH, D);
    for (let i = 0; i < 3; i++) {
      append(s, D_PATH, 'console.log(1);\n');
      await session.stop();
    }
    assert.equal(bench.state().blocks, 3);
    nothing(await session.prompt(), 'a new prompt');
    assert.equal(bench.state().blocks, 0);
    assert.equal(bench.state().last, null);
    append(s, D_PATH, 'console.log(1);\n');
    assert.equal((await session.stop()).json?.hookSpecificOutput?.hookEventName, 'Stop');
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
    json(await session.stop(), { systemMessage: 'Lawcheck: the check at the end of the turn stopped with an error, and the turn changed no file under .lawcheck/. lawcheck check shows the error.' });
  });
});

test('test 174: more than 1,000 files', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    mkdirSync(join(s, 'notes'));
    for (let i = 1; i <= 1001; i++) writeFileSync(join(s, 'notes', `${i}.md`), `${i}\n`);
    json(await session.stop(), { systemMessage: 'Lawcheck: 1001 files changed in this turn, and the check at the end of a turn takes at most 1000, so it did not run. lawcheck check shows the result.' });
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
    json(await session.stop(), withD({ systemMessage: 'Lawcheck: the check at the end of the turn did not run: lawcheck was not found.' }));
    await session.prompt();
    append(s, D_PATH, '// more\n');
    nothing(await session.stop(), 'told already');
    bench.script('lawcheck', ["process.stdout.write('lawcheck: ERROR  1 error\\n\\nerror[usage]  x\\n');", 'process.exitCode = 2;']);
    const other = new Session(bench, s, 's2');
    nothing(await other.edit(D_PATH), 'edit with an old lawcheck');
    await other.prompt();
    append(s, D_PATH, '// again\n');
    json(await other.stop(), { systemMessage: 'Lawcheck: the check at the end of the turn did not run: this Lawcheck does not take check <paths>; update it.' });
  });
});

test('test 851: the end of a turn that added a waiver or changed the law tells the user once, and a waiver from before the turn is not named', async () => {
  const told = (text: string) => ({ systemMessage: `Lawcheck: in this turn the agent ${text}. Read them before you accept the turn.` });
  const legacy = (what: string) => `console.log('${what}'); // lawcheck-waive no-console -- a legacy call\n`;
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    write(s, 'src/core/shipping.ts', legacy('x'));
    append(s, '.lawcheck/law.yaml', '# a note\n');
    json(await session.stop(), told('added 1 waiver (no-console at src/core/shipping.ts:1) and changed .lawcheck/law.yaml'), 'the turn that adds them');
    nothing(await session.stop(), 'a second stop of the same turn');
    await session.prompt();
    append(s, 'src/core/shipping.ts', '// more\n');
    nothing(await session.stop(), 'a waiver written before the turn, in a file that differs from HEAD');
    git(s, 'add', '-A');
    git(s, 'commit', '-q', '-m', 'waiver');
    await session.prompt();
    append(s, 'src/core/shipping.ts', '// again\n');
    nothing(await session.stop(), 'a committed waiver');
    await session.prompt();
    write(s, D_PATH, D);
    append(s, 'src/core/shipping.ts', legacy('y'));
    setRuleFile(s);
    assert.equal((await session.stop()).json?.hookSpecificOutput?.hookEventName, 'Stop', 'the hand-back says nothing to the user');
    write(s, D_PATH, 'export const d = 1;\n');
    json(await session.stop(), told('added 1 waiver (no-console at src/core/shipping.ts:4) and changed .lawcheck/rules/no-console.mjs'), 'the stop that lets the agent finish');
  });
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    for (let i = 0; i < 7; i++) append(s, 'src/core/shipping.ts', legacy(String(i)));
    json(await session.stop(), told(`added 7 waivers (${[1, 2, 3, 4, 5].map((line) => `no-console at src/core/shipping.ts:${line}`).join(', ')} and 2 more)`));
  });
});

test('R-152: the end of a turn that deleted a file of the law names it, .lawcheck/law.yaml itself included, and a deleted rule file sends the agent back to fix the law', async () => {
  const told = (text: string) => ({ systemMessage: `Lawcheck: in this turn the agent ${text}. Read them before you accept the turn.` });
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    write(s, '.lawcheck/config.yaml', 'runner: global\n');
    git(s, 'add', '-A');
    git(s, 'commit', '-q', '-m', 'config');
    const session = new Session(bench, s);
    await session.prompt();
    rmSync(join(s, '.lawcheck/config.yaml'));
    json(await session.stop(), told('deleted .lawcheck/config.yaml'), 'a deleted config');
    nothing(await session.stop(), 'a second stop of the same turn');
    await session.prompt();
    rmSync(join(s, '.lawcheck/rules/no-todo.mjs'));
    append(s, 'src/cli/main.ts', '// end\n');
    const back = await session.stop();
    assert.ok(back.json?.hookSpecificOutput?.additionalContext.startsWith(`${stopErrorHeader()}\n\nlawcheck: ERROR  `), back.stdout);
    assert.match(back.json.hookSpecificOutput.additionalContext, /rule-missing-file/);
    write(s, '.lawcheck/law.yaml', LAW.replace('  no-todo:\n    why: A TODO without an issue number gets forgotten.\n    status: advisory\n', '').replaceAll('    rules: [no-todo]\n', ''));
    const after = await session.stop();
    assert.deepEqual(after.json, told('changed .lawcheck/law.yaml and deleted .lawcheck/rules/no-todo.mjs'), after.stdout + after.stderr);
  });
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, join(s, 'src'));
    await session.prompt();
    rmSync(join(s, '.lawcheck/law.yaml'));
    json(await session.stop(), told('deleted .lawcheck/law.yaml'), 'the law deleted');
    nothing(await session.stop(), 'a second stop');
    await session.prompt();
    nothing(await session.stop(), 'the next turn, with no law');
    assert.deepEqual(bench.checks(), []);
  });
});

test('R-153: when the state folder holds a folder in place of the state file, the session start still gives the primer and tells the user that no reviewer is set', async () => {
  await withBench(async (bench, dir) => {
    const r = makeR(dir);
    rmSync(join(r, '.lawcheck/config.yaml'));
    const primed = (await lawcheck(r, ['prime'])).stdout.replace(/\n$/, '');
    mkdirSync(join(bench.data, 'sessions', 's1.json', 'held'), { recursive: true });
    const run = await new Session(bench, r).start();
    assert.equal(run.stderr, '');
    json(run, { ...started(primed), systemMessage: "Lawcheck: this repository has a reviewer rule, and .lawcheck/config.yaml sets no reviewer, so a plain lawcheck check and CI fail on every file a reviewer rule judges. Setting reviewer.provider and reviewer.model there is the user's decision; lawcheck docs providers lists the choices." });
  });
});

test('R-154: a prompt whose snapshot fails keeps what the session was told, so a notice told once does not come back', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    bench.remove('lawcheck');
    const session = new Session(bench, s);
    await session.prompt();
    append(s, 'src/cli/main.ts', '// end\n');
    json(await session.stop(), { systemMessage: 'Lawcheck: the check at the end of the turn did not run: lawcheck was not found.' });
    nothing(await session.prompt({ PATH: bench.bin }), 'a prompt where git cannot start');
    assert.equal(bench.state().told, true);
    assert.equal(bench.state().open, false);
    append(s, 'src/cli/main.ts', '// more\n');
    nothing(await session.stop(), 'told already');
  });
});

test('R-155: the message about no reviewer names the docs command of the runner the repository sets', async () => {
  await withBench(async (bench, dir) => {
    bench.runner('pnpm', 2);
    const r = makeR(dir);
    write(r, '.lawcheck/config.yaml', 'runner: pnpm\n');
    const run = await new Session(bench, r).start();
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.json?.systemMessage, "Lawcheck: this repository has a reviewer rule, and .lawcheck/config.yaml sets no reviewer, so a plain pnpm exec lawcheck check and CI fail on every file a reviewer rule judges. Setting reviewer.provider and reviewer.model there is the user's decision; pnpm exec lawcheck docs providers lists the choices.");
  });
});

test('R-156: a law error reaches the agent once per root, so an edit that passes in another root does not hand it over again', async () => {
  await withBench(async (bench, dir) => {
    const a = makeSample(join(dir, 'a'));
    const b = makeSample(join(dir, 'b'));
    write(a, '.lawcheck/law.yaml', BROKEN_LAW);
    const session = new Session(bench, a);
    const inB = () => session.run('edit', { tool_name: 'Write', tool_input: { file_path: join(b, 'src/cli/main.ts') }, tool_response: {} });
    json(await session.edit('.lawcheck/law.yaml'), edited(`${editErrorHeader('.lawcheck/law.yaml')}\n\n${TEST17_CHECK}`), 'the first break');
    append(b, 'src/cli/main.ts', '// end\n');
    nothing(await inB(), 'an edit that passes in the other root');
    append(a, 'src/cli/main.ts', '// end\n');
    nothing(await session.edit('src/cli/main.ts'), 'the same break, after an edit in the other root');
    write(a, '.lawcheck/law.yaml', LAW);
    nothing(await session.edit('.lawcheck/law.yaml'), 'the law fixed');
    write(a, '.lawcheck/law.yaml', BROKEN_LAW);
    json(await session.edit('.lawcheck/law.yaml'), edited(`${editErrorHeader('.lawcheck/law.yaml')}\n\n${TEST17_CHECK}`), 'the same break after a pass in its own root');
  });
});

test('test 176: a background agent keeps the turn open and says so; a background shell does not', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new Session(bench, s);
    await session.prompt();
    write(s, D_PATH, D);
    json(await session.stop({ background_tasks: [{ id: 't1', type: 'subagent', status: 'running' }] }), {
      systemMessage: 'Lawcheck: the check at the end of the turn waits for the background task t1 (subagent), which may still be writing files. It runs the first time the agent finishes after that task ends.',
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
      const run = await hook(bench, event, input, {}, undefined, { stderr: /^Lawcheck plugin: [^\n]+\n$/ });
      assert.equal(run.stdout, '', event);
      assert.match(run.stderr, /^Lawcheck plugin: /, event);
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
    json(await session.stop(), withD(released()), 'the same output again is let go, so the state was read');
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

const blocked = (text: string) => ({ decision: 'block', reason: text });
const editsHeader = (paths: string[], cmd = 'lawcheck') => `Lawcheck: after this edit, the files it wrote break the law of this repository. ${cmd} check ${paths.map((path) => `./${path}`).join(' ')} printed:`;

test('test 920: the files of the plugin for Codex', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const claude = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
  const codex = JSON.parse(readFileSync(join(PLUGIN, '.codex-plugin', 'plugin.json'), 'utf8'));
  const { userConfig, description, ...shared } = claude;
  assert.ok(userConfig !== undefined && description !== undefined);
  assert.deepEqual(codex, { ...shared, version: manifest.version, description: description.replace('with Write, Edit or NotebookEdit', 'with apply_patch'), hooks: './hooks/codex.json' });
  const claudeHooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const codexHooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'codex.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(codexHooks), Object.keys(claudeHooks));
  for (const [name, groups] of Object.entries(codexHooks) as [string, any[]][]) {
    const event = Object.keys(EVENT_NAMES).find((key) => EVENT_NAMES[key] === name)!;
    const ours = claudeHooks[name][0].hooks[0];
    assert.deepEqual(groups, [{ ...(name === 'PostToolUse' ? { matcher: 'apply_patch' } : {}), hooks: [{ type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/lawcheck-hook.mjs" ${event} --host codex`, timeout: ours.timeout }] }], name);
  }
});

test('test 921: in Codex, the session start, the hand-back by decision block, three returns per turn, and the message to the user', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const primed = (await lawcheck(s, ['prime'])).stdout.replace(/\n$/, '');
    const session = new CodexSession(bench, s);
    for (const source of ['startup', 'resume', 'clear', 'compact']) json(await session.start(source), started(primed), source);
    nothing(await session.prompt(), 'the prompt');
    assert.equal(bench.state('c1').prompt_id, 't1');
    write(s, D_PATH, D);
    json(await session.stop(), blocked(`${stopHeader()}\n\n${D_OUTPUT}`), 'the first stop');
    json(await session.stop({ stop_hook_active: true }), withD(released()), 'the same output after the hand-back');
    await session.prompt();
    const runs: HookRun[] = [];
    for (let i = 0; i < 4; i++) {
      append(s, D_PATH, 'console.log(1);\n');
      runs.push(await session.stop({ stop_hook_active: i > 0 }));
    }
    for (const run of runs.slice(0, 3)) assert.equal(run.json?.decision, 'block', run.stdout);
    json(runs[3]!, released(), 'the fourth stop of the turn');
    await session.prompt();
    append(s, D_PATH, 'console.log(1);\n');
    assert.equal((await session.stop()).json?.decision, 'block', 'a new turn sends the agent back again');
    assert.equal(bench.state('c1').blocks, 1);
  });
});

test('test 922: in Codex, the edit hook checks the files an apply_patch leaves on disk', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new CodexSession(bench, s);
    write(s, D_PATH, D);
    json(await session.patch([`*** Add File: ${D_PATH}`, '+export const d = 1;']), edited(`${editHeader(D_PATH)}\n\n${D_OUTPUT}`), 'a file added');
    json(await session.patch([`*** Update File: ${join(s, D_PATH)}`, '@@', '+// more']), edited(`${editHeader(D_PATH)}\n\n${D_OUTPUT}`), 'a file updated, by its absolute path');
    json(await session.patch(['*** Update File: src/core/old.ts', `*** Move to: ${D_PATH}`, '@@', '+// moved']), edited(`${editHeader(D_PATH)}\n\n${D_OUTPUT}`), 'a file moved');
    append(s, 'src/cli/main.ts', '// end\n');
    const both = await session.patch(['*** Update File: src/cli/main.ts', '@@', '+// end', `*** Update File: ${D_PATH}`, '@@', '+// more']);
    assert.equal(both.code, 0, both.stderr);
    assert.ok(String(both.json?.hookSpecificOutput?.additionalContext).startsWith(`${editsHeader(['src/cli/main.ts', D_PATH])}\n\n`), both.stdout);
    assert.deepEqual(bench.checks(), [...Array.from({ length: 3 }, () => ['check', `./${D_PATH}`]), ['check', './src/cli/main.ts', `./${D_PATH}`]]);
    bench.clearLog();
    nothing(await session.patch(['*** Delete File: src/core/tax.ts']), 'a file deleted');
    nothing(await session.patch(['*** Update File: src/core/gone.ts', '@@', '+x']), 'a file that is not on disk');
    nothing(await session.run('edit', { tool_name: 'Bash', tool_input: { command: patchOf([`*** Update File: ${D_PATH}`]) } }), 'a shell command');
    nothing(await session.run('edit', { tool_name: 'apply_patch', tool_input: { command: 7 } }), 'a patch that is no text');
    const lawless = newRepository(join(dir, 'lawless'));
    write(lawless, 'src/a.ts', 'console.log(1);\n');
    nothing(await new CodexSession(bench, lawless).patch(['*** Add File: src/a.ts', '+console.log(1);']), 'no law');
    assert.deepEqual(bench.log(), []);
  });
});

test('test 923: in Codex, the two switches are variables of the environment, and Claude Code keeps its settings', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    write(s, D_PATH, D);
    const session = new CodexSession(bench, s);
    const patch = [`*** Update File: ${D_PATH}`, '@@', '+// more'];
    for (const value of ['false', '0', 'No', ' off ']) nothing(await session.patch(patch, { LAWCHECK_PLUGIN_CHECK_AFTER_EDIT: value }), value);
    assert.deepEqual(bench.log(), []);
    json(await session.patch(patch, { CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT: 'false' }), edited(`${editHeader(D_PATH)}\n\n${D_OUTPUT}`), 'the setting of Claude Code');
    nothing(await new Session(bench, s).edit(D_PATH, 'Write', {}, { CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT: 'false', LAWCHECK_PLUGIN_CHECK_AFTER_EDIT: 'true' }), 'Claude Code reads its own setting');
  });
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new CodexSession(bench, s);
    const off = { LAWCHECK_PLUGIN_CHECK_BEFORE_STOP: 'off' };
    nothing(await session.prompt(off));
    write(s, D_PATH, D);
    nothing(await session.stop({}, off));
    assert.deepEqual(bench.sessions(), []);
    assert.deepEqual(bench.log(), []);
  });
});

test('test 924: a host the hook does not know fails the hook with one line', async () => {
  await withBench(async (bench, dir) => {
    const input = JSON.stringify({ session_id: 's1', cwd: dir, hook_event_name: 'Stop' });
    for (const host of ['cursor', 'Codex']) {
      const run = await hook(bench, 'stop', input, {}, undefined, { host, stderr: `Lawcheck plugin: unknown arguments '--host ${host}' after the event; the hook takes --host claude-code, --host codex or --host copilot there\n` });
      assert.equal(run.stdout, '', host);
      assert.equal(run.code, 1, host);
    }
  });
});

test('R-4: the check after an edit judges a file of a folder that holds a law of its own by that law, as docs/plugin.md says, and not by the law of the repository the session runs in', async () => {
  await withBench(async (bench, dir) => {
    const TOP_LAW = 'lawcheck: 0.1.0\n\ntypes:\n  everything:\n    about: Every TypeScript file.\n    paths: ["**/*.ts"]\n';
    const repo = makeSample(dir, { under: 'tests/fixture', top: (r) => write(r, '.lawcheck/law.yaml', TOP_LAW) });
    write(repo, `tests/fixture/${D_PATH}`, D);
    const session = new Session(bench, repo);
    json(await session.edit(`tests/fixture/${D_PATH}`, 'Write'), edited(`${editHeader(D_PATH)}\n\n${D_OUTPUT}`), 'judged by the law of the fixture');
    assert.deepEqual(bench.log().at(-1), { args: ['check', `./${D_PATH}`], cwd: join(repo, 'tests/fixture') });
    write(repo, 'src/top.ts', 'console.log(1);\n');
    nothing(await session.edit('src/top.ts', 'Write'), 'judged by the law of the repository, which has no rule');
    assert.deepEqual(bench.log().at(-1), { args: ['check', './src/top.ts'], cwd: repo });
  });
});

const COPILOT_EVENTS: Record<string, string> = { sessionStart: 'session-start', userPromptSubmitted: 'prompt', postToolUse: 'edit', agentStop: 'stop' };
const copilotContext = (text: string) => ({ additionalContext: text });
const toldAtEnd = (text: string) => blocked(`Lawcheck: before you finish, tell the user this message, word for word, then finish:\n\n${text}`);

test('test 960: the files of the plugin for Copilot CLI', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const claude = JSON.parse(readFileSync(join(PLUGIN, '.claude-plugin', 'plugin.json'), 'utf8'));
  const copilot = JSON.parse(readFileSync(join(PLUGIN, '.plugin', 'plugin.json'), 'utf8'));
  const { userConfig, description, ...shared } = claude;
  assert.ok(userConfig !== undefined && description !== undefined);
  assert.deepEqual(copilot, { ...shared, version: manifest.version, description: description.replace('with Write, Edit or NotebookEdit', 'with create or edit'), hooks: 'hooks/copilot.json' });
  const claudeHooks = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const settings = JSON.parse(readFileSync(join(PLUGIN, 'hooks', 'copilot.json'), 'utf8'));
  assert.deepEqual(Object.keys(settings), ['version', 'hooks']);
  assert.equal(settings.version, 1);
  assert.deepEqual(Object.keys(settings.hooks), Object.keys(COPILOT_EVENTS));
  for (const [name, entries] of Object.entries(settings.hooks) as [string, any[]][]) {
    const event = COPILOT_EVENTS[name]!;
    const ours = claudeHooks[EVENT_NAMES[event]!][0].hooks[0];
    const matcher = name === 'postToolUse' ? { matcher: '^(create|edit|str_replace_editor|apply_patch)$' } : {};
    assert.deepEqual(entries, [{ type: 'command', ...matcher, exec: 'node', args: ['${PLUGIN_ROOT}/hooks/lawcheck-hook.mjs', event, '--host', 'copilot'], timeoutSec: ours.timeout }], name);
  }
});

test('test 961: in Copilot, the session start gives the law as additionalContext, and the hand-back is decision block with three returns per turn', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const primed = (await lawcheck(s, ['prime'])).stdout.replace(/\n$/, '');
    const session = new CopilotSession(bench, s);
    for (const source of ['new', 'startup', 'resume']) json(await session.start(source), copilotContext(primed), source);
    nothing(await session.prompt(), 'the prompt');
    assert.equal(bench.state('k1').prompt_id, null);
    write(s, D_PATH, D);
    json(await session.stop(), blocked(`${stopHeader()}\n\n${D_OUTPUT}`), 'the first stop');
    nothing(await session.prompt({}, 'the reason of the hand-back'), 'the prompt event the hand-back opens');
    assert.equal(bench.state('k1').blocks, 1, 'the hand-back keeps the count of its turn');
    const runs: HookRun[] = [];
    for (let i = 0; i < 3; i++) {
      append(s, D_PATH, 'console.log(1);\n');
      runs.push(await session.stop({ stop_hook_active: true }));
      await session.prompt({}, 'the reason of the hand-back');
    }
    for (const run of runs.slice(0, 2)) assert.equal(run.json?.decision, 'block', run.stdout);
    json(runs[2]!, toldAtEnd(withD(released()).systemMessage), 'the fourth stop of the turn sends the agent back to tell the user');
  });
});

test('test 962: in Copilot, the message of the end of a turn goes to the user through the agent, once per turn', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new CopilotSession(bench, s);
    nothing(await session.prompt());
    write(s, D_PATH, D);
    json(await session.stop(), blocked(`${stopHeader()}\n\n${D_OUTPUT}`), 'the first stop');
    json(await session.stop({ stop_hook_active: true }), toldAtEnd(withD(released()).systemMessage), 'the same output: the agent goes back once to tell the user');
    assert.equal(bench.state('k1').relayed, true);
    assert.equal(bench.state('k1').open, false);
    nothing(await session.stop({ stop_hook_active: true }), 'the stop after the message, with no prompt event between');
    nothing(await session.prompt({}, 'the reason of the hand-back'), 'the prompt event the message opens');
    nothing(await session.stop({ stop_hook_active: true }), 'the stop after the message: the agent changed no file');
    nothing(await session.prompt(), 'the next prompt of the user');
    append(s, D_PATH, 'console.log(1);\n');
    assert.equal((await session.stop()).json?.decision, 'block', 'a new turn sends the agent back again');
  });
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    bench.remove('lawcheck');
    const session = new CopilotSession(bench, s, 'k2');
    nothing(await session.prompt());
    write(s, D_PATH, D);
    json(await session.stop(), toldAtEnd(`Lawcheck: the check at the end of the turn did not run: lawcheck was not found.\n${D_WAIVER}`), 'a check that did not run');
    const lost = new CopilotSession(bench, s, '../k3');
    json(await lost.stop(), toldAtEnd('Lawcheck: the check at the end of the turn did not run: lawcheck was not found.'), 'a session id the plugin keeps no state for');
    nothing(await lost.stop({ stop_hook_active: true }), 'the stop after it');
  });
});

test('test 963: in Copilot, the session start asks the agent to tell the user once that no reviewer is set', async () => {
  await withBench(async (bench, dir) => {
    const r = makeR(dir);
    rmSync(join(r, '.lawcheck/config.yaml'));
    const primed = (await lawcheck(r, ['prime'])).stdout.replace(/\n$/, '');
    const notice = "Lawcheck: this repository has a reviewer rule, and .lawcheck/config.yaml sets no reviewer, so a plain lawcheck check and CI fail on every file a reviewer rule judges. Setting reviewer.provider and reviewer.model there is the user's decision; lawcheck docs providers lists the choices.";
    const session = new CopilotSession(bench, r);
    json(await session.start(), copilotContext(`${primed}\n\nLawcheck: in your first answer, tell the user this message, word for word:\n\n${notice}`), 'the first start');
    json(await session.start('resume'), copilotContext(primed), 'the same session again');
  });
});

test('test 964: in Copilot, the edit hook checks the file that create, edit or str_replace_editor wrote, and the text fits in 10,000 bytes', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    const session = new CopilotSession(bench, s);
    write(s, D_PATH, D);
    const found = copilotContext(`${editHeader(D_PATH)}\n\n${D_OUTPUT}`);
    json(await session.write('create', D_PATH), found, 'create');
    json(await session.write('edit', D_PATH), found, 'edit');
    const by = (toolName: string, toolArgs: unknown) => session.run('edit', { toolName, toolArgs });
    json(await by('edit', { path: D_PATH, old_str: 'a', new_str: 'b' }), found, 'a path relative to the session folder');
    json(await by('edit', JSON.stringify({ path: join(s, D_PATH), old_str: 'a', new_str: 'b' })), found, 'arguments as a JSON text');
    json(await by('str_replace_editor', { command: 'str_replace', path: join(s, D_PATH), old_str: 'a', new_str: 'b' }), found, 'str_replace_editor');
    json(await by('apply_patch', patchOf([`*** Update File: ${D_PATH}`, '@@', '+// more'])), found, 'apply_patch');
    assert.equal(bench.checks().length, 6);
    bench.clearLog();
    nothing(await by('str_replace_editor', { command: 'view', path: join(s, D_PATH) }), 'str_replace_editor view');
    nothing(await by('view', { path: join(s, D_PATH) }), 'view');
    nothing(await by('bash', { command: `echo > ${D_PATH}` }), 'bash');
    nothing(await by('edit', { path: join(s, 'src/core/gone.ts') }), 'a file that is not on disk');
    nothing(await by('edit', 7), 'arguments that are no object');
    const lawless = newRepository(join(dir, 'lawless'));
    write(lawless, 'src/a.ts', 'console.log(1);\n');
    nothing(await new CopilotSession(bench, lawless).write('create', 'src/a.ts'), 'no law');
    assert.deepEqual(bench.log(), []);
    const body = Array.from({ length: 400 }, (_, i) => `${String(i + 1).padStart(3, '0')} ${'\u017c'.repeat(40)}`);
    const printed = ['lawcheck: FAIL  400 errors in 1 named file', '', ...body, '', 'next: fix a.ts:1'];
    writeFileSync(join(dir, 'long.txt'), printed.join('\n') + '\n');
    bench.script('lawcheck', [`process.stdout.write(readFileSync(${JSON.stringify(join(dir, 'long.txt'))}));`, 'process.exitCode = 1;']);
    const long = await session.write('edit', D_PATH);
    const text: string = long.json.additionalContext;
    const bytes = Buffer.byteLength(text, 'utf8');
    assert.ok(bytes <= 10000, String(bytes));
    const lines = text.split('\n');
    const kept = lines.slice(3, -2);
    assert.deepEqual(kept, printed.slice(1, 1 + kept.length));
    assert.ok(bytes + 1 + Buffer.byteLength(printed[1 + kept.length]!, 'utf8') > 9999, 'the next line would not fit');
    assert.equal(lines[lines.length - 1], 'next: fix a.ts:1');
  });
});

test('test 965: in Copilot, the two switches are variables of the environment', async () => {
  await withBench(async (bench, dir) => {
    const s = makeSample(dir);
    write(s, D_PATH, D);
    const session = new CopilotSession(bench, s);
    for (const value of ['false', '0', 'No', ' off ']) nothing(await session.write('edit', D_PATH, { LAWCHECK_PLUGIN_CHECK_AFTER_EDIT: value }), value);
    assert.deepEqual(bench.log(), []);
    const off = { LAWCHECK_PLUGIN_CHECK_BEFORE_STOP: 'off' };
    nothing(await session.prompt(off));
    nothing(await session.stop({}, off));
    assert.deepEqual(bench.sessions(), []);
    assert.deepEqual(bench.log(), []);
  });
});
