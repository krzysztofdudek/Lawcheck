import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ROOT } from '../harness/tool.ts';

const DISCOVERED = ['unit', 'acceptance', 'contract', 'properties', 'security', 'limits', 'environments', 'guard'];

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...files(path));
    else out.push(relative(ROOT, path).split(sep).join('/'));
  }
  return out;
}

const map = JSON.parse(readFileSync(join(ROOT, 'tests', 'map.json'), 'utf8')) as Record<string, string[]>;

test('question 95: tests/map.json names the tests of every file of src/', () => {
  const unmapped = files(join(ROOT, 'src')).filter((path) => map[path] === undefined || map[path]!.length === 0);
  assert.deepEqual(unmapped, []);
});

test('question 95: tests/map.json names only files that exist, and test files that the runner finds', () => {
  const missing: string[] = [];
  for (const [source, tests] of Object.entries(map)) {
    if (!existsSync(join(ROOT, source))) missing.push(source);
    for (const path of tests) {
      const found = existsSync(join(ROOT, path)) && path.endsWith('.test.ts') && DISCOVERED.some((dir) => path.startsWith(`tests/${dir}/`));
      if (!found) missing.push(`${source} -> ${path}`);
    }
  }
  assert.deepEqual(missing, []);
});
