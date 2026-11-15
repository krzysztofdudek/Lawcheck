import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openai, withFake } from '../acceptance/fake-reviewer.ts';
import { git, inTemp, lawcheck, write } from '../acceptance/helpers.ts';
import type { Run } from '../acceptance/helpers.ts';
import { expectedField, expectedLine, jsonProblem, outputProblem } from './oracle.ts';

const NO_BREAK = '\x1b[2K\x1b[1A\x07\b\t\x7f\x85\u2028\u2029\u202e⁦ ::error::x ##vso[task.setvariable variable=a]b';
const HOSTILE = `a\nb\r${NO_BREAK}\n::error title=forged::y\n##[group]z\n  ::warning::w\r\n##vso[task.complete]done`;

interface Setup {
  about?: string;
  rules?: Record<string, string>;
  ruleIds?: string[];
  config?: string;
  files?: Record<string, string>;
}

// Windows refuses control characters and these in a file name; the design filters such names by platform and prints the count.
const REFUSED = process.platform === 'win32' ? /[\x00-\x1f:*?"<>|]/ : /\x00/;

function onThisSystem(names: string[]): string[] {
  const kept = names.filter((name) => !REFUSED.test(name));
  if (kept.length < names.length) process.stdout.write(`# ${names.length - kept.length} of ${names.length} names left out on ${process.platform}\n`);
  return kept;
}

function repo(dir: string, setup: Setup = {}, name = 'r'): string {
  const r = join(dir, name);
  mkdirSync(join(r, '.lawcheck', 'rules'), { recursive: true });
  git(r, 'init', '-q', '-b', 'main');
  const rules = setup.rules ?? { shout: 'export function check() { return [{ line: 1, message: "named" }]; }\n' };
  const ids = setup.ruleIds ?? Object.keys(rules);
  const law = [
    'lawcheck: 0.1.0',
    'rules:',
    ...ids.flatMap((id) => [`  ${JSON.stringify(id)}:`, '    why: Every file is named.']),
    'types:',
    '  all:',
    ...(setup.about === undefined ? [] : [`    about: ${JSON.stringify(setup.about)}`]),
    '    paths: ["**/*.ts"]',
    `    rules: [${ids.map((id) => JSON.stringify(id)).join(', ')}]`,
    '',
  ].join('\n');
  writeFileSync(join(r, '.lawcheck', 'law.yaml'), law);
  for (const [id, source] of Object.entries(rules)) writeFileSync(join(r, '.lawcheck', 'rules', id.endsWith('.md') ? id : `${id}.mjs`), source);
  if (setup.config !== undefined) writeFileSync(join(r, '.lawcheck', 'config.yaml'), setup.config);
  git(r, 'add', '-A');
  git(r, 'commit', '-q', '-m', 'law');
  git(r, 'checkout', '-q', '-b', 'work');
  for (const [path, text] of Object.entries(setup.files ?? { 'a.ts': 'const a = 1;\n' })) write(r, path, text);
  return r;
}

function clean(run: Run, json = false): void {
  assert.equal(outputProblem(run.stderr), null, run.stderr);
  if (json) {
    assert.equal(jsonProblem(run.stdout), null);
    JSON.parse(run.stdout);
  } else {
    assert.equal(outputProblem(run.stdout), null, run.stdout);
  }
}

const SHOWN = '\\x1b[2K\\x1b[1A';

function reached(run: Run): void {
  assert.ok(run.stdout.includes(SHOWN), `the hostile text does not reach the output: ${run.stdout}`);
}

function linesWith(stdout: string, part: string): string[] {
  return stdout.split('\n').filter((line) => line.includes(part));
}

test('I-out-1: file names cannot forge a line of check, explain or try, and each finding stays one line', async () => {
  const names = onThisSystem(['::error title=pwned::x.ts', '##vso[task.setvariable variable=a]b.ts', `e\x1b[2K\x1b[1A\x07\u202e\u2028\x85.ts`, ' ::warning::w.ts', '##[group]g.ts']);
  await inTemp(async (dir) => {
    const r = repo(dir, { files: Object.fromEntries(names.map((name) => [name, 'const a = 1;\n'])) });
    const run = await lawcheck(r, ['check', '--base', 'main']);
    clean(run);
    assert.equal(run.code, 1);
    const found = linesWith(run.stdout, '  error[shout]  ');
    assert.deepEqual(new Set(found), new Set(names.map((name) => expectedLine(`${expectedField(name)}:1  error[shout]  named`))));
    const json = await lawcheck(r, ['check', '--base', 'main', '--json']);
    clean(json, true);
    assert.deepEqual(JSON.parse(json.stdout).findings.map((f: { file: string }) => f.file).sort(), [...names].sort());
    for (const name of names) {
      const explained = await lawcheck(r, ['explain', name]);
      clean(explained);
      assert.equal(explained.stdout.split('\n')[0], expectedLine(expectedField(name)));
      const tried = await lawcheck(r, ['try', 'shout', name]);
      clean(tried);
      assert.deepEqual(linesWith(tried.stdout, '  error[shout]  '), [expectedLine(`${expectedField(name)}:1  error[shout]  named`)]);
    }
  });
});

test('I-out-1: a rule message cannot forge a line of check or try, in text or JSON', async () => {
  const message = `${HOSTILE}\x00`;
  const normalized = message.replace(/\r\n|[\n\r]/g, ' ');
  await inTemp(async (dir) => {
    const r = repo(dir, { rules: { shout: `export function check() { return [{ line: 1, message: ${JSON.stringify(message)} }]; }\n` } });
    for (const args of [['check', '--base', 'main'], ['try', 'shout', 'a.ts']]) {
      const run = await lawcheck(r, args);
      clean(run);
      assert.equal(run.code, 1);
      assert.deepEqual(linesWith(run.stdout, '  error[shout]  '), [expectedLine(`a.ts:1  error[shout]  ${expectedField(normalized)}`)]);
      const json = await lawcheck(r, [...args, '--json']);
      clean(json, true);
      const document = JSON.parse(json.stdout);
      assert.equal((document.findings ?? document.runs[0].findings)[0].message, normalized);
    }
  });
});

test('I-out-1: a reviewer message cannot forge a line, in the run that asked and from the cache afterwards', async () => {
  await withFake(
    async (fake) => {
      await inTemp(async (dir) => {
        const r = repo(dir, {
          rules: { 'judge.md': 'Report every line.\n' },
          ruleIds: ['judge'],
          config: 'reviewer:\n  provider: openai-compatible\n  model: m\n',
        });
        const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.url };
        const expected = [expectedLine(`a.ts:1  error[judge]  ${expectedField(HOSTILE.replace(/\r\n|[\n\r]/g, ' ').trim())}`)];
        for (const args of [['check', '--base', 'main', '--review'], ['check', '--base', 'main'], ['try', 'judge', 'a.ts']]) {
          const run = await lawcheck(r, args, env);
          clean(run);
          assert.equal(run.code, 1);
          assert.deepEqual(linesWith(run.stdout, '  error[judge]  '), expected);
          const json = await lawcheck(r, [...args, '--json'], env);
          clean(json, true);
        }
      });
    },
    () => openai(JSON.stringify({ verdict: 'fail', findings: [{ line: 1, message: HOSTILE }] })),
  );
});

test('I-out-1: an error text from the reviewer endpoint cannot forge a line of check or doctor', async () => {
  await withFake(
    async (fake) => {
      await inTemp(async (dir) => {
        const r = repo(dir, { rules: { 'judge.md': 'Report every line.\n' }, ruleIds: ['judge'], config: 'reviewer:\n  provider: openai-compatible\n  model: m\n' });
        const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.url };
        for (const args of [['check', '--base', 'main', '--review'], ['doctor', '--reviewer']]) {
          const run = await lawcheck(r, args, env);
          clean(run);
          reached(run);
          assert.equal(run.code, 2);
          assert.ok(run.stdout.includes('HTTP 401'), run.stdout);
          clean(await lawcheck(r, [...args, '--json'], env), true);
        }
      });
    },
    () => ({ status: 401, body: JSON.stringify({ error: { message: `${NO_BREAK}\r::error::cr` } }) }),
  );
});

test('I-out-1: a base ref cannot forge a line, and its error stays one line', async () => {
  await inTemp(async (dir) => {
    const r = repo(dir);
    const run = await lawcheck(r, ['check', '--base', HOSTILE]);
    clean(run);
    reached(run);
    assert.equal(run.code, 2);
    assert.equal(linesWith(run.stdout, 'error[base-unreachable]').length, 1);
    const json = await lawcheck(r, ['check', '--base', HOSTILE, '--json']);
    clean(json, true);
    assert.ok(JSON.parse(json.stdout).errors[0].message.includes(HOSTILE));
  });
});

test("I-out-1: a type's about text and a rule id cannot forge a line of prime, explain or check", async () => {
  await inTemp(async (dir) => {
    const r = repo(dir, { about: NO_BREAK });
    for (const args of [['prime'], ['explain', 'a.ts']]) {
      const run = await lawcheck(r, args);
      clean(run);
      reached(run);
      assert.equal(run.code, 0);
      clean(await lawcheck(r, [...args, '--json']), true);
    }
  });
  await inTemp(async (dir) => {
    const r = repo(dir, { ruleIds: [HOSTILE], rules: {} });
    for (const args of [['check', '--base', 'main'], ['prime'], ['doctor']]) {
      const run = await lawcheck(r, args);
      clean(run);
      reached(run);
      assert.equal(run.code, 2);
      const json = await lawcheck(r, [...args, '--json']);
      clean(json, true);
      const count = (JSON.parse(json.stdout).errors ?? []).length;
      if (count > 0) assert.equal(linesWith(run.stdout, 'error[').length, count);
    }
  });
});

test('I-out-1: a config value cannot forge a line of check or doctor', async () => {
  await inTemp(async (dir) => {
    const r = repo(dir, { config: `reviewer:\n  provider: ${JSON.stringify(HOSTILE)}\n  model: ${JSON.stringify(NO_BREAK)}\n` });
    for (const args of [['check', '--base', 'main'], ['doctor']]) {
      const run = await lawcheck(r, args);
      clean(run);
      reached(run);
      assert.equal(run.code, 2);
      clean(await lawcheck(r, [...args, '--json']), true);
    }
  });
});

test("I-out-1: git's error text cannot forge a line of check, prime or doctor", async () => {
  await inTemp(async (dir) => {
    const [name] = onThisSystem([`r-\u202e\u2028\x1b[2K\x1b[1A##vso[task.complete]x`]);
    const r = repo(dir, {}, name ?? 'r-\u202e\u2028');
    rmSync(join(r, '.git'), { recursive: true, force: true });
    writeFileSync(join(r, '.git'), 'gitdir: missing\n');
    for (const args of [['check', '--base', 'main'], ['prime'], ['doctor']]) {
      const run = await lawcheck(r, args);
      clean(run);
      assert.ok(run.stdout.includes('\\u202e'), run.stdout);
      assert.equal(run.code, 2);
      clean(await lawcheck(r, [...args, '--json']), true);
    }
  });
});

test("I-out-1: what a script rule prints on its own streams reaches the tool's standard error through the same escapes", async () => {
  await inTemp(async (dir) => {
    const printed = `console.log(${JSON.stringify('::error title=forged::x')}); console.error(${JSON.stringify(`${NO_BREAK}\r##[group]g`)}); process.stdout.write('no line end ##vso[task.complete]');`;
    const r = repo(dir, { rules: { shout: `export function check() { ${printed} return [{ line: 1, message: "named" }]; }\n` } });
    for (const args of [['check', '--base', 'main'], ['try', 'shout', 'a.ts']]) {
      const run = await lawcheck(r, args);
      assert.equal(run.code, 1, run.stdout + run.stderr);
      assert.equal(outputProblem(run.stderr), null, run.stderr);
      assert.ok(run.stderr.includes('\\x3a:error title=forged::x'), run.stderr);
      assert.ok(run.stderr.includes(SHOWN), run.stderr);
      assert.ok(run.stderr.includes('no line end \\x23#vso[task.complete]'), run.stderr);
    }
  });
});
