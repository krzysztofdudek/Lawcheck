import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GRAMMARS, ownLine, readerOf, readUses, ruleReads, RUNES, siblingsOf, Unreadable } from '../../dist/readers.js';

type Hint = { kind: 'path'; specifier: string } | { kind: 'symbol'; symbolKey: string };
type Kind =
  | { kind: 'resolved'; owner: string; resolvedFile: string }
  | { kind: 'ambiguous'; candidates?: string[] }
  | { kind: 'absent'; reason?: string; resolvedFile?: string };

interface FakeOptions {
  uses?: Record<string, { line: number; candidates: Hint[] }[]>;
  classifyUse?: (candidates: Hint[], from: string) => Kind;
  failGrammar?: string;
  failUses?: string;
  failDeclarations?: string;
  failProject?: boolean;
  failAssemble?: string;
  failClassify?: string;
  failParse?: string;
}

function fake(options: FakeOptions) {
  const record = { loaded: [] as string[], parsed: [] as string[], declared: [] as string[], classified: [] as string[], project: 0 };
  const runes = {
    ...RUNES,
    createHost: () => ({
      getParser: async (extension: string) => {
        if (extension === options.failGrammar) throw new Error(`cannot load ${extension}\nsecond line`);
        record.loaded.push(extension);
        return {};
      },
      withParsedFile: async (path: string, _content: string, fn: (tree: unknown) => unknown) => {
        if (path === options.failParse) throw new Error('parse broke');
        record.parsed.push(path);
        return fn({});
      },
      newParser: () => ({}),
    }),
    extractorForLanguage: (language: string) => ({
      languages: new Set([language]),
      rev: 1,
      declarations: (file: { path: string }) => {
        if (file.path === options.failDeclarations) throw new Error('declarations broke');
        record.declared.push(file.path);
        return [];
      },
      uses: (file: { path: string }) => {
        if (file.path === options.failUses) throw new Error('uses broke\nmore');
        return options.uses?.[file.path] ?? [];
      },
    }),
    extractCsharpRefs: (file: { path: string }) => ({ fileNs: '', scope: { globalPrefixes: [], globalAliases: new Map(), globalStatics: [] }, refs: [], fileLocalTypes: [], path: file.path }),
    assembleCsharpCandidates: (extract: { path: string }) => {
      if (extract.path === options.failAssemble) throw new Error('assembly broke');
      return options.uses?.[extract.path] ?? [];
    },
    buildCsharpProjectScopes: () => {
      record.project++;
      if (options.failProject) throw new Error('scopes broke');
      return new Map();
    },
    buildCsharpReachability: () => ({}),
    makeResolver: () => ({
      classifyUse: (candidates: Hint[], from: string) => {
        if (from === options.failClassify) throw new Error('classify broke');
        record.classified.push(`${from} ${candidates.map((hint) => (hint.kind === 'path' ? hint.specifier : hint.symbolKey)).join(' ')}`);
        return options.classifyUse ? options.classifyUse(candidates, from) : { kind: 'absent' };
      },
    }),
    makeResolvePathToFile: () => () => undefined,
  };
  return { runes: runes as any, record };
}

const enc = new TextEncoder();

function input(files: Record<string, string>, read: string[], extra: Partial<Parameters<typeof readUses>[0]> = {}) {
  const paths = Object.keys(files).sort();
  const siblings = siblingsOf(paths);
  return {
    root: '/nowhere',
    files: paths,
    bytes: (path: string) => {
      if (files[path] === undefined) throw new Unreadable(path, 'ENOENT');
      return enc.encode(files[path]);
    },
    ownerOf: (path: string) => (files[path] === undefined ? undefined : 'owner'),
    read: read.map((path) => {
      const reader = readerOf(path, files[path]!, siblings);
      assert.ok(reader.reader, path);
      return { path, view: reader.view };
    }),
    ...extra,
  };
}

test('dependency-slice §3.2: which files have a reader', () => {
  const siblings = siblingsOf(['a/x.ts', 'a/y.json', 'b/c.vue', 'b/d.svelte', 'c/e.h', 'c/f.cpp', 'g/h.h']);
  assert.deepEqual(readerOf('a/x.ts', 'x', siblings), { reader: true, view: { language: 'typescript', parsePath: 'a/x.ts', content: 'x' } });
  assert.deepEqual(readerOf('a/y.json', '{}', siblings), { reader: false });
  assert.deepEqual(readerOf('a/z.yaml', 'a: 1', siblings), { reader: false });
  assert.deepEqual(readerOf('a/Makefile', 'all:', siblings), { reader: false });
  assert.deepEqual(readerOf('b/c.vue', '<template></template>', siblings), { reader: true, view: null });
  const view = readerOf('b/d.svelte', '<script lang="ts">import x from "./x";</script>', siblings);
  assert.ok(view.reader && view.view !== null && view.view.language === 'typescript' && view.view.parsePath === 'b/d.svelte.ts');
  assert.equal((readerOf('c/e.h', '', siblings) as any).view.language, 'cpp');
  assert.equal((readerOf('g/h.h', '', siblings) as any).view.language, 'c');
});

test("dependency-slice §3.5: a use's answer is Runes' answer for all its candidates, with its reason or candidates, and what is the first candidate", async () => {
  const use = (line: number, ...keys: string[]) => ({ line, candidates: keys.map((specifier) => ({ kind: 'path', specifier }) as Hint) });
  const uses = {
    'a.ts': [
      use(1, 'resolved', 'later'),
      use(2, 'ambiguous', 'later'),
      use(3, 'ambiguous-unnamed'),
      use(4, 'outside', 'later'),
      use(5, 'unfollowed'),
      use(6, 'unowned'),
      use(7, 'unknown-reason'),
      use(8, 'no-reason'),
    ],
    'b.ts': [{ line: 1, candidates: [] as Hint[] }],
  };
  const classifyUse = (candidates: Hint[]): Kind => {
    const first = candidates[0];
    const key = first === undefined ? '' : first.kind === 'path' ? first.specifier : first.symbolKey;
    if (key === 'resolved') return { kind: 'resolved', owner: 'o', resolvedFile: 'b.ts' };
    if (key === 'ambiguous') return { kind: 'ambiguous', candidates: ['x/one.ts', 'y/two.ts'] };
    if (key === 'ambiguous-unnamed') return { kind: 'ambiguous' };
    if (key === 'outside') return { kind: 'absent', reason: 'outside' };
    if (key === 'unfollowed') return { kind: 'absent', reason: 'unfollowed' };
    if (key === 'unowned') return { kind: 'absent', reason: 'unowned', resolvedFile: 'gen/out.ts' };
    if (key === 'unknown-reason') return { kind: 'absent', reason: 'elsewhere' };
    return { kind: 'absent' };
  };
  const { runes, record } = fake({ uses, classifyUse });
  const outcome = await readUses(input({ 'a.ts': '', 'b.ts': '' }, ['a.ts', 'b.ts']), runes);
  assert.ok('uses' in outcome);
  assert.deepEqual(outcome.uses.get('a.ts'), [
    { line: 1, answer: { kind: 'file', file: 'b.ts' } },
    { line: 2, answer: { kind: 'ambiguous', what: 'ambiguous', candidates: ['x/one.ts', 'y/two.ts'] } },
    { line: 3, answer: { kind: 'ambiguous', what: 'ambiguous-unnamed', candidates: [] } },
    { line: 4, answer: { kind: 'outside' } },
    { line: 5, answer: { kind: 'none', what: 'unfollowed', reason: 'unfollowed', candidates: [] } },
    { line: 6, answer: { kind: 'none', what: 'unowned', reason: 'unowned', candidates: ['gen/out.ts'] } },
    { line: 7, answer: { kind: 'none', what: 'unknown-reason', reason: null, candidates: [] } },
    { line: 8, answer: { kind: 'none', what: 'no-reason', reason: null, candidates: [] } },
  ]);
  assert.deepEqual(outcome.uses.get('b.ts'), [{ line: 1, answer: { kind: 'none', what: '', reason: null, candidates: [] } }]);
  assert.deepEqual(record.classified.slice(0, 2), ['a.ts resolved later', 'a.ts ambiguous later']);
});

test('dependency-slice §3.3: a run that reads no use loads no grammar and parses nothing', async () => {
  const { runes, record } = fake({});
  const outcome = await readUses(input({ 'a.vue': '<template></template>' }, ['a.vue']), runes);
  assert.ok('uses' in outcome);
  assert.deepEqual(outcome.uses.get('a.vue'), []);
  assert.deepEqual(record, { loaded: [], parsed: [], declared: [], classified: [], project: 0 });
});

test('dependency-slice §3.3: files are parsed once, in path order, and the name-binding groups read every declaration', async () => {
  const files = { 'b/A.java': 'class A {}', 'a/K.kt': 'class K', 'c/x.ts': '', 'd/blob.java': 'x\u0000', 'e/R.rb': '', 'f/G.go': '' };
  const { runes, record } = fake({});
  const outcome = await readUses(input(files, ['b/A.java', 'c/x.ts']), runes);
  assert.ok('uses' in outcome);
  assert.deepEqual(record.parsed, ['a/K.kt', 'b/A.java', 'c/x.ts']);
  assert.deepEqual(record.declared, ['a/K.kt', 'b/A.java']);
  assert.deepEqual(record.loaded, ['.kt', '.java', '.ts']);
  const others = fake({});
  await readUses(input({ 'a.py': '', 'b.php': '<?php', 'c.go': '', 'd.ts': '', 'e.c': '', 'f.cpp': '', 'g.js': '' }, ['a.py', 'b.php', 'c.go', 'd.ts', 'e.c', 'f.cpp', 'g.js']), others.runes);
  assert.deepEqual(others.record.declared, []);
});

test('dependency-slice §6: a grammar that cannot be loaded stops the run without a place, and no file after it is read', async () => {
  const { runes, record } = fake({ failGrammar: '.ts' });
  const outcome = await readUses(input({ 'a.py': '', 'b.ts': '', 'c.py': '' }, ['a.py', 'b.ts', 'c.py']), runes);
  assert.deepEqual(outcome, {
    error: {
      code: 'parser-failed',
      file: null,
      line: null,
      message: 'the grammar of typescript cannot be loaded: cannot load .ts',
      next: 'reinstall Lawcheck; a grammar it ships cannot be loaded',
    },
  });
  assert.deepEqual(record.parsed, ['a.py']);
  assert.deepEqual(record.classified, []);
});

test('dependency-slice §3.3: a reader that fails on a file stops the run at that file, and no file after it is read', async () => {
  for (const options of [{ failUses: 'b.py' }, { failDeclarations: 'b.java' }]) {
    const files = { 'a.py': '', 'b.py': '', 'c.py': '', 'b.java': '', 'd.java': '' };
    const { runes, record } = fake(options);
    const outcome = await readUses(input(files, Object.keys(files)), runes);
    const failed = options.failUses ?? options.failDeclarations!;
    const language = failed.endsWith('.py') ? 'python' : 'java';
    assert.ok('error' in outcome);
    assert.equal(outcome.error.code, 'parser-failed');
    assert.equal(outcome.error.file, failed);
    assert.match(outcome.error.message, new RegExp(`^the ${language} reader fails on this file: (uses|declarations) broke$`));
    assert.equal(outcome.error.next, `report the failure of the ${language} reader on ${failed}; until it is fixed, no ${language} use can be judged`);
    assert.equal(record.parsed[record.parsed.length - 1], failed);
    assert.deepEqual(record.classified, []);
  }
});

test('dependency-slice §3.3: classifying a use that fails stops the run at its file', async () => {
  const uses = { 'b.ts': [{ line: 1, candidates: [{ kind: 'path', specifier: 'x' }] as Hint[] }], 'c.ts': [{ line: 1, candidates: [{ kind: 'path', specifier: 'y' }] as Hint[] }] };
  const { runes, record } = fake({ uses, failClassify: 'b.ts' });
  const outcome = await readUses(input({ 'b.ts': '', 'c.ts': '' }, ['b.ts', 'c.ts']), runes);
  assert.ok('error' in outcome);
  assert.equal(outcome.error.file, 'b.ts');
  assert.equal(outcome.error.message, 'the typescript reader fails on this file: classify broke');
  assert.deepEqual(record.classified, []);
});

test('dependency-slice §3.3: the C# project reader fails without a place; assembling a file fails at the file', async () => {
  const files = { 'a/A.cs': '', 'b/B.cs': '', 'c/x.ts': '' };
  const project = fake({ failProject: true });
  const failed = await readUses(input(files, Object.keys(files)), project.runes);
  assert.deepEqual(failed, {
    error: {
      code: 'parser-failed',
      file: null,
      line: null,
      message: 'the C# project reader fails: scopes broke',
      next: 'report the failure of the C# project reader; until it is fixed, no C# use can be judged',
    },
  });
  assert.deepEqual(project.record.classified, []);
  const assembly = fake({ failAssemble: 'a/A.cs' });
  const atFile = await readUses(input(files, Object.keys(files)), assembly.runes);
  assert.ok('error' in atFile);
  assert.equal(atFile.error.file, 'a/A.cs');
  assert.equal(atFile.error.message, 'the csharp reader fails on this file: assembly broke');
});

test('dependency-slice §3.3: a file the readers cannot read is file-unreadable at that file', async () => {
  const { runes } = fake({});
  const base = input({ 'a.java': '' }, ['a.java']);
  const outcome = await readUses({ ...base, files: [...base.files, 'z.java'] }, runes);
  assert.deepEqual(outcome, { error: { code: 'file-unreadable', file: 'z.java', line: null, message: 'the file cannot be read (ENOENT)' } });
});

test('dependency-slice §6: a notice in dist/grammars/LICENSES.txt for every grammar beside it', () => {
  const dir = GRAMMARS;
  const notices = readFileSync(`${dir}/LICENSES.txt`, 'utf8');
  const grammars = readdirSync(dir).filter((name) => name.endsWith('.wasm'));
  assert.equal(grammars.length, 13);
  for (const grammar of grammars) {
    const at = notices.indexOf(`: ${grammar}\nRepository: https://github.com/`);
    assert.ok(at > 0, grammar);
    const block = notices.slice(at, notices.indexOf('\n====', at) > 0 ? notices.indexOf('\n====', at) : undefined);
    assert.match(block, /\nCommit: [0-9a-f]{40}\n/, grammar);
    assert.match(block, /\nCopyright \(c\) /, grammar);
    assert.match(block, /Permission is hereby granted/, grammar);
  }
  assert.equal(fileURLToPath(new URL('../../dist/grammars', import.meta.url)), dir);
});

test('S4-9: a line Runes counts after a lone CR is the line of the file that holds its start, and without a lone CR it stays', () => {
  const mixed = ownLine('a\rb\r\nc\nd\re');
  assert.deepEqual([1, 2, 3, 4, 5].map(mixed), [1, 1, 2, 3, 3]);
  const plain = ownLine('a\r\nb\nc');
  assert.deepEqual([1, 2, 3].map(plain), [1, 2, 3]);
});

function reads(files: Record<string, string>, runes: any) {
  const paths = Object.keys(files).sort();
  const bound = paths.map((path) => ({ path, text: files[path]! }));
  const serve = ruleReads({ root: '/nowhere', files: paths, bytes: (path) => enc.encode(files[path]!), ownerOf: () => 'owner', typeOf: (path) => (path.startsWith('app/') ? 'app' : null) }, runes)(bound);
  return { serve, file: (path: string) => ({ path, text: files[path]! }) };
}

test('test 773: the reads of a script rule load no grammar and parse nothing until the rule asks, and a tree parses only its own file', async () => {
  const { runes, record } = fake({});
  const { serve, file } = reads({ 'a.ts': '', 'b.ts': '', 'c.java': '' }, runes);
  assert.deepEqual(record, { loaded: [], parsed: [], declared: [], classified: [], project: 0 });
  await serve('tree', file('b.ts'));
  assert.deepEqual(record.parsed, ['b.ts']);
  assert.deepEqual(record.declared, []);
});

test('test 773: the tree of a file is its nodes in preorder, with the type, the field, named, the range in the text, and the line and column of the start', async () => {
  const { serve, file } = reads({ 'a.ts': 'let é = f(\r\n  x);\n' }, RUNES);
  const answer = (await serve('tree', file('a.ts'))) as any;
  assert.equal(answer.language, 'typescript');
  assert.equal(answer.absent, null);
  const { types, fields, nodes } = answer.tree;
  const rows: string[] = [];
  for (let at = 0; at < nodes.length; at += 8) {
    rows.push(`${nodes[at]} ${types[nodes[at + 1]]} ${nodes[at + 2] < 0 ? '-' : fields[nodes[at + 2]]} ${nodes[at + 3] === 1 ? 'named' : 'anonymous'} ${nodes[at + 4]}-${nodes[at + 5]} ${nodes[at + 6]}:${nodes[at + 7]}`);
  }
  assert.deepEqual(rows, [
    '-1 program - named 0-18 1:0',
    '0 lexical_declaration - named 0-17 1:0',
    '1 let kind anonymous 0-3 1:0',
    '1 variable_declarator - named 4-16 1:4',
    '3 identifier name named 4-5 1:4',
    '3 = - anonymous 6-7 1:6',
    '3 call_expression value named 8-16 1:8',
    '6 identifier function named 8-9 1:8',
    '6 arguments arguments named 9-16 1:9',
    '8 ( - anonymous 9-10 1:9',
    '8 identifier - named 14-15 2:2',
    '8 ) - anonymous 15-16 2:3',
    '1 ; - anonymous 16-17 2:4',
  ]);
});

test('test 775: a file past the limit, a file with no reader and a reader that fails are absences that name their reason', async () => {
  const { runes, record } = fake({ failParse: 'b.ts' });
  const { serve, file } = reads({ 'a.ts': `${'x'.repeat(512 * 1024)}y`, 'b.ts': '', 'c.md': '', 'd.vue': '<template></template>' }, runes);
  assert.deepEqual(await serve('tree', file('a.ts')), { language: 'typescript', tree: null, absent: 'too-large' });
  assert.deepEqual(await serve('tree', file('b.ts')), { language: 'typescript', tree: null, absent: 'reader-failed' });
  assert.deepEqual(await serve('tree', file('c.md')), { language: null, tree: null, absent: 'no-reader' });
  assert.deepEqual(await serve('tree', file('d.vue')), { language: null, tree: null, absent: 'no-reader' });
  assert.deepEqual(await serve('uses', file('a.ts')), { uses: null, absent: 'too-large' });
  assert.deepEqual(await serve('uses', file('b.ts')), { uses: null, absent: 'reader-failed' });
  assert.deepEqual(await serve('uses', file('c.md')), { uses: null, absent: 'no-reader' });
  assert.deepEqual(await serve('uses', file('d.vue')), { uses: [], absent: null });
  assert.deepEqual(record.parsed, []);
});

test("test 774: a rule's uses are read once for every file it judges, each target with its type, and a reader that fails on one file leaves the others their uses", async () => {
  const use = (line: number, specifier: string) => ({ line, candidates: [{ kind: 'path', specifier } as Hint] });
  const uses = { 'domain/a.py': [use(1, 'app'), use(2, 'none')], 'domain/b.py': [use(3, 'app')], 'domain/c.py': [] };
  const classifyUse = (candidates: Hint[]): Kind => ((candidates[0] as { specifier: string }).specifier === 'app' ? { kind: 'resolved', owner: 'app', resolvedFile: 'app/x.py' } : { kind: 'absent', reason: 'unfollowed' });
  const files = { 'app/x.py': '', 'domain/a.py': '', 'domain/b.py': '', 'domain/c.py': '' };
  const once = fake({ uses, classifyUse });
  const { serve, file } = reads(files, once.runes);
  assert.deepEqual(await serve('uses', file('domain/a.py')), {
    uses: [
      { line: 1, kind: 'file', file: 'app/x.py', type: 'app' },
      { line: 2, kind: 'none', what: 'none', reason: 'unfollowed', candidates: [] },
    ],
    absent: null,
  });
  assert.deepEqual(await serve('uses', file('domain/b.py')), { uses: [{ line: 3, kind: 'file', file: 'app/x.py', type: 'app' }], absent: null });
  assert.deepEqual(once.record.parsed, ['app/x.py', 'domain/a.py', 'domain/b.py', 'domain/c.py']);
  const failing = fake({ uses, classifyUse, failUses: 'domain/b.py' });
  const second = reads(files, failing.runes);
  assert.deepEqual(await second.serve('uses', second.file('domain/b.py')), { uses: null, absent: 'reader-failed' });
  assert.deepEqual(await second.serve('uses', second.file('domain/c.py')), { uses: [], absent: null });
});
