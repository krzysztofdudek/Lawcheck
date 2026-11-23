import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { plural } from '../../dist/output.js';
import { counted, gitAlone, whyOf, writeFakeProgram } from './fake-reviewer.ts';
import { alive, F, F_PATH, lawcheck, pathWith, PROMPT_F, run, SECOND, startLawcheck, withR, write } from './helpers.ts';
import { fakeWrites, platformSkip, waitUntil } from '../harness/tool.ts';
import { HELD_OUTPUT_RUN_MS, LATE_ANSWER_MS, LIST_DELAY_MS, PROGRAM_TIMEOUT_RUN_MS, SHARED_TIMEOUT_S } from '../numbers.ts';

// The sign-in variables of each program that hold a key (docs/config.md, Variables); copilot's COPILOT_PROVIDER_API_KEY_COMMAND holds a command.
const SIGN_IN_KEYS: Record<string, string[]> = {
  codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_PROVIDER_API_KEY', 'COPILOT_PROVIDER_BEARER_TOKEN'],
};
const POLICY = '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n';
const AGAIN = 'then run the same command again; what was answered is kept, so it asks only the rest';
const PASSED = 'lawcheck: PASS  1 changed file (against main), 1 waiver, 1 reviewer call\nnote: this change adds 1 waiver: clear-errors at src/core/refund.ts:3\n';

interface Program {
  provider: 'codex' | 'gemini-cli' | 'copilot-cli';
  name: 'codex' | 'gemini' | 'copilot';
  args: (model: string | null, recorded: string[], servers?: string[]) => string[];
  exits: number[];
  lists: boolean;
}

const CODEX_OFF = ['--disable', 'shell_tool', '--disable', 'view_image', '--disable', 'multi_agent', '--disable', 'goals', '--disable', 'hooks', '--disable', 'plugins', '--disable', 'apps', '-c', 'web_search=disabled'];

const PROGRAMS: Program[] = [
  {
    provider: 'codex',
    name: 'codex',
    args: (model, _recorded, servers = []) => [
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--ignore-rules',
      '--color',
      'never',
      ...CODEX_OFF,
      ...servers.flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]),
      ...(model === null ? [] : ['--model', model]),
      '-',
    ],
    exits: [1],
    lists: true,
  },
  {
    provider: 'gemini-cli',
    name: 'gemini',
    args: (model, recorded) => [
      '--output-format',
      'text',
      ...(model === null ? [] : ['--model', model]),
      '--skip-trust',
      '--approval-mode',
      'plan',
      '--extensions',
      'none',
      '--allowed-mcp-server-names',
      'lawcheck-allows-no-mcp-server',
      '--policy',
      recorded[recorded.indexOf('--policy') + 1]!,
    ],
    exits: [1, 42, 53],
    lists: false,
  },
  {
    provider: 'copilot-cli',
    name: 'copilot',
    args: (model, _recorded, servers = []) => [
      '--silent',
      '--no-ask-user',
      '--no-custom-instructions',
      '--disable-builtin-mcps',
      ...servers.flatMap((name) => ['--disable-mcp-server', name]),
      '--available-tools=lawcheck-offers-no-tool',
      '--disallow-temp-dir',
      '--no-auto-update',
      ...(model === null ? [] : ['--model', model]),
    ],
    exits: [1],
    lists: true,
  },
];

const configOf = (provider: string, extra = '') => ({
  onMain: (r: string) => write(r, '.lawcheck/config.yaml', `reviewer:\n  provider: ${provider}\n${extra}`),
});

const after = (text: string, calls: number) => text.replace('ERROR  1 error\n', `ERROR  1 error, ${plural(calls, 'reviewer call')}\n`);

function stopped(error: string, code: 'reviewer-unreachable' | 'reviewer-bad-answer', next: string): string {
  return `lawcheck: ERROR  1 error\n\n${error}\n  why:  ${whyOf(code)}\n\nnext: ${next}\n`;
}

const UNREACHABLE = (message: string) => `src/core/refund.ts  error[reviewer-unreachable]  clear-errors: ${message}`;

function fakeEnv(program: Program, dir: string, mode: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const bin = writeFakeProgram(join(dir, 'bin'), program.name);
  const upper = program.name.toUpperCase();
  fakeWrites(dir, ['record.json', 'asked.txt', 'listed.txt']);
  return {
    PATH: pathWith(bin),
    [`FAKE_${upper}_MODE`]: mode,
    [`FAKE_${upper}_RECORD`]: join(dir, 'record.json'),
    [`FAKE_${upper}_ASKED`]: join(dir, 'asked.txt'),
    [`FAKE_${upper}_LISTED`]: join(dir, 'listed.txt'),
    ...extra,
  };
}

function record(dir: string) {
  return JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8')) as { args: string[]; cwd: string; listing: string[]; stdin: string; pid: number; child?: number; policy: string | null; env: Record<string, string>; at: number };
}


function named(program: Program, what: string, body: () => Promise<void>): Promise<void> {
  return body().catch((error: Error) => {
    error.message = `${program.provider}, ${what}: ${error.message}`;
    throw error;
  });
}

function binaryOf(dir: string, program: Program): string {
  return join(dir, 'bin', program.name + (process.platform === 'win32' ? '.cmd' : ''));
}

async function programCases(program: Program): Promise<void> {
  {
    const upper = program.name.toUpperCase();
    const answerKey = `FAKE_${upper}_ANSWER`;
    const called = `lawcheck: 1 reviewer call to ${program.provider}\n`;
    const simple = (mode: string, message: string, next: string, extra = ''): [string, () => Promise<void>] => [
      mode,
      () =>
        withR(async (r, dir) => {
          write(r, F_PATH, F);
          const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, mode));
          assert.equal(result.stdout, after(stopped(UNREACHABLE(message), 'reviewer-unreachable', `${next}, ${AGAIN}`), 1));
          assert.equal(result.stderr, called);
          assert.equal(result.code, 2);
          assert.equal(counted(join(dir, 'asked.txt')), mode === 'expired' ? 0 : 1);
        }, configOf(program.provider, extra)),
    ];
    const told = `ask the user to do what ${program.name} says, such as signing in or setting reviewer.model in .lawcheck/config.yaml to a model ${program.name} has`;
    const pastTimeout = (): Promise<void> =>
      withR(async (r, dir) => {
        write(r, F_PATH, F);
        const running = startLawcheck(r, ['check', '--review', '--base', 'main'], { env: fakeEnv(program, dir, 'sleep') });
        await running.output(/error\[reviewer-unreachable\]/, 'stdout');
        const shown = Date.now();
        const result = await running.ended;
        const next = `check that ${program.name} answers when started by hand, or ask the user to raise reviewer.timeout in .lawcheck/config.yaml, ${AGAIN}`;
        assert.equal(result.stdout, after(stopped(UNREACHABLE(`${program.name} gave no answer within 1 seconds`), 'reviewer-unreachable', next), 1));
        assert.equal(result.code, 2);
        const seen = record(dir);
        assert.ok(shown - seen.at < PROGRAM_TIMEOUT_RUN_MS, `${shown - seen.at} ms from the start of ${program.name} to the error line, where the kill grace alone is 5 seconds`);
        assert.ok(await waitUntil(() => !alive(seen.pid) && !alive(seen.child!), 'LEFTOVER_GRACE_MS'), 'the fake or its child is alive');
        assert.ok(await waitUntil(() => !existsSync(seen.cwd), 'LEFTOVER_GRACE_MS'), seen.cwd);
      }, configOf(program.provider, '  timeout: 1\n'));
    const heldOutput = (): Promise<void> =>
      withR(async (r, dir) => {
        if (platformSkip('a child that left the group') !== null) return;
        write(r, F_PATH, F);
        const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'setsid'));
        const seen = record(dir);
        try {
          assert.equal(result.stdout, SECOND);
          assert.equal(result.code, 1);
          assert.ok(result.ms < HELD_OUTPUT_RUN_MS, `${result.ms} ms`);
          assert.ok(await waitUntil(() => !alive(seen.child!), 'LEFTOVER_GRACE_MS'), 'the child is alive');
        } finally {
          if (alive(seen.child!)) process.kill(seen.child!, 'SIGKILL');
        }
      }, configOf(program.provider));
    const cases: [string, () => Promise<void>][] = [
      [
        'a fail with lines, and how the program is started',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'answer'));
            assert.equal(result.stdout, SECOND);
            assert.equal(result.stderr, called);
            assert.equal(result.code, 1);
            const seen = record(dir);
            assert.deepEqual(seen.args, program.args('test-model', seen.args));
            assert.equal(seen.stdin, PROMPT_F);
            assert.deepEqual(seen.listing, []);
            assert.ok(!existsSync(seen.cwd), seen.cwd);
            assert.equal(counted(join(dir, 'listed.txt')), program.lists ? 1 : 0);
            if (program.name === 'gemini') {
              assert.equal(seen.policy, POLICY);
              assert.ok(!existsSync(seen.args[seen.args.indexOf('--policy') + 1]!));
            } else {
              assert.equal(seen.policy, null);
            }
          }, configOf(program.provider, '  model: test-model\n')),
      ],
      [
        'no model',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'answer'));
            assert.equal(result.stdout, SECOND);
            assert.equal(result.code, 1);
            const seen = record(dir);
            assert.deepEqual(seen.args, program.args(null, seen.args));
          }, configOf(program.provider)),
      ],
      [
        'a pass after a line of prose',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'answer', { [answerKey]: 'Here it is.\n{"verdict":"pass","findings":[]}' }));
            assert.equal(result.stdout, PASSED);
            assert.equal(result.stderr, called);
            assert.equal(result.code, 0);
          }, configOf(program.provider)),
      ],
      ...(['fine', 'cut', 'large'] as const).map(
        (what): [string, () => Promise<void>] => [
          `a bad answer: ${what}`,
          () =>
            withR(async (r, dir) => {
              write(r, F_PATH, F);
              const env = what === 'fine' ? fakeEnv(program, dir, 'answer', { [answerKey]: 'fine' }) : fakeEnv(program, dir, what);
              const result = await run(r, null, ['--review', '--base', 'main'], env);
              const lines = result.stdout.split('\n');
              assert.ok(lines[2]!.startsWith('src/core/refund.ts  error[reviewer-bad-answer]  clear-errors: the answer is no verdict twice ('), result.stdout.slice(0, 500));
              assert.equal(result.stdout, after(stopped(lines[2]!, 'reviewer-bad-answer', 'run the same command again; what was answered is kept, so it asks only the rest'), 2));
              assert.equal(result.stderr, called);
              assert.equal(result.code, 2);
              assert.equal(counted(join(dir, 'asked.txt')), 2);
            }, configOf(program.provider)),
        ],
      ),
      [
        'an answer over 4 MiB',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'huge'));
            const message = `${program.name} wrote more than 4 MiB on standard output, so its answer is not read`;
            assert.equal(result.stdout, after(stopped(UNREACHABLE(message), 'reviewer-unreachable', `check that the program ${binaryOf(dir, program)} is ${program.name}, ${AGAIN}`), 1));
            assert.equal(result.code, 2);
            assert.equal(counted(join(dir, 'asked.txt')), 1);
          }, configOf(program.provider)),
      ],
      simple('error', 'Not logged in', told),
      ...[...program.exits, 3].map((code) => simple(`exit-${code}`, `ended with ${code}`, told)),
      simple('silent-exit', `${program.name} exited with 1`, told),
      // The fake prints the first 10 characters of its answer and then kills itself.
      simple('killed', '{"verdict"', told),
      [
        'an exit before it reads its input, with a large prompt',
        () =>
          withR(async (r, dir) => {
            write(r, 'src/core/big.ts', '// filler\n'.repeat(7000));
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'expired'));
            assert.equal(result.stdout, after(stopped('src/core/big.ts  error[reviewer-unreachable]  clear-errors: expired', 'reviewer-unreachable', `${told}, ${AGAIN}`), 1));
            assert.equal(result.code, 2);
          }, configOf(program.provider, '  max_chars: 120000\n')),
      ],
      [
        'a child that leaves the group and lets go of the output',
        () =>
          withR(async (r, dir) => {
            if (platformSkip('a child that left the group') !== null) return;
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'escape'));
            const seen = record(dir);
            try {
              assert.equal(result.stdout, SECOND);
              assert.equal(result.code, 1);
              assert.ok(!alive(seen.child!), 'the child is alive');
            } finally {
              if (alive(seen.child!)) process.kill(seen.child!, 'SIGKILL');
            }
          }, configOf(program.provider)),
      ],
      [
        'no temporary folder',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const missing = join(dir, 'missing');
            // try reads no change of git, which check copies an index for in the temporary directory before any review.
            const result = await lawcheck(r, ['try', 'clear-errors', F_PATH], fakeEnv(program, dir, 'answer', { TMPDIR: missing, TMP: missing, TEMP: missing }));
            const message = `a folder for ${program.name} cannot be made in ${missing} (ENOENT)`;
            const first = program.lists ? `${program.name} could not list its MCP servers: ${message}` : message;
            const fix = 'set TMPDIR (TEMP on Windows) to a folder that exists and can be written';
            assert.equal(result.stdout, after(stopped(UNREACHABLE(first), 'reviewer-unreachable', `${fix}, then run the same command again; try keeps no answer, so it makes every call again`), 1));
            assert.equal(result.code, 2);
          }, configOf(program.provider)),
      ],
      [
        'doctor',
        () =>
          withR(async (r, dir) => {
            const result = await lawcheck(r, ['doctor', '--base', 'main'], fakeEnv(program, dir, 'answer'));
            assert.ok(result.stdout.split('\n').includes(`ok  reviewer  1 reviewer rule; ${program.provider} can be called (lawcheck doctor --reviewer makes one call)`), result.stdout);
            assert.equal(result.code, 0);
            assert.ok(!existsSync(join(dir, 'record.json')));
            const asked = await lawcheck(r, ['doctor', '--base', 'main', '--reviewer'], fakeEnv(program, dir, 'answer'));
            assert.ok(asked.stdout.split('\n').includes(`ok  reviewer  1 reviewer rule; ${program.provider} answered a test call`), asked.stdout);
            assert.equal(asked.code, 0);
          }, configOf(program.provider)),
      ],
      [
        'not on PATH',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], { PATH: gitAlone(dir) });
            const error = `error[reviewer-unreachable]  ${program.provider} cannot be called: the program ${program.name} is not on PATH`;
            assert.equal(result.stdout, `lawcheck: ERROR  1 error\n\n${error}\n  why:  ${whyOf('reviewer-unreachable')}\n\nnext: install ${program.name}, or put the folder that holds it on PATH, then run lawcheck check --review --base main\n`);
            assert.equal(result.stderr, '');
            assert.equal(result.code, 2);
          }, configOf(program.provider)),
      ],
    ];
    if (program.lists) {
      const listed = program.name === 'codex' ? '[{"name":"one","enabled":true},{"name":"off","enabled":false},{"name":"two-2"}]' : '{"mcpServers":{"one":{"source":"user","enabled":true},"off":{"enabled":false},"two-2":{"source":"plugin"}}}';
      cases.push(
        [
          'the MCP servers it would start are switched off, listed once a run',
          () =>
            withR(async (r, dir) => {
              write(r, F_PATH, F);
              const result = await run(r, null, ['--review', '--full', '--base', 'main'], fakeEnv(program, dir, 'answer', { [`FAKE_${upper}_MCP`]: listed }));
              assert.equal(result.code, 1, result.stdout);
              assert.equal(counted(join(dir, 'asked.txt')), 3);
              assert.equal(counted(join(dir, 'listed.txt')), 1);
              const seen = record(dir);
              assert.deepEqual(seen.args, program.args(null, seen.args, ['one', 'two-2']));
            }, configOf(program.provider)),
        ],
        [
          'a list that fails',
          () =>
            withR(async (r, dir) => {
              write(r, F_PATH, F);
              const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'list-fails'));
              assert.equal(result.stdout, after(stopped(UNREACHABLE(`${program.name} could not list its MCP servers: no config`), 'reviewer-unreachable', `run ${program.name} mcp list --json and fix what it says, ${AGAIN}`), 1));
              assert.equal(counted(join(dir, 'asked.txt')), 0);
            }, configOf(program.provider)),
        ],
      );
    }
    cases.push([
      'a key the program prints is written as [key]',
      () =>
        withR(async (r, dir) => {
          write(r, F_PATH, F);
          const secrets = Object.fromEntries(SIGN_IN_KEYS[program.name]!.map((variable) => [variable, `canary-${randomBytes(9).toString('hex')}`]));
          const masked = SIGN_IN_KEYS[program.name]!.map(() => '[key]').join(' and ');
          const failed = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'echo-error', secrets));
          assert.equal(failed.stdout, after(stopped(UNREACHABLE(`Invalid API key: ${masked}`), 'reviewer-unreachable', `${told}, ${AGAIN}`), 1));
          const answered = await run(r, null, ['--review', '--base', 'main', '--json'], fakeEnv(program, dir, 'echo-answer', secrets));
          assert.equal(answered.code, 1, answered.stdout);
          const messages = JSON.parse(answered.stdout).findings.filter((f: { code: string }) => f.code === 'clear-errors').map((f: { message: string }) => f.message);
          assert.deepEqual(messages, [`the key is ${masked}`]);
          for (const value of Object.values(secrets)) assert.ok(!(failed.stdout + failed.stderr + answered.stdout + answered.stderr).includes(value), value);
        }, configOf(program.provider)),
    ]);
    if (program.lists) {
      cases.push([
        'the list and the first call share one timeout',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'late', { [`FAKE_${upper}_LIST_DELAY`]: String(LIST_DELAY_MS), [`FAKE_${upper}_DELAY`]: String(LATE_ANSWER_MS) }));
            const next = `check that ${program.name} answers when started by hand, or ask the user to raise reviewer.timeout in .lawcheck/config.yaml, ${AGAIN}`;
            assert.equal(result.stdout, after(stopped(UNREACHABLE(`${program.name} gave no answer within ${SHARED_TIMEOUT_S} seconds`), 'reviewer-unreachable', next), 1));
            assert.equal(result.code, 2);
          }, configOf(program.provider, `  timeout: ${SHARED_TIMEOUT_S}\n`)),
      ]);
    }
    if (program.name === 'codex') {
      cases.push([
        'a server codex cannot switch off for one call',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'answer', { FAKE_CODEX_MCP: '[{"name":"odd.name","enabled":true}]' }));
            const message = 'codex would start the MCP server "odd.name", and a server whose name holds another character than a letter, a digit, _ or - cannot be switched off for one call';
            assert.equal(result.stdout, after(stopped(UNREACHABLE(message), 'reviewer-unreachable', `rename the server in ~/.codex/config.toml, or set enabled = false under [mcp_servers."odd.name"], ${AGAIN}`), 1));
            assert.equal(counted(join(dir, 'asked.txt')), 0);
          }, configOf(program.provider)),
      ]);
    }
    await Promise.all(cases.map(([what, body]) => named(program, what, body)));
    // These two cases are timed by this process, so each runs alone: the setup of the other cases and the harness's checks of their runs are synchronous and hold this process for seconds, on Windows and on a loaded macOS runner.
    await named(program, 'past its timeout, which bounds the whole call', pastTimeout);
    await named(program, 'a child that leaves the group and holds the output', heldOutput);
  }
}

test('test 406: codex', () => programCases(PROGRAMS[0]!));
test('test 407: gemini-cli', () => programCases(PROGRAMS[1]!));
test('test 408: copilot-cli', () => programCases(PROGRAMS[2]!));

test('test 409: a copilot inside the folder of the VS Code extension is passed over', async () => {
  await withR(async (r, dir) => {
    write(r, F_PATH, F);
    const stub = join(dir, 'Code', 'User', 'globalStorage', 'github.copilot-chat', 'copilotCli');
    mkdirSync(stub, { recursive: true });
    writeFileSync(join(stub, 'copilot'), `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(join(dir, 'stub.txt'))}, 'started');\nprocess.exit(9);\n`);
    chmodSync(join(stub, 'copilot'), 0o755);
    if (process.platform === 'win32') writeFileSync(join(stub, 'copilot.cmd'), `@"${process.execPath}" "${join(stub, 'copilot')}" %*\r\n`);
    const env = fakeEnv(PROGRAMS[2]!, dir, 'answer');
    const result = await run(r, null, ['--review', '--base', 'main'], { ...env, PATH: pathWith(stub, join(dir, 'bin')) });
    assert.equal(result.stdout, SECOND);
    assert.equal(result.code, 1);
    assert.ok(!existsSync(join(dir, 'stub.txt')));
  }, configOf('copilot-cli'));
});
