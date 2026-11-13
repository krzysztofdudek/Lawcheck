import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { check, LAW, NO_TODO, setRule, withSample, write } from './helpers.ts';

function law(s: string, text: string): void {
  write(s, '.lawcheck/law.yaml', text);
}

function replaceOnce(text: string, from: string, to: string): string {
  assert.ok(text.includes(from), `the law holds ${from}`);
  return text.replace(from, to);
}

test('test 15: a symlink and a binary file have no type; an unreadable file stops the run', async () => {
  await withSample(async (s) => {
    symlinkSync('price.ts', join(s, 'src/core/link.ts'));
    write(s, 'src/core/blob.ts', Buffer.concat([Buffer.from('console.log(1);\n'), Buffer.from([0]), Buffer.from('\n')]));
    const run = await check(s);
    assert.equal(run.stdout, 'lawcheck: PASS  1 changed file (against main)\n');
    assert.equal(run.code, 0);
  });
  if (process.getuid?.() === 0) return;
  await withSample(async (s) => {
    chmodSync(join(s, 'src/core/price.ts'), 0o000);
    try {
      const run = await check(s);
      assert.equal(run.code, 2);
      assert.match(run.stdout, /^src\/core\/price\.ts {2}error\[file-unreadable\]/m);
    } finally {
      chmodSync(join(s, 'src/core/price.ts'), 0o644);
    }
  });
});

test('test 16: types that overlap', async () => {
  await withSample(async (s) => {
    law(s, LAW + '  core:\n    paths: ["src/core/**"]\n');
    const run = await check(s);
    assert.equal(run.code, 2);
    const lines = run.stdout.split('\n').filter((line) => line.includes('error[type-overlap]'));
    assert.equal(lines.length, 2);
    assert.ok(lines[0]!.startsWith('src/core/price.ts  error[type-overlap]'));
    assert.ok(lines[1]!.startsWith('src/core/tax.ts  error[type-overlap]'));
    for (const line of lines) assert.ok(line.includes("'source'") && line.includes("'core'"), line);
  });
  await withSample(async (s) => {
    law(s, replaceOnce(LAW, '      command:\n', '      pricing:\n        paths: ["src/core/p*.ts"]\n      command:\n'));
    const run = await check(s);
    assert.equal(run.code, 2);
    const lines = run.stdout.split('\n').filter((line) => line.includes('error[type-overlap]'));
    assert.equal(lines.length, 1);
    assert.ok(lines[0]!.startsWith('src/core/price.ts  error[type-overlap]'));
    assert.ok(lines[0]!.includes("'library'") && lines[0]!.includes("'pricing'"));
  });
});

test('test 17: the statuss example', async () => {
  await withSample(async (s) => {
    law(s, replaceOnce(LAW, 'status: advisory', 'statuss: advisory'));
    const run = await check(s);
    assert.equal(
      run.stdout,
      [
        'lawcheck: ERROR  1 error',
        '',
        ".lawcheck/law.yaml:8  error[law-invalid]  unknown key 'statuss' in rule 'no-todo' (did you mean 'status'?)",
        '  why:  a misspelled key changes the law without a word',
        '',
        'next: fix .lawcheck/law.yaml, then run lawcheck check',
        '',
      ].join('\n'),
    );
    assert.equal(run.code, 2);
  });
});

test('test 18: each break of the law is law-invalid', async () => {
  const lastScriptRules = (text: string, to: string) => {
    const at = text.lastIndexOf('    rules: [no-todo]');
    return text.slice(0, at) + to + text.slice(at + '    rules: [no-todo]'.length);
  };
  const cases: [string, string][] = [
    ['may_use: [nope] on library', replaceOnce(LAW, '        rules: [no-console]\n', '        rules: [no-console]\n        may_use: [nope]\n')],
    ['rules: [no-such] on script', lastScriptRules(LAW, '    rules: [no-such]')],
    ['a second type library', LAW + '  library:\n    paths: ["lib/**"]\n'],
    ['a second type library in one mapping', replaceOnce(LAW, '      command:\n', '      library:\n        paths: ["lib/**"]\n      command:\n')],
    ['status: strict', replaceOnce(LAW, 'status: advisory', 'status: strict')],
    ['content: "("', replaceOnce(LAW, 'content: "^#!"', 'content: "("')],
    ['no lawcheck key', replaceOnce(LAW, 'lawcheck: 0.1.0\n', '')],
    ['paths as a string', replaceOnce(LAW, 'paths: ["src/**/*.ts", "!src/**/*.d.ts"]', 'paths: "src/**/*.ts"')],
    ['about with no value', replaceOnce(LAW, 'about: Everything that ships.', 'about:')],
    ['a rule style/no-tabs', replaceOnce(LAW, 'rules:\n', 'rules:\n  style/no-tabs:\n    why: Tabs.\n')],
    ['pattern src/**core/*.ts', replaceOnce(LAW, '"src/**/*.ts", "!', '"src/**core/*.ts", "!')],
    ['pattern src/core/', replaceOnce(LAW, '"src/**/*.ts", "!', '"src/core/", "!')],
    ['pattern ../src/**', replaceOnce(LAW, '"src/**/*.ts", "!', '"../src/**", "!')],
    ['pattern src/{core,{cli,io}}/**', replaceOnce(LAW, '"src/**/*.ts", "!', '"src/{core,{cli,io}}/**", "!')],
  ];
  for (const [name, text] of cases) {
    await withSample(async (s) => {
      law(s, text);
      const run = await check(s);
      assert.equal(run.code, 2, name);
      assert.match(run.stdout, /error\[law-invalid\]/, name);
      assert.doesNotMatch(run.stdout, /error\[(?!law-invalid)/, name);
    });
  }
});

test('test 19: two problems, two lines', async () => {
  await withSample(async (s) => {
    let text = replaceOnce(LAW, 'status: advisory', 'statuss: advisory');
    text = replaceOnce(text, '        rules: [no-console]\n', '        rules: [no-console]\n        may_use: [nope]\n');
    law(s, text);
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: ERROR  2 errors');
    const lines = run.stdout.split('\n').filter((line) => line.includes('error[law-invalid]'));
    assert.equal(lines.length, 2);
    assert.ok(lines[0]!.startsWith('.lawcheck/law.yaml:8  error[law-invalid]'));
    assert.ok(lines[1]!.startsWith('.lawcheck/law.yaml:20  error[law-invalid]'));
    assert.equal(run.code, 2);
  });
});

test('test 20: rule files', async () => {
  await withSample(async (s) => {
    unlinkSync(join(s, '.lawcheck/rules/no-todo.mjs'));
    const run = await check(s);
    assert.match(run.stdout, /^\.lawcheck\/law\.yaml:6 {2}error\[rule-missing-file\]/m);
    assert.equal(run.code, 2);
  });
  await withSample(async (s) => {
    setRule(s, 'extra', NO_TODO);
    const run = await check(s);
    assert.match(run.stdout, /^\.lawcheck\/rules\/extra\.mjs {2}error\[rule-file-without-entry\]/m);
    assert.equal(run.code, 2);
  });
  await withSample(async (s) => {
    write(s, '.lawcheck/rules/lib/util.mjs', 'export const x = 1;\n');
    const run = await check(s);
    assert.equal(run.code, 0, run.stdout);
  });
  await withSample(async (s) => {
    write(s, '.lawcheck/rules/.no-todo.mjs.swp', 'swap\n');
    write(s, '.gitignore', '*.swp\n');
    const run = await check(s);
    assert.equal(run.code, 0, run.stdout);
  });
  await withSample(async (s) => {
    write(s, '.lawcheck/law.yaml', LAW.replace('types:\n', '  spare:\n    why: Nothing lists it.\n\ntypes:\n'));
    setRule(s, 'spare', "throw new Error('spare');\n");
    const run = await check(s);
    assert.equal(run.code, 0, run.stdout);
  });
});

test('section 6: a law that cannot be read is law-invalid', async () => {
  if (process.getuid?.() === 0) return;
  await withSample(async (s) => {
    chmodSync(join(s, '.lawcheck/law.yaml'), 0o000);
    try {
      const run = await check(s);
      assert.equal(run.code, 2);
      assert.match(run.stdout, /^\.lawcheck\/law\.yaml:1 {2}error\[law-invalid\] {2}the law cannot be read \(EACCES\)$/m);
      assert.match(run.stdout, /^next: fix \.lawcheck\/law\.yaml, then run lawcheck check$/m);
    } finally {
      chmodSync(join(s, '.lawcheck/law.yaml'), 0o644);
    }
  });
});
