import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withFake, openai } from './fake-reviewer.ts';
import { writeFakeClaude } from './fake-reviewer.ts';
import { append, git, inTemp, lawcheck, lawcheckAt, newRepository, PRICING, read, withCopy, withR, withSample, withU, write } from './helpers.ts';

const spec = readFileSync(new URL('../../spec/commands-slice.md', import.meta.url), 'utf8').split('\n');
const block = (start: string): string[] => {
  const at = spec.indexOf(start);
  const lines: string[] = [];
  for (let i = at; spec[i] !== '```'; i++) lines.push(spec[i]!);
  return lines;
};
const NODE = /^ok {2}node {2}Node \d+\.\d+\.\d+; Lawcheck needs 24 or later$/;
const DOCTOR_S = block('lawcheck: PASS  9 checks');
const NOTE_LINES = block('lawcheck: PASS  9 checks, 1 note');

function sameAsSpec(stdout: string, expected: string[]): void {
  const lines = stdout.split('\n');
  assert.equal(lines.length, expected.length + 1, stdout);
  expected.forEach((line, index) => {
    if (line.startsWith('ok  node  ')) assert.match(lines[index]!, NODE);
    else assert.equal(lines[index], line);
  });
  assert.equal(lines[expected.length], '');
}

function line(stdout: string, id: string): string {
  return stdout.split('\n').find((l) => new RegExp(`^(ok|note|fail|skip) {2}${id} {2}`).test(l)) ?? '';
}

function nextAfter(stdout: string, id: string): string {
  const lines = stdout.split('\n');
  return lines[lines.indexOf(line(stdout, id)) + 1] ?? '';
}

const doctor = (cwd: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) => lawcheck(cwd, ['doctor', ...args], env);

test('test 131: doctor in S with a base, and its JSON', async () => {
  await withSample(async (s) => {
    const result = await doctor(s, ['--base', 'main']);
    sameAsSpec(result.stdout, DOCTOR_S);
    assert.equal(result.code, 0);
    const json = await doctor(s, ['--base', 'main', '--json']);
    const document = JSON.parse(json.stdout);
    assert.equal(document.schema, 'lawcheck-doctor/0');
    assert.equal(document.result, 'pass');
    assert.deepEqual(document.checks.map((c: { id: string }) => c.id), ['node', 'git', 'law', 'config', 'types', 'base', 'law-change', 'readers', 'reviewer']);
    for (const check of document.checks) {
      assert.equal(check.state, 'ok');
      assert.equal(check.next, null);
    }
    assert.equal(json.code, 0);
  });
});

test('test 132: doctor in S without a base', async () => {
  await withSample(async (s) => {
    const result = await doctor(s);
    assert.equal(result.stdout.split('\n')[0], 'lawcheck: PASS  9 checks, 1 note');
    assert.equal(line(result.stdout, 'base'), 'note  base  no base: no --base, LAWCHECK_BASE or origin/HEAD, so a plain check counts every file as changed');
    assert.equal(nextAfter(result.stdout, 'base'), '  next: pass --base <branch>, or set LAWCHECK_BASE');
    assert.equal(line(result.stdout, 'law-change'), 'ok  law-change  no base, so a plain check judges every file');
    assert.equal(result.code, 0);
  });
});

test('test 133: a change of the law, in doctor and in check', async () => {
  const NOTE = 'note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code';
  await withSample(async (s) => {
    append(s, '.lawcheck/law.yaml', '# a note\n');
    const result = await doctor(s, ['--base', 'main']);
    const lines = result.stdout.split('\n');
    assert.equal(lines[0], NOTE_LINES[0]);
    assert.equal(line(result.stdout, 'base'), NOTE_LINES[1]);
    assert.equal(line(result.stdout, 'law-change'), NOTE_LINES[2]);
    assert.equal(nextAfter(result.stdout, 'law-change'), NOTE_LINES[3]);
    assert.equal(result.code, 0);
    const checked = await lawcheck(s, ['check', '--base', 'main']);
    assert.equal(checked.stdout, block('lawcheck: PASS  1 changed file (against main)').join('\n') + '\n');
    assert.equal(checked.code, 0);
    const json = await lawcheck(s, ['check', '--base', 'main', '--json']);
    assert.deepEqual(JSON.parse(json.stdout).scope, { mode: 'change', base: 'main', files: 1, law_changed: true });
    const fullJson = await lawcheck(s, ['check', '--full', '--base', 'main', '--json']);
    assert.deepEqual(JSON.parse(fullJson.stdout).scope, { mode: 'full', base: 'main', files: 1, law_changed: true });
    const full = await lawcheck(s, ['check', '--full', '--base', 'main']);
    assert.ok(!full.stdout.includes('note:'));
    assert.equal(full.code, 0);
    const noBase = await lawcheck(s, ['check']);
    assert.ok(!noBase.stdout.includes('note:'));
    assert.equal(noBase.code, 1);
  });
  await withSample(async (s) => {
    append(s, '.lawcheck/rules/no-todo.mjs', '// end\n');
    const result = await lawcheck(s, ['check', '--base', 'main']);
    assert.equal(result.stdout.split('\n')[1], NOTE);
    assert.equal(result.code, 0);
  });
  await withSample(
    async (s) => {
      const result = await lawcheck(s, ['check', '--base', 'main']);
      assert.equal(result.stdout, 'lawcheck: PASS  nothing changed against main\n');
      assert.equal(result.code, 0);
    },
    { onMain: (s) => append(s, '.lawcheck/law.yaml', '# a note\n') },
  );
});

test('test 134: doctor with a law that cannot be read', async () => {
  await withSample(
    async (s) => {
      const result = await doctor(s, ['--base', 'main']);
      assert.equal(result.stdout.split('\n')[0], 'lawcheck: FAIL  9 checks, 1 problem');
      assert.equal(line(result.stdout, 'law'), "fail  law  .lawcheck/law.yaml:8  unknown key 'statuss' in rule 'no-todo' (did you mean 'status'?)");
      assert.equal(nextAfter(result.stdout, 'law'), '  next: fix .lawcheck/law.yaml, then run lawcheck doctor again');
      for (const id of ['node', 'git', 'config', 'base', 'law-change']) assert.match(line(result.stdout, id), /^ok {2}/, id);
      assert.equal(line(result.stdout, 'types'), 'skip  types  needs law');
      assert.equal(line(result.stdout, 'readers'), 'skip  readers  needs types');
      assert.equal(line(result.stdout, 'reviewer'), 'skip  reviewer  needs law');
      assert.equal(result.code, 2);
      const json = await doctor(s, ['--base', 'main', '--json']);
      const document = JSON.parse(json.stdout);
      assert.equal(document.result, 'fail');
      assert.deepEqual(
        document.checks.map((c: { state: string }) => c.state),
        ['ok', 'ok', 'fail', 'ok', 'skip', 'ok', 'ok', 'skip', 'skip'],
      );
      assert.equal(json.code, 2);
    },
    { onMain: (s) => write(s, '.lawcheck/law.yaml', read(s, '.lawcheck/law.yaml').replace('    status: advisory', '    statuss: advisory')) },
  );
});

test('test 135: doctor without a law, and outside git', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    const result = await doctor(repo);
    assert.equal(line(result.stdout, 'law'), 'fail  law  no .lawcheck/law.yaml in this directory or any above it');
    assert.equal(nextAfter(result.stdout, 'law'), '  next: lawcheck init  (only when the user wants a law here)');
    for (const id of ['config', 'types', 'base', 'law-change', 'readers', 'reviewer']) assert.match(line(result.stdout, id), /^skip {2}/, id);
    assert.equal(result.code, 2);
    const json = await doctor(repo, ['--json']);
    const law = JSON.parse(json.stdout).checks.find((c: { id: string }) => c.id === 'law');
    assert.deepEqual(law.next, { command: 'lawcheck init', text: 'lawcheck init  (only when the user wants a law here)' });
  });
  await inTemp(async (dir) => {
    const result = await doctor(dir);
    assert.match(line(result.stdout, 'git'), /^fail {2}git {2}/);
    for (const id of ['law', 'config', 'types', 'base', 'law-change', 'readers', 'reviewer']) assert.match(line(result.stdout, id), /^skip {2}/, id);
    assert.equal(result.code, 2);
  });
});

test('test 136: the reviewer check', async () => {
  await withFake(async (fake) => {
    const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.url };
    await withR(async (r) => {
      const unset = await doctor(r, ['--base', 'main']);
      assert.match(line(unset.stdout, 'reviewer'), /^fail {2}reviewer {2}1 reviewer rule; openai-compatible cannot be called: openai-compatible needs the address of its endpoint in LAWCHECK_REVIEWER_ENDPOINT$/);
      assert.equal(unset.code, 2);
      const set = await doctor(r, ['--base', 'main'], env);
      assert.equal(line(set.stdout, 'law'), 'ok  law  .lawcheck/law.yaml: 4 types, 3 rules (2 script, 1 reviewer)');
      assert.equal(line(set.stdout, 'config'), 'ok  config  .lawcheck/config.yaml: reviewer openai-compatible, model test-model');
      assert.equal(line(set.stdout, 'reviewer'), 'ok  reviewer  1 reviewer rule; openai-compatible can be called (lawcheck doctor --reviewer makes one call)');
      assert.equal(set.code, 0);
      assert.equal(fake.requests.length, 0);
      fake.respond = () => openai('{"verdict": "pass", "findings": []}');
      const called = await doctor(r, ['--base', 'main', '--reviewer'], env);
      assert.equal(line(called.stdout, 'reviewer'), 'ok  reviewer  1 reviewer rule; openai-compatible answered a test call');
      assert.equal(called.code, 0);
      assert.equal(fake.requests.length, 1);
      assert.equal(fake.requests[0]!.json.messages[0].content, 'Answer with this JSON object and nothing else: {"verdict": "pass", "findings": []}');
      fake.respond = () => ({ status: 500, body: '{}' });
      const failed = await doctor(r, ['--base', 'main', '--reviewer'], env);
      assert.match(line(failed.stdout, 'reviewer'), /^fail {2}reviewer {2}.*500/);
      assert.equal(failed.code, 2);
      assert.equal(fake.requests.length, 2);
      fake.respond = () => openai('fine');
      const fine = await doctor(r, ['--base', 'main', '--reviewer'], env);
      assert.match(line(fine.stdout, 'reviewer'), /^fail {2}reviewer {2}.*answered with no verdict: fine$/);
      assert.equal(fine.code, 2);
      const verdict = '{"verdict": "fail", "findings": [{"line": null, "message": "m"}]}';
      fake.respond = () => openai(verdict);
      const failing = await doctor(r, ['--base', 'main', '--reviewer'], env);
      assert.equal(line(failing.stdout, 'reviewer'), `fail  reviewer  1 reviewer rule; openai-compatible answered fail to a test call that asks for pass: ${verdict}`);
      assert.equal(failing.code, 2);
    });
    await withR(
      async (r) => {
        const result = await doctor(r, ['--base', 'main'], env);
        assert.equal(line(result.stdout, 'reviewer'), 'fail  reviewer  1 reviewer rule and no reviewer set, so their files stay not-reviewed');
        assert.equal(result.code, 2);
      },
      { onMain: (r) => git(r, 'rm', '-q', '.lawcheck/config.yaml') },
    );
  });
  await inTemp(async (bin) => {
    writeFakeClaude(bin);
    const record = join(bin, 'record.json');
    await withR(
      async (r) => {
        const result = await doctor(r, ['--base', 'main'], { PATH: `${bin}:${process.env.PATH}`, FAKE_CLAUDE_RECORD: record });
        assert.equal(line(result.stdout, 'reviewer'), 'ok  reviewer  1 reviewer rule; claude-code can be called (lawcheck doctor --reviewer makes one call)');
        assert.equal(result.code, 0);
        assert.throws(() => readFileSync(record));
      },
      { onMain: (r) => write(r, '.lawcheck/config.yaml', 'reviewer:\n  provider: claude-code\n  model: test-model\n') },
    );
  });
  await withSample(async (s) => {
    const result = await doctor(s, ['--base', 'main', '--reviewer']);
    assert.equal(line(result.stdout, 'reviewer'), 'fail  reviewer  no reviewer is set, so --reviewer has nothing to call');
    assert.equal(result.code, 2);
  });
});

test('test 137: types, unread files and a broken grammar', async () => {
  await withSample(
    async (s) => {
      const result = await doctor(s, ['--base', 'main']);
      assert.match(line(result.stdout, 'types'), /^fail {2}types {2}src\/core\/price\.ts {2}/);
      assert.equal(line(result.stdout, 'readers'), 'skip  readers  needs types');
      assert.equal(result.code, 2);
    },
    { onMain: (s) => write(s, '.lawcheck/law.yaml', PRICING(read(s, '.lawcheck/law.yaml'))) },
  );
  await withU(
    async (u) => {
      const result = await doctor(u, ['--base', 'main']);
      assert.match(line(result.stdout, 'readers'), /^note {2}readers {2}.*1 \.md.*so check warns uses-not-read$/);
      assert.equal(nextAfter(result.stdout, 'readers'), '  next: lawcheck docs languages');
      assert.equal(result.code, 0);
    },
    {
      onMain: (u) => {
        write(u, '.lawcheck/law.yaml', read(u, '.lawcheck/law.yaml').replace('types:\n', 'types:\n  notes:\n    paths: ["notes/**"]\n    may_use: [notes]\n'));
        write(u, 'notes/a.md', '# A\n');
      },
    },
  );
  await withCopy(async (copy) => {
    writeFileSync(join(copy.dir, 'dist/grammars/tree-sitter-ruby.wasm'), 'x');
    await withSample(async (s) => {
      const result = await lawcheckAt(copy.cli, s, ['doctor', '--base', 'main']);
      assert.match(line(result.stdout, 'readers'), /^fail {2}readers {2}.*ruby/);
      assert.equal(nextAfter(result.stdout, 'readers'), '  next: reinstall Lawcheck; a grammar it ships cannot be loaded');
      assert.equal(result.code, 2);
    });
  });
});

test('test 138: a base that names no commit', async () => {
  await withSample(async (s) => {
    const result = await doctor(s, ['--base', 'nope']);
    assert.equal(line(result.stdout, 'base'), "fail  base  the base 'nope' names no commit here");
    assert.equal(nextAfter(result.stdout, 'base'), '  next: pass --base with a branch or a commit that exists here');
    assert.equal(line(result.stdout, 'law-change'), 'skip  law-change  needs base');
    assert.equal(result.code, 2);
  });
});

test('test 139: usage of doctor, prime and docs', async () => {
  await withSample(async (s) => {
    for (const args of [['doctor', 'x'], ['doctor', '--base'], ['doctor', '--reviewer', '--reviewer'], ['doctor', '--no-color'], ['prime', 'x'], ['docs', '--base', 'main']]) {
      const result = await lawcheck(s, args);
      assert.match(result.stdout, /^error\[usage\]/m, args.join(' '));
      assert.equal(result.code, 2, args.join(' '));
    }
  });
});

test('test 140: the usage of the program and of each command', async () => {
  await inTemp(async (dir) => {
    const help = await lawcheck(dir, ['--help']);
    assert.equal(help.stdout.split('\n')[0], 'usage: lawcheck <command> [<arguments>] [--json]');
    assert.equal(help.code, 0);
    const firsts = spec.filter((l) => /^usage: lawcheck [a-z]+ /.test(l)).slice(0, 7);
    assert.equal(firsts.length, 7);
    for (const first of firsts) {
      const command = first.split(' ')[2]!;
      const result = await lawcheck(dir, [command, '--help']);
      assert.equal(result.stdout.split('\n')[0], first, command);
      assert.equal(result.code, 0);
    }
    for (const args of [[], ['fix']]) {
      const result = await lawcheck(dir, args);
      assert.match(result.stdout, /^error\[usage\]/m);
      assert.equal(result.code, 2);
    }
    const json = await lawcheck(dir, ['init', '--help', '--json']);
    const document = JSON.parse(json.stdout);
    assert.equal(document.schema, 'lawcheck-error/1');
    assert.equal(document.errors[0].code, 'usage');
    assert.equal(json.code, 2);
    const version = await lawcheck(dir, ['--version']);
    assert.equal(version.stdout, '0.1.0\n');
    assert.equal(version.code, 0);
  });
});
