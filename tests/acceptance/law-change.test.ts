import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { append, check, LAW, lawcheck, read, setRule, withSample, write } from './helpers.ts';

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
  });
});
