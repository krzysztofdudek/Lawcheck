import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { append, check, E, E_PATH, findingLines, git, LAW, lawcheck, read, run as runR, setRule, withR, withSample, withU, write } from './helpers.ts';
import { withFake } from './fake-reviewer.ts';

const GENERIC = 'note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code';
const PREFIX = 'note: this change edits the law that judges it: ';

function edit(s: string, from: string, to: string): void {
  const text = read(s, '.lawcheck/law.yaml');
  assert.ok(text.includes(from), `the sample law has no "${from}"`);
  write(s, '.lawcheck/law.yaml', text.replace(from, to));
}

function secondLines(stdout: string): string[] {
  return stdout.split('\n').slice(1, 3);
}

test('test 300: S7-3, a rule taken off a type while the change breaks it is said in plain words, and the exit code stays', async () => {
  await withSample(async (s) => {
    edit(s, '        rules: [no-console]\n', '        rules: []\n');
    append(s, 'src/core/price.ts', "console.log('sneaky');\n");
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: PASS  2 changed files (against main)');
    assert.deepEqual(secondLines(run.stdout), [GENERIC, `${PREFIX}takes the rule no-console off the type library`]);
    assert.equal(run.code, 0);
    const json = await check(s, '--base', 'main', '--json');
    assert.deepEqual(JSON.parse(json.stdout).scope, { mode: 'change', base: 'main', files: 2, law_changed: true, law_changes: ['takes the rule no-console off the type library'] });
    assert.equal(json.code, 0);
  });
  await withSample(async (s) => {
    append(s, 'src/core/price.ts', "console.log('plain');\n");
    const run = await check(s);
    assert.equal(run.code, 1, 'the control: the same breach without the law change fails');
    assert.ok(!run.stdout.includes('note:'));
    assert.ok(!JSON.parse((await check(s, '--base', 'main', '--json')).stdout).scope.law_changes);
  });
});

test('test 301: S7-3, a rule script rewritten to return nothing is named by its file', async () => {
  await withSample(async (s) => {
    setRule(s, 'no-console', 'export function check() {\n  return [];\n}\n');
    append(s, 'src/core/price.ts', "console.log('sneaky');\n");
    const run = await check(s);
    assert.deepEqual(secondLines(run.stdout), [GENERIC, `${PREFIX}changes .lawcheck/rules/no-console.mjs`]);
    assert.equal(run.code, 0);
  });
  await withSample(async (s) => {
    write(s, '.lawcheck/rules/extra.mjs', 'export function check() {\n  return [];\n}\n');
    edit(s, '  no-todo:\n', '  extra:\n    why: An extra rule.\n  no-todo:\n');
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[2], `${PREFIX}adds the rule extra; adds .lawcheck/rules/extra.mjs`);
    assert.equal(run.code, 0);
  });
});

test('test 302: S7-3, the changes are told in a fixed order, and a law that only gains a note says that', async () => {
  await withSample(async (s) => {
    edit(s, '  no-todo:\n    why: A TODO without an issue number gets forgotten.\n    status: advisory\n', '');
    edit(s, '    rules: [no-todo]\n    types:', '    types:');
    edit(s, '    content: "^#!"\n    rules: [no-todo]\n', '    content: "^#!"\n');
    edit(s, '  no-console:\n    why: Only the command layer writes to the terminal.\n', '  no-console:\n    why: Only the command layer writes to the terminal.\n    status: advisory\n');
    edit(s, 'paths: ["tools/**/*.{mjs,js}"]', 'paths: ["tools/**/*.mjs"]');
    edit(s, 'types:\n  source:', 'types:\n  docs:\n    about: Pages.\n    paths: ["docs/**"]\n  source:');
    rmSync(join(s, '.lawcheck/rules/no-todo.mjs'));
    const run = await check(s, '--full', '--base', 'main');
    assert.equal(run.stdout.split('\n')[1], `${PREFIX}adds the type docs; removes the rule no-todo; makes the rule no-console advisory; changes the paths of the type script; removes .lawcheck/rules/no-todo.mjs`);
    assert.ok(!run.stdout.includes(GENERIC), '--full says no generic note');
    assert.equal(run.code, 0);
  });
  await withSample(async (s) => {
    append(s, '.lawcheck/law.yaml', '# a note\n');
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[2], `${PREFIX}edits .lawcheck/law.yaml without changing a rule or a type`);
  });
});

test('test 303: S7-3, the line holds five changes and counts the rest; JSON lists all', async () => {
  await withSample(async (s) => {
    for (const [index, name] of ['a', 'b', 'c', 'd', 'e', 'f', 'g'].entries()) {
      write(s, `.lawcheck/rules/${name}-rule.mjs`, `export function check() {\n  return [];\n}\n// ${index}\n`);
      edit(s, '  no-todo:\n', `  ${name}-rule:\n    why: A rule.\n  no-todo:\n`);
    }
    const run = await check(s);
    const line = run.stdout.split('\n')[2]!;
    assert.ok(line.startsWith(`${PREFIX}adds the rule a-rule; adds the rule b-rule; `), line);
    assert.ok(line.endsWith('; and 9 more'), line);
    assert.equal(line.split('; ').length, 6);
    const document = JSON.parse((await check(s, '--base', 'main', '--json')).stdout);
    assert.equal(document.scope.law_changes.length, 14);
  });
});

test('test 304: S7-3, a change of the config is a change of the law, and a change that ends in exit 2 prints no note', async () => {
  await withSample(async (s) => {
    write(s, '.lawcheck/config.yaml', 'runner: npx\n');
    const run = await check(s);
    assert.deepEqual(secondLines(run.stdout), [GENERIC, `${PREFIX}adds .lawcheck/config.yaml`]);
    assert.equal(run.code, 0);
  });
  await withSample(async (s) => {
    write(s, '.lawcheck/law.yaml', LAW.replace('rules: [no-console]', 'rules: [nope]'));
    const run = await check(s);
    assert.equal(run.code, 2);
    assert.ok(!run.stdout.includes('note:'));
  });
  await withSample(async (s) => {
    append(s, '.lawcheck/law.yaml', '# a note\n');
    const run = await lawcheck(s, ['check']);
    assert.ok(!run.stdout.includes('note:'), 'with no base nothing is compared');
    const noBase = JSON.parse((await lawcheck(s, ['check', '--json'])).stdout).scope;
    assert.equal(noBase.base, null);
    assert.ok(!('law_changes' in noBase), 'with no base the key is absent');
    assert.ok(readFileSync(new URL('../../docs/json.md', import.meta.url), 'utf8').includes('`law_changes` is present only when the check compared a base and the law differs'));
  });
});

test('test 315: S7-3, a name in the law folder holding a format character is told as an escape, in text and in JSON', async () => {
  await withSample(async (s) => {
    write(s, '.lawcheck/rules/lib/a\u202eb\u200fc.mjs', 'export const x = 1;\n');
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[2], `${PREFIX}adds .lawcheck/rules/lib/a\\u202eb\\u200fc.mjs`);
    assert.ok(!/[\u202e\u200f]/.test(run.stdout), 'no raw format character reaches the terminal');
    assert.equal(run.code, 0);
    const json = JSON.parse((await check(s, '--base', 'main', '--json')).stdout);
    assert.deepEqual(json.scope.law_changes, ['adds .lawcheck/rules/lib/a\\u202eb\\u200fc.mjs']);
  });
});

test('test 316: S7-3, a change of the why, the context or the about is named, and a note with no change of meaning says so', async () => {
  await withSample(async (s) => {
    edit(s, 'why: Only the command layer writes to the terminal.', 'why: Nothing writes to the terminal.');
    edit(s, 'about: Code the commands call.', 'about: Code the commands use.');
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[2], `${PREFIX}changes the why of the rule no-console; changes the about of the type library`);
    assert.equal(run.code, 0);
  });
  await withR(async (r) => {
    edit(r, 'context: ["docs/errors.md"]', 'context: ["docs/errors.md", "docs/more.md"]');
    write(r, 'docs/more.md', '# More\n');
    const run = await check(r);
    assert.ok(run.stdout.split('\n').includes(`${PREFIX}changes the context of the rule clear-errors`), run.stdout);
  });
});

test('test 317: S7-3, a waiver the change adds is named in the line, and one the base already had is not', async () => {
  await withSample(async (s) => {
    append(s, '.lawcheck/law.yaml', '# a note\n');
    write(s, 'src/core/shipping.ts', "console.log('x'); // lawcheck-waive no-console -- a legacy call\n");
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: PASS  2 changed files (against main), 1 waiver');
    assert.deepEqual(run.stdout.split('\n').slice(2, 4), [`${PREFIX}edits .lawcheck/law.yaml without changing a rule or a type`, 'note: this change adds 1 waiver: no-console at src/core/shipping.ts:1']);
    assert.equal(run.code, 0);
    const json = JSON.parse((await check(s, '--base', 'main', '--json')).stdout);
    assert.deepEqual(json.scope.law_changes, ['edits .lawcheck/law.yaml without changing a rule or a type']);
    assert.deepEqual(json.waivers.map((w: { added: boolean }) => w.added), [true]);
  });
  await withSample(
    async (s) => {
      append(s, '.lawcheck/law.yaml', '# a note\n');
      append(s, 'src/core/shipping.ts', '// more\n');
      const run = await check(s);
      assert.ok(!run.stdout.includes('adds 1 waiver'), 'a waiver that was already there is no addition');
    },
    { onMain: (s) => write(s, 'src/core/shipping.ts', "console.log('x'); // lawcheck-waive no-console -- a legacy call\n") },
  );
});

test('test 318: S7-3, R-75, a changed waivers key is named by the type that writes it, and the types that inherit its value are not', async () => {
  await withSample(async (s) => {
    edit(s, '        rules: [no-console]\n', '        rules: [no-console]\n        waivers: false\n');
    const run = await check(s);
    assert.deepEqual(secondLines(run.stdout), [GENERIC, `${PREFIX}changes the waivers of the type library`]);
    assert.equal(run.code, 0);
    const json = await check(s, '--base', 'main', '--json');
    assert.deepEqual(JSON.parse(json.stdout).scope.law_changes, ['changes the waivers of the type library']);
  });
  await withSample(async (s) => {
    edit(s, '    rules: [no-todo]\n    types:', '    rules: [no-todo]\n    waivers: false\n    types:');
    const run = await check(s);
    assert.deepEqual(secondLines(run.stdout), [GENERIC, `${PREFIX}changes the waivers of the type source`]);
    assert.equal(run.code, 0);
  });
});

test('R-99: a waiver of forbidden-use that the change adds is named in the line, in text and in JSON, as a waiver of a rule is', async () => {
  const lines = E.split('\n');
  await withU(async (u) => {
    append(u, '.lawcheck/law.yaml', '# a note\n');
    write(u, E_PATH, [lines[0], "import '../cli/main.js'; // lawcheck-waive forbidden-use -- the report repeats the banner until 2.0", lines[2], ''].join('\n'));
    const run = await check(u);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: PASS  2 changed files (against main), 1 waiver');
    assert.ok(run.stdout.split('\n').includes(`note: this change adds 1 waiver: forbidden-use at ${E_PATH}:2`), run.stdout);
    assert.equal(run.code, 0);
    const json = JSON.parse((await check(u, '--base', 'main', '--json')).stdout);
    assert.deepEqual(json.scope.law_changes, ['edits .lawcheck/law.yaml without changing a rule or a type']);
    assert.deepEqual(json.waivers.map((w: { rule: string; added: boolean }) => [w.rule, w.added]), [['forbidden-use', true]]);
  });
});

test('R-104: a type moved under another parent is named, though its own keys stay, and its files lose the rules of the old place', async () => {
  const library = '      library:\n        about: Code the commands call.\n        paths: ["src/core/**"]\n        rules: [no-console]\n';
  await withSample(async (s) => {
    edit(s, library, '');
    append(s, '.lawcheck/law.yaml', `    types:\n${library}`);
    append(s, 'src/core/price.ts', "console.log('sneaky');\n");
    const run = await check(s);
    assert.deepEqual(secondLines(run.stdout), [GENERIC, `${PREFIX}moves the type library from source to script`]);
    assert.equal(run.code, 0);
    const json = await check(s, '--base', 'main', '--json');
    assert.deepEqual(JSON.parse(json.stdout).scope.law_changes, ['moves the type library from source to script']);
  });
  await withSample(async (s) => {
    const script = '  script:\n    about: Executable helpers.\n    paths: ["tools/**/*.{mjs,js}"]\n    content: "^#!"\n    rules: [no-todo]\n';
    edit(s, script, '');
    edit(s, '      command:\n', `${script.replace(/^(?=.)/gm, '    ')}      command:\n`);
    const run = await check(s);
    assert.deepEqual(secondLines(run.stdout), [GENERIC, `${PREFIX}moves the type script from the top of types to source`]);
    assert.equal(run.code, 0);
  });
});

const MAIN_RULE = readFileSync(new URL('../reviewer-sample/.lawcheck/rules/clear-errors.md', import.meta.url), 'utf8').trim();
const FROM = 'note: this change edits its own law, and the law of main judged it: ';

function noCopyLeft(s: string): void {
  const local = join(s, '.lawcheck/.local');
  assert.deepEqual(existsSync(local) ? readdirSync(local) : [], [], 'the copy of the rules is gone');
}

test('test 1071: T7, a change that takes a rule off a type and breaks it passes by its own law and fails with --law-from, in text and in JSON', async () => {
  await withSample(async (s) => {
    edit(s, '        rules: [no-console]\n', '        rules: []\n');
    write(s, 'src/core/total.ts', "export const total = 1;\nconsole.log(total);\n");
    const own = await check(s);
    assert.equal(own.code, 0, own.stdout);
    const run = await check(s, '--base', 'main', '--law-from', 'main');
    assert.deepEqual(run.stdout.split('\n'), [
      'lawcheck: FAIL  1 error in 2 changed files (against main)',
      FROM + 'takes the rule no-console off the type library',
      '',
      'src/core/total.ts:2  error[no-console]  writes to the terminal with console.log',
      '  why:  Only the command layer writes to the terminal.',
      '',
      'next: fix src/core/total.ts:2',
      '',
    ]);
    assert.equal(run.code, 1);
    noCopyLeft(s);
    const json = await check(s, '--base', 'main', '--law-from', 'main', '--json');
    const document = JSON.parse(json.stdout);
    assert.deepEqual(document.scope, { mode: 'change', base: 'main', files: 2, law_changed: true, law_changes: ['takes the rule no-console off the type library'] });
    assert.deepEqual(document.findings.map((f: { code: string; file: string; line: number }) => [f.code, f.file, f.line]), [['no-console', 'src/core/total.ts', 2]]);
    assert.equal(json.code, 1);
    git(s, 'add', '-A');
    git(s, 'commit', '-q', '-m', 'loosen');
    const committed = await check(s, '--base', 'main', '--law-from', 'main');
    assert.equal(committed.code, 1, 'the commit of the same change fails the same way');
    const ownAgain = await lawcheck(s, ['check', '--base', 'main', '--law-from', 'HEAD']);
    assert.equal(ownAgain.code, 0, 'the law of the branch, named by its commit, judges as the work tree does');
  });
});

test('test 1072: T7, under --law-from the script rules and their helpers are those of the commit, and a rule the change adds neither runs nor stops the run', async () => {
  const helper = "export const CALL = /\\bconsole\\.(\\w+)/;\n";
  const rule = "import { CALL } from './lib/call.mjs';\nexport function check({ files }) {\n  return files.flatMap((file) => file.lines.flatMap((text, index) => (CALL.test(text) ? [{ file: file.path, line: index + 1, message: 'writes to the terminal' }] : [])));\n}\n";
  await withSample(
    async (s) => {
      write(s, '.lawcheck/rules/lib/call.mjs', 'export const CALL = /a^/;\n');
      setRule(s, 'extra', "throw new Error('the rule of the change ran');\n");
      edit(s, '  no-todo:\n', '  extra:\n    why: A rule of the change.\n  no-todo:\n');
      edit(s, '        rules: [no-console]\n', '        rules: [no-console, extra]\n');
      write(s, 'src/core/total.ts', "export const total = 1;\nconsole.log(total);\n");
      const run = await check(s, '--base', 'main', '--law-from', 'main');
      assert.deepEqual(findingLines(run.stdout), ['src/core/total.ts:2  error[no-console]  writes to the terminal']);
      assert.equal(run.code, 1, run.stdout);
      noCopyLeft(s);
      const own = await check(s);
      assert.equal(own.code, 2, 'by its own law the change runs its own rule');
      assert.match(own.stdout, /error\[rule-crashed\]/);
    },
    { onMain: (s) => { write(s, '.lawcheck/rules/lib/call.mjs', helper); setRule(s, 'no-console', rule); } },
  );
});

test('test 1073: T7, a pass recorded under the text of the change for a reviewer rule of a reviewer rule does not count for the text of --law-from, and the next line records one that does', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, '.lawcheck/rules/clear-errors.md', 'Anything goes.\n');
      append(r, 'src/core/tax.ts', '// taxed\n');
      const own = await runR(r, fake, ['--review', '--base', 'main']);
      assert.equal(own.code, 0, own.stdout);
      const plain = await runR(r, null, ['--base', 'main']);
      assert.equal(plain.code, 0, plain.stdout);
      const from = await runR(r, null, ['--base', 'main', '--law-from', 'main']);
      assert.deepEqual(findingLines(from.stdout).filter((line) => line.includes('[not-reviewed]')), ['src/core/tax.ts  error[not-reviewed]  clear-errors has no verdict for this content']);
      assert.ok(from.stdout.split('\n').includes('next: lawcheck check --review --base main --law-from main  (1 reviewer call)'), from.stdout);
      assert.equal(from.code, 1);
      const recorded = await runR(r, fake, ['--review', '--base', 'main', '--law-from', 'main']);
      assert.equal(recorded.code, 0, recorded.stdout);
      assert.ok(fake.requests.at(-1)!.prompt.includes(MAIN_RULE) && !fake.requests.at(-1)!.prompt.includes('Anything goes.'), 'the request carries the text of main');
      const both = await runR(r, null, ['--base', 'main', '--law-from', 'main']);
      assert.equal(both.code, 0, both.stdout);
    });
  });
});

test('test 1074: --law-from with a ref that names no commit, or a commit that holds no law, or a law that is not valid, stops with exit 2; with paths it is a usage error', async () => {
  await withSample(async (s) => {
    const none = await check(s, '--base', 'main', '--law-from', 'nope');
    assert.deepEqual(none.stdout.split('\n'), [
      'lawcheck: ERROR  1 error',
      '',
      "error[law-from-unreachable]  the ref 'nope' that --law-from names is no commit here",
      '  why:  a change judged by the law of a commit needs that law',
      '',
      'next: pass --law-from with a commit here that holds .lawcheck/law.yaml, such as the base of the change',
      '',
    ]);
    assert.equal(none.code, 2);
    const json = JSON.parse((await check(s, '--base', 'main', '--law-from', 'nope', '--json')).stdout);
    assert.deepEqual(json.errors.map((e: { code: string }) => e.code), ['law-from-unreachable']);

    git(s, 'branch', 'bare', git(s, 'commit-tree', git(s, 'hash-object', '-w', '-t', 'tree', '--stdin').trim(), '-m', 'empty').trim());
    const empty = await check(s, '--base', 'main', '--law-from', 'bare');
    assert.equal(empty.stdout.split('\n')[2], "error[law-from-unreachable]  the commit 'bare' that --law-from names holds no .lawcheck/law.yaml");
    assert.equal(empty.code, 2);

    git(s, 'checkout', '-q', '-b', 'broken', 'main');
    write(s, '.lawcheck/law.yaml', LAW.replace('rules: [no-console]', 'rules: [nope]'));
    git(s, 'commit', '-q', '-am', 'broken law');
    git(s, 'checkout', '-q', 'work');
    const invalid = await check(s, '--base', 'main', '--law-from', 'broken');
    assert.match(invalid.stdout, /^\.lawcheck\/law\.yaml:\d+  error\[law-invalid\]  .*, in the law of 'broken' that --law-from names$/m);
    assert.equal(invalid.code, 2);

    const paths = await lawcheck(s, ['check', 'src/core/price.ts', '--law-from', 'main']);
    assert.equal(paths.stdout.split('\n')[2], 'error[usage]  paths go with --json alone');
    assert.equal(paths.code, 2);
  });
});
