import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UNPARSABLE_JAVA_CHARS } from '../numbers.ts';
import { inTemp, lawcheck, newRepository } from './helpers.ts';

const page = readFileSync(new URL('../../docs/languages.md', import.meta.url), 'utf8');

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
      unresolved: document.unresolved.map((u: any) => `${u.file}:${u.line} ${u.reason === null ? u.answer : `${u.answer} ${u.reason}`} ${u.what}`),
    };
  });
}

const UI_DATA = law(['ui', ['src/ui/**'], ['ui']], ['data', ['src/data/**'], null]);

test('test 310: S4-1, a use through an alias of the bundler configuration is judged where the readers read the alias, counted where they cannot follow it, and import.meta.glob and require.context give no use', async () => {
  assert.ok(page.includes('`import.meta.glob` and `require.context` are not read'));
  assert.ok(page.includes('an alias written another way, such as through a variable, is not followed, and its uses are counted as unresolved'));
  const found = await judged({
    '.lawcheck/law.yaml': UI_DATA,
    'vite.config.ts': 'import { fileURLToPath } from "node:url";\nconst dataDir = "/abs/src/data";\nexport default { resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "~data": dataDir } } };\n',
    '.babelrc': '{"plugins":[["module-resolver",{"alias":{"@d":"./src/data"}}]]}\n',
    'src/data/d.ts': 'export const d = 1;\n',
    'src/ui/a.ts': 'import { d } from "@/data/d";\nimport { e } from "~data/d";\nexport const x = [d, e];\n',
    'src/ui/b.js': 'import { d } from "@d/d";\nexport const x = d;\n',
    'src/ui/c.ts': 'const g = import.meta.glob("../data/*.ts");\nconst h = require.context("../data");\nexport { g, h };\n',
    'src/ui/m.test.ts': 'vi.mock("../data/d");\n',
  });
  assert.deepEqual(found, { result: 'fail', findings: ['src/ui/a.ts:1', 'src/ui/b.js:1', 'src/ui/m.test.ts:1'], unresolved: ['src/ui/a.ts:2 none unfollowed ~data/d'] });
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

test('test 311: S4-2, a Python package under a root that configuration names is judged on every form, as the same package at the root', async () => {
  const lib = await judged(PY_FILES('lib/', '[tool.setuptools.packages.find]\nwhere = ["lib"]\n'));
  assert.deepEqual({ findings: lib.findings, unresolved: lib.unresolved }, { findings: ['lib/pkg/ui/a.py:1', 'lib/pkg/ui/a.py:2', 'lib/pkg/ui/a.py:3'], unresolved: [] });
  const control = await judged(PY_FILES('', ''));
  assert.deepEqual({ findings: control.findings, unresolved: control.unresolved }, { findings: ['pkg/ui/a.py:1', 'pkg/ui/a.py:2', 'pkg/ui/a.py:3'], unresolved: [] });
});

const RUST_LAW = law(['ui', ['src/ui/**', 'src/lib.rs'], ['ui']], ['data', ['src/data/**', 'datacrate/**'], null]);

test('test 312: S4-3, a Rust mod with #[path], in src/lib.rs and in a module file, and a path-dependency crate written in code with no use are judged, as a plain mod and a use are', async () => {
  assert.ok(page.includes('a `mod` with `#[path]` inside an inline module, a function body or a `cfg_if!` branch, or under a `cfg_attr`, gives no use'));
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
  assert.deepEqual(found.findings, ['src/lib.rs:3', 'src/lib.rs:4', 'src/ui/f.rs:1', 'src/ui/g.rs:1', 'src/ui/k.rs:2'], 'the two #[path] mods, the plain mod, the path in code and the use are judged');
  assert.deepEqual(found.unresolved, []);
});

test('test 313: S4-6, a script block inside an HTML comment of a Vue file is not read, and a script with src is judged', async () => {
  assert.ok(page.includes('or uses the file a relative `<script src>` names; a script in an HTML comment is not read'));
  const found = await judged({
    '.lawcheck/law.yaml': law(['ui', ['ui/**'], ['ui']], ['data', ['data/**'], null]),
    'data/d.ts': 'export const d = 1;\n',
    'ui/Commented.vue': '<template><p/></template>\n<!--\n<script lang="ts">\nimport { d } from "../data/d";\n</script>\n-->\n',
    'ui/Src.vue': '<template><p/></template>\n<script src="../data/d.ts"></script>\n',
    'ui/Plain.vue': '<template><p/></template>\n<script lang="ts">\nimport { d } from "../data/d";\n</script>\n',
  });
  assert.deepEqual(found.findings, ['ui/Plain.vue:3', 'ui/Src.vue:2']);
  assert.deepEqual(found.unresolved, []);
});

test('test 313: S4-7, a name imported from a Python module is not counted, whether the import is relative or absolute', async () => {
  assert.ok(page.includes('`from . import x`, where `x` is a name `__init__.py` defines, is counted as unresolved, while `from .m import x` and `from pkg.m import x` are judged'));
  const found = await judged({
    '.lawcheck/law.yaml': law(['app', ['app/**'], ['app']]),
    'app/__init__.py': 'Top = 1\n',
    'app/m.py': 'Name = 1\n',
    'app/rel.py': 'from .m import Name\n',
    'app/abs.py': 'from app.m import Name\n',
    'app/top.py': 'from . import Top\n',
  });
  assert.deepEqual(found.unresolved, ['app/top.py:1 none unfollowed .Top']);
});

test('test 313: S4-8, a Go module wired to a sibling only by replace is judged, as with a go.work', async () => {
  const files = (extra: Record<string, string>) => ({
    '.lawcheck/law.yaml': law(['ui', ['ui/**/*.go'], ['ui']], ['data', ['data/**/*.go'], null]),
    'ui/go.mod': 'module example.com/ui\n\ngo 1.22\n\nrequire example.com/data v0.0.0\n\nreplace example.com/data => ../data\n',
    'data/go.mod': 'module example.com/data\n\ngo 1.22\n',
    'data/d.go': 'package data\n\nfunc D() int { return 1 }\n',
    'ui/main.go': 'package main\n\nimport "example.com/data"\n\nfunc main() { _ = data.D() }\n',
    ...extra,
  });
  const replaced = await judged(files({}));
  assert.deepEqual({ findings: replaced.findings, unresolved: replaced.unresolved }, { findings: ['ui/main.go:3'], unresolved: [] });
  const workspace = await judged(files({ 'go.work': 'go 1.22\n\nuse (\n\t./ui\n\t./data\n)\n' }));
  assert.deepEqual(workspace.findings, ['ui/main.go:3'], 'the control: with a go.work the same use is judged');
});

test('test 313: S4-11, declare module is read as a use, and a fully qualified Java name is read in a field type only', async () => {
  const typescript = await judged({
    '.lawcheck/law.yaml': law(['ui', ['ui/**'], ['ui']], ['data', ['data/**'], null]),
    'data/d.ts': 'export const d = 1;\n',
    'ui/decl.ts': 'declare module "../data/d" {\n  export const e: number;\n}\n',
  });
  assert.deepEqual(typescript.findings, ['ui/decl.ts:1']);
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
  const line = '  int x = ((( ;;; } } class class 12 @@ \n';
  let text = 'package com.acme.ui;\npublic class Big {\n';
  while (text.length < UNPARSABLE_JAVA_CHARS) text += line;
  const found = await judged({
    '.lawcheck/law.yaml': law(['ui', ['ui/**'], ['ui']]),
    'ui/src/main/java/com/acme/ui/Big.java': text + '}\n',
  });
  assert.deepEqual(found, { result: 'pass', findings: [], unresolved: [] });
});
