import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { ROOT } from './helpers.ts';

interface Packed {
  files: { path: string }[];
}

function packed(): string[] {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return (JSON.parse(out) as Packed[])[0]!.files.map((file) => file.path);
}

test('package: the tarball holds the licence, the readme, the built tool, its docs and the grammars with their licences, and nothing else', () => {
  const paths = packed();
  const manifest = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8')) as { bin: Record<string, string> };
  for (const path of ['LICENSE', 'README.md', 'package.json', 'dist/cli.js', 'dist/grammars/LICENSES.txt', ...Object.values(manifest.bin)]) {
    assert.ok(paths.includes(path), `${path} is missing from the tarball`);
  }
  assert.equal(paths.filter((path) => path.startsWith('docs/')).length, 12);
  assert.equal(paths.filter((path) => /^dist\/grammars\/tree-sitter-.*\.wasm$/.test(path)).length, 13);
  const stray = paths.filter((path) => !/^(LICENSE|README\.md|package\.json|docs\/[a-z-]+\.md|dist\/[a-z-]+\.js|dist\/providers\/[a-z-]+\.js|dist\/grammars\/(LICENSES\.txt|tree-sitter-[a-z_]+\.wasm))$/.test(path));
  assert.deepEqual(stray, []);
});

test('package: every shipped grammar is named in the licence file', () => {
  const licences = readFileSync(`${ROOT}scripts/grammar-licenses.txt`, 'utf8');
  for (const path of packed().filter((p) => p.endsWith('.wasm'))) {
    assert.ok(licences.includes(path.slice('dist/grammars/'.length)), `${path} has no licence text`);
  }
});
