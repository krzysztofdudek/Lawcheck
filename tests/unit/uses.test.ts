import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLaw } from '../../dist/law.js';
import { allows, extensionOf, judgeUses, listInForce, notRead, notReadMessage } from '../../dist/uses.js';

const LAW = `lawcheck: 0.1.0
types:
  source:
    paths: ["src/**"]
    may_use: [library, library]
    types:
      library:
        paths: ["src/core/**"]
      command:
        paths: ["src/cli/**"]
        may_use: [command, library]
      closed:
        paths: ["src/closed/**"]
        may_use: []
  free:
    paths: ["free/**"]
    types:
      inner:
        paths: ["free/inner/**"]
`;

function types() {
  const { law, problems } = parseLaw(LAW);
  assert.deepEqual(problems, []);
  return law!.byId;
}

test('dependency-slice §3.5: the list in force: its own, its nearest ancestor, or none', () => {
  const byId = types();
  const own = listInForce(byId.get('command')!)!;
  assert.deepEqual(own.list, ['command', 'library']);
  assert.equal(own.from.id, 'command');
  const taken = listInForce(byId.get('library')!)!;
  assert.deepEqual(taken.list, ['library']);
  assert.equal(taken.from.id, 'source');
  assert.deepEqual(listInForce(byId.get('closed')!)!.list, []);
  assert.equal(listInForce(byId.get('free')!), null);
  assert.equal(listInForce(byId.get('inner')!), null);
});

test('dependency-slice §3.5: naming a type allows its subtypes, never its parent', () => {
  const byId = types();
  assert.equal(allows(['source'], byId.get('library')!), true);
  assert.equal(allows(['library'], byId.get('source')!), false);
  assert.equal(allows(['library'], byId.get('library')!), true);
  assert.equal(allows([], byId.get('library')!), false);
});

test('dependency-slice §3.5: each answer of section 3.5', () => {
  const byId = types();
  const library = byId.get('library')!;
  const targets: Record<string, any> = {
    'src/core/a.ts': { kind: 'typed', type: library },
    'src/cli/b.ts': { kind: 'typed', type: byId.get('command')! },
    'lib/c.ts': { kind: 'untyped' },
    'src/core/d.png': { kind: 'binary' },
  };
  const judged = judgeUses(
    'src/core/x.ts',
    library,
    [
      { line: 1, answer: { kind: 'file', file: 'src/core/x.ts' } },
      { line: 2, answer: { kind: 'file', file: 'src/core/a.ts' } },
      { line: 3, answer: { kind: 'file', file: 'src/cli/b.ts' } },
      { line: 4, answer: { kind: 'file', file: 'lib/c.ts' } },
      { line: 5, answer: { kind: 'file', file: 'src/core/d.png' } },
      { line: 6, answer: { kind: 'ambiguous', what: 'A.B', candidates: ['src/a/B.ts', 'src/b/B.ts'] } },
      { line: 7, answer: { kind: 'none', what: './gen', reason: 'unfollowed', candidates: [] } },
      { line: 8, answer: { kind: 'outside' } },
      { line: 9, answer: { kind: 'none', what: 'config.h', reason: null, candidates: [] } },
    ],
    (file) => targets[file],
  );
  assert.deepEqual(judged.forbidden, [
    { file: 'src/core/x.ts', line: 3, message: 'library may not use command (src/cli/b.ts); it takes may_use [library] from source' },
    { file: 'src/core/x.ts', line: 4, message: 'library may not use lib/c.ts, which has no type; it takes may_use [library] from source' },
  ]);
  assert.deepEqual(judged.unresolved, [
    { file: 'src/core/x.ts', line: 6, what: 'A.B', answer: 'ambiguous', reason: null, candidates: ['src/a/B.ts', 'src/b/B.ts'] },
    { file: 'src/core/x.ts', line: 7, what: './gen', answer: 'none', reason: 'unfollowed', candidates: [] },
    { file: 'src/core/x.ts', line: 9, what: 'config.h', answer: 'none', reason: null, candidates: [] },
  ]);
});

test('S4-4: an ambiguous use whose every candidate the list forbids is a forbidden-use; one with an allowed, a binary or its own file among them is not, and every one stays unresolved', () => {
  const byId = types();
  const command = { kind: 'typed', type: byId.get('command')! };
  const targets: Record<string, any> = {
    'src/cli/a.ts': command,
    'src/cli/b.ts': command,
    'src/cli/c.ts': command,
    'src/cli/d.ts': command,
    'lib/c.ts': { kind: 'untyped' },
    'src/core/d.ts': { kind: 'typed', type: byId.get('library')! },
    'src/core/e.png': { kind: 'binary' },
  };
  const ambiguous = (line: number, what: string, candidates: string[]) => ({ line, answer: { kind: 'ambiguous' as const, what, candidates } });
  const judged = judgeUses(
    'src/core/x.ts',
    byId.get('library')!,
    [
      ambiguous(1, 'A.B', ['src/cli/a.ts', 'lib/c.ts']),
      ambiguous(2, 'A.C', ['src/cli/a.ts', 'src/core/d.ts']),
      ambiguous(3, 'A.D', ['src/cli/a.ts', 'src/core/e.png']),
      ambiguous(4, 'A.E', ['src/core/x.ts', 'src/cli/a.ts']),
      ambiguous(5, 'A.F', ['src/cli/a.ts', 'src/cli/b.ts', 'src/cli/c.ts', 'src/cli/d.ts', 'lib/c.ts']),
      ambiguous(5, 'A.F', ['src/cli/a.ts', 'src/cli/b.ts', 'src/cli/c.ts', 'src/cli/d.ts', 'lib/c.ts']),
    ],
    (file) => targets[file],
  );
  assert.deepEqual(judged.forbidden, [
    { file: 'src/core/x.ts', line: 1, message: 'library may not use A.B, which names one of src/cli/a.ts (command) and lib/c.ts (no type); it takes may_use [library] from source' },
    { file: 'src/core/x.ts', line: 5, message: 'library may not use A.F, which names one of src/cli/a.ts (command), src/cli/b.ts (command), src/cli/c.ts (command) and 2 more; it takes may_use [library] from source' },
  ]);
  assert.deepEqual(judged.unresolved.map((u) => u.line), [1, 2, 3, 4, 5, 5]);
  const free = judgeUses('free/x.ts', byId.get('free')!, [ambiguous(1, 'A.B', ['src/cli/a.ts', 'lib/c.ts'])], (file) => targets[file]);
  assert.deepEqual(free, { forbidden: [], unresolved: [] });
});

test('dependency-slice §5: the messages with a list of its own, and an empty one', () => {
  const byId = types();
  const target = (): any => ({ kind: 'untyped' });
  const own = judgeUses('src/cli/x.ts', byId.get('command')!, [{ line: 1, answer: { kind: 'file', file: 'a.ts' } }], target);
  assert.equal(own.forbidden[0]!.message, 'command may not use a.ts, which has no type; its may_use is [command, library]');
  const closed = judgeUses('src/closed/x.ts', byId.get('closed')!, [{ line: 1, answer: { kind: 'file', file: 'src/closed/y.ts' } }], () => ({ kind: 'typed', type: byId.get('closed')! }));
  assert.equal(closed.forbidden[0]!.message, 'closed may not use closed (src/closed/y.ts); its may_use is []');
});

test('dependency-slice §5: one forbidden-use per line and target file', () => {
  const byId = types();
  const command = byId.get('command')!;
  const judged = judgeUses(
    'src/core/x.ts',
    byId.get('library')!,
    [
      { line: 1, answer: { kind: 'file', file: 'src/cli/a.ts' } },
      { line: 1, answer: { kind: 'file', file: 'src/cli/a.ts' } },
      { line: 1, answer: { kind: 'file', file: 'src/cli/b.ts' } },
      { line: 2, answer: { kind: 'file', file: 'src/cli/a.ts' } },
    ],
    () => ({ kind: 'typed', type: command }),
  );
  assert.deepEqual(judged.forbidden.map((f) => `${f.line} ${f.message.match(/\((.*)\)/)![1]}`), ['1 src/cli/a.ts', '1 src/cli/b.ts', '2 src/cli/a.ts']);
});

test('dependency-slice §5: a type with no list in force judges nothing and counts nothing', () => {
  const byId = types();
  const judged = judgeUses('free/x.ts', byId.get('free')!, [{ line: 1, answer: { kind: 'none', what: 'x', reason: null, candidates: [] } }, { line: 2, answer: { kind: 'file', file: 'y' } }], () => ({ kind: 'untyped' }));
  assert.deepEqual(judged, { forbidden: [], unresolved: [] });
});

test('dependency-slice §3.2: the extension of a file name', () => {
  assert.equal(extensionOf('ts/domain/schema.json'), '.json');
  assert.equal(extensionOf('a/b.tar.gz'), '.gz');
  assert.equal(extensionOf('a/.gitignore'), 'no extension');
  assert.equal(extensionOf('Makefile'), 'no extension');
  assert.equal(extensionOf('a.d/Makefile'), 'no extension');
  assert.equal(extensionOf('a/.env.local'), '.local');
  assert.equal(extensionOf('a/b.'), '.');
});

test('dependency-slice §5: the uses-not-read message, its extensions sorted with their counts', () => {
  assert.equal(notReadMessage('domain', ['ts/domain/schema.json']), '1 file of type domain is not read for uses: 1 .json');
  assert.equal(
    notReadMessage('web', ['a/x.css', 'a/Makefile', 'a/y.css', 'a/z.scss', 'a/.npmrc']),
    '5 files of type web are not read for uses: 2 .css, 1 .scss, 2 no extension',
  );
});

test('dependency-slice §5: uses-not-read is one finding per type, split between change and debt', () => {
  const byId = types();
  const library = byId.get('library')!;
  const command = byId.get('command')!;
  const found = notRead([
    { path: 'src/core/a.css', type: library, debt: false },
    { path: 'src/core/b.css', type: library, debt: true },
    { path: 'src/core/c.yaml', type: library, debt: false },
    { path: 'src/cli/d.json', type: command, debt: true },
  ]);
  assert.deepEqual(
    found.map((f) => [f.type.id, f.debt, f.message]),
    [
      ['library', false, '2 files of type library are not read for uses: 1 .css, 1 .yaml'],
      ['library', true, '1 file of type library is not read for uses: 1 .css'],
      ['command', true, '1 file of type command is not read for uses: 1 .json'],
    ],
  );
  assert.deepEqual(notRead([]), []);
});
