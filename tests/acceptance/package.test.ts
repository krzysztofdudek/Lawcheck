import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { ROOT } from './helpers.ts';
import { DEADLINES_VARIABLE, HOOK_WITH_DEADLINES, LIMITS_VARIABLE, TOOL_WITH_LIMITS } from '../harness/tool.ts';

interface Packed {
  files: { path: string }[];
}

function packed(): string[] {
  // npm test sets npm_execpath to npm's own script; on Windows npm on PATH is a .cmd file, which execFile cannot start.
  const npm = process.env.npm_execpath;
  const [program, args] = npm === undefined ? ['npm', [] as string[]] : [process.execPath, [npm]];
  const out = execFileSync(program, [...args, 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return (JSON.parse(out) as Packed[])[0]!.files.map((file) => file.path);
}

test('release-readiness §Package: package: the tarball holds the licence, the readme, the built tool, its docs and the grammars with their licences, and nothing else', () => {
  const paths = packed();
  const manifest = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')) as { bin: Record<string, string> };
  for (const path of ['LICENSE', 'README.md', 'package.json', 'dist/cli.js', 'dist/grammars/LICENSES.txt', ...Object.values(manifest.bin)]) {
    assert.ok(paths.includes(path), `${path} is missing from the tarball`);
  }
  assert.equal(paths.filter((path) => path.startsWith('docs/')).length, 14);
  assert.equal(paths.filter((path) => /^dist\/grammars\/tree-sitter-.*\.wasm$/.test(path)).length, 13);
  const stray = paths.filter((path) => !/^(LICENSE|README\.md|package\.json|docs\/[a-z-]+\.md|dist\/[a-z-]+\.js|dist\/bin\.cjs|dist\/providers\/[a-z-]+\.js|dist\/grammars\/(LICENSES\.txt|tree-sitter-[a-z_]+\.wasm))$/.test(path));
  assert.deepEqual(stray, []);
});

test('release-readiness §Package: package: every shipped grammar is named in the licence file', () => {
  const licences = readFileSync(`${ROOT}scripts/grammar-licenses.txt`, 'utf8');
  for (const path of packed().filter((p) => p.endsWith('.wasm'))) {
    assert.ok(licences.includes(path.slice('dist/grammars/'.length)), `${path} has no licence text`);
  }
});

function pluginFiles(dir = join(ROOT, 'plugin')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? pluginFiles(join(dir, entry.name)) : [relative(ROOT, join(dir, entry.name)).split('\\').join('/')]));
}

test('release-readiness §Package: package: nothing the tarball or the plugin ships holds a test entry, names one or its variable, or changes the shipped limits and deadlines', () => {
  const shipped = [...packed(), ...pluginFiles()];
  assert.ok(shipped.includes('dist/rules.js') && shipped.includes('plugin/hooks/start.mjs'), shipped.join(', '));
  const names = [basename(HOOK_WITH_DEADLINES), basename(TOOL_WITH_LIMITS), DEADLINES_VARIABLE, LIMITS_VARIABLE];
  const writes = /\b(LIMITS|DEADLINES)\s*(\.\s*[\w$]+|\[[^\]]*\])\s*([-+*/]?=(?!=)|\+\+|--)|Object\.(assign|defineProperty|defineProperties|setPrototypeOf)\(\s*(LIMITS|DEADLINES)\b/;
  const found: string[] = [];
  for (const path of shipped) {
    if (path.startsWith('tests/')) found.push(`${path} is a file of the tests`);
    if (path.endsWith('.wasm')) continue;
    const text = readFileSync(join(ROOT, path), 'utf8');
    for (const name of names) if (text.includes(name)) found.push(`${path} names ${name}`);
    const write = writes.exec(text);
    if (write !== null) found.push(`${path} changes a shipped limit or deadline: ${write[0]}`);
  }
  assert.deepEqual(found, []);
});
