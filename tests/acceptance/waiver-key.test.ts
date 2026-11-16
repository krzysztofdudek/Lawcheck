import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, LAW, lawcheck, withSample, write } from './helpers.ts';

const finding = (place: string) => `${place}  error[no-console]  writes to the terminal with console.log`;

const DOCS_LAW = (waivers: string) => `${LAW}  docs:\n    paths: ["docs/**/*.md"]\n${waivers}    rules: [no-todo]\n`;

test('T6: a type with waivers: false reads a waiver marker in its files as text', async () => {
  await withSample(async (s) => {
    write(s, '.lawcheck/law.yaml', DOCS_LAW('    waivers: false\n'));
    write(s, 'docs/waivers.md', 'The form is `lawcheck-waive <rule id> -- <reason>`.\nA TODO line // lawcheck-waive no-todo -- quoted here\n');
    const run = await check(s);
    assert.deepEqual([run.code, run.stdout], [0, 'lawcheck: PASS  1 warning in 2 changed files (against main)\nnote: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code\nnote: this change edits the law that judges it: adds the type docs\n\ndocs/waivers.md:2  warning[no-todo]  TODO without an issue number\n  why:  A TODO without an issue number gets forgotten.\n']);
  });
});

test('T6: the same file in a type that reads waivers gets waiver-unknown-rule (control)', async () => {
  await withSample(async (s) => {
    write(s, '.lawcheck/law.yaml', DOCS_LAW(''));
    write(s, 'docs/waivers.md', 'The form is `lawcheck-waive <rule id> -- <reason>`.\nA TODO line // lawcheck-waive no-todo -- quoted here\n');
    const run = await check(s);
    assert.equal(run.code, 1);
    assert.ok(run.stdout.includes("docs/waivers.md:1  error[waiver-unknown-rule]  the waiver names '<rule', which is no rule of the law"), run.stdout);
  });
});

test('T6: waivers takes true or false, and a subtype takes its parent\'s value', async () => {
  await withSample(async (s) => {
    write(s, '.lawcheck/law.yaml', DOCS_LAW('    waivers: "no"\n'));
    const run = await check(s);
    assert.equal(run.code, 2);
    assert.match(run.stdout, /\.lawcheck\/law\.yaml:\d+  error\[law-invalid\]  'waivers' of type 'docs' takes true or false, not a string/);
    write(s, '.lawcheck/law.yaml', LAW.replace('  source:\n    about: Everything that ships.\n', '  source:\n    about: Everything that ships.\n    waivers: false\n'));
    write(s, 'src/core/w.ts', "console.log(1); // lawcheck-waive no-console -- reads nothing\n");
    const off = await check(s);
    assert.equal(off.code, 1);
    assert.ok(off.stdout.split('\n').includes(finding('src/core/w.ts:1')), off.stdout);
    const explained = await lawcheck(s, ['explain', '--type', 'library']);
    assert.ok(explained.stdout.includes('  waivers:  not read; a waiver marker in its files is text\n'), explained.stdout);
    const asJson = JSON.parse((await lawcheck(s, ['explain', '--type', 'library', '--json'])).stdout);
    assert.equal(asJson.waivers, false);
    const script = JSON.parse((await lawcheck(s, ['explain', '--type', 'script', '--json'])).stdout);
    assert.equal(script.waivers, true);
  });
});

