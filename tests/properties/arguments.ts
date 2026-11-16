import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import fc from 'fast-check';
import { D, D_PATH, GIT_ENV, lawcheck, makeSample, ROOT, temp, write } from '../acceptance/helpers.ts';
import { installedLawcheck } from '../harness/fakes.ts';
import { fakeWrites, startHook } from '../harness/tool.ts';
import { tool } from './support.ts';
import type { Speed } from './support.ts';

const WORDS = ['init', 'prime', 'check', 'explain', 'try', 'docs', 'doctor', 'help', 'fix'];
const FLAGS = ['--json', '--full', '--base', '--review', '--again', '--max-calls', '--type', '--rule', '--times', '--dry-run', '--reviewer', '--help', '--version', '--base=main', '-h', '--', '-'];
const VALUES = ['main', 'HEAD', 'nope', '0', '1', '-1', '99999999999999999999', '', 'src', 'src/**', 'src/core/price.ts', "src/{a", '../x', '/', 'no-console', 'library', 'languages', 'waivers', 'a\nb', '\u001b[2K', '::error::x', '\\', 'src/core/new\\nline.ts', 'x'.repeat(300)];
const token = fc.oneof({ weight: 2, arbitrary: fc.constantFrom(...WORDS) }, { weight: 3, arbitrary: fc.constantFrom(...FLAGS) }, { weight: 3, arbitrary: fc.constantFrom(...VALUES) }, { weight: 3, arbitrary: fc.string({ maxLength: 6 }) });
const argv = fc.tuple(fc.constantFrom(...WORDS.slice(0, 7)), fc.array(token, { maxLength: 5 }), fc.boolean()).map(([first, rest, json]) => [first, ...rest, ...(json ? ['--json'] : [])]);

function state(repo: string): string {
  return execFileSync('git', ['status', '--porcelain=v2', '-z', '--untracked-files=all'], { cwd: repo, env: GIT_ENV, encoding: 'latin1' }) + execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, env: GIT_ENV, encoding: 'utf8' });
}

const EVENTS = ['session-start', 'prompt', 'edit', 'stop'];

function runHook(event: string, input: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return startHook(event, input, env, { stderr: /^(lawcheck plugin: [^\n]+\n)?$/ }).ended;
}

// Each property by its name, for tests/properties/arguments.test.ts and arguments.nightly.test.ts to register with its name written out.
export function argumentsProperties(speed: Speed): Record<string, () => unknown> {
  const out: Record<string, () => unknown> = {};
  const test = (name: string, body: () => unknown) => {
    out[name] = body;
  };
  test('I-args-1: tokens of the tool and junk give usage or a run, never internal, and change nothing in git', async () => {
    const dir = temp();
    try {
      const s = makeSample(dir.dir);
      write(s, D_PATH, D);
      const before = state(s);
      await tool(
        speed,
        argv,
        { classes: { 'a value of a flag': (a) => a.some((t, i) => i > 0 && VALUES.includes(t)), junk: (a) => a.some((t) => !WORDS.includes(t) && !FLAGS.includes(t) && !VALUES.includes(t)), '--json': (a) => a.includes('--json') } },
        async (a) => {
          const run = await lawcheck(s, a);
          assert.ok(run.code === 0 || run.code === 1 || run.code === 2, `${JSON.stringify(a)}: ${run.code}`);
          assert.notEqual(run.stdout, '', JSON.stringify(a));
          assert.doesNotMatch(run.stdout, /error\[internal\]|"code": "internal"/, `${JSON.stringify(a)}: ${run.stdout}`);
          assert.equal(run.stderr, '', `${JSON.stringify(a)}: ${run.stderr}`);
          if (a.includes('--json') && run.code === 2 && !a.includes('--help') && !a.includes('-h') && a[0] !== 'doctor') {
            const document = JSON.parse(run.stdout);
            assert.equal(document.schema, 'lawcheck-error/1', JSON.stringify(a));
          }
          assert.equal(state(s), before, `${JSON.stringify(a)} changed git`);
        },
      );
    } finally {
      dir.remove();
    }
  });

  test('I-hook-1: S6-6, S6-8, any input to a hook gives exit 0 with nothing or one hook document, or the defined notice, never a stack trace', async () => {
    const dir = temp();
    try {
      const s = makeSample(dir.dir);
      write(s, D_PATH, D);
      const bin = join(dir.dir, 'bin');
      mkdirSync(bin);
      const shim = join(bin, 'lawcheck');
      fakeWrites(dir.dir, ['data/', 'lawcheck.log']);
      writeFileSync(shim, [`#!${process.execPath}`, "import { appendFileSync } from 'node:fs';", "import { spawnSync } from 'node:child_process';", ...installedLawcheck(join(dir.dir, 'lawcheck.log')), ''].join('\n'));
      chmodSync(shim, 0o755);
      if (process.platform === 'win32') writeFileSync(`${shim}.cmd`, `@"${process.execPath}" "${shim}" %*\r\n`);
      const git = dirname(execFileSync(process.platform === 'win32' ? 'where.exe' : 'sh', process.platform === 'win32' ? ['git'] : ['-c', 'command -v git'], { encoding: 'utf8' }).split(/\r?\n/)[0]!.trim());
      const env: NodeJS.ProcessEnv = { PATH: [bin, git, dirname(process.execPath)].join(delimiter), CLAUDE_PLUGIN_ROOT: join(ROOT, 'plugin'), CLAUDE_PLUGIN_DATA: join(dir.dir, 'data'), ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec } : {}) };
      const id = fc.oneof({ weight: 2, arbitrary: fc.constant('x'.repeat(5000)) }, { weight: 3, arbitrary: fc.constantFrom('s1', '../x', '', 'a b', 'ż', 'y'.repeat(129)) }, { weight: 1, arbitrary: fc.string({ maxLength: 10 }) }, { weight: 1, arbitrary: fc.integer() });
      const field = fc.oneof(fc.constantFrom(s, '/', join(s, 'src'), join(s, D_PATH), join(s, 'src/core/new\nline.ts'), 'relative/path.ts', ''), fc.anything());
      const object = fc
        .record({ session_id: id, prompt_id: fc.oneof(fc.constant('p1'), fc.anything()), cwd: field, tool_name: fc.constantFrom('Write', 'Edit', 'NotebookEdit', 'Bash', 7), tool_input: fc.oneof(fc.record({ file_path: field, notebook_path: field }), fc.anything()), stop_hook_active: fc.oneof(fc.boolean(), fc.anything()), background_tasks: fc.oneof(fc.constant([]), fc.anything()) }, { requiredKeys: ['session_id'] })
        .map((v) => JSON.stringify(v));
      const input = fc.oneof(
        { weight: 3, arbitrary: object },
        { weight: 1, arbitrary: object.map((text) => `\ufeff${text}`) },
        { weight: 2, arbitrary: fc.oneof(fc.string({ maxLength: 40 }), fc.json(), fc.constantFrom('', '{', 'null', '[]', '"x"', '\ufeff{"session_id":"s1","cwd":"/"}')) },
      );
      await tool(
        speed,
        fc.tuple(fc.constantFrom(...EVENTS), input, fc.constantFrom('', 'runner: global\n', '\ufeffrunner: global\n', 'runner: bogus\n', '\ufeffrunner: bogus\n', '\ufeffrunner: global  # pinned\r\n')),
        { classes: { 'a config with a byte-order mark': ([, , config]) => config.startsWith('\ufeff'), 'an object': ([, i]) => i.startsWith('{"'), 'no JSON object': ([, i]) => !i.startsWith('{"'), 'a byte-order mark at the start of the input': ([, i]) => i.startsWith('\ufeff'), 'a session id of 5,000 characters to a hook that keeps state': ([event, i]) => event !== 'session-start' && i.includes('x'.repeat(5000)) } },
        async ([event, i, config]) => {
          write(s, '.lawcheck/config.yaml', config);
          const run = await runHook(event, i, env);
          if (config.startsWith('\ufeff')) {
            const start = JSON.stringify({ session_id: 's1', cwd: s, hook_event_name: 'SessionStart', source: 'startup' });
            const marked = await runHook('session-start', start, env);
            write(s, '.lawcheck/config.yaml', config.slice(1));
            const plain = await runHook('session-start', start, env);
            assert.deepEqual([marked.code, marked.stdout], [plain.code, plain.stdout], 'S6-8: a byte-order mark changes what the hook reads');
            write(s, '.lawcheck/config.yaml', config);
          }
          assert.doesNotMatch(run.stderr, /\n\s+at /, `a stack trace: ${run.stderr}`);
          if (run.code === 1) {
            assert.match(run.stderr, /^lawcheck plugin: [^\n]+\n$/, run.stderr);
            assert.ok(!i.startsWith('{"'), `a JSON object is input the hook takes, so it exits 0: ${run.stderr}`);
            assert.equal(run.stdout, '');
            return;
          }
          assert.equal(run.code, 0, `${event} ${i.slice(0, 200)}: ${run.stderr}`);
          assert.equal(run.stderr, '');
          if (run.stdout === '') return;
          const document = JSON.parse(run.stdout);
          assert.ok(typeof document.systemMessage === 'string' || typeof document.hookSpecificOutput?.additionalContext === 'string', run.stdout);
        },
      );
    } finally {
      dir.remove();
    }
  });
  return out;
}
