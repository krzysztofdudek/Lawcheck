import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileList, compilePattern, patternProblem } from '../../dist/glob.js';
import { MATCH_BUDGET_MS } from '../numbers.ts';

const matches = (pattern: string, path: string) => compilePattern(pattern).test(path);

test('check-slice §2: ** before the last segment matches any number of directories, none included', () => {
  assert.ok(matches('a/**/b.ts', 'a/b.ts'));
  assert.ok(matches('a/**/b.ts', 'a/x/y/b.ts'));
  assert.ok(!matches('a/**/b.ts', 'ab.ts'));
  assert.ok(matches('**/b.ts', 'b.ts'));
  assert.ok(matches('**/b.ts', 'x/b.ts'));
});

test('check-slice §2: ** as the last segment matches every file below, and not the directory', () => {
  assert.ok(matches('src/core/**', 'src/core/a.ts'));
  assert.ok(matches('src/core/**', 'src/core/x/a.ts'));
  assert.ok(!matches('src/core/**', 'src/core'));
  assert.ok(!matches('src/core/**', 'src/corex/a.ts'));
});

test('check-slice §2: * and ? stay within a segment; a leading dot is a character like any other', () => {
  assert.ok(matches('src/*.ts', 'src/.ts'));
  assert.ok(matches('src/*.ts', 'src/.hidden.ts'));
  assert.ok(!matches('src/*.ts', 'src/a/b.ts'));
  assert.ok(matches('src/?.ts', 'src/a.ts'));
  assert.ok(matches('src/?.ts', 'src/ż.ts'));
  assert.ok(!matches('src/?.ts', 'src/ab.ts'));
});

test('check-slice §2: braces, literals and case', () => {
  assert.ok(matches('tools/**/*.{mjs,js}', 'tools/a.js'));
  assert.ok(matches('tools/**/*.{mjs,js}', 'tools/x/a.mjs'));
  assert.ok(!matches('tools/**/*.{mjs,js}', 'tools/a.cjs'));
  assert.ok(matches('a/{x*,y?}.ts', 'a/xyz.ts'));
  assert.ok(matches('a+b/(c)[d].ts', 'a+b/(c)[d].ts'));
  assert.ok(matches('a,b.ts', 'a,b.ts'));
  assert.ok(!matches('src/a.ts', 'SRC/a.ts'));
});

test('check-slice §2: a list matches one plain pattern and no exclusion, in any order', () => {
  const list = compileList(['!src/**/*.d.ts', 'src/**/*.ts']);
  assert.ok(list('src/a.ts'));
  assert.ok(!list('src/a.d.ts'));
  assert.ok(!list('lib/a.ts'));
});

test('check-slice §2: invalid patterns', () => {
  for (const pattern of ['', '!', '/src', 'src/', 'a//b', './a', 'a/../b', 'src/**core/*.ts', '***', 'a/{b,{c}}', 'a/{b', 'a/b}', 'a/{b/c}', 'a/{}', 'a/{b,}', 'a/{,b}']) {
    assert.notEqual(patternProblem(pattern), null, pattern);
  }
  for (const pattern of ['src/**', '**', '!src/**/*.d.ts', 'a/{b,c}.ts', '.lawcheck/x', 'a,b']) {
    assert.equal(patternProblem(pattern), null, pattern);
  }
});

test('S1-1: src/**/*a*a*a*a*a*a*b.ts against a name of 240 a ends within the budget, and matches what it should', () => {
  const pattern = compilePattern('src/**/*a*a*a*a*a*a*b.ts');
  const started = performance.now();
  assert.equal(pattern.test(`src/core/${'a'.repeat(240)}.ts`), false);
  assert.ok(performance.now() - started <= MATCH_BUDGET_MS, `the match took ${Math.round(performance.now() - started)} ms`);
  assert.equal(pattern.test(`src/core/${'a'.repeat(6)}b.ts`), true);
  assert.equal(pattern.test(`src/${'a'.repeat(240)}b.ts`), true);
  assert.equal(pattern.test(`src/core/${'a'.repeat(5)}b.ts`), false);
});

test('R-40: patternProblem says in its own words what is wrong, for each fault', () => {
  const said: Record<string, string> = {
    '': 'is empty',
    '!': "is '!' alone",
    'a/{b,{c}}': 'nests a brace',
    '{{': 'nests a brace',
    'a/b}': 'closes a brace it never opened',
    'a/{}': 'holds an empty alternative',
    'a/{b,}': 'holds an empty alternative',
    'a/{,b}': 'holds an empty alternative',
    'a/{b/c}': "holds a '/' inside a brace",
    'a/{b': 'leaves a brace unclosed',
    '/src': 'holds an empty segment',
    'src/': 'holds an empty segment',
    'a//b': 'holds an empty segment',
    './a': "holds the segment '.'",
    'a/../b': "holds the segment '..'",
    'src/**core': 'holds ** beside other characters in one segment',
    'src/core**': 'holds ** beside other characters in one segment',
    '***': 'holds ** beside other characters in one segment',
    '!/a': 'holds an empty segment',
    '!{': 'leaves a brace unclosed',
  };
  for (const [pattern, problem] of Object.entries(said)) assert.equal(patternProblem(pattern), problem, pattern);
  for (const pattern of ['!a', '!a/b', '!*', '{a}', 'a{b,c}d/e', '*', '?', 'a/*/b', '**/**/a']) assert.equal(patternProblem(pattern), null, pattern);
});

test('R-40: a ** that is the last segment does not match the directory, with or without its slash', () => {
  assert.ok(!matches('src/core/**', 'src/core/'));
  assert.ok(!matches('**', ''));
  assert.ok(matches('**', 'a'));
  assert.ok(matches('**', 'a/b/c'));
});

test('R-40: a comma and a closing brace outside braces are characters of the path, and a brace holds nothing past its end', () => {
  assert.ok(matches('{a,b},c', 'a,c'));
  assert.ok(matches('{a,b},c', 'b,c'));
  assert.ok(!matches('{a,b},c', 'a'));
  assert.ok(!matches('{a,b},c', 'c'));
  assert.ok(matches('{a,b}}', 'a}'));
  assert.ok(!matches('{a,b}}', 'a'));
});

test('R-40: reaches says whether some path that starts with the prefix matches, the matching path itself included', () => {
  const reaches = (pattern: string, prefix: string) => compilePattern(pattern).reaches(prefix);
  const cases: [string, string, boolean][] = [
    ['a/b', '', true],
    ['a/b', 'a/', true],
    ['a/b', 'a/b', true],
    ['a/b', 'a/b/', false],
    ['a/b', 'c', false],
    ['src/**', 'sr', true],
    ['src/**', 'src/', true],
    ['src/**', 'src/a/b/', true],
    ['src/**', 'lib/', false],
    ['a/{b,c}/d', 'a/c/', true],
    ['a/{b,c}/d', 'a/c/d', true],
    ['a/{b,c}/d', 'a/e', false],
    ['*.ts', 'abc', true],
    ['*.ts', 'a/', false],
    ['**/b', 'x/y/', true],
    ['**/b', 'x/y/b', true],
    ['a/*/c', 'a/x/', true],
    ['a/*/c', 'a/x/y', false],
    ['a?c', 'ab', true],
    ['a?c', 'a/', false],
  ];
  for (const [pattern, prefix, expected] of cases) assert.equal(reaches(pattern, prefix), expected, `${pattern} reaches ${JSON.stringify(prefix)}`);
});
