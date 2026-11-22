import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { append, check, E, E_PATH, LAW, lawcheck, read, setRule, withR, withSample, withU, write } from './helpers.ts';

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
    assert.equal(run.stdout.split('\n')[2], `${PREFIX}edits .lawcheck/law.yaml without changing a rule or a type; adds a waiver of no-console in src/core/shipping.ts`);
    assert.equal(run.code, 0);
    const json = JSON.parse((await check(s, '--base', 'main', '--json')).stdout);
    assert.deepEqual(json.scope.law_changes, ['edits .lawcheck/law.yaml without changing a rule or a type', 'adds a waiver of no-console in src/core/shipping.ts']);
  });
  await withSample(
    async (s) => {
      append(s, '.lawcheck/law.yaml', '# a note\n');
      append(s, 'src/core/shipping.ts', '// more\n');
      const run = await check(s);
      assert.ok(!run.stdout.includes('adds a waiver'), 'a waiver that was already there is no addition');
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
    assert.ok(run.stdout.split('\n').includes(`${PREFIX}edits .lawcheck/law.yaml without changing a rule or a type; adds a waiver of forbidden-use in ${E_PATH}`), run.stdout);
    assert.equal(run.code, 0);
    const json = JSON.parse((await check(u, '--base', 'main', '--json')).stdout);
    assert.deepEqual(json.scope.law_changes, ['edits .lawcheck/law.yaml without changing a rule or a type', `adds a waiver of forbidden-use in ${E_PATH}`]);
  });
});
