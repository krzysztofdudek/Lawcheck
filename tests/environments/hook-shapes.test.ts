import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { D, D_PATH, inTemp, LAW, write } from '../acceptance/helpers.ts';
import { binWithLawcheck, hookEnv, NODE_DIR, runHook, SHAPES, STARTS, WINDOWS } from './shapes.ts';
import type { Placed, Shape } from './shapes.ts';

const where = (program: string) =>
  WINDOWS ? execFileSync('where.exe', [program], { encoding: 'utf8' }).split(/\r?\n/)[0]!.trim() : execFileSync('sh', ['-c', `command -v ${program}`], { encoding: 'utf8' }).trim();
const GIT_DIR = dirname(where('git'));

// spec/plugin-slice.md, section 8: the headers, and the output of check <paths> for D in S.
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
const STOP_HEADER =
  "Lawcheck: the files that changed in this turn break the law of this repository. Fix the code, then finish; if a fix needs the user's word, tell the user what blocks you and finish. lawcheck check on those files printed:";
const STOP_ERROR_HEADER =
  "Lawcheck could not check the files that changed in this turn, and the turn changed files under .lawcheck/. Fix what the error names, then finish; if that needs the user's word, tell the user and finish. lawcheck check on those files printed:";
const EDIT_HEADER = `Lawcheck: after this edit, ${D_PATH} breaks the law of this repository. lawcheck check ./${D_PATH} printed:`;
const PRIMER_START = "Lawcheck checks this repository's code against its law";

interface Bench {
  placed: Placed;
  env: NodeJS.ProcessEnv;
  input(fields?: Record<string, unknown>): Record<string, unknown>;
}

async function inEveryShape(body: (bench: Bench, shape: Shape) => Promise<void>): Promise<string[]> {
  const problems: string[] = [];
  for (const shape of SHAPES) {
    for (const start of STARTS) {
      await inTemp(async (dir) => {
        const placed = shape.make(dir, {});
        const env = hookEnv(dir, [binWithLawcheck(dir), GIT_DIR, NODE_DIR]);
        const input = (fields: Record<string, unknown> = {}) => ({ session_id: 's1', prompt_id: 'p1', cwd: start.cwd(placed), ...fields });
        try {
          await body({ placed, env, input }, shape);
        } catch (error) {
          problems.push(`${shape.name}, ${start.name}: ${(error as Error).message}`);
        }
      });
    }
  }
  return problems;
}

test('S6-1: the check before finishing hands back a breach written in the turn, in every repository shape', async () => {
  const problems = await inEveryShape(async ({ placed, env, input }) => {
    const opened = await runHook('prompt', input({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }), env);
    assert.deepEqual([opened.code, opened.stdout, opened.stderr], [0, '', '']);
    write(placed.root, D_PATH, D);
    const stopped = await runHook('stop', input({ hook_event_name: 'Stop', stop_hook_active: false }), env);
    assert.equal(stopped.code, 0, stopped.stderr);
    assert.deepEqual(stopped.json, { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: `${STOP_HEADER}\n\n${D_OUTPUT}` } });
  });
  assert.deepEqual(problems, []);
});

test('I-shape-2: control, a clean change lets the agent finish in every repository shape', async () => {
  const problems = await inEveryShape(async ({ placed, env, input }) => {
    await runHook('prompt', input({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }), env);
    write(placed.root, 'src/core/clean.ts', 'export const clean = 1;\n');
    const stopped = await runHook('stop', input({ hook_event_name: 'Stop', stop_hook_active: false }), env);
    assert.deepEqual([stopped.code, stopped.stdout, stopped.stderr], [0, '', '']);
  });
  assert.deepEqual(problems, []);
});

test('I-shape-2: the hook after an edit hands back a breach in every repository shape', async () => {
  const problems = await inEveryShape(async ({ placed, env, input }) => {
    write(placed.root, D_PATH, D);
    const edited = await runHook('edit', input({ hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: join(placed.root, D_PATH) }, tool_response: {} }), env);
    assert.equal(edited.code, 0, edited.stderr);
    assert.deepEqual(edited.json, { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `${EDIT_HEADER}\n\n${D_OUTPUT}` } });
  });
  assert.deepEqual(problems, []);
});

test('I-shape-2: the session start gives the primer in every repository shape', async () => {
  const problems = await inEveryShape(async ({ env, input }) => {
    const started = await runHook('session-start', input({ hook_event_name: 'SessionStart', source: 'startup' }), env);
    assert.equal(started.code, 0, started.stderr);
    const text = (started.json as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    assert.ok(text.startsWith(PRIMER_START), text);
  });
  assert.deepEqual(problems, []);
});

test('I-shape-2: a law broken in the turn is handed back under its header in every repository shape', async () => {
  const problems = await inEveryShape(async ({ placed, env, input }) => {
    await runHook('prompt', input({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }), env);
    write(placed.root, '.lawcheck/law.yaml', LAW.replace('status: advisory', 'statuss: advisory'));
    const stopped = await runHook('stop', input({ hook_event_name: 'Stop', stop_hook_active: false }), env);
    const text = (stopped.json as { hookSpecificOutput?: { additionalContext: string } } | null)?.hookSpecificOutput?.additionalContext ?? stopped.stdout;
    assert.ok(text.startsWith(`${STOP_ERROR_HEADER}\n\nlawcheck: ERROR  1 error\n`), text);
  });
  assert.deepEqual(problems, []);
});

test('S6-1: a check before finishing that cannot take its snapshot says so', async () => {
  const problems = await inEveryShape(async ({ placed, env, input }) => {
    await runHook('prompt', input({ hook_event_name: 'UserPromptSubmit', prompt: 'go' }), env);
    write(placed.root, D_PATH, D);
    const withoutGit = { ...env, PATH: String(env.PATH).split(WINDOWS ? ';' : ':')[0] };
    const stopped = await runHook('stop', input({ hook_event_name: 'Stop', stop_hook_active: false }), withoutGit);
    assert.equal(stopped.code, 0, stopped.stderr);
    const message = (stopped.json as { systemMessage?: string } | null)?.systemMessage ?? '';
    assert.ok(message.startsWith('lawcheck: the check before the agent finished did not run: git could not list the files of this turn, because git cannot be started'), stopped.stdout);
  });
  assert.deepEqual(problems, []);
});
