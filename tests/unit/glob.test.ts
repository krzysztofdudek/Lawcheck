import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileList, compilePattern, patternProblem } from '../../dist/glob.js';

const matches = (pattern: string, path: string) => compilePattern(pattern).test(path);

test('** before the last segment matches any number of directories, none included', () => {
  assert.ok(matches('a/**/b.ts', 'a/b.ts'));
  assert.ok(matches('a/**/b.ts', 'a/x/y/b.ts'));
  assert.ok(!matches('a/**/b.ts', 'ab.ts'));
  assert.ok(matches('**/b.ts', 'b.ts'));
  assert.ok(matches('**/b.ts', 'x/b.ts'));
});

test('** as the last segment matches every file below, and not the directory', () => {
  assert.ok(matches('src/core/**', 'src/core/a.ts'));
  assert.ok(matches('src/core/**', 'src/core/x/a.ts'));
  assert.ok(!matches('src/core/**', 'src/core'));
  assert.ok(!matches('src/core/**', 'src/corex/a.ts'));
});

test('* and ? stay within a segment; a leading dot is a character like any other', () => {
  assert.ok(matches('src/*.ts', 'src/.ts'));
  assert.ok(matches('src/*.ts', 'src/.hidden.ts'));
  assert.ok(!matches('src/*.ts', 'src/a/b.ts'));
  assert.ok(matches('src/?.ts', 'src/a.ts'));
  assert.ok(matches('src/?.ts', 'src/ż.ts'));
  assert.ok(!matches('src/?.ts', 'src/ab.ts'));
});

test('braces, literals and case', () => {
  assert.ok(matches('tools/**/*.{mjs,js}', 'tools/a.js'));
  assert.ok(matches('tools/**/*.{mjs,js}', 'tools/x/a.mjs'));
  assert.ok(!matches('tools/**/*.{mjs,js}', 'tools/a.cjs'));
  assert.ok(matches('a/{x*,y?}.ts', 'a/xyz.ts'));
  assert.ok(matches('a+b/(c)[d].ts', 'a+b/(c)[d].ts'));
  assert.ok(matches('a,b.ts', 'a,b.ts'));
  assert.ok(!matches('src/a.ts', 'SRC/a.ts'));
});

test('a list matches one plain pattern and no exclusion, in any order', () => {
  const list = compileList(['!src/**/*.d.ts', 'src/**/*.ts']);
  assert.ok(list('src/a.ts'));
  assert.ok(!list('src/a.d.ts'));
  assert.ok(!list('lib/a.ts'));
});

test('invalid patterns', () => {
  for (const pattern of ['', '!', '/src', 'src/', 'a//b', './a', 'a/../b', 'src/**core/*.ts', '***', 'a/{b,{c}}', 'a/{b', 'a/b}', 'a/{b/c}', 'a/{}', 'a/{b,}', 'a/{,b}']) {
    assert.notEqual(patternProblem(pattern), null, pattern);
  }
  for (const pattern of ['src/**', '**', '!src/**/*.d.ts', 'a/{b,c}.ts', '.lawcheck/x', 'a,b']) {
    assert.equal(patternProblem(pattern), null, pattern);
  }
});
