import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMIT_GROUPS, ROOT, TESTS, walk } from '../harness/sets.ts';
import { HAND_STARTS, namesTool, namesToolInLine } from '../harness/tool.ts';

const START = /\b(spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(/g;
const TOOL = /\bCLI\b|\bBIN\b|\bHOOK\b|cli\.js|bin\.cjs|lawcheck-hook|\.tgz\b|'dist'/;

export function handStarts(text: string): number[] {
  const lines: number[] = [];
  for (const m of text.matchAll(START)) {
    const call = text.slice(m.index, m.index + 400);
    const end = call.search(/;\s*$|;\n|\)\s*;/m);
    if (TOOL.test(end < 0 ? call : call.slice(0, end + 1))) lines.push(text.slice(0, m.index).split('\n').length);
  }
  return lines;
}

test('only tests/harness/ starts Lawcheck, a hook or the tarball', () => {
  const found: string[] = [];
  for (const path of walk(TESTS, (name) => /\.[cm]?[jt]s$/.test(name))) {
    if (path.startsWith('tests/harness/')) continue;
    for (const line of handStarts(readFileSync(join(ROOT, path), 'utf8'))) found.push(`${path}:${line}`);
  }
  assert.deepEqual(found, []);
});

// The samples spell each call with @ so that this file holds no start of its own.
const sample = (text: string, call: string) => text.replace('@', call);

test('the scan finds a start of the tool by hand', () => {
  assert.deepEqual(handStarts(sample("const c = @(process.execPath, [CLI, 'check'], { cwd });\n", 'spawn')), [1]);
  assert.deepEqual(handStarts(sample("x;\n@(process.execPath, [join(ROOT, 'dist', 'cli.js')]);\n", 'spawnSync')), [2]);
  assert.deepEqual(handStarts(sample("@(process.execPath, [HOOK, 'stop'], { input });\n", 'execFileSync')), [1]);
  assert.deepEqual(handStarts(sample('`const r = @(process.execPath, [${JSON.stringify(CLI)}, ...process.argv.slice(2)]);`\n', 'spawnSync')), [1]);
  assert.deepEqual(handStarts(sample("@('npm', ['install', 'lawcheck-0.1.0.tgz']);\n", 'execFileSync')), [1]);
  assert.deepEqual(handStarts(sample("@('git', ['status'], { cwd });\n", 'spawnSync')), []);
});

test('a test that starts the tool makes its folders with testFolder(), never with mkdtemp', () => {
  const found: string[] = [];
  const dirs = [...new Set(Object.values(COMMIT_GROUPS).flat())].filter((dir) => dir !== 'unit');
  for (const path of dirs.flatMap((dir) => walk(join(TESTS, dir), (name) => name.endsWith('.ts')))) {
    const text = readFileSync(join(ROOT, path), 'utf8');
    if (!/harness\/tool\.ts|harness\/start\.ts|\.\/helpers\.ts/.test(text)) continue;
    text.split('\n').forEach((line, i) => {
      if (/\bmkdtemp(Sync)?\s*\(/.test(line)) found.push(`${path}:${i + 1}`);
    });
  }
  assert.deepEqual(found, []);
});

test('the harness knows both entries of the built tool, and each hand start it allows names a test of its file', () => {
  assert.notEqual(namesTool([join(ROOT, 'dist', 'bin.cjs')]), null);
  assert.notEqual(namesTool(['/elsewhere/dist/bin.cjs']), null);
  assert.ok(namesToolInLine('node dist/bin.cjs check'));
  for (const entry of HAND_STARTS) {
    const text = readFileSync(join(ROOT, entry.file), 'utf8');
    assert.ok(text.includes(`test(${JSON.stringify(entry.test).replace(/^"|"$/g, "'")}`), `${entry.file} > ${entry.test}`);
  }
});
