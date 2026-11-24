import { test } from 'node:test';
import { exampleText } from '../harness/examples.ts';
import assert from 'node:assert/strict';
import { readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withFake } from './fake-reviewer.ts';
import { F, F_PATH, F_PRIME, inTemp, lawcheck, lawcheckAt, newRepository, PRICING, read, REVIEWER_CONFIG, ROOT, run, setRule, withCopy, withR, withSample, withU, write } from './helpers.ts';

const PRICE = exampleText('explain-price');
const RELEASE = exampleText('explain-release');
const BUILD = exampleText('explain-build');
const REFUND = exampleText('explain-refund');
const SRC = exampleText('explain-src');
const TYPE_SOURCE = exampleText('explain-type-source');
const RULE_NO_TODO = exampleText('explain-rule-no-todo');

async function explain(cwd: string, ...args: string[]) {
  return lawcheck(cwd, ['explain', ...args]);
}

async function same(cwd: string, args: string[], expected: string): Promise<void> {
  const result = await explain(cwd, ...args);
  assert.equal(result.stdout, expected, args.join(' '));
  assert.equal(result.code, 0, args.join(' '));
}

test('test 105: explain a file, from a subdirectory, with content, and one that does not exist', async () => {
  await withSample(async (s) => {
    await same(s, ['src/core/price.ts'], PRICE);
    await same(join(s, 'src/core'), ['price.ts'], PRICE);
    await same(s, ['tools/release.mjs'], RELEASE);
    await same(s, ['tools/build.mjs'], BUILD);
  });
});

test('test 106: files with no type, and a new file of a type', async () => {
  await withSample(async (s) => {
    await same(s, ['README.md'], "README.md\n  type:  none: no type's paths match it, so no rule judges it\n");
    await same(s, ['src/core/api.d.ts'], "src/core/api.d.ts  (does not exist yet)\n  type:  none: no type's paths match it, so no rule judges it\n");
    const known = PRICE.split('\n').slice(1, 7).join('\n');
    await same(s, ['src/core/new.ts'], `src/core/new.ts  (does not exist yet)\n${known}\n`);
    write(s, 'tools/plain.mjs', 'console.log(1);\n');
    await same(s, ['tools/plain.mjs'], 'tools/plain.mjs\n  type:  none: it matches the paths of script but not their content, so no rule judges it\n');
  });
});

test('test 107: ignored, symbolic links and binary files', async () => {
  await withSample(async (s) => {
    write(s, '.gitignore', 'src/core/gen*.ts\n');
    write(s, 'src/core/gen.ts', 'export const x = 1;\n');
    await same(s, ['src/core/gen.ts'], 'src/core/gen.ts\n  type:  none: git ignores it, so Lawcheck never sees it\n');
    await same(s, ['src/core/gen2.ts'], 'src/core/gen2.ts  (does not exist yet)\n  type:  none: git ignores this path, so Lawcheck would never see it\n');
    symlinkSync('price.ts', join(s, 'src/core/link.ts'));
    await same(s, ['src/core/link.ts'], 'src/core/link.ts\n  type:  none: it is a symbolic link, which has no type\n');
    symlinkSync('core', join(s, 'src/coresym'));
    await same(s, ['src/coresym/price.ts'], 'src/coresym/price.ts\n  type:  none: it lies behind a symbolic link, which has no type\n');
    await same(s, ['src/coresym/new.ts'], 'src/coresym/new.ts  (does not exist yet)\n  type:  none: it lies behind a symbolic link, which has no type\n');
    write(s, 'src/core/blob.ts', Buffer.from([0x78, 0x00]));
    await same(s, ['src/core/blob.ts'], 'src/core/blob.ts\n  type:  none: it is binary, which has no type\n');
  });
});

test('test 108: an overlap is the answer for its file, and stops a directory', async () => {
  await withSample(
    async (s) => {
      const price = await explain(s, 'src/core/price.ts');
      assert.equal(price.stdout.split('\n')[1], '  type:  none: it matches library and pricing at one level (type-overlap); check stops with exit 2 until a ! pattern in one of them leaves it out');
      assert.equal(price.code, 0);
      const tax = await explain(s, 'src/core/tax.ts');
      assert.equal(tax.stdout.split('\n')[1], '  type:  library  (source > library)  Code the commands call.');
      assert.equal(tax.code, 0);
      const src = await explain(s, 'src');
      assert.match(src.stdout, /^src\/core\/price\.ts {2}error\[type-overlap\]/m);
      assert.equal(src.code, 2);
    },
    { onMain: (s) => write(s, '.lawcheck/law.yaml', PRICING(read(s, '.lawcheck/law.yaml'))) },
  );
});

test('test 109: a subtype whose content does not match, and the alternatives of a new file', async () => {
  const entry = (law: string) =>
    law.replace('        paths: ["src/cli/**"]\n', '        paths: ["src/cli/**"]\n        types:\n          entry:\n            about: Entry points.\n            paths: ["src/cli/**"]\n            content: "^#!"\n');
  await withSample(
    async (s) => {
      const main = await explain(s, 'src/cli/main.ts');
      assert.equal(main.stdout.split('\n')[2], '  matched:  source by "src/**/*.ts", command by "src/cli/**", not entry: content "^#!" does not match');
      assert.equal(main.code, 0);
      const json = await explain(s, 'src/cli/main.ts', '--json');
      assert.deepEqual(JSON.parse(json.stdout).not_matched, [{ type: 'entry', content: '^#!' }]);
      const fresh = await explain(s, 'src/cli/run.ts');
      assert.equal(
        fresh.stdout,
        [
          'src/cli/run.ts  (does not exist yet)',
          '  type:  command  (source > command)  The command layer.',
          '  matched:  source by "src/**/*.ts", command by "src/cli/**"',
          '  then:  entry if its text matches "^#!"; otherwise command',
          '  may use:  any file; no type on the way up has may_use',
          '  rules:',
          '    no-todo  script  advisory  from source  A TODO without an issue number gets forgotten.',
          '',
        ].join('\n'),
      );
      assert.equal(fresh.code, 0);
    },
    { onMain: (s) => write(s, '.lawcheck/law.yaml', entry(read(s, '.lawcheck/law.yaml'))) },
  );
});

test('test 110: the list in force and the reader', async () => {
  await withU(async (u) => {
    const price = (await explain(u, 'src/core/price.ts')).stdout.split('\n');
    assert.deepEqual(price.slice(3, 5), ['  may use:  library  (from source)', '  uses:  read as typescript']);
    const main = await explain(u, 'src/cli/main.ts');
    assert.deepEqual(main.stdout.split('\n').slice(3, 5), ['  may use:  command, library', '  uses:  read as typescript']);
    assert.equal(main.code, 0);
  });
  await withU(
    async (u) => {
      const price = await explain(u, 'src/core/price.ts');
      assert.equal(price.stdout.split('\n')[3], '  may use:  nothing  (from source)');
      assert.equal(price.code, 0);
    },
    { onMain: (u) => write(u, '.lawcheck/law.yaml', read(u, '.lawcheck/law.yaml').replace('    may_use: [library]\n', '    may_use: []\n')) },
  );
});

test('commands-slice §6: explain: the pattern that matched, a rule listed twice, and a file with no reader under a list', async () => {
  const law = (text: string) =>
    text
      .replace('    paths: ["src/**/*.ts", "!src/**/*.d.ts"]\n    rules: [no-todo]\n', '    paths: ["src/**/*.ts", "src/**/*.md", "!src/**/*.d.ts"]\n    rules: [no-todo]\n    may_use: [source]\n')
      .replace('        rules: [no-console]\n', '        rules: [no-console, no-todo]\n');
  await withSample(
    async (s) => {
      write(s, 'src/core/notes.md', '# Notes\n');
      await same(
        s,
        ['src/core/notes.md'],
        [
          'src/core/notes.md',
          '  type:  library  (source > library)  Code the commands call.',
          '  matched:  source by "src/**/*.md", library by "src/core/**"',
          '  may use:  source  (from source)',
          '  uses:  not read: Lawcheck has no reader for this file',
          '  rules:',
          '    no-todo  script  advisory  from source  A TODO without an issue number gets forgotten.',
          '    no-console  script  enforced  from library  Only the command layer writes to the terminal.',
          '  waivers:  none',
          '',
        ].join('\n'),
      );
    },
    { onMain: (s) => write(s, '.lawcheck/law.yaml', law(read(s, '.lawcheck/law.yaml'))) },
  );
});

test('test 111: the state of each review, and no request', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      await same(r, [F_PATH], REFUND);
      await run(r, fake, ['--review', '--base', 'main']);
      await same(r, [F_PATH], REFUND.replace('not reviewed', 'failed earlier'));
      assert.equal(fake.requests.length, 1);
    });
    await withR(async (r) => {
      write(r, F_PATH, F_PRIME);
      await run(r, fake, ['--review', '--base', 'main']);
      const result = await explain(r, F_PATH);
      assert.match(result.stdout, /^ {4}clear-errors {2}reviewer {2}enforced {2}from library {2}reviewed {2}/m);
      assert.equal(result.code, 0);
      assert.equal(fake.requests.length, 2);
    });
    await withR(
      async (r) => {
        write(r, F_PATH, F);
        const result = await explain(r, F_PATH);
        assert.match(result.stdout, /^ {4}clear-errors {2}reviewer {2}enforced {2}from library {2}too large to review {2}/m);
        assert.equal(result.code, 0);
      },
      { onMain: (r) => write(r, '.lawcheck/config.yaml', REVIEWER_CONFIG + '  max_chars: 100\n') },
    );
    assert.equal(fake.requests.length, 2);
  });
});

test('test 112: a directory, the root, a type and a rule', async () => {
  await withSample(async (s) => {
    await same(s, ['src'], SRC);
    await same(s, ['.'], './  8 files\n  library  2 files\n  command  1 file\n  script  1 file\n  no type  4 files\n');
    await same(s, ['--type', 'source'], TYPE_SOURCE);
    await same(s, ['--rule', 'no-todo'], RULE_NO_TODO);
  });
  await withR(async (r) => {
    const result = await explain(r, '--rule', 'clear-errors');
    const lines = result.stdout.split('\n');
    assert.equal(lines[3], '  context:  docs/errors.md');
    assert.equal(lines[2], '  file:  .lawcheck/rules/clear-errors.md');
    assert.ok(lines.includes('  binds:  2 files; 0 have a verdict for their content'));
    assert.equal(result.code, 0);
  });
});

test('test 113: usage', async () => {
  await withSample(async (s) => {
    for (const args of [[], ['a', 'b'], ['--type', 'nope'], ['--rule', 'no-tod'], ['--type', 'source', '--rule', 'no-todo'], ['../outside'], ['--type']]) {
      const result = await explain(s, ...args);
      assert.match(result.stdout, /^error\[usage\]/m, args.join(' '));
      assert.equal(result.code, 2, args.join(' '));
      if (args[1] === 'no-tod') assert.match(result.stdout, /'no-todo'/);
    }
  });
});

test('test 114: JSON', async () => {
  await withSample(async (s) => {
    const price = await explain(s, 'src/core/price.ts', '--json');
    assert.deepEqual(JSON.parse(price.stdout), {
      schema: 'lawcheck-explain/0',
      subject: 'file',
      path: 'src/core/price.ts',
      exists: true,
      type: 'library',
      chain: ['source', 'library'],
      about: 'Code the commands call.',
      none: null,
      matched: [
        { type: 'source', pattern: 'src/**/*.ts', content: null },
        { type: 'library', pattern: 'src/core/**', content: null },
      ],
      not_matched: [],
      then: null,
      may_use: null,
      uses: null,
      rules: [
        { id: 'no-todo', kind: 'script', status: 'advisory', why: 'A TODO without an issue number gets forgotten.', from: 'source', review: null },
        { id: 'no-console', kind: 'script', status: 'enforced', why: 'Only the command layer writes to the terminal.', from: 'library', review: null },
      ],
      waivers: [],
    });
    const readme = await explain(s, 'README.md', '--json');
    assert.deepEqual(JSON.parse(readme.stdout), {
      schema: 'lawcheck-explain/0',
      subject: 'file',
      path: 'README.md',
      exists: true,
      type: null,
      chain: [],
      about: null,
      none: "no type's paths match it, so no rule judges it",
      matched: [],
      not_matched: [],
      then: null,
      may_use: null,
      uses: null,
      rules: [],
      waivers: [],
    });
    const src = await explain(s, 'src', '--json');
    assert.deepEqual(JSON.parse(src.stdout), {
      schema: 'lawcheck-explain/0',
      subject: 'directory',
      path: 'src/',
      files: 3,
      types: [
        { type: 'library', files: 2 },
        { type: 'command', files: 1 },
      ],
    });
    for (const result of [price, readme, src]) assert.equal(result.code, 0);
  });
});

test('test 115: explain and prime run no rule and send no request', async () => {
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        write(r, F_PATH, F);
        for (const args of [['explain', F_PATH], ['explain', '--rule', 'clear-errors'], ['prime']]) {
          const result = await lawcheck(r, args, { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
          assert.equal(result.code, 0, args.join(' '));
        }
        assert.equal(fake.requests.length, 0);
      },
      { onMain: (r) => setRule(r, 'no-console', "throw new Error('broken at load');\n") },
    );
  });
});

const RUN_TS = 'const note = "eval(x)"; // eval(y)\neval(note);\n';

test('test 951: explain --tree prints the named nodes of a file with their field, line and the text of a node with no named node below, and --json gives every node with its parent', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n', 'src/run.ts': RUN_TS });
    const expected = [
      'src/run.ts  typescript  20 nodes, 12 named',
      '  program  line 1',
      '    lexical_declaration  line 1',
      '      variable_declarator  line 1',
      '        name: identifier  line 1  "note"',
      '        value: string  line 1',
      '          string_fragment  line 1  "eval(x)"',
      '    comment  line 1  "// eval(y)"',
      '    expression_statement  line 2',
      '      call_expression  line 2',
      '        function: identifier  line 2  "eval"',
      '        arguments: arguments  line 2',
      '          identifier  line 2  "note"',
      '',
    ].join('\n');
    await same(repo, ['src/run.ts', '--tree'], expected);
    await same(join(repo, 'src'), ['run.ts', '--tree'], expected);
    write(repo, 'src/scratch.ts', RUN_TS);
    await same(repo, ['src/scratch.ts', '--tree'], expected.replace('src/run.ts', 'src/scratch.ts'));
    const json = await explain(repo, 'src/run.ts', '--tree', '--json');
    assert.equal(json.code, 0);
    const document = JSON.parse(json.stdout);
    assert.deepEqual({ ...document, nodes: document.nodes.slice(0, 3) }, {
      schema: 'lawcheck-explain/0',
      subject: 'tree',
      path: 'src/run.ts',
      language: 'typescript',
      absent: null,
      nodes: [
        { type: 'program', named: true, field: null, start: 0, end: RUN_TS.length, line: 1, column: 0, parent: null },
        { type: 'lexical_declaration', named: true, field: null, start: 0, end: 23, line: 1, column: 0, parent: 0 },
        { type: 'const', named: false, field: 'kind', start: 0, end: 5, line: 1, column: 0, parent: 1 },
      ],
    });
    assert.equal(document.nodes.length, 20);
    const call = document.nodes.findIndex((node: any) => node.type === 'call_expression');
    assert.deepEqual(document.nodes.filter((node: any) => node.parent === call).map((node: any) => [node.field, node.type, RUN_TS.slice(node.start, node.end)]), [['function', 'identifier', 'eval'], ['arguments', 'arguments', '(note)']]);
  });
});

test('test 952: explain --tree of a file with no tree prints why, as tree() gives it, and a path that is no text file is a usage error', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, {
      '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n',
      'src/run.ts': RUN_TS,
      'src/notes.md': '# Notes\n',
      'src/big.ts': `// ${'x'.repeat(512 * 1024)}\n`,
    });
    write(repo, 'src/logo.ts', new Uint8Array([0, 1, 2, 3]));
    symlinkSync('run.ts', join(repo, 'src', 'link.ts'));
    const absent = async (cli: string | null, path: string, line: string, language: string | null, reason: string) => {
      const args = ['explain', path, '--tree'];
      const text = cli === null ? await lawcheck(repo, args) : await lawcheckAt(cli, repo, args);
      assert.deepEqual([text.code, text.stdout], [0, line + '\n'], path);
      const json = cli === null ? await lawcheck(repo, [...args, '--json']) : await lawcheckAt(cli, repo, [...args, '--json']);
      assert.deepEqual([json.code, JSON.parse(json.stdout)], [0, { schema: 'lawcheck-explain/0', subject: 'tree', path, language, absent: reason, nodes: null }], path);
    };
    await absent(null, 'src/notes.md', 'src/notes.md  no tree: no-reader, no reader reads the language of this file, or a Vue or Svelte file has no script block', null, 'no-reader');
    await absent(null, 'src/big.ts', 'src/big.ts  typescript  no tree: too-large, the parsed text holds more than 512 KiB', 'typescript', 'too-large');
    await withCopy(async (copy) => {
      writeFileSync(join(copy.dir, 'dist', 'grammars', 'tree-sitter-typescript.wasm'), 'x');
      await absent(copy.cli, 'src/run.ts', 'src/run.ts  typescript  no tree: reader-failed, Lawcheck could not load the grammar of typescript, or the parser failed on the file', 'typescript', 'reader-failed');
    });
    for (const [args, message] of [
      [['--tree'], 'explain --tree takes the path of one file'],
      [['--tree', '--type', 'source'], 'explain --tree takes the path of one file'],
      [['src', '--tree'], "explain --tree takes a file, and 'src' is a folder"],
      [['src/gone.ts', '--tree'], "the file 'src/gone.ts' does not exist, so it has no tree"],
      [['src/link.ts', '--tree'], "'src/link.ts' is a symbolic link, and a rule never judges one, so it has no tree"],
      [['src/logo.ts', '--tree'], "'src/logo.ts' is binary, and a rule never judges a binary file, so it has no tree"],
    ] as const) {
      const result = await explain(repo, ...args);
      assert.equal(result.code, 2, args.join(' '));
      assert.equal(result.stdout.split('\n')[2], `error[usage]  ${message}`, args.join(' '));
    }
  });
});

test('test 953: explain --tree stops at a depth and a count of lines and says what it left out, and --json gives every node of a tree thousands of nodes deep and of a file just under 512 KiB', async () => {
  await inTemp(async (dir) => {
    const statement = (i: number) => `export const a${i} = f(${i}, [1, 2]);\n`;
    let wide = '';
    let statements = 0;
    while (wide.length + statement(statements).length <= 512 * 1024) wide += statement(statements++);
    const repo = newRepository(dir, {
      '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n',
      'src/deep.ts': `export const a = ${'['.repeat(14)}1${']'.repeat(14)};\n`,
      'src/long.ts': Array.from({ length: 300 }, (_, i) => `export const a${i} = ${i};\n`).join(''),
      'src/sum.ts': `export const s = ${Array.from({ length: 5000 }, () => '1').join(' + ')};\n`,
      'src/wide.ts': wide,
    });
    const deep = await explain(repo, 'src/deep.ts', '--tree');
    assert.equal(deep.code, 0);
    const lines = deep.stdout.slice(0, -1).split('\n');
    assert.equal(lines.at(-1), `${' '.repeat(24)}array  line 1  ... 7 named nodes below`);
    assert.equal(Math.max(...lines.slice(1).map((line) => line.length - line.trimStart().length)), 24);
    const long = await explain(repo, 'src/long.ts', '--tree');
    const longLines = long.stdout.slice(0, -1).split('\n');
    assert.equal(longLines[0], 'src/long.ts  typescript  2701 nodes, 1501 named');
    assert.equal(longLines.length, 202);
    assert.equal(longLines.at(-1), '  ... 1301 more named nodes; --json gives every node');
    const json = await explain(repo, 'src/sum.ts', '--tree', '--json');
    assert.equal(json.code, 0, json.stdout.slice(0, 500));
    const nodes = JSON.parse(json.stdout).nodes;
    assert.equal(nodes.filter((node: any) => node.type === 'binary_expression').length, 4999);
    assert.ok(nodes.every((node: any, at: number) => (at === 0 ? node.parent === null : node.parent < at)));
    const sum = await explain(repo, 'src/sum.ts', '--tree');
    assert.equal(sum.code, 0);
    assert.ok(sum.stdout.split('\n').length <= 203, sum.stdout.slice(0, 500));
    const all = await explain(repo, 'src/wide.ts', '--tree', '--json');
    assert.equal(all.code, 0, all.stdout.slice(0, 500));
    assert.equal(JSON.parse(all.stdout).nodes.length, 1 + 21 * statements);
  });
});

test('test 954: explain --tree answers with exit 0 under a broken law, which every other explain refuses with exit 2, as the exit-code table of docs/commands.md says', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': 'lawcheck: 0.1.0\nnot a law: [\n', 'src/run.ts': RUN_TS });
    const tree = await explain(repo, 'src/run.ts', '--tree');
    assert.equal(tree.code, 0, tree.stdout);
    assert.match(tree.stdout, /^src\/run\.ts {2}typescript /);
    for (const args of [['src/run.ts'], ['--type', 'source'], ['--rule', 'no-todo']]) assert.equal((await explain(repo, ...args)).code, 2, args.join(' '));
    const table = readFileSync(join(ROOT, 'docs', 'commands.md'), 'utf8').split('### Exit codes of explain')[1]!.split('\n## ')[0]!;
    assert.match(table, /^\| 2 \| no answer: the law is broken \(`--tree` reads no law, so it answers under a broken law\), /m);
  });
});
