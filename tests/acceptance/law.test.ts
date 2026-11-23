import { test } from 'node:test';
import { platformSkip } from '../harness/tool.ts';
import assert from 'node:assert/strict';
import { chmodSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { check, LAW, lawcheck, NO_TODO, setRule, withSample, write } from './helpers.ts';

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
  if (platformSkip('an unreadable file') !== null) return;
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

test('check-slice §6: a law that cannot be read is law-invalid', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
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

const REQUIRED = LAW.replace('rules:\n', 'required: ["src/**", "tools/**"]\n\nrules:\n');
const IGNORED = (patterns: string) => REQUIRED.replace('rules:\n', `ignored: [${patterns}]\n\nrules:\n`);
const HELPER = 'export const help = 1;\n';
const UNTYPED_WHY = '  why:  a file that no type takes is judged by no rule, so a folder under required may hold none';

test('test 830: a file an agent adds under required that no type takes fails check with untyped-file, and the same file under ignored passes', async () => {
  await withSample(
    async (s) => {
      write(s, 'src/gen/helpers.js', HELPER);
      const run = await check(s);
      assert.equal(
        run.stdout,
        [
          'lawcheck: FAIL  1 error in 1 changed file (against main)',
          '',
          'src/gen/helpers.js  error[untyped-file]  the file lies under required (src/**) and no type of the law takes it',
          UNTYPED_WHY,
          '',
          "next: give src/gen/helpers.js a type: move it where a type's paths take it, or add a type for it to .lawcheck/law.yaml",
          '',
        ].join('\n'),
      );
      assert.equal(run.code, 1);
      const json = await check(s, '--base', 'main', '--json');
      const document = JSON.parse(json.stdout);
      assert.deepEqual(document.findings, [
        { code: 'untyped-file', rule: null, severity: 'error', blocking: true, debt: false, file: 'src/gen/helpers.js', type: '', message: 'the file lies under required (src/**) and no type of the law takes it', why: UNTYPED_WHY.slice('  why:  '.length) },
      ]);
      assert.equal(json.code, 1);
      const named = await lawcheck(s, ['check', 'src/gen/helpers.js']);
      assert.equal(named.stdout.split('\n')[0], 'lawcheck: FAIL  1 error in 1 named file');
      assert.equal(named.code, 1);
    },
    { onMain: (m) => write(m, '.lawcheck/law.yaml', REQUIRED) },
  );
  await withSample(
    async (s) => {
      write(s, 'src/gen/helpers.js', HELPER);
      const run = await check(s);
      assert.equal(run.stdout, 'lawcheck: PASS  1 changed file (against main)\n');
      assert.equal(run.code, 0);
    },
    { onMain: (m) => write(m, '.lawcheck/law.yaml', IGNORED('"src/gen/**"')) },
  );
  await withSample(async (s) => {
    write(s, 'src/gen/helpers.js', HELPER);
    const run = await check(s);
    assert.equal(run.stdout, 'lawcheck: PASS  1 changed file (against main)\n', 'the control: without required the file passes in silence, as before');
    assert.equal(run.code, 0);
  });
});

test('test 831: untyped-file in debt, a binary file, a file a type takes by path and not by content, a typed file under ignored, and what explain and prime say', async () => {
  await withSample(
    async (s) => {
      const full = await check(s, '--full', '--base', 'main');
      assert.deepEqual(
        full.stdout.split('\n').filter((line) => line.includes('[untyped-file]')),
        ['src/gen/helpers.js  warning[untyped-file]  the file lies under required (src/**) and no type of the law takes it', 'tools/notes.mjs  warning[untyped-file]  the file lies under required (tools/**) and no type of the law takes it'],
      );
      assert.ok(!full.stdout.includes('src/gen/logo.png'));
      assert.ok(!full.stdout.includes('src/core/price.ts'), 'the file under ignored is judged by no rule');
      assert.equal(full.code, 0);
      const strict = await check(s, '--strict', '--base', 'main');
      assert.ok(strict.stdout.includes('src/gen/helpers.js  error[untyped-file]'), strict.stdout);
      assert.equal(strict.code, 1);
      const helper = await lawcheck(s, ['explain', 'src/gen/helpers.js']);
      assert.equal(helper.stdout, "src/gen/helpers.js\n  type:  none: no type's paths match it, so no rule judges it; it lies under required (src/**), so check reports it as untyped-file\n");
      const notes = await lawcheck(s, ['explain', 'tools/notes.mjs']);
      assert.equal(notes.stdout, 'tools/notes.mjs\n  type:  none: it matches the paths of script but not their content, so no rule judges it; it lies under required (tools/**), so check reports it as untyped-file\n');
      const price = await lawcheck(s, ['explain', 'src/core/price.ts']);
      assert.equal(price.stdout, 'src/core/price.ts\n  type:  none: it lies under ignored (src/core/price.ts), which the law leaves out\n');
      const absent = await lawcheck(s, ['explain', 'src/gen/next.js']);
      assert.equal(absent.stdout, "src/gen/next.js  (does not exist yet)\n  type:  none: no type's paths match it, so no rule judges it; it lies under required (src/**), so check reports it as untyped-file\n");
      const prime = await lawcheck(s, ['prime']);
      assert.ok(prime.stdout.includes('\nThe law here: 4 types, 2 rules\nEvery file under src/**, tools/** needs a type; a file with none is untyped-file\nLeft out of the law: src/core/price.ts\n'), prime.stdout);
      assert.ok(prime.stdout.includes('\n- adding a pattern to ignored, or taking one from required\n'), prime.stdout);
    },
    {
      onMain: (m) => {
        write(m, '.lawcheck/law.yaml', IGNORED('"src/core/price.ts"'));
        write(m, 'src/gen/helpers.js', HELPER);
        write(m, 'src/gen/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
        write(m, 'tools/notes.mjs', "console.log('no shebang');\n");
      },
    },
  );
  await withSample(async (s) => {
    write(s, '.lawcheck/law.yaml', IGNORED('"src/gen/**"'));
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[2], 'note: this change edits the law that judges it: changes required; changes ignored');
    assert.equal(run.code, 0);
  });
});
