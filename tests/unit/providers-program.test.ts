import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { DEFAULT_CONFIG } from '../../dist/config.js';
import { geminiCli } from '../../dist/providers/gemini-cli.js';
import { failure, LAWCHECK_VARIABLES, lastLine, plainOutput, programEnv, SIGN_IN_VARIABLES } from '../../dist/providers/program.js';
import { writeFakeProgram } from '../acceptance/fake-reviewer.ts';

const ended = (code: number | null, signal: string | null, stdout: string, stderr: string) => ({ code, signal, stdout, stderr });

test('the last non-empty line', () => {
  assert.equal(lastLine('a\r\nb\r\n\r\n  \n'), 'b');
  assert.equal(lastLine('\n \n'), null);
});

test('a failure: the first reason given, else the last line of standard error, of standard output, then the exit', () => {
  assert.deepEqual(failure('p', ended(1, null, 'out', 'err'), 'given'), { failure: 'given', resend: false, fix: 'do what p says, such as signing in or naming a model it has' });
  assert.deepEqual(failure('p', ended(1, null, 'out\n', 'one\ntwo\n')), { failure: 'two', resend: false, fix: 'do what p says, such as signing in or naming a model it has' });
  assert.deepEqual(failure('p', ended(1, null, 'first\nlast\n', '')), { failure: 'last', resend: false, fix: 'do what p says, such as signing in or naming a model it has' });
  assert.deepEqual(failure('p', ended(4, null, '', '')), { failure: 'p exited with 4', resend: false, fix: 'do what p says, such as signing in or naming a model it has' });
  assert.deepEqual(failure('p', ended(null, 'SIGKILL', '', '')), { failure: 'p was ended by SIGKILL', resend: false, fix: 'do what p says, such as signing in or naming a model it has' });
  assert.equal((failure('p', ended(1, null, '', 'x'.repeat(400))) as { failure: string }).failure.length, 300);
});

test('plain output: standard output is the answer after exit 0', () => {
  const read = plainOutput('p');
  assert.deepEqual(read(ended(0, null, 'the answer\n', 'progress\n')), { answer: 'the answer\n' });
  assert.deepEqual(read(ended(0, null, '', '')), { answer: '' });
  assert.deepEqual(read(ended(1, null, 'half', 'ERROR: unexpected status 401\n')), { failure: 'ERROR: unexpected status 401', resend: false, fix: 'do what p says, such as signing in or naming a model it has' });
  assert.deepEqual(read(ended(null, 'SIGTERM', '', '')), { failure: 'p was ended by SIGTERM', resend: false, fix: 'do what p says, such as signing in or naming a model it has' });
});

test('the working folder and the folder aside are gone when the call ends, before the tool does', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-program-'));
  try {
    const bin = writeFakeProgram(join(dir, 'bin'), 'gemini');
    const record = join(dir, 'record.json');
    // Windows spells the key Path, and a second PATH beside it would be the one never read.
    const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
    env.PATH = `${bin}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}`;
    env.FAKE_GEMINI_RECORD = record;
    const asked = await geminiCli({ ...DEFAULT_CONFIG, provider: 'gemini-cli', timeout: 300, parallel: 1, temperature: null }, env).ask('a prompt');
    assert.ok('answer' in asked, JSON.stringify(asked));
    const seen = JSON.parse(readFileSync(record, 'utf8')) as { args: string[]; cwd: string; stdin: string };
    assert.equal(seen.stdin, 'a prompt');
    assert.ok(!existsSync(seen.cwd), seen.cwd);
    assert.ok(!existsSync(dirname(seen.args[seen.args.indexOf('--policy') + 1]!)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a program gets its own sign-in variables, and neither Lawcheck's nor another program's", () => {
  const own = { claude: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'], codex: ['OPENAI_API_KEY', 'CODEX_API_KEY'], gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], copilot: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_PROVIDER_API_KEY', 'COPILOT_PROVIDER_API_KEY_COMMAND', 'COPILOT_PROVIDER_BEARER_TOKEN'] };
  assert.deepEqual(SIGN_IN_VARIABLES, own);
  const every = Object.fromEntries([...LAWCHECK_VARIABLES, ...Object.values(own).flat()].map((name) => [name, 'v']));
  for (const [program, variables] of Object.entries(own)) {
    assert.deepEqual(Object.keys(programEnv({ PATH: '/bin', COPILOT_MODEL: 'm', ...every }, program, 'linux')).sort(), ['COPILOT_MODEL', 'PATH', ...variables].sort(), program);
  }
  assert.deepEqual(LAWCHECK_VARIABLES, ['LAWCHECK_REVIEWER_ENDPOINT', 'LAWCHECK_REVIEWER_KEY']);
  assert.deepEqual(programEnv({ Path: 'C:\\', openai_api_key: 'o', Lawcheck_Reviewer_Key: 'k', anthropic_api_key: 'a' }, 'claude', 'win32'), { Path: 'C:\\', anthropic_api_key: 'a' });
  assert.deepEqual(programEnv({ openai_api_key: 'o' }, 'claude', 'linux'), { openai_api_key: 'o' });
});
