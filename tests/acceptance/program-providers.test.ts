import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { writeFakeProgram } from './fake-reviewer.ts';
import { alive, F, F_PATH, lawcheck, pathWith, programDir, PROMPT_F, run, SECOND, withR, write } from './helpers.ts';

const UNREACHABLE = 'src/core/refund.ts  error[reviewer-unreachable]  ';
const BAD_ANSWER = 'src/core/refund.ts  error[reviewer-bad-answer]  clear-errors';
const POLICY = '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n';

interface Program {
  provider: 'codex' | 'gemini-cli' | 'copilot-cli';
  name: 'codex' | 'gemini' | 'copilot';
  args: (model: string | null, recorded: string[]) => string[];
  exits: number[];
}

const CODEX_TAIL = ['--disable', 'shell_tool', '--disable', 'view_image', '--disable', 'multi_agent', '--disable', 'goals', '--disable', 'hooks', '--disable', 'plugins', '--disable', 'apps', '-c', 'web_search=disabled'];

const PROGRAMS: Program[] = [
  {
    provider: 'codex',
    name: 'codex',
    args: (model) => ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '--ephemeral', '--ignore-rules', '--color', 'never', ...CODEX_TAIL, ...(model === null ? [] : ['--model', model]), '-'],
    exits: [1],
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
  },
  {
    provider: 'copilot-cli',
    name: 'copilot',
    args: (model) => [
      '--silent',
      '--no-ask-user',
      '--no-custom-instructions',
      '--disable-builtin-mcps',
      '--deny-tool',
      'shell',
      '--deny-tool',
      'write',
      '--deny-tool',
      'url',
      '--deny-tool',
      'memory',
      '--no-auto-update',
      ...(model === null ? [] : ['--model', model]),
    ],
    exits: [1],
  },
];

const configOf = (provider: string, extra = '') => ({
  onMain: (r: string) => write(r, '.lawcheck/config.yaml', `reviewer:\n  provider: ${provider}\n${extra}`),
});

function errorLine(stdout: string, prefix: string): string | undefined {
  return stdout.split('\n').find((line) => line.startsWith(prefix));
}

function fakeEnv(program: Program, dir: string, mode: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const bin = writeFakeProgram(join(dir, 'bin'), program.name);
  const upper = program.name.toUpperCase();
  return { PATH: pathWith(bin), [`FAKE_${upper}_MODE`]: mode, [`FAKE_${upper}_RECORD`]: join(dir, 'record.json'), ...extra };
}

function record(dir: string) {
  return JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8')) as { args: string[]; cwd: string; listing: string[]; stdin: string; pid: number; child?: number; policy: string | null };
}

async function waitFor(condition: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (condition()) return true;
    await new Promise((done) => setTimeout(done, 50));
  }
  return condition();
}

function named(program: Program, what: string, body: () => Promise<void>): Promise<void> {
  return body().catch((error: Error) => {
    error.message = `${program.provider}, ${what}: ${error.message}`;
    throw error;
  });
}

for (const [number, program] of [[190, PROGRAMS[0]!], [191, PROGRAMS[1]!], [192, PROGRAMS[2]!]] as const) {
  test(`test ${number}: ${program.provider}`, async () => {
    const answerKey = `FAKE_${program.name.toUpperCase()}_ANSWER`;
    const cases: [string, () => Promise<void>][] = [
      [
        'a fail with lines, and how the program is started',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'answer'));
            assert.equal(result.stdout, SECOND);
            assert.equal(result.code, 1);
            const seen = record(dir);
            assert.deepEqual(seen.args, program.args('test-model', seen.args));
            assert.equal(seen.stdin, PROMPT_F);
            assert.deepEqual(seen.listing, []);
            assert.ok(!existsSync(seen.cwd), seen.cwd);
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
            assert.equal(result.code, 1, result.stdout);
            const seen = record(dir);
            assert.deepEqual(seen.args, program.args(null, seen.args));
          }, configOf(program.provider)),
      ],
      [
        'a pass',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'answer', { [answerKey]: 'Here it is.\n{"verdict":"pass","findings":[]}' }));
            assert.equal(result.code, 0, result.stdout);
          }, configOf(program.provider)),
      ],
      ...(['fine', 'cut', 'huge'] as const).map(
        (what): [string, () => Promise<void>] => [
          `a bad answer: ${what}`,
          () =>
            withR(async (r, dir) => {
              write(r, F_PATH, F);
              const env = what === 'fine' ? fakeEnv(program, dir, 'answer', { [answerKey]: 'fine' }) : fakeEnv(program, dir, what);
              const result = await run(r, null, ['--review', '--base', 'main', '--json'], env);
              const document = JSON.parse(result.stdout);
              assert.deepEqual(document.errors.map((e: { code: string; file: string }) => `${e.code} ${e.file}`), ['reviewer-bad-answer src/core/refund.ts']);
              assert.ok(result.stdout.length < 10_000, `${result.stdout.length} characters`);
              assert.equal(result.code, 2);
            }, configOf(program.provider)),
        ],
      ),
      [
        'a failed call: the last line of standard error',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'error'));
            assert.equal(errorLine(result.stdout, UNREACHABLE), `${UNREACHABLE}clear-errors: Not logged in`);
            assert.equal(result.code, 2);
          }, configOf(program.provider)),
      ],
      ...[...program.exits, 3].map(
        (code): [string, () => Promise<void>] => [
          `exit ${code}`,
          () =>
            withR(async (r, dir) => {
              write(r, F_PATH, F);
              const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, `exit-${code}`));
              assert.equal(errorLine(result.stdout, UNREACHABLE), `${UNREACHABLE}clear-errors: ended with ${code}`);
              assert.equal(result.code, 2);
            }, configOf(program.provider)),
        ],
      ),
      [
        'an exit with no word',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'silent-exit'));
            assert.equal(errorLine(result.stdout, UNREACHABLE), `${UNREACHABLE}clear-errors: ${program.name} exited with 1`);
          }, configOf(program.provider)),
      ],
      [
        'killed while it answers',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'killed'));
            assert.ok(errorLine(result.stdout, UNREACHABLE), result.stdout);
            assert.equal(result.code, 2);
          }, configOf(program.provider)),
      ],
      [
        'an exit before it reads its input, with a large prompt',
        () =>
          withR(async (r, dir) => {
            write(r, 'src/core/big.ts', '// filler\n'.repeat(7000));
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'expired'));
            assert.equal(errorLine(result.stdout, 'src/core/big.ts  error[reviewer-unreachable]  '), 'src/core/big.ts  error[reviewer-unreachable]  clear-errors: expired');
            assert.ok(!result.stdout.includes('error[internal]'), result.stdout);
            assert.equal(result.code, 2);
          }, configOf(program.provider, '  max_chars: 120000\n')),
      ],
      [
        'past its timeout',
        () =>
          withR(async (r, dir) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], fakeEnv(program, dir, 'sleep'));
            assert.equal(errorLine(result.stdout, UNREACHABLE), `${UNREACHABLE}clear-errors: ${program.name} gave no answer within 1 seconds`);
            assert.ok(result.ms < 15_000, `${result.ms} ms`);
            const seen = record(dir);
            assert.ok(await waitFor(() => !alive(seen.pid), 2000), 'the fake is alive');
            assert.ok(await waitFor(() => !alive(seen.child!), 2000), 'its child is alive');
            assert.ok(!existsSync(seen.cwd), seen.cwd);
          }, configOf(program.provider, '  timeout: 1\n')),
      ],
      [
        'doctor',
        () =>
          withR(async (r, dir) => {
            const result = await lawcheck(r, ['doctor', '--base', 'main'], fakeEnv(program, dir, 'answer'));
            assert.ok(result.stdout.split('\n').includes(`ok  reviewer  1 reviewer rule; ${program.provider} can be called (lawcheck doctor --reviewer makes one call)`), result.stdout);
            assert.ok(!existsSync(join(dir, 'record.json')));
            const asked = await lawcheck(r, ['doctor', '--base', 'main', '--reviewer'], fakeEnv(program, dir, 'answer'));
            assert.ok(asked.stdout.split('\n').includes(`ok  reviewer  1 reviewer rule; ${program.provider} answered a test call`), asked.stdout);
          }, configOf(program.provider)),
      ],
    ];
    const gitDir = programDir('git');
    if (!['', '.cmd', '.exe'].some((ending) => existsSync(join(gitDir, program.name + ending)))) {
      cases.push([
        'not on PATH',
        () =>
          withR(async (r) => {
            write(r, F_PATH, F);
            const result = await run(r, null, ['--review', '--base', 'main'], { PATH: gitDir });
            assert.ok(result.stdout.split('\n').includes(`error[reviewer-unreachable]  ${program.provider} cannot be called: the program ${program.name} is not on PATH`), result.stdout);
            assert.equal(result.code, 2);
          }, configOf(program.provider)),
      ]);
    }
    await Promise.all(cases.map(([what, body]) => named(program, what, body)));
  });
}

test('test 193: a copilot inside the folder of the VS Code extension is passed over', async () => {
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
    assert.ok(!existsSync(join(dir, 'stub.txt')));
  }, configOf('copilot-cli'));
});
