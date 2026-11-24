import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctorText, runChecks } from '../../dist/doctor.js';
import { openai, ollama, withFake } from '../acceptance/fake-reviewer.ts';
import { append, inTemp, lawcheck, makeR, makeSample, newRepository, write } from '../acceptance/helpers.ts';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';

const SAMPLE = fileURLToPath(new URL('../sample', import.meta.url));
const ENV = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };

function sample(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-doctor-'));
  cpSync(SAMPLE, dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...ENV }, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 's');
  return body(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const states = (checks: { id: string; state: string }[]) => Object.fromEntries(checks.map((c) => [c.id, c.state]));

test('commands-slice §8: node below 24 fails, and the rest still runs', async () => {
  await sample(async (dir) => {
    const checks = await runChecks({ cwd: dir, env: {}, base: 'main', reviewer: false, nodeVersion: '22.1.0' });
    assert.equal(checks[0]!.state, 'fail');
    assert.equal(checks[0]!.message, 'Node 22.1.0 is older than 24, the oldest Node Lawcheck runs on');
    assert.deepEqual(checks[0]!.next, { command: null, text: 'install Node 24 or later, then run lawcheck doctor again' });
    assert.equal(states(checks).law, 'ok');
  });
});

test('commands-slice §8: LAWCHECK_BASE is named as the base source', async () => {
  await sample(async (dir) => {
    const checks = await runChecks({ cwd: dir, env: { LAWCHECK_BASE: 'main' }, base: null, reviewer: false });
    assert.equal(checks.find((c) => c.id === 'base')!.message, 'main, from LAWCHECK_BASE; the change holds 0 files');
  });
});

test('commands-slice §8: a grammar that does not load fails readers', async () => {
  await sample(async (dir) => {
    const checks = await runChecks({ cwd: dir, env: {}, base: 'main', reviewer: false, grammarDir: join(dir, 'nowhere') });
    const readers = checks.find((c) => c.id === 'readers')!;
    assert.equal(readers.state, 'fail');
    assert.match(readers.message, /^the grammar of typescript cannot be loaded: /);
  });
});

test('commands-slice §8: a skipped check names the first check it waits for', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-doctor-'));
  try {
    const checks = await runChecks({ cwd: dir, env: {}, base: null, reviewer: false });
    assert.deepEqual(
      checks.map((c) => `${c.state} ${c.id} ${c.state === 'skip' ? c.message : ''}`.trim()),
      ['ok node', 'fail git', 'skip law needs git', 'skip config needs git', 'skip types needs law', 'skip base needs git', 'skip law-change needs base', 'skip readers needs types', 'skip reviewer needs law'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('commands-slice §8: the first line counts problems and notes, and each note and fail has its next line', () => {
  const text = doctorText([
    { id: 'a', state: 'ok', message: 'm', next: null },
    { id: 'b', state: 'note', message: 'n', next: { command: null, text: 'do n' } },
    { id: 'c', state: 'fail', message: 'f', next: { command: 'lawcheck init', text: 'lawcheck init' } },
    { id: 'd', state: 'skip', message: 'needs c', next: null },
  ]);
  assert.equal(text, 'lawcheck: FAIL  4 checks, 1 problem, 1 note\n\nok  a  m\nnote  b  n\n  next: do n\nfail  c  f\n  next: lawcheck init\nskip  d  needs c\n');
});

const OWN_LAW = 'lawcheck: 0.1.0\n\nrules:\n  r1:\n    why: x\n\ntypes:\n  t:\n    paths: ["src/**"]\n    rules: [r1]\n';
const SCRIPT_RULE = 'export function check() { return []; }\n';
const check = (checks: { id: string }[], id: string) => checks.find((c) => c.id === id);
const plain = (cwd: string, extra: Partial<Parameters<typeof runChecks>[0]> = {}) => runChecks({ cwd, env: {}, base: null, reviewer: false, ...extra });

test('R-39: the git check names an old git, and a folder git does not see, and the checks that wait for it say so', async () => {
  await inTemp(async (dir) => {
    const old = await plain(dir, { gitText: () => 'git version 2.20.1' });
    assert.deepEqual(check(old, 'git'), { id: 'git', state: 'fail', message: 'git 2.20.1 is older than 2.34, the oldest git Lawcheck runs with', next: { command: null, text: 'install git 2.34 or later, then run lawcheck doctor again' } });
    assert.deepEqual(check(old, 'law'), { id: 'law', state: 'skip', message: 'needs git', next: null });
    const edge = await plain(dir, { gitText: () => 'git version 2.34.0' });
    assert.equal(check(edge, 'git')!.message, 'git does not see a work tree here: fatal: not a git repository (or any of the parent directories): .git');
    const outside = await plain(dir);
    assert.deepEqual(check(outside, 'git'), { id: 'git', state: 'fail', message: 'git does not see a work tree here: fatal: not a git repository (or any of the parent directories): .git', next: { command: null, text: 'run lawcheck doctor inside a git work tree, with git on the PATH' } });
  });
});

test('R-39: with git off the PATH, doctor says git cannot be started and still runs the other checks', async () => {
  await inTemp(async (dir) => {
    const empty = join(dir, 'empty');
    mkdirSync(empty);
    const repo = newRepository(dir, { '.lawcheck/law.yaml': OWN_LAW, '.lawcheck/rules/r1.mjs': SCRIPT_RULE, 'src/a.ts': 'x\n' });
    const result = await lawcheck(repo, ['doctor', '--json'], { PATH: empty });
    assert.equal(result.code, 2);
    const git = check(JSON.parse(result.stdout).checks, 'git')!;
    assert.deepEqual(git, { id: 'git', state: 'fail', message: 'git cannot be started: it is not on the PATH', next: { command: null, text: 'run lawcheck doctor inside a git work tree, with git on the PATH' } });
  });
});

test('R-39: a repository whose law is below it gets the laws named, and one whose law sits in a folder names the folder', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { 'pkg/.lawcheck/law.yaml': 'lawcheck: 0.1.0\n', 'pkg2/.lawcheck/law.yaml': 'lawcheck: 0.1.0\n' });
    const checks = await plain(repo);
    assert.deepEqual(check(checks, 'git'), { id: 'git', state: 'ok', message: 'a git work tree', next: null });
    assert.deepEqual(check(checks, 'law'), {
      id: 'law',
      state: 'fail',
      message: 'no .lawcheck/law.yaml in this directory or any above it; the laws below it are in pkg, pkg2',
      details: ['to govern this folder instead, write .lawcheck/law.yaml here by hand  (lawcheck docs first-law shows how)'],
      next: { command: null, text: 'cd pkg, where a law is, then run lawcheck doctor again' },
    });
    const single = newRepository(join(dir, 'single'), { 'only/.lawcheck/law.yaml': 'lawcheck: 0.1.0\n' });
    assert.equal(check(await plain(single), 'law')!.message, 'no .lawcheck/law.yaml in this directory or any above it; the laws below it are in only');
    const none = newRepository(join(dir, 'none'));
    assert.deepEqual(check(await plain(none), 'law'), { id: 'law', state: 'fail', message: 'no .lawcheck/law.yaml in this directory or any above it', next: { command: 'lawcheck init', text: 'lawcheck init  (only when the user wants a law here)' } });
    const nested = newRepository(join(dir, 'nested'), { 'pkg/.lawcheck/law.yaml': OWN_LAW, 'pkg/.lawcheck/rules/r1.mjs': SCRIPT_RULE, 'pkg/src/a.ts': 'x\n' });
    assert.equal(check(await plain(join(nested, 'pkg')), 'git')!.message, "a git work tree, and the law's root is pkg/ below its top");
    assert.equal(check(await plain(nested), 'git')!.message, 'a git work tree');
  });
});

test('R-39: the first error of the law is the message, with its place and a count of the others', async () => {
  const lawOf = (rules: string[]) => `lawcheck: 0.1.0\n\nrules:\n${rules.map((id) => `  ${id}:\n    why: x\n`).join('')}\ntypes:\n  t:\n    paths: ["src/**"]\n    rules: [${rules.join(', ')}]\n`;
  const next = { command: null, text: 'ask the user to write the rule files the law names or to take their rules out of the law, then run lawcheck doctor again' };
  await inTemp(async (dir) => {
    const one = newRepository(join(dir, 'one'), { '.lawcheck/law.yaml': lawOf(['r1']) });
    assert.deepEqual(check(await plain(one), 'law'), { id: 'law', state: 'fail', message: ".lawcheck/law.yaml:4  the rule 'r1' has neither .lawcheck/rules/r1.mjs nor .lawcheck/rules/r1.md", next });
    const two = newRepository(join(dir, 'two'), { '.lawcheck/law.yaml': lawOf(['r1', 'r2']) });
    assert.equal(check(await plain(two), 'law')!.message, ".lawcheck/law.yaml:4  the rule 'r1' has neither .lawcheck/rules/r1.mjs nor .lawcheck/rules/r1.md; and 1 more");
    const four = newRepository(join(dir, 'four'), { '.lawcheck/law.yaml': lawOf(['r1', 'r2', 'r3', 'r4']) });
    assert.equal(check(await plain(four), 'law')!.message, ".lawcheck/law.yaml:4  the rule 'r1' has neither .lawcheck/rules/r1.mjs nor .lawcheck/rules/r1.md; and 3 more");
    const broken = newRepository(join(dir, 'broken'), { '.lawcheck/law.yaml': 'lawcheck: 0.1.0\nrules: 5\n' });
    const law = check(await plain(broken), 'law')!;
    assert.equal(law.state, 'fail');
    assert.match(law.message, /^\.lawcheck\/law\.yaml:2 {2}/);
  });
});

test('R-39: a law that git ignores is a note that says how to fix it, and one git lists is ok', async () => {
  await inTemp(async (dir) => {
    const files = { '.lawcheck/law.yaml': OWN_LAW, '.lawcheck/rules/r1.mjs': SCRIPT_RULE, 'src/a.ts': 'x\n' };
    const listed = newRepository(join(dir, 'listed'), files);
    assert.deepEqual(check(await plain(listed), 'law'), { id: 'law', state: 'ok', message: '.lawcheck/law.yaml: 1 type, 1 rule (1 script, 0 reviewer)', next: null });
    const ignored = newRepository(join(dir, 'ignored'), { ...files, '.gitignore': '.lawcheck/law.yaml\n' });
    assert.deepEqual(check(await plain(ignored), 'law'), {
      id: 'law',
      state: 'note',
      message: '.lawcheck/law.yaml: 1 type, 1 rule (1 script, 0 reviewer); git ignores it, so no other checkout has the law',
      next: { command: null, text: 'remove the line that ignores .lawcheck/law.yaml, as `git check-ignore -v .lawcheck/law.yaml` shows, then run lawcheck doctor again' },
    });
  });
});

test('R-39: the config check names a config that is wrong, and the program of each runner, found on the PATH or not', async () => {
  await inTemp(async (dir) => {
    const files = { '.lawcheck/law.yaml': OWN_LAW, '.lawcheck/rules/r1.mjs': SCRIPT_RULE, 'src/a.ts': 'x\n' };
    const bad = newRepository(join(dir, 'bad'), { ...files, '.lawcheck/config.yaml': 'bogus: 1\n' });
    assert.deepEqual(check(await plain(bad), 'config'), { id: 'config', state: 'fail', message: ".lawcheck/config.yaml:1  unknown key 'bogus' at the top of the config", next: { command: null, text: 'ask the user to fix .lawcheck/config.yaml, then run lawcheck doctor again' } });
    assert.equal(check(await plain(bad), 'types')!.state, 'ok');
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const shim = (program: string) => join(bin, process.platform === 'win32' ? `${program}.cmd` : program);
    for (const program of ['lawcheck', 'npx', 'pnpm', 'yarn', 'bun']) {
      writeFileSync(shim(program), process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\n');
      chmodSync(shim(program), 0o755);
    }
    for (const [runner, program] of [['global', 'lawcheck'], ['npx', 'npx'], ['pnpm', 'pnpm'], ['yarn', 'yarn'], ['bun', 'bun']]) {
      const repo = newRepository(join(dir, runner!), { ...files, '.lawcheck/config.yaml': `runner: ${runner}\n` });
      assert.deepEqual(check(await plain(repo, { env: { PATH: join(dir, 'nowhere') } }), 'config'), {
        id: 'config',
        state: 'fail',
        message: `.lawcheck/config.yaml: runner ${runner}, and ${program} is not on the PATH`,
        next: { command: null, text: `install ${program}, or ask the user to set runner to the way this repository starts Lawcheck, then run lawcheck doctor again` },
      });
      assert.deepEqual(check(await plain(repo, { env: { PATH: bin } }), 'config'), { id: 'config', state: 'ok', message: `.lawcheck/config.yaml: no reviewer set; runner ${runner}, ${program} at ${shim(program!)}`, next: null });
    }
    const named = newRepository(join(dir, 'named'), { ...files, '.lawcheck/config.yaml': 'runner: npx\nreviewer:\n  provider: ollama\n  model: llama\n' });
    assert.equal(check(await plain(named, { env: { PATH: bin } }), 'config')!.message, `.lawcheck/config.yaml: reviewer ollama, model llama; runner npx, npx at ${shim('npx')}`);
    const unnamed = newRepository(join(dir, 'unnamed'), { ...files, '.lawcheck/config.yaml': 'reviewer:\n  provider: ollama\n  model: llama\n' });
    assert.equal(check(await plain(unnamed), 'config')!.message, '.lawcheck/config.yaml: reviewer ollama, model llama');
    assert.equal(check(await plain(newRepository(join(dir, 'absent'), files)), 'config')!.message, 'no .lawcheck/config.yaml; every setting has its default');
  });
});

test('R-39: a change that touches the law names the first three files in order and counts the rest, and the command keeps the base only when one was passed', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(join(dir, 's'));
    const next = (command: string) => ({ command, text: `${command}  (lists what the law finds in the rest of the code, as debt)` });
    assert.deepEqual(check(await plain(s, { base: 'main' }), 'law-change'), { id: 'law-change', state: 'ok', message: 'the change does not touch the law', next: null });
    for (const file of ['.lawcheck/rules/no-todo.mjs', '.lawcheck/rules/no-console.mjs', '.lawcheck/law.yaml']) append(s, file, '\n// x\n');
    assert.deepEqual(check(await plain(s, { base: 'main' }), 'law-change'), {
      id: 'law-change',
      state: 'note',
      message: 'the change touches the law: .lawcheck/law.yaml, .lawcheck/rules/no-console.mjs, .lawcheck/rules/no-todo.mjs; a plain check judges only the files that changed',
      next: next('lawcheck check --full --base main'),
    });
    write(s, '.lawcheck/config.yaml', 'runner: global\n');
    assert.equal(check(await plain(s, { base: 'main' }), 'law-change')!.message, 'the change touches the law: .lawcheck/config.yaml, .lawcheck/law.yaml, .lawcheck/rules/no-console.mjs, and 1 more; a plain check judges only the files that changed');
    write(s, '.lawcheck/rules/lib/z.mjs', 'export {};\n');
    const viaEnvironment = await plain(s, { env: { LAWCHECK_BASE: 'main' } });
    assert.deepEqual(check(viaEnvironment, 'law-change'), {
      id: 'law-change',
      state: 'note',
      message: 'the change touches the law: .lawcheck/config.yaml, .lawcheck/law.yaml, .lawcheck/rules/lib/z.mjs, and 2 more; a plain check judges only the files that changed',
      next: next('lawcheck check --full'),
    });
    assert.equal(check(viaEnvironment, 'base')!.message, 'main, from LAWCHECK_BASE; the change holds 5 files');
    const missing = await plain(s, { base: 'nope' });
    assert.deepEqual(check(missing, 'base'), { id: 'base', state: 'fail', message: "the base 'nope' names no commit here", next: { command: null, text: 'pass --base with a branch or a commit that exists here' } });
    assert.equal(check(missing, 'law-change')!.message, 'needs base');
  });
});

test('R-39: the readers check counts the files it cannot read by extension and the languages it reads, and says nothing of a list that is not there', async () => {
  const law = 'lawcheck: 0.1.0\n\ntypes:\n  code:\n    paths: ["src/**"]\n    may_use: [code]\n  notes:\n    paths: ["notes/**"]\n    may_use: [notes]\n';
  const lawOf = (paths: string) => law.replace('"src/**"', paths);
  await inTemp(async (dir) => {
    const many = newRepository(join(dir, 'many'), { '.lawcheck/law.yaml': law, 'notes/b.md': '# b\n', 'notes/a.md': '# a\n', 'notes/c.txt': 'c\n', 'notes/d.md': '# d\n', 'src/a.ts': 'export const a = 1;\n' });
    assert.deepEqual(check(await plain(many), 'readers'), { id: 'readers', state: 'note', message: '4 files are not read for uses: 3 .md, 1 .txt, so check warns uses-not-read', next: { command: 'lawcheck docs languages', text: 'lawcheck docs languages' } });
    const one = newRepository(join(dir, 'one'), { '.lawcheck/law.yaml': law, 'notes/a.md': '# a\n' });
    assert.equal(check(await plain(one), 'readers')!.message, '1 file is not read for uses: 1 .md, so check warns uses-not-read');
    const mixed = newRepository(join(dir, 'mixed'), {
      '.lawcheck/law.yaml': law,
      'notes/a.md': '# a\n',
      'notes/b.md': '# b\n',
      'src/a.ts': 'import { d } from "@/data/d";\nexport const x = d;\n',
      'src/data/d.ts': 'export const d = 1;\n',
      'tsconfig.json': "{'compilerOptions': {}}\n",
    });
    const readers = check(await plain(mixed), 'readers')! as { state: string; message: string; details?: string[]; next: { text: string } };
    assert.equal(readers.state, 'note');
    assert.equal(readers.message, '2 files are not read for uses: 2 .md, so check warns uses-not-read; 1 configuration file could not be read, so the uses that go through it are not followed');
    assert.equal(readers.details!.length, 1);
    assert.equal(readers.next.text, 'fix tsconfig.json so that it parses, then run lawcheck doctor again');
    const read = newRepository(join(dir, 'read'), {
      '.lawcheck/law.yaml': lawOf('"src/**"'),
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 1;\n',
      'src/c.py': 'x = 1\n',
      'src/d.vue': '<template><p>d</p></template>\n',
    });
    assert.deepEqual(check(await plain(read), 'readers'), { id: 'readers', state: 'ok', message: 'uses are read in 4 files: python 1, typescript 2, vue 1; the 13 grammars load', next: null });
    const none = newRepository(join(dir, 'none'), { '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n\ntypes:\n  code:\n    paths: ["src/**"]\n', 'src/a.ts': 'x\n' });
    assert.equal(check(await plain(none), 'readers')!.message, 'no type has may_use, so no use is read; the 13 grammars load');
    const typed = newRepository(join(dir, 'typed'), { '.lawcheck/law.yaml': law, 'notes/a.txt': 'a\n' });
    assert.equal(check(await plain(typed, { grammarDir: join(dir, 'no') }), 'readers')!.state, 'fail');
  });
});

test('R-39: the reviewer check says why it cannot call a reviewer, and what a call answered', async () => {
  const noProvider = { id: 'reviewer', state: 'fail', next: { command: null } };
  await inTemp(async (dir) => {
    const files = { '.lawcheck/law.yaml': OWN_LAW, '.lawcheck/rules/r1.mjs': SCRIPT_RULE, 'src/a.ts': 'x\n' };
    const none = newRepository(join(dir, 'none'), files);
    assert.deepEqual(check(await plain(none), 'reviewer'), { id: 'reviewer', state: 'ok', message: 'no reviewer rule, so no reviewer is needed', next: null });
    assert.deepEqual(check(await plain(none, { reviewer: true }), 'reviewer'), {
      ...noProvider,
      message: 'no reviewer is set, so --reviewer has nothing to call',
      next: { command: null, text: 'ask the user to set reviewer.provider and reviewer.model in .lawcheck/config.yaml, then run lawcheck doctor --reviewer' },
    });
    const prose = newRepository(join(dir, 'prose'), { '.lawcheck/law.yaml': OWN_LAW, '.lawcheck/rules/r1.md': 'Check.\n', 'src/a.ts': 'x\n' });
    assert.deepEqual(check(await plain(prose), 'reviewer'), {
      ...noProvider,
      message: '1 reviewer rule and no reviewer set, so their files stay not-reviewed',
      next: { command: null, text: 'ask the user to set reviewer.provider and reviewer.model in .lawcheck/config.yaml, then run lawcheck doctor' },
    });
  });
  await withFake(async (fake) => {
    await inTemp(async (dir) => {
      const files = { '.lawcheck/law.yaml': OWN_LAW, '.lawcheck/rules/r1.mjs': SCRIPT_RULE, 'src/a.ts': 'x\n', '.lawcheck/config.yaml': 'reviewer:\n  provider: ollama\n  model: llama\n' };
      const quiet = newRepository(join(dir, 'quiet'), files);
      const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.url };
      fake.respond = () => ({ status: 200, body: '{"version":"0.1"}' });
      assert.deepEqual(check(await plain(quiet, { env }), 'reviewer'), { id: 'reviewer', state: 'ok', message: 'no reviewer rule, so no reviewer is needed', next: null });
      assert.deepEqual(check(await plain(quiet, { env, reviewer: true }), 'reviewer'), {
        id: 'reviewer',
        state: 'fail',
        message: '0 reviewer rules; ollama answered with no verdict: ',
        next: { command: null, text: 'ask the user to check reviewer.model in .lawcheck/config.yaml or to choose another model, then run lawcheck doctor --reviewer' },
      });
      const r = makeR(join(dir, 'r'));
      write(r, '.lawcheck/config.yaml', 'reviewer:\n  provider: ollama\n  model: llama\n');
      assert.deepEqual(check(await plain(r, { env }), 'reviewer'), { id: 'reviewer', state: 'ok', message: `1 reviewer rule; ollama can be called at ${fake.url} (lawcheck doctor --reviewer makes one call)`, next: null });
      fake.respond = () => ({ status: 404, body: '{}' });
      assert.deepEqual(check(await plain(r, { env }), 'reviewer'), {
        id: 'reviewer',
        state: 'fail',
        message: `1 reviewer rule; ollama cannot be called: ${fake.url}/api/version answered HTTP 404, so no Ollama server is there`,
        next: { command: null, text: 'set LAWCHECK_REVIEWER_ENDPOINT to the address of the Ollama server, then run lawcheck doctor' },
      });
      fake.respond = (request) => (request.path.endsWith('/api/version') ? { status: 200, body: '{"version":"0.1"}' } : ollama('{"verdict": "pass", "findings": []}'));
      assert.equal(check(await plain(r, { env, reviewer: true }), 'reviewer')!.message, '1 reviewer rule; ollama answered a test call');
    });
    await inTemp(async (dir) => {
      const r = makeR(join(dir, 'r'));
      const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.url };
      const asked = async (answer: unknown) => {
        fake.respond = () => openai(answer);
        return check(await plain(r, { env, base: 'main', reviewer: true }), 'reviewer') as { state: string; message: string; next: { text: string } };
      };
      const adjust = 'ask the user to check reviewer.model in .lawcheck/config.yaml or to choose another model, then run lawcheck doctor --reviewer';
      const none = await asked('fine');
      assert.deepEqual([none.state, none.message, none.next.text], ['fail', '1 reviewer rule; openai-compatible answered with no verdict: fine', adjust]);
      const long = await asked('x'.repeat(250));
      assert.equal(long.message, `1 reviewer rule; openai-compatible answered with no verdict: ${'x'.repeat(200)}`);
      const line = '{"verdict": "fail", "findings": [{"line": 1, "message": "m"}]}';
      assert.equal((await asked(line)).message, `1 reviewer rule; openai-compatible answered with no verdict: ${line}`);
      const verdict = '{"verdict": "fail", "findings": [{"line": null, "message": "m"}]}';
      const failing = await asked(verdict);
      assert.deepEqual([failing.state, failing.message, failing.next.text], ['fail', `1 reviewer rule; openai-compatible answered fail to a test call that asks for pass: ${verdict}`, adjust]);
      assert.equal((await asked('{"verdict": "pass", "findings": []}')).message, '1 reviewer rule; openai-compatible answered a test call');
      fake.respond = () => ({ status: 500, body: '{}' });
      const down = check(await plain(r, { env, base: 'main', reviewer: true }), 'reviewer') as { message: string; next: { text: string } };
      assert.equal(down.message, '1 reviewer rule; openai-compatible did not answer a test call: HTTP 500 Internal Server Error');
      assert.equal(down.next.text, `wait until the reviewer at ${fake.url} works again, then run lawcheck doctor --reviewer`);
      const unready = check(await plain(r, { base: 'main' }), 'reviewer')!;
      assert.equal(unready.message, '1 reviewer rule; openai-compatible cannot be called: openai-compatible needs the address of its endpoint in LAWCHECK_REVIEWER_ENDPOINT');
    });
  });
});

test('R-39: the text of doctor puts a next line after a note or a fail that has one, and after nothing else', () => {
  const text = doctorText([
    { id: 'a', state: 'ok', message: 'm', next: { command: null, text: 'ignored on ok' } },
    { id: 'b', state: 'fail', message: 'f', next: null },
    { id: 'c', state: 'note', message: 'n', next: null },
    { id: 'd', state: 'skip', message: 's', next: { command: null, text: 'ignored on skip' } },
    { id: 'e', state: 'note', message: 'n2', details: ['more'], next: { command: null, text: 'do n2' } },
  ]);
  assert.equal(text, 'lawcheck: FAIL  5 checks, 1 problem, 2 notes\n\nok  a  m\nfail  b  f\nnote  c  n\nskip  d  s\nnote  e  n2\n  more\n  next: do n2\n');
  assert.equal(doctorText([{ id: 'a', state: 'ok', message: 'm', next: null }], 'refused'), 'lawcheck: ERROR  refused\n\nok  a  m\n');
});

test('R-39: doctor given a word or a flag it does not know is a usage error of doctor', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': OWN_LAW, '.lawcheck/rules/r1.mjs': SCRIPT_RULE, 'src/a.ts': 'x\n' });
    const result = await lawcheck(repo, ['doctor', 'extra']);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, "lawcheck: ERROR  1 error\n\nerror[usage]  unexpected argument 'extra'; doctor takes no arguments\n  why:  the tool does only what its usage line says\n\nnext: run lawcheck doctor as its usage line says: lawcheck doctor --help\n");
  });
});

test('R-39: a repository git cannot read fails the check that needed it, in the words of git, and the checks that wait for it are skipped', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': OWN_LAW, '.lawcheck/rules/r1.mjs': SCRIPT_RULE, 'src/a.ts': 'x\n' });
    writeFileSync(join(repo, '.git/index'), 'garbage garbage garbage');
    const checks = await plain(repo);
    const next = { command: null, text: 'repair the repository, so that git status works here, then run lawcheck doctor again' };
    for (const id of ['law', 'base']) {
      const failed = check(checks, id)!;
      assert.deepEqual([failed.state, failed.next], ['fail', next], id);
      assert.match((failed as { message: string }).message, /^git cannot read this repository: fatal: /, id);
    }
    assert.deepEqual(checks.map((c) => `${c.id} ${(c as { state: string }).state}`), ['node ok', 'git ok', 'law fail', 'config ok', 'types skip', 'base fail', 'law-change skip', 'readers skip', 'reviewer skip']);
  });
});
