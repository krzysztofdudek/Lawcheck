import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { DEFAULT_CONFIG } from '../../dist/config.js';
import { geminiCli } from '../../dist/providers/gemini-cli.js';
import { failure, HIDDEN_VARIABLES, lastLine, plainOutput, programEnv } from '../../dist/providers/program.js';
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
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, FAKE_GEMINI_RECORD: record };
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

test('a program gets the environment without the variables of Lawcheck that hold an address or a key', () => {
  const env = { PATH: '/bin', HOME: '/h', LAWCHECK_REVIEWER_ENDPOINT: 'e', LAWCHECK_REVIEWER_KEY: 'k', ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', GOOGLE_API_KEY: 'g', COPILOT_MODEL: 'm' };
  assert.deepEqual(programEnv(env, 'linux'), { PATH: '/bin', HOME: '/h', COPILOT_MODEL: 'm' });
  assert.deepEqual(programEnv({ Path: 'C:\\', openai_api_key: 'o', Lawcheck_Reviewer_Key: 'k' }, 'win32'), { Path: 'C:\\' });
  assert.deepEqual(programEnv({ openai_api_key: 'o' }, 'linux'), { openai_api_key: 'o' });
  assert.deepEqual(HIDDEN_VARIABLES, ['LAWCHECK_REVIEWER_ENDPOINT', 'LAWCHECK_REVIEWER_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY']);
});
