import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { append, atOnce, check, E, E_PATH, findingLines, git, LAW, lawcheck, read, run as runR, setRule, withR, withSample, withU, write } from './helpers.ts';
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

test('test 1372: S7-3, a may_use or waivers change that lets a type use or waive more says so, and one that cannot keeps the plain words', async () => {
  const LIBRARY = '        rules: [no-console]\n';
  const SOURCE = '    rules: [no-todo]\n    types:';
  const cases: [string, string, string, string, string][] = [
    ['a type added to the list', LIBRARY, `${LIBRARY}        may_use: [library]\n`, `${LIBRARY}        may_use: [library, script]\n`, 'widens may_use of the type library by script'],
    ['one type added and one taken off', LIBRARY, `${LIBRARY}        may_use: [library]\n`, `${LIBRARY}        may_use: [script]\n`, 'widens may_use of the type library by script'],
    ['the only list removed', LIBRARY, `${LIBRARY}        may_use: []\n`, LIBRARY, 'widens may_use of the type library to any file'],
    ['a type taken off the list', LIBRARY, `${LIBRARY}        may_use: [library, script]\n`, `${LIBRARY}        may_use: [library]\n`, 'changes may_use of the type library'],
    ['a list where none was', LIBRARY, LIBRARY, `${LIBRARY}        may_use: [library]\n`, 'changes may_use of the type library'],
    ['a type under one the list already names', LIBRARY, `${LIBRARY}        may_use: [source]\n`, `${LIBRARY}        may_use: [source, command]\n`, 'changes may_use of the type library'],
    ['waivers read again', LIBRARY, `${LIBRARY}        waivers: false\n`, LIBRARY, 'reads waivers in the type library'],
    ['waivers: true where they were read already', LIBRARY, LIBRARY, `${LIBRARY}        waivers: true\n`, 'changes the waivers of the type library'],
  ];
  for (const [name, from, before, after, item] of cases) {
    await withSample(
      async (s) => {
        edit(s, before, after);
        const json = await check(s, '--base', 'main', '--json');
        assert.deepEqual(JSON.parse(json.stdout).scope.law_changes, [item], name);
      },
      from === before ? {} : { onMain: (s) => edit(s, from, before) },
    );
  }
  const inherited = (own: string) => LAW.replace(SOURCE, `    rules: [no-todo]\n    may_use: [source, script]\n    types:`).replace(LIBRARY, `${LIBRARY}${own}`);
  await withSample(
    async (s) => {
      write(s, '.lawcheck/law.yaml', inherited(''));
      const json = await check(s, '--base', 'main', '--json');
      assert.deepEqual(JSON.parse(json.stdout).scope.law_changes, ['widens may_use of the type library by source, script'], 'a type that drops its own list takes the wider one above it');
    },
    { onMain: (s) => write(s, '.lawcheck/law.yaml', inherited('        may_use: [library]\n')) },
  );
  const COMMAND = '      command:\n        about: The command layer.\n        paths: ["src/cli/**"]\n';
  const listed = (list: string, top: boolean) => {
    const law = LAW.replace(LIBRARY, `${LIBRARY}        may_use: ${list}\n`);
    return top ? `${law.replace(COMMAND, '').replace('"!src/**/*.d.ts"]', '"!src/**/*.d.ts", "!src/cli/**"]')}  command:\n    about: The command layer.\n    paths: ["src/cli/**"]\n` : law;
  };
  for (const [name, list] of [['the list narrowed to a type that moved from under one it named', '[command]'], ['a type that moved from under one the list names, added to it', '[source, command]']] as const) {
    await withSample(
      async (s) => {
        write(s, '.lawcheck/law.yaml', listed(list, true));
        const json = await check(s, '--base', 'main', '--json');
        assert.deepEqual(JSON.parse(json.stdout).scope.law_changes, ['moves the type command from source to the top of types', 'changes may_use of the type library', 'changes the paths of the type source'], name);
      },
      { onMain: (s) => write(s, '.lawcheck/law.yaml', listed('[source]', false)) },
    );
  }
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

    git(s, 'checkout', '-q', '-b', 'linked', 'main');
    write(s, 'target', '../../tools/release.mjs');
    const link = git(s, 'hash-object', '-w', 'target').trim();
    rmSync(join(s, 'target'));
    git(s, 'update-index', '--cacheinfo', `120000,${link},.lawcheck/rules/no-console.mjs`);
    git(s, 'commit', '-q', '-m', 'a rule through a link');
    git(s, 'checkout', '-q', '-f', 'work');
    for (const change of ['nothing changed', 'a file for the rule']) {
      if (change === 'a file for the rule') write(s, 'src/core/total.ts', "export const total = 1;\nconsole.log(total);\n");
      const linked = await check(s, '--base', 'main', '--law-from', 'linked');
      assert.equal(linked.stdout.split('\n')[2], ".lawcheck/law.yaml:4  error[rule-missing-file]  the rule 'no-console' has neither .lawcheck/rules/no-console.mjs nor .lawcheck/rules/no-console.md as a file: .lawcheck/rules/no-console.mjs is a symbolic link, and Lawcheck reads no rule through one, in the law of 'linked' that --law-from names", change);
      assert.equal(linked.code, 2, change);
    }
    rmSync(join(s, 'src/core/total.ts'));

    const paths = await lawcheck(s, ['check', 'src/core/price.ts', '--law-from', 'main']);
    assert.equal(paths.stdout.split('\n')[2], 'error[usage]  paths go with --json alone');
    assert.equal(paths.code, 2);
  });
});

test('test 1110: T7, under --law-from a commit in which git lists a file in .lawcheck/node_modules or .lawcheck/.local stops with law-from-packages, and the same commit without those files fails by the rule of the base', async () => {
  const rule = "import { CALL } from 'callpkg';\nexport function check({ files }) {\n  return files.flatMap((file) => file.lines.flatMap((text, index) => (CALL.test(text) ? [{ file: file.path, line: index + 1, message: 'writes to the terminal' }] : [])));\n}\n";
  const callpkg = (s: string, folder: string, call: string) => {
    write(s, `${folder}/callpkg/package.json`, '{ "name": "callpkg", "type": "module", "exports": "./index.js" }\n');
    write(s, `${folder}/callpkg/index.js`, `export const CALL = ${call};\n`);
  };
  // Each folder has its own sample, so the two run at once.
  const folders = [['.lawcheck/node_modules', '.lawcheck/node_modules'], ['.lawcheck/.local', '.lawcheck/.local/node_modules']] as const;
  await atOnce([...folders], folders.length, ([top]) => top, ([top, folder]) =>
    withSample(
      async (s) => {
        write(s, 'src/core/total.ts', "export const total = 1;\nconsole.log(total);\n");
        callpkg(s, folder, '/a^/');
        git(s, 'add', '-A');
        git(s, 'add', '-f', folder);
        git(s, 'commit', '-q', '-m', 'plant');
        const wanted = [
          'lawcheck: ERROR  1 error',
          '',
          `${folder}/callpkg/index.js  error[law-from-packages]  git lists this file in ${top}, and 1 more file there, and a package that a rule of 'main' imports cannot come from the change`,
          '  why:  a change judged by the law of a commit cannot supply the code that law runs',
          '',
          `next: take ${top} out of git, such as with git rm -r --cached ${top}, and name it in .gitignore`,
          '',
        ];
        const planted = await check(s, '--base', 'main', '--law-from', 'main');
        assert.deepEqual(planted.stdout.split('\n'), wanted, top);
        assert.equal(planted.code, 2, top);
        assert.deepEqual(readdirSync(join(s, '.lawcheck')).filter((name) => name === '.local').flatMap(() => readdirSync(join(s, '.lawcheck/.local'))).filter((name) => name.startsWith('law-from-')), [], top);
        const json = JSON.parse((await check(s, '--base', 'main', '--law-from', 'main', '--json')).stdout);
        assert.deepEqual(json.errors.map((e: { code: string; file: string }) => [e.code, e.file]), [['law-from-packages', `${folder}/callpkg/index.js`]], top);
        callpkg(s, folder, '/nothing/');
        git(s, 'commit', '-q', '-am', 'change the plant');
        assert.equal((await check(s, '--base', 'main', '--law-from', 'main')).stdout, wanted.join('\n'), `a changed file in ${top}`);
        git(s, 'rm', '-r', '-q', folder);
        git(s, 'commit', '-q', '-m', 'without the plant');
        const clean = await check(s, '--base', 'main', '--law-from', 'main');
        assert.deepEqual(findingLines(clean.stdout), ['src/core/total.ts:2  error[no-console]  writes to the terminal'], top);
        assert.equal(clean.code, 1, top);
        assert.deepEqual(readdirSync(join(s, '.lawcheck')).filter((name) => name === '.local').flatMap(() => readdirSync(join(s, '.lawcheck/.local'))).filter((name) => name.startsWith('law-from-')), [], top);
      },
      { onMain: (s) => { write(s, '.git/info/exclude', 'node_modules/\n'); callpkg(s, 'node_modules', '/\\bconsole\\.(\\w+)/'); setRule(s, 'no-console', rule); } },
    ),
  );
});

test('test 1160: T7, under --law-from a package.json of the change, .lawcheck/package.json or the root one, cannot change what an import of a rule of the base resolves to, by the name and exports of its package or by its # imports', async () => {
  const rule = (from: string) => `import { CALL } from '${from}';\nexport function check({ files }) {\n  return files.flatMap((file) => file.lines.flatMap((text, index) => (CALL.test(text) ? [{ file: file.path, line: index + 1, message: 'writes to the terminal' }] : [])));\n}\n`;
  const callpkg = (s: string) => {
    write(s, '.git/info/exclude', 'node_modules/\n');
    write(s, 'node_modules/callpkg/package.json', '{ "name": "callpkg", "type": "module", "exports": "./index.js" }\n');
    write(s, 'node_modules/callpkg/index.js', 'export const CALL = /\\bconsole\\.(\\w+)/;\n');
  };
  const fake = 'export const CALL = /a^/;\n';
  const cases: { name: string; base: (s: string) => void; plant: (s: string) => void }[] = [
    {
      name: 'the name and exports of .lawcheck/package.json',
      base: (s) => { callpkg(s); setRule(s, 'no-console', rule('callpkg')); },
      plant: (s) => { write(s, '.lawcheck/package.json', '{ "name": "callpkg", "exports": "./fake.mjs" }\n'); write(s, '.lawcheck/fake.mjs', fake); },
    },
    {
      name: 'exports of .lawcheck/package.json into the rule of the change',
      base: (s) => { callpkg(s); setRule(s, 'no-console', rule('callpkg')); },
      plant: (s) => { write(s, '.lawcheck/package.json', '{ "name": "callpkg", "exports": "./rules/no-console.mjs" }\n'); setRule(s, 'no-console', `${fake}export function check() {\n  return [];\n}\n`); },
    },
    {
      name: 'the name and exports of the root package.json',
      base: (s) => { callpkg(s); setRule(s, 'no-console', rule('callpkg')); },
      plant: (s) => { write(s, 'package.json', '{ "name": "callpkg", "exports": "./.lawcheck/fake.mjs" }\n'); write(s, '.lawcheck/fake.mjs', fake); },
    },
    {
      name: 'the # imports of .lawcheck/package.json',
      base: (s) => { write(s, '.lawcheck/package.json', '{ "imports": { "#call": "./rules/lib/call.mjs" } }\n'); write(s, '.lawcheck/rules/lib/call.mjs', 'export const CALL = /\\bconsole\\.(\\w+)/;\n'); setRule(s, 'no-console', rule('#call')); },
      plant: (s) => { write(s, '.lawcheck/package.json', '{ "imports": { "#call": "./fake.mjs" } }\n'); write(s, '.lawcheck/fake.mjs', fake); },
    },
    {
      name: 'the # imports of the root package.json',
      base: (s) => { callpkg(s); write(s, 'package.json', '{ "private": true, "imports": { "#call": "callpkg" } }\n'); setRule(s, 'no-console', rule('#call')); },
      plant: (s) => { write(s, 'package.json', '{ "private": true, "imports": { "#call": "./.lawcheck/fake.mjs" } }\n'); write(s, '.lawcheck/fake.mjs', fake); },
    },
  ];
  for (const { name, base, plant } of cases) {
    await withSample(
      async (s) => {
        write(s, 'src/core/total.ts', "export const total = 1;\nconsole.log(total);\n");
        plant(s);
        git(s, 'add', '-A');
        git(s, 'commit', '-q', '-m', 'plant');
        const run = await check(s, '--base', 'main', '--law-from', 'main');
        assert.deepEqual(findingLines(run.stdout), ['src/core/total.ts:2  error[no-console]  writes to the terminal'], `${name}: ${run.stdout}`);
        assert.equal(run.code, 1, name);
        noCopyLeft(s);
      },
      { onMain: base },
    );
  }
});

test('test 1112: T7, under --law-from a folder that a file system which ignores case finds as .lawcheck/node_modules or .lawcheck/.local, in another case or with a long s, stops with law-from-packages, named as git lists it, and its next line clears it', async () => {
  for (const folder of ['.lawcheck/Node_Moduleſ', '.lawcheck/.Local']) {
    await withSample(async (s) => {
      write(s, `${folder}/callpkg/index.js`, 'export const CALL = /a^/;\n');
      git(s, 'add', '-f', folder);
      git(s, 'commit', '-q', '-m', 'plant');
      const planted = await check(s, '--base', 'main', '--law-from', 'main');
      assert.deepEqual(planted.stdout.split('\n'), [
        'lawcheck: ERROR  1 error',
        '',
        `${folder}/callpkg/index.js  error[law-from-packages]  git lists this file in ${folder}, and a package that a rule of 'main' imports cannot come from the change`,
        '  why:  a change judged by the law of a commit cannot supply the code that law runs',
        '',
        `next: take ${folder} out of git, such as with git rm -r --cached ${folder}, and name it in .gitignore`,
        '',
      ], folder);
      assert.equal(planted.code, 2, folder);
      git(s, 'rm', '-r', '-q', '--cached', folder);
      append(s, '.gitignore', `\n${folder}/\n`);
      git(s, 'add', '.gitignore');
      git(s, 'commit', '-q', '-m', 'ignore the plant');
      const cleared = await check(s, '--base', 'main', '--law-from', 'main');
      assert.ok(!cleared.stdout.includes('law-from-packages'), `${folder}: ${cleared.stdout}`);
      assert.equal(cleared.code, 0, `${folder}: ${cleared.stdout}`);
    });
  }
});

test('test 1180: T7, under --law-from a rule of the base whose import leads outside .lawcheck/rules/, by the project\'s own name, a # import or a relative path, stops with rule-crashed naming the rule, the module and the import as the base holds them, and its next line lets the base\'s rule run', async () => {
  const rule = (from: string) => `import { CALL } from '${from}';\nexport function check({ files }) {\n  return files.flatMap((file) => file.lines.flatMap((text, index) => (CALL.test(text) ? [{ file: file.path, line: index + 1, message: 'writes to the terminal' }] : [])));\n}\n`;
  const calls = (s: string, path: string) => write(s, path, 'export const CALL = /\\bconsole\\.(\\w+)/;\n');
  const ruleFile = '.lawcheck/rules/no-console.mjs';
  const cases: { name: string; base: (s: string) => void; module: string; specifier: string; target: string; fix: (s: string) => void }[] = [
    {
      name: 'the exports of the project\'s own name',
      base: (s) => { write(s, 'package.json', '{ "name": "app", "private": true, "exports": { "./calls": "./lib/calls.mjs" } }\n'); calls(s, 'lib/calls.mjs'); setRule(s, 'no-console', rule('app/calls')); },
      module: ruleFile,
      specifier: 'app/calls',
      target: 'lib/calls.mjs',
      fix: (s) => { calls(s, '.lawcheck/rules/lib/calls.mjs'); setRule(s, 'no-console', rule('./lib/calls.mjs')); },
    },
    {
      name: 'a # import of the root package.json, in a helper',
      base: (s) => { write(s, 'package.json', '{ "private": true, "imports": { "#calls": "./lib/calls.mjs" } }\n'); calls(s, 'lib/calls.mjs'); write(s, '.lawcheck/rules/lib/load.mjs', "export { CALL } from '#calls';\n"); setRule(s, 'no-console', rule('./lib/load.mjs')); },
      module: '.lawcheck/rules/lib/load.mjs',
      specifier: '#calls',
      target: 'lib/calls.mjs',
      fix: (s) => { calls(s, '.lawcheck/rules/lib/calls.mjs'); write(s, '.lawcheck/rules/lib/load.mjs', "export { CALL } from './calls.mjs';\n"); },
    },
    {
      name: 'a # import of .lawcheck/package.json',
      base: (s) => { write(s, '.lawcheck/package.json', '{ "imports": { "#calls": "./calls.mjs" } }\n'); calls(s, '.lawcheck/calls.mjs'); setRule(s, 'no-console', rule('#calls')); },
      module: ruleFile,
      specifier: '#calls',
      target: '.lawcheck/calls.mjs',
      fix: (s) => { calls(s, '.lawcheck/rules/lib/calls.mjs'); setRule(s, 'no-console', rule('./lib/calls.mjs')); },
    },
    {
      name: 'a relative path',
      base: (s) => { calls(s, 'lib/calls.mjs'); setRule(s, 'no-console', rule('../../lib/calls.mjs')); },
      module: ruleFile,
      specifier: '../../lib/calls.mjs',
      target: 'lib/calls.mjs',
      fix: (s) => { calls(s, '.lawcheck/rules/lib/calls.mjs'); setRule(s, 'no-console', rule('./lib/calls.mjs')); },
    },
  ];
  // Each case has its own sample in its own folder, so the cases and the control run at once.
  const withCase = ({ name, base, module, specifier, target, fix }: (typeof cases)[number]) =>
    withSample(
      async (s) => {
        write(s, 'src/core/total.ts', 'export const total = 1;\nconsole.log(total);\n');
        git(s, 'add', '-A');
        git(s, 'commit', '-q', '-m', 'change');
        const own = await check(s, '--base', 'main');
        assert.deepEqual(findingLines(own.stdout), ['src/core/total.ts:2  error[no-console]  writes to the terminal'], `${name}, by the law of the change: ${own.stdout}`);
        const stopped = await check(s, '--base', 'main', '--law-from', 'main');
        assert.deepEqual(stopped.stdout.split('\n'), [
          'lawcheck: ERROR  1 error',
          '',
          `${ruleFile}  error[rule-crashed]  fails to load: ${module} of 'main' imports '${specifier}', which leads to ${target}, outside .lawcheck/rules/, and under --law-from a rule of 'main' loads only the files of .lawcheck/rules/ of 'main'`,
          '  why:  a broken rule says nothing about the code',
          '',
          `next: on 'main', copy what ${module} needs of ${target} into .lawcheck/rules/lib/ and import it from there by a relative path, then run lawcheck check --base main --law-from main`,
          '',
        ], name);
        assert.equal(stopped.code, 2, name);
        noCopyLeft(s);
        git(s, 'checkout', '-q', 'main');
        fix(s);
        git(s, 'add', '-A');
        git(s, 'commit', '-q', '-m', 'the rule imports from .lawcheck/rules/');
        git(s, 'checkout', '-q', 'work');
        const ran = await check(s, '--base', 'main', '--law-from', 'main');
        assert.deepEqual(findingLines(ran.stdout), ['src/core/total.ts:2  error[no-console]  writes to the terminal'], `${name}, after the next line: ${ran.stdout}`);
        assert.equal(ran.code, 1, name);
      },
      { onMain: base },
    );
  const control = () => withSample(
    async (s) => {
      write(s, 'src/core/total.ts', 'export const total = 1;\nconsole.log(total);\n');
      git(s, 'add', '-A');
      git(s, 'commit', '-q', '-m', 'change');
      const stopped = await check(s, '--base', 'main', '--law-from', 'main');
      assert.deepEqual(stopped.stdout.split('\n'), [
        'lawcheck: ERROR  1 error',
        '',
        `${ruleFile}  error[rule-crashed]  fails to load: Cannot find package 'nopkg' imported from ${ruleFile}`,
        '  why:  a broken rule says nothing about the code',
        '',
        `next: fix ${ruleFile} on 'main', then run lawcheck check --base main --law-from main`,
        '',
      ]);
      assert.equal(stopped.code, 2);
      noCopyLeft(s);
    },
    { onMain: (s) => setRule(s, 'no-console', rule('nopkg')) },
  );
  const parts: [name: string, run: () => Promise<void>][] = [...cases.map((one): [string, () => Promise<void>] => [one.name, () => withCase(one)]), ['a package that is not there', control]];
  await atOnce(parts, parts.length, ([name]) => name, ([, run]) => run());
});

test('test 1181: T7, under --law-from a folder that HFS+ finds as .lawcheck/node_modules or .lawcheck/.local because it ignores a code point of the name, such as U+200C or U+FEFF, stops with law-from-packages, named as git lists it', async () => {
  const cases = [
    { folder: '.lawcheck/node_‌modules', said: '.lawcheck/node_‌modules' },
    { folder: '.lawcheck‍/node_modules', said: '.lawcheck‍/node_modules' },
    { folder: '.lawcheck/.﻿Local', said: '.lawcheck/.\\ufeffLocal' },
    { folder: '.lawcheck/node‮_modules⁯', said: '.lawcheck/node\\u202e_modules\\u206f' },
  ];
  for (const { folder, said } of cases) {
    await withSample(async (s) => {
      write(s, `${folder}/callpkg/index.js`, 'export const CALL = /a^/;\n');
      git(s, 'add', '-f', folder);
      git(s, 'commit', '-q', '-m', 'plant');
      const planted = await check(s, '--base', 'main', '--law-from', 'main');
      assert.deepEqual(planted.stdout.split('\n'), [
        'lawcheck: ERROR  1 error',
        '',
        `${said}/callpkg/index.js  error[law-from-packages]  git lists this file in ${said}, and a package that a rule of 'main' imports cannot come from the change`,
        '  why:  a change judged by the law of a commit cannot supply the code that law runs',
        '',
        `next: take ${said} out of git, such as with git rm -r --cached ${said}, and name it in .gitignore`,
        '',
      ], said);
      assert.equal(planted.code, 2, said);
    });
  }
});
