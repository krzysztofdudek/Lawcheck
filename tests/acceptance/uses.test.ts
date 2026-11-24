import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  append,
  check,
  E,
  E_PATH,
  findingLines,
  inTemp,
  lawcheck,
  lawcheckAt,
  newRepository,
  NOTHING_CHANGED,
  U_LAW,
  withCopy,
  withSample,
  withU,
  write,
} from './helpers.ts';

const WHY = "  why:  a type's may_use names every type its files may use";

const REPORT_LINE = 'src/core/report.ts:2  error[forbidden-use]  library may not use command (src/cli/main.ts); it takes may_use [library] from source';

const TEST81 = ['lawcheck: FAIL  1 error in 1 changed file (against main)', '', REPORT_LINE, WHY, '', 'next: fix src/core/report.ts:2', ''].join('\n');

const TEST82 = {
  schema: 'lawcheck-check/0',
  result: 'fail',
  scope: { mode: 'change', base: 'main', files: 1, law_changed: false },
  summary: { errors: 1, warnings: 0, debt: 0, waivers: 0, unresolved: 0 },
  findings: [
    {
      code: 'forbidden-use', rule: null, severity: 'error', blocking: true, debt: false,
      file: 'src/core/report.ts', line: 2, type: 'library',
      message: 'library may not use command (src/cli/main.ts); it takes may_use [library] from source',
      why: "a type's may_use names every type its files may use",
    },
  ],
  waivers: [],
  unresolved: [],
  reviews: { missing: 0, calls_made: 0, passes_recorded: 0 },
  next: { command: null, text: 'fix src/core/report.ts:2' },
};

const SLICE_ONE_DEBT = [
  'src/core/price.ts:2  warning[no-console]  writes to the terminal with console.log',
  'src/core/tax.ts:1  warning[no-todo]  TODO without an issue number',
  'tools/release.mjs:2  warning[no-todo]  TODO without an issue number',
];

function replaceOnce(text: string, from: string, to: string): string {
  assert.equal(text.split(from).length, 2, from);
  return text.replace(from, to);
}

function lawOnMain(text: string) {
  return { onMain: (u: string) => write(u, '.lawcheck/law.yaml', text) };
}

test('test 80: U with nothing changed, then --full', async () => {
  await withU(async (u) => {
    const plain = await check(u);
    assert.equal(plain.stdout, NOTHING_CHANGED);
    assert.equal(plain.code, 0);
    const full = await check(u, '--full', '--base', 'main');
    const lines = full.stdout.split('\n');
    assert.equal(lines[0], 'lawcheck: PASS  nothing changed against main');
    assert.ok(lines.includes('debt (outside this change): 3 findings in 3 files'), full.stdout);
    assert.deepEqual(findingLines(full.stdout), SLICE_ONE_DEBT);
    assert.doesNotMatch(full.stdout, /forbidden-use/);
    assert.equal(full.code, 0);
  });
});

test('test 81: E uses a command from library code', async () => {
  await withU(async (u) => {
    write(u, E_PATH, E);
    const run = await check(u);
    assert.equal(run.stdout, TEST81);
    assert.equal(run.code, 1);
  });
});

test('test 82: the same with --json', async () => {
  await withU(async (u) => {
    write(u, E_PATH, E);
    const run = await check(u, '--base', 'main', '--json');
    assert.deepEqual(JSON.parse(run.stdout), TEST82);
    assert.equal(JSON.stringify(JSON.parse(run.stdout)), JSON.stringify(TEST82), 'the keys keep the order of docs/json.md');
    assert.equal(run.code, 1);
  });
});

test('test 83: a forbidden use outside the change is debt', async () => {
  await withU(
    async (u) => {
      append(u, 'src/core/tax.ts', '// end\n');
      const test7 = [
        'lawcheck: PASS  1 warning in 1 changed file (against main)',
        '',
        'src/core/tax.ts:1  warning[no-todo]  TODO without an issue number',
        '  why:  A TODO without an issue number gets forgotten.',
        '',
      ].join('\n');
      const plain = await check(u);
      assert.equal(plain.stdout, test7);
      assert.equal(plain.code, 0);
      const full = await check(u, '--full', '--base', 'main');
      assert.equal(
        full.stdout,
        test7 +
          [
            '',
            'debt (outside this change): 3 findings in 3 files',
            'src/core/price.ts:2  warning[no-console]  writes to the terminal with console.log',
            '  why:  Only the command layer writes to the terminal.',
            'src/core/report.ts:2  warning[forbidden-use]  library may not use command (src/cli/main.ts); it takes may_use [library] from source',
            WHY,
            'tools/release.mjs:2  warning[no-todo]  TODO without an issue number',
            '',
          ].join('\n'),
      );
      assert.equal(full.code, 0);
    },
    { onMain: (u) => write(u, E_PATH, E) },
  );
});

test('test 84: a type may not use itself unless it names itself, and a subtype keeps its own list', async () => {
  await withU(async (u) => {
    write(u, 'src/util/format.ts', "import { rate } from '../core/tax.js';\nimport { shout } from './shout.js';\nexport const format = (n: number): string => shout(String(n * rate));\n");
    write(u, 'src/util/shout.ts', 'export const shout = (text: string): string => text.toUpperCase();\n');
    write(u, 'src/cli/flags.ts', "import { shout } from '../util/shout.js';\nexport const flag = shout('x');\n");
    write(u, 'tools/build.mjs', "#!/usr/bin/env node\nimport { price } from '../src/core/price.js';\nimport './release.mjs';\n");
    const run = await check(u);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: FAIL  3 errors in 4 changed files (against main)');
    assert.deepEqual(findingLines(run.stdout), [
      'src/cli/flags.ts:1  error[forbidden-use]  command may not use source (src/util/shout.ts); its may_use is [command, library]',
      'src/util/format.ts:2  error[forbidden-use]  source may not use source (src/util/shout.ts); its may_use is [library]',
      'tools/build.mjs:3  error[forbidden-use]  script may not use script (tools/release.mjs); its may_use is [source]',
    ]);
    assert.ok(run.stdout.endsWith('\nnext: fix src/cli/flags.ts:1\n'), run.stdout);
    assert.equal(run.code, 1);
  });
});

function addX(u: string): void {
  write(
    u,
    'src/core/extra.ts',
    [
      "import { readFileSync } from 'node:fs';",
      "import lodash from 'lodash';",
      "import { client } from './generated/client.js';",
      "import { helper } from '../../lib/helper.js';",
      "import logo from './logo.png';",
      "export * from '../cli/main.js';",
      "export type { Banner } from '../cli/banner.js';",
      'export const load = async (name: string) => import(name);',
      "export const later = async () => import('./price.js');",
      '',
    ].join('\n'),
  );
  write(u, 'lib/helper.ts', 'export const helper = 1;\n');
  write(u, 'src/cli/banner.ts', 'export type Banner = string;\n');
  write(u, 'src/core/logo.png', Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]));
  write(u, 'src/core/generated/client.js', 'export const client = 1;\n');
  write(u, '.gitignore', 'src/core/generated/\n');
  write(u, 'packages/ui/package.json', '{ "name": "@sample/ui", "main": "dist/index.js" }\n');
  write(u, 'src/core/view.ts', "import { button } from '@sample/ui';\nexport const view = button;\n");
}

test('test 85: untyped, binary, ignored and outside targets, and what is not read', async () => {
  await withU(async (u) => {
    addX(u);
    const run = await check(u);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: FAIL  3 errors in 7 changed files (against main), 2 unresolved uses');
    assert.deepEqual(findingLines(run.stdout), [
      'src/core/extra.ts:4  error[forbidden-use]  library may not use lib/helper.ts, which has no type; it takes may_use [library] from source',
      'src/core/extra.ts:6  error[forbidden-use]  library may not use command (src/cli/main.ts); it takes may_use [library] from source',
      'src/core/extra.ts:7  error[forbidden-use]  library may not use command (src/cli/banner.ts); it takes may_use [library] from source',
    ]);
    assert.ok(run.stdout.endsWith('\nnext: fix src/core/extra.ts:4\n'), run.stdout);
    assert.equal(run.code, 1);
    const json = await check(u, '--base', 'main', '--json');
    const document = JSON.parse(json.stdout);
    assert.equal(document.summary.unresolved, 2);
    assert.deepEqual(document.unresolved, [
      { file: 'src/core/extra.ts', line: 3, what: './generated/client.js', answer: 'none', reason: 'unfollowed', candidates: [], debt: false },
      { file: 'src/core/view.ts', line: 1, what: '@sample/ui', answer: 'none', reason: 'unfollowed', candidates: [], debt: false },
    ]);
    assert.equal(json.code, 1);
  });
  await withU(async (u) => {
    write(u, 'packages/ui/package.json', '{ "name": "@sample/ui", "main": "dist/index.js" }\n');
    write(u, 'src/core/view.ts', "import { button } from '@sample/ui';\nexport const view = button;\n");
    const run = await check(u);
    assert.equal(run.stdout, 'lawcheck: PASS  2 changed files (against main), 1 unresolved use\n');
    assert.equal(run.code, 0);
  });
});

test('test 86: a waiver of forbidden-use, unused, and of a code that cannot be waived', async () => {
  const lines = E.split('\n');
  await withU(async (u) => {
    write(u, E_PATH, [lines[0], "import '../cli/main.js'; // lawcheck-waive forbidden-use -- the report repeats the banner until 2.0", lines[2], ''].join('\n'));
    const run = await check(u);
    assert.equal(run.stdout, 'lawcheck: PASS  1 changed file (against main), 1 waiver\nnote: this change adds 1 waiver: forbidden-use at src/core/report.ts:2\n');
    assert.equal(run.code, 0);
    const json = await check(u, '--base', 'main', '--json');
    assert.deepEqual(JSON.parse(json.stdout).waivers, [
      { file: 'src/core/report.ts', line: 2, rule: 'forbidden-use', debt: false, waived: 1, reason: 'the report repeats the banner until 2.0', added: true },
    ]);
    assert.equal(json.code, 0);
  });
  await withU(async (u) => {
    write(u, E_PATH, '// lawcheck-waive forbidden-use -- price is library code\n' + E);
    const run = await check(u);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: FAIL  1 error, 1 warning in 1 changed file (against main), 1 waiver');
    const found = findingLines(run.stdout);
    assert.equal(found.length, 2, run.stdout);
    assert.ok(found[0]!.startsWith('src/core/report.ts:1  warning[waiver-unused]'), run.stdout);
    assert.ok(found[1]!.startsWith('src/core/report.ts:3  error[forbidden-use]'), run.stdout);
    assert.equal(run.code, 1);
  });
  await withU(async (u) => {
    write(u, E_PATH, [lines[0], lines[1] + ' // lawcheck-waive uses-not-read -- the banner', lines[2], ''].join('\n'));
    const run = await check(u);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: FAIL  2 errors in 1 changed file (against main)');
    const found = findingLines(run.stdout);
    assert.equal(found.length, 2, run.stdout);
    assert.ok(found[0]!.startsWith('src/core/report.ts:2  error[forbidden-use]'), run.stdout);
    assert.ok(found[1]!.startsWith('src/core/report.ts:2  error[waiver-unknown-rule]'), run.stdout);
    assert.equal(run.code, 1);
  });
});

test('test 87: may_use values and reserved ids are law-invalid', async () => {
  const last = '        paths: ["src/core/**"]\n        rules: [no-console]\n';
  const rule = '    status: advisory\n';
  const cases: [string, string, string][] = [
    ['may_use: [nope]', replaceOnce(U_LAW, last, last + '        may_use: [nope]\n'), '.lawcheck/law.yaml:21'],
    ['may_use: library', replaceOnce(U_LAW, last, last + '        may_use: library\n'), '.lawcheck/law.yaml:21'],
    ['may_use: with no value', replaceOnce(U_LAW, last, last + '        may_use:\n'), '.lawcheck/law.yaml:21'],
    ['may_use: [1]', replaceOnce(U_LAW, last, last + '        may_use: [1]\n'), '.lawcheck/law.yaml:21'],
    ['a rule forbidden-use', replaceOnce(U_LAW, rule, rule + '  forbidden-use:\n    why: x\n'), '.lawcheck/law.yaml:9'],
    ['a rule uses-not-read', replaceOnce(U_LAW, rule, rule + '  uses-not-read:\n    why: x\n'), '.lawcheck/law.yaml:9'],
    ['a rule parser-failed', replaceOnce(U_LAW, rule, rule + '  parser-failed:\n    why: x\n'), '.lawcheck/law.yaml:9'],
  ];
  for (const [name, text, place] of cases) {
    await withU(async (u) => {
      const run = await check(u);
      const errors = run.stdout.split('\n').filter((line) => /(^|  )error\[[a-z0-9-]+\]  /.test(line));
      assert.equal(errors.length, 1, `${name}\n${run.stdout}`);
      assert.ok(errors[0]!.startsWith(`${place}  error[law-invalid]  `), `${name}\n${run.stdout}`);
      assert.equal(run.code, 2, name);
    }, lawOnMain(text));
  }
});

test('test 89: no grammar is loaded where no list reaches, and only the grammars a run parses', async () => {
  await withCopy(async (copy) => {
    rmSync(join(copy.dir, 'dist', 'grammars'), { recursive: true, force: true });
    await withSample(async (s) => {
      write(s, E_PATH, E);
      const run = await lawcheckAt(copy.cli, s, ['check', '--base', 'main']);
      assert.equal(run.stdout, 'lawcheck: PASS  1 changed file (against main)\n');
      assert.equal(run.code, 0);
    });
  });
  await withCopy(async (copy) => {
    writeFileSync(join(copy.dir, 'dist', 'grammars', 'tree-sitter-ruby.wasm'), 'x');
    await withU(async (u) => {
      write(u, E_PATH, E);
      const run = await lawcheckAt(copy.cli, u, ['check', '--base', 'main']);
      assert.equal(run.stdout, TEST81);
      assert.equal(run.code, 1);
    });
  });
});

test('test 90: a grammar that cannot be loaded stops the run', async () => {
  for (const damage of ['one byte', 'removed']) {
    await withCopy(async (copy) => {
      const grammar = join(copy.dir, 'dist', 'grammars', 'tree-sitter-typescript.wasm');
      if (damage === 'one byte') writeFileSync(grammar, 'x');
      else rmSync(grammar);
      await withU(async (u) => {
        write(u, E_PATH, E);
        const run = await lawcheckAt(copy.cli, u, ['check', '--base', 'main']);
        const lines = run.stdout.split('\n');
        assert.equal(lines[0], 'lawcheck: ERROR  1 error', `${damage}\n${run.stdout}`);
        assert.ok(lines.some((line) => line.startsWith('error[parser-failed]  the grammar of typescript cannot be loaded: ')), `${damage}\n${run.stdout}`);
        assert.ok(run.stdout.endsWith('\nnext: reinstall Lawcheck; a grammar it ships cannot be loaded\n'), `${damage}\n${run.stdout}`);
        assert.equal(run.code, 2, damage);
      });
    });
  }
});

test('S8-7: a missing grammar is named by its file and folder, and no line sends the user to a build only Lawcheck\'s developers run', async () => {
  await withCopy(async (copy) => {
    rmSync(join(copy.dir, 'dist', 'grammars', 'tree-sitter-typescript.wasm'));
    await withU(async (u) => {
      write(u, E_PATH, E);
      const run = await lawcheckAt(copy.cli, u, ['check', '--base', 'main']);
      const said = run.stdout.split('\n').find((line) => line.startsWith('error[parser-failed]  '));
      assert.ok(said?.startsWith('error[parser-failed]  the grammar of typescript cannot be loaded: grammar tree-sitter-typescript.wasm not found in '), run.stdout);
      assert.ok(!/buildGrammars|build it/.test(run.stdout), run.stdout);
      assert.equal(run.code, 2);
      const doctor = await lawcheckAt(copy.cli, u, ['doctor']);
      const row = doctor.stdout.split('\n').find((line) => line.startsWith('fail  readers  '));
      assert.ok(row?.startsWith('fail  readers  the grammar of typescript cannot be loaded: grammar tree-sitter-typescript.wasm not found in '), doctor.stdout);
      assert.ok(!/buildGrammars|build it/.test(doctor.stdout), doctor.stdout);
      assert.ok(doctor.stdout.includes('\n  next: reinstall Lawcheck; a grammar it ships cannot be loaded\n'), doctor.stdout);
    });
  });
});

test('test 91: may_use: [] forbids every file, the own type included', async () => {
  await withU(
    async (u) => {
      write(u, E_PATH, E);
      const run = await check(u);
      assert.equal(run.stdout.split('\n')[0], 'lawcheck: FAIL  2 errors in 1 changed file (against main)');
      assert.deepEqual(findingLines(run.stdout), [
        'src/core/report.ts:1  error[forbidden-use]  library may not use library (src/core/price.ts); it takes may_use [] from source',
        'src/core/report.ts:2  error[forbidden-use]  library may not use command (src/cli/main.ts); it takes may_use [] from source',
      ]);
      assert.equal(run.code, 1);
    },
    lawOnMain(replaceOnce(U_LAW, '    may_use: [library]\n', '    may_use: []\n')),
  );
});


const ABSENT_LAW = 'lawcheck: 0.1.0\n\nrules:\n  absent:\n    why: The rule says what Lawcheck could not read.\n\ntypes:\n  code:\n    paths: ["src/**"]\n    rules: [absent]\n';

const ABSENT_RULE = `export async function check({ files: [file] }) {
  const tree = await file.tree();
  const uses = await file.uses();
  return [{ message: \`tree \${tree.absent ?? tree.root.type}, uses \${uses.absent ?? uses.uses.length}\` }];
}
`;

test('test 775: a file over the size limit, a language with no reader and a reader that fails give the rule a stated absence, never a crash of the run', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, {
      '.lawcheck/law.yaml': ABSENT_LAW,
      '.lawcheck/rules/absent.mjs': ABSENT_RULE,
      'src/big.ts': `// ${'x'.repeat(512 * 1024)}\n`,
      'src/notes.md': '# Notes\n',
      'src/a.ts': "import { b } from './b';\n",
      'src/b.ts': 'export const b = 1;\n',
    });
    const said = (run: { stdout: string; stderr: string; code: number | null }) => {
      assert.equal(run.stderr, '');
      assert.equal(run.code, 1, run.stdout);
      return JSON.parse(run.stdout).findings.map((f: any) => `${f.file}  ${f.message}`);
    };
    assert.deepEqual(said(await lawcheck(repo, ['check', '--json'])), [
      'src/a.ts  tree program, uses 1',
      'src/b.ts  tree program, uses 0',
      'src/big.ts  tree too-large, uses too-large',
      'src/notes.md  tree no-reader, uses no-reader',
    ]);
    await withCopy(async (copy) => {
      writeFileSync(join(copy.dir, 'dist', 'grammars', 'tree-sitter-typescript.wasm'), 'x');
      assert.deepEqual(said(await lawcheckAt(copy.cli, repo, ['check', '--json'])), [
        'src/a.ts  tree reader-failed, uses reader-failed',
        'src/b.ts  tree reader-failed, uses reader-failed',
        'src/big.ts  tree too-large, uses too-large',
        'src/notes.md  tree no-reader, uses no-reader',
      ]);
      const tried = await lawcheckAt(copy.cli, repo, ['try', 'absent', 'src/a.ts']);
      assert.deepEqual([tried.code, tried.stderr, tried.stdout.split('\n')[2]], [1, '', 'src/a.ts  error[absent]  tree reader-failed, uses reader-failed']);
    });
  });
});

test('T5: a may_use list brought in on old code that breaks it, as the adoption page says: the old use is debt, its waiver lets a change of the file pass, a new use still fails, and a waiver whose use is gone is waiver-unused', async () => {
  const OPEN = U_LAW.replace('    may_use: [library]\n    types:', '    types:');
  const [first, use, last] = E.split('\n');
  const WAIVED = [first, `${use} // lawcheck-waive forbidden-use -- the report prints the banner until 2.0`, last, ''].join('\n');
  await withU(
    async (u) => {
      write(u, '.lawcheck/law.yaml', U_LAW);
      const full = await check(u, '--full', '--base', 'main');
      assert.deepEqual(findingLines(full.stdout).filter((line) => line.includes('[forbidden-use]')), [REPORT_LINE.replace('error[', 'warning[')]);
      assert.equal(full.code, 0);
    },
    { onMain: (m) => (write(m, '.lawcheck/law.yaml', OPEN), write(m, E_PATH, E)) },
  );
  await withU(
    async (u) => {
      append(u, E_PATH, 'export const total = 2;\n');
      const kept = await check(u);
      assert.equal(kept.stdout, 'lawcheck: PASS  1 changed file (against main), 1 waiver\n');
      assert.equal(kept.code, 0);
      append(u, E_PATH, "import '../cli/main.js';\n");
      const added = await check(u);
      assert.deepEqual(findingLines(added.stdout), [REPORT_LINE.replace(':2 ', ':5 ')]);
      assert.equal(added.code, 1);
      write(u, E_PATH, [first, '// lawcheck-waive forbidden-use -- the report prints the banner until 2.0', last, ''].join('\n'));
      const paid = await check(u);
      assert.deepEqual(findingLines(paid.stdout), ["src/core/report.ts:2  warning[waiver-unused]  the waiver of 'forbidden-use' drops no finding"]);
      assert.equal(paid.code, 0);
    },
    { onMain: (m) => write(m, E_PATH, WAIVED) },
  );
});
