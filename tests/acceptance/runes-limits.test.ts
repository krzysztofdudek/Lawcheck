import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UNPARSABLE_JAVA_CHARS } from '../numbers.ts';
import { inTemp, lawcheck, newRepository } from './helpers.ts';

const page = readFileSync(new URL('../../docs/languages.md', import.meta.url), 'utf8');
const spec = readFileSync(new URL('../../spec/dependency-slice.md', import.meta.url), 'utf8');

function law(...types: [string, string[], string[] | null][]): string {
  const lines = ['lawcheck: 0.1.0', '', 'types:'];
  for (const [id, paths, mayUse] of types) {
    lines.push(`  ${id}:`, `    paths: [${paths.map((p) => `"${p}"`).join(', ')}]`);
    if (mayUse !== null) lines.push(`    may_use: [${mayUse.join(', ')}]`);
  }
  return lines.join('\n') + '\n';
}

interface Found {
  findings: string[];
  unresolved: string[];
  result: string;
}

async function judged(files: Record<string, string>): Promise<Found> {
  return inTemp(async (dir) => {
    const repo = newRepository(dir, files);
    const run = await lawcheck(repo, ['check', '--json']);
    const document = JSON.parse(run.stdout);
    return {
      result: document.result,
      findings: document.findings.filter((f: any) => f.code === 'forbidden-use').map((f: any) => `${f.file}:${f.line}`),
      unresolved: document.unresolved.map((u: any) => `${u.file}:${u.line} ${u.answer} ${u.what}`),
    };
  });
}

const UI_DATA = law(['ui', ['src/ui/**'], ['ui']], ['data', ['src/data/**'], null]);

test('test 310: S4-1, a use through an alias that only a bundler defines is read as an installed package, so it is dropped and not counted; the relative path of the same use fails', async () => {
  assert.ok(page.includes('an alias that only a bundler defines'));
  assert.ok(page.includes('`import.meta.glob`, `require.context` and `vi.mock` are not read'));
  assert.ok(spec.includes('**An alias only a bundler defines is read as an installed package** (S4-1)'));
  const found = await judged({
    '.lawcheck/law.yaml': UI_DATA,
    'vite.config.ts': 'export default { resolve: { alias: { "@": "/abs/src", "~data": "/abs/src/data" } } };\n',
    '.babelrc': '{"plugins":[["module-resolver",{"alias":{"@d":"./src/data"}}]]}\n',
    'src/data/d.ts': 'export const d = 1;\n',
    'src/ui/a.ts': 'import { d } from "@/data/d";\nimport { e } from "~data/d";\nexport const x = [d, e];\n',
    'src/ui/b.js': 'import { d } from "@d/d";\nexport const x = d;\n',
    'src/ui/c.ts': 'const g = import.meta.glob("../data/*.ts");\nconst h = require.context("../data");\nexport { g, h };\n',
  });
  assert.deepEqual(found, { result: 'pass', findings: [], unresolved: [] });
  const control = await judged({
    '.lawcheck/law.yaml': UI_DATA,
    'src/data/d.ts': 'export const d = 1;\n',
    'src/ui/a.ts': 'import { d } from "../data/d";\nexport const x = d;\n',
  });
  assert.deepEqual(control.findings, ['src/ui/a.ts:1']);
});

const PY = (root: string) => law(['ui', [`${root}pkg/ui/**`], ['ui']], ['data', [`${root}pkg/data/**`, 'pyproject.toml'], null]);
const PY_FILES = (root: string, where: string) => ({
  '.lawcheck/law.yaml': PY(root),
  'pyproject.toml': `[project]\nname = "pkg"\n${where}`,
  [`${root}pkg/__init__.py`]: '',
  [`${root}pkg/ui/__init__.py`]: '',
  [`${root}pkg/data/__init__.py`]: '',
  [`${root}pkg/data/d.py`]: 'x = 1\n',
  [`${root}pkg/ui/a.py`]: 'from pkg.data.d import x\nfrom ..data.d import x as y\nimport pkg.data.d\n',
});

test('test 311: S4-2, a Python package under a root that only configuration names has its absolute self-imports dropped and not counted; the same package at a root the readers search is judged on every form', async () => {
  assert.ok(page.includes('has its absolute imports of itself (`from pkg.data.d import x`) read as outside'));
  assert.ok(spec.includes('**A Python root that only configuration names is no root** (S4-2)'));
  const lib = await judged(PY_FILES('lib/', '[tool.setuptools.packages.find]\nwhere = ["lib"]\n'));
  assert.deepEqual(lib.findings, ['lib/pkg/ui/a.py:2'], 'only the relative import is judged');
  assert.deepEqual(lib.unresolved, ['lib/pkg/ui/a.py:2 none ..data.d.x'], 'one line, two uses: the module is judged and the name is counted');
  assert.ok(page.includes('A line can hold two uses: `from ..data.d import x` uses the module `d`, judged, and the name `x`, counted as unresolved when it is no module'));
  assert.ok(spec.includes('one line can hold a judged use and a counted one'));
  const control = await judged(PY_FILES('', ''));
  assert.deepEqual(control.findings, ['pkg/ui/a.py:1', 'pkg/ui/a.py:2', 'pkg/ui/a.py:3']);
});

const RUST_LAW = law(['ui', ['src/ui/**', 'src/lib.rs'], ['ui']], ['data', ['src/data/**', 'datacrate/**'], null]);

test('test 312: S4-3, a Rust mod with #[path] and a path-dependency crate written in code with no use give no use, where a plain mod and a use are judged', async () => {
  assert.ok(page.includes('a `mod` with `#[path]` gave no use where tried'));
  assert.ok(spec.includes('**Rust `#[path]` and a crate written in code** (S4-3)'));
  assert.ok(!spec.includes('`mod` declarations with and without `#[path]`'), 'the spec no longer promises #[path]');
  const found = await judged({
    '.lawcheck/law.yaml': RUST_LAW,
    'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\ndatacrate = { path = "datacrate" }\n',
    'datacrate/Cargo.toml': '[package]\nname = "datacrate"\nversion = "0.1.0"\nedition = "2021"\n',
    'datacrate/src/lib.rs': 'pub fn dc() {}\n',
    'src/data/orphan.rs': 'pub fn o() {}\n',
    'src/data/d.rs': 'pub fn d() {}\n',
    'src/data/mod.rs': 'pub fn m() {}\n',
    'src/lib.rs': 'pub mod ui;\n#[path = "data/d.rs"]\npub mod dd;\npub mod data;\n',
    'src/ui/mod.rs': 'pub mod k;\npub mod f;\npub mod g;\n',
    'src/ui/k.rs': '#[path = "../data/orphan.rs"]\npub mod via_attr;\n',
    'src/ui/f.rs': 'pub fn k() { datacrate::dc(); }\n',
    'src/ui/g.rs': 'use datacrate::dc;\npub fn k() { dc(); }\n',
  });
  assert.deepEqual(found.findings, ['src/lib.rs:4', 'src/ui/g.rs:1'], 'the plain mod and the use are judged, the two #[path] mods and the path in code are not');
  assert.deepEqual(found.unresolved, []);
});

test('test 313: S4-6, a script block inside an HTML comment of a Vue file is read as code, and a script with src is neither read nor counted', async () => {
  assert.ok(page.includes('a `<script>` in an HTML comment is read as code; `<script src>` is not read'));
  const found = await judged({
    '.lawcheck/law.yaml': law(['ui', ['ui/**'], ['ui']], ['data', ['data/**'], null]),
    'data/d.ts': 'export const d = 1;\n',
    'ui/Commented.vue': '<template><p/></template>\n<!--\n<script lang="ts">\nimport { d } from "../data/d";\n</script>\n-->\n',
    'ui/Src.vue': '<template><p/></template>\n<script src="../data/d.ts"></script>\n',
    'ui/Plain.vue': '<template><p/></template>\n<script lang="ts">\nimport { d } from "../data/d";\n</script>\n',
  });
  assert.deepEqual(found.findings, ['ui/Commented.vue:4', 'ui/Plain.vue:3']);
  assert.deepEqual(found.unresolved, []);
});

test('test 313: S4-7, the count of unresolved uses depends on the import style of Python', async () => {
  assert.ok(page.includes("`from .m import Name` is counted and `from app.m import Name` is not"));
  const found = await judged({
    '.lawcheck/law.yaml': law(['app', ['app/**'], ['app']]),
    'app/__init__.py': '',
    'app/m.py': 'Name = 1\n',
    'app/rel.py': 'from .m import Name\n',
    'app/abs.py': 'from app.m import Name\n',
  });
  assert.deepEqual(found.unresolved, ['app/rel.py:1 none .m.Name']);
});

test('test 313: S4-8, a Go module wired to a sibling only by replace is outside, so its use is neither judged nor counted', async () => {
  assert.ok(page.includes('a sibling module wired only by `replace` in `go.mod` is outside; use a `go.work`'));
  const files = (extra: Record<string, string>) => ({
    '.lawcheck/law.yaml': law(['ui', ['ui/**/*.go'], ['ui']], ['data', ['data/**/*.go'], null]),
    'ui/go.mod': 'module example.com/ui\n\ngo 1.22\n\nrequire example.com/data v0.0.0\n\nreplace example.com/data => ../data\n',
    'data/go.mod': 'module example.com/data\n\ngo 1.22\n',
    'data/d.go': 'package data\n\nfunc D() int { return 1 }\n',
    'ui/main.go': 'package main\n\nimport "example.com/data"\n\nfunc main() { _ = data.D() }\n',
    ...extra,
  });
  const replaced = await judged(files({}));
  assert.deepEqual({ findings: replaced.findings, unresolved: replaced.unresolved }, { findings: [], unresolved: [] });
  const workspace = await judged(files({ 'go.work': 'go 1.22\n\nuse (\n\t./ui\n\t./data\n)\n' }));
  assert.deepEqual(workspace.findings, ['ui/main.go:3'], 'the control: with a go.work the same use is judged');
});

test('test 313: S4-11, the dependency spec lists declare module as read, and a fully qualified Java name as read in a field type only', async () => {
  const typescript = await judged({
    '.lawcheck/law.yaml': law(['ui', ['ui/**'], ['ui']], ['data', ['data/**'], null]),
    'data/d.ts': 'export const d = 1;\n',
    'ui/decl.ts': 'declare module "../data/d" {\n  export const e: number;\n}\n',
  });
  assert.deepEqual(typescript.findings, ['ui/decl.ts:1']);
  assert.ok(spec.includes('`declare module \\"<path>\\"`') || spec.includes('`declare module "<path>"`'));
  const java = (name: string, body: string) => ({ [`ui/src/main/java/com/acme/ui/${name}.java`]: `package com.acme.ui;\n${body}\n` });
  const found = await judged({
    '.lawcheck/law.yaml': law(['ui', ['ui/**'], ['ui']], ['data', ['data/**'], null]),
    'data/src/main/java/com/acme/data/Dat.java': 'package com.acme.data;\npublic class Dat { public static void run() {} }\n',
    'data/src/main/java/com/acme/data/DatAnn.java': 'package com.acme.data;\npublic @interface DatAnn {}\n',
    ...java('Field', 'public class Field { com.acme.data.Dat d; }'),
    ...java('Call', 'public class Call { void f() { com.acme.data.Dat.run(); } }'),
    ...java('Ann', '@com.acme.data.DatAnn\npublic class Ann { }'),
    ...java('Refl', 'public class Refl { void f() throws Exception { Class.forName("com.acme.data.Dat"); } }'),
  });
  assert.deepEqual(found.findings, ['ui/src/main/java/com/acme/ui/Field.java:2']);
  assert.ok(page.includes('a fully qualified name is read in a field type, and not in a call, an annotation or `Class.forName`'));
  assert.ok(page.includes('a file of any size with syntax errors has no bound'), 'S4-10');
});

test('test 313: S4-10, a large Java file with syntax errors is parsed on every run and bounded by nothing: the run passes, with no error and no named limit', async () => {
  assert.ok(page.includes('a file of any size with syntax errors has no bound'));
  assert.ok(spec.includes('a large file with syntax errors has no bound (S4-10)'));
  const line = '  int x = ((( ;;; } } class class 12 @@ \n';
  let text = 'package com.acme.ui;\npublic class Big {\n';
  while (text.length < UNPARSABLE_JAVA_CHARS) text += line;
  const found = await judged({
    '.lawcheck/law.yaml': law(['ui', ['ui/**'], ['ui']]),
    'ui/src/main/java/com/acme/ui/Big.java': text + '}\n',
  });
  assert.deepEqual(found, { result: 'pass', findings: [], unresolved: [] });
});
