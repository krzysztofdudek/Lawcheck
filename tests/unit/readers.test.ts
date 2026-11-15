import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GRAMMARS, readerOf, readUses, RUNES, siblingsOf, Unreadable } from '../../dist/readers.js';

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
