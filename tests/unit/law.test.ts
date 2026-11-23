import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLaw, nearestKey, patternFor } from '../../dist/law.js';

const SAMPLE = readFileSync(new URL('../sample/.lawcheck/law.yaml', import.meta.url), 'utf8');

function problems(text: string) {
  return parseLaw(text).problems;
}

test('check-slice §2: the sample law reads', () => {
  const { law, problems: found } = parseLaw(SAMPLE);
  assert.deepEqual(found, []);
  assert.ok(law);
  assert.deepEqual([...law.rules.keys()], ['no-console', 'no-todo']);
  assert.equal(law.rules.get('no-todo')!.status, 'advisory');
  assert.equal(law.rules.get('no-console')!.status, 'enforced');
  assert.equal(law.rules.get('no-todo')!.line, 6);
  assert.deepEqual(law.types.map((t) => t.id), ['source', 'script']);
  assert.deepEqual(law.types[0]!.types.map((t) => t.id), ['library', 'command']);
  assert.equal(law.byId.get('library')!.parent!.id, 'source');
});

test('check-slice §2: an unknown key names the nearest known key within two edits', () => {
  assert.deepEqual(problems(SAMPLE.replace('status: advisory', 'statuss: advisory')), [
    { line: 8, message: "unknown key 'statuss' in rule 'no-todo' (did you mean 'status'?)" },
  ]);
  assert.equal(nearestKey('pathz', ['about', 'paths', 'content']), 'paths');
  assert.equal(nearestKey('required', ['about', 'paths', 'content', 'rules', 'types']), null);
});

test('check-slice §2: the keys this slice leaves out are unknown keys', () => {
  for (const key of ['required: [x]', 'ignored: [x]']) {
    const found = problems(SAMPLE.replace('    about: Executable helpers.\n', `    about: Executable helpers.\n    ${key}\n`));
    assert.equal(found.length, 1, key);
    assert.match(found[0]!.message, /^unknown key/);
  }
});

const FOLDERS = SAMPLE.replace('rules:\n', 'required: ["src/**", "!src/**/*.md"]\nignored: ["src/gen/**"]\n\nrules:\n');

test('test 830: required and ignored take lists of patterns at the top of the law, and a law without them requires and leaves out nothing', () => {
  const { law, problems: found } = parseLaw(FOLDERS);
  assert.deepEqual(found, []);
  assert.deepEqual(law!.required.patterns, ['src/**', '!src/**/*.md']);
  assert.deepEqual(law!.ignored.patterns, ['src/gen/**']);
  assert.equal(law!.required.matches('src/a/b.js'), true);
  assert.equal(law!.required.matches('src/a/b.md'), false);
  assert.equal(law!.required.matches('lib/b.js'), false);
  assert.equal(law!.ignored.matches('src/gen/x.ts'), true);
  assert.equal(patternFor(law!.required, 'src/a/b.js'), 'src/**');
  assert.equal(patternFor(law!.required, 'src/a/b.md'), null);
  const plain = parseLaw(SAMPLE).law!;
  assert.deepEqual([plain.required.patterns, plain.ignored.patterns], [[], []]);
  assert.equal(plain.required.matches('src/a/b.js'), false);
  assert.equal(parseLaw(SAMPLE.replace('rules:\n', 'required: []\n\nrules:\n')).law!.required.matches('src/a.ts'), false);
});

test('test 830: required and ignored of the wrong kind, with a pattern that does not compile, or with only exclusions are law-invalid at their line', () => {
  const at = (key: string, value: string) => problems(SAMPLE.replace('rules:\n', `${key}: ${value}\n\nrules:\n`));
  assert.deepEqual(at('required', '"src/**"'), [{ line: 3, message: "'required' takes a sequence of strings, not a string" }]);
  assert.deepEqual(at('ignored', '{ a: 1 }'), [{ line: 3, message: "'ignored' takes a sequence of strings, not a mapping" }]);
  assert.deepEqual(at('required', '["!src/x.ts"]'), [{ line: 3, message: "'required' holds no pattern without '!'" }]);
  assert.deepEqual(at('ignored', '["src//x"]'), [{ line: 3, message: "the pattern 'src//x' of 'ignored' holds an empty segment" }]);
  assert.deepEqual(at('requird', '["src/**"]'), [{ line: 3, message: "unknown key 'requird' at the top of the law (did you mean 'required'?)" }]);
});

test('check-slice §2: values of the wrong kind', () => {
  assert.equal(problems('').length, 1);
  assert.match(problems('lawcheck: 1.0\n')[0]!.message, /'lawcheck' takes a string, not a number/);
  assert.match(problems('lawcheck: "1.0"\n')[0]!.message, /MAJOR\.MINOR\.PATCH/);
  assert.match(problems('lawcheck: 0.1.0\nrules:\n')[0]!.message, /'rules' takes a mapping, not nothing/);
  assert.match(problems('lawcheck: 0.1.0\nrules:\n  a:\n    why: |\n      two\n      lines\n')[0]!.message, /line break/);
  assert.match(problems(`lawcheck: 0.1.0\nrules:\n  a:\n    why: ${'x'.repeat(201)}\n`)[0]!.message, /200/);
  assert.match(problems('lawcheck: 0.1.0\nrules:\n  a:\n    status: advisory\n')[0]!.message, /has no 'why'/);
  assert.match(problems('lawcheck: 0.1.0\ntypes:\n  a:\n    about: x\n')[0]!.message, /has no 'paths'/);
  assert.match(problems('lawcheck: 0.1.0\ntypes:\n  a:\n    paths: ["!x/**"]\n')[0]!.message, /no pattern without '!'/);
});

test('check-slice §2: ids', () => {
  assert.match(problems('lawcheck: 0.1.0\nrules:\n  style/no-tabs:\n    why: x\n')[0]!.message, /kebab-case/);
  assert.match(problems('lawcheck: 0.1.0\nrules:\n  internal:\n    why: x\n')[0]!.message, /code of Lawcheck/);
  assert.match(problems('lawcheck: 0.1.0\nrules:\n  waiver-unused:\n    why: x\n')[0]!.message, /code of Lawcheck/);
  const twice = problems('lawcheck: 0.1.0\ntypes:\n  a:\n    paths: [x]\n    types:\n      b:\n        paths: [y]\n  b:\n    paths: [z]\n');
  assert.deepEqual(twice, [{ line: 8, message: "the type id 'b' appears twice in the law" }]);
  assert.equal(problems('lawcheck: 0.1.0\ntypes:\n  a:\n    paths: [x]\n  a:\n    paths: [y]\n').length, 1);
});

test('check-slice §2: a rule that a type lists and the law lacks', () => {
  assert.deepEqual(problems('lawcheck: 0.1.0\ntypes:\n  a:\n    paths: [x]\n    rules: [nope]\n'), [
    { line: 5, message: "type 'a' lists the rule 'nope', which the law does not have" },
  ]);
});

test('check-slice §2: a YAML error names its line', () => {
  const found = problems('lawcheck: 0.1.0\nrules: [\n');
  assert.equal(found.length >= 1, true);
  assert.match(found[0]!.message, /does not parse/);
});

test('check-slice §2: a key that YAML reads as no string is law-invalid', () => {
  for (const key of ['~', 'true', '1e3', '12']) {
    const found = problems(`lawcheck: 0.1.0\nrules:\n  ${key}:\n    why: x\n`);
    assert.ok(found.some((p) => p.line === 3 && /is no string/.test(p.message)), `${key}: ${JSON.stringify(found)}`);
  }
  assert.deepEqual(problems('lawcheck: 0.1.0\nrules:\n  "12":\n    why: x\n'), []);
});

test('check-slice §2: the code untyped-file is no rule id', () => {
  assert.match(problems('lawcheck: 0.1.0\nrules:\n  untyped-file:\n    why: x\n')[0]!.message, /code of Lawcheck/);
});

test('reviewer-slice §2: context is a sequence of paths, each with its line', () => {
  const { law } = parseLaw('lawcheck: 0.1.0\nrules:\n  a:\n    why: x\n    context:\n      - docs/one.md\n      - "docs/two.md"\n');
  assert.deepEqual(law!.rules.get('a')!.context, [{ path: 'docs/one.md', line: 6 }, { path: 'docs/two.md', line: 7 }]);
  assert.equal(law!.rules.get('a')!.contextLine, 5);
  assert.equal(parseLaw('lawcheck: 0.1.0\nrules:\n  a:\n    why: x\n').law!.rules.get('a')!.context, null);
  for (const value of ['"docs/a.md"', '[1]', '[docs/a.md, 2]', '', '{ a: b }']) {
    const found = problems(`lawcheck: 0.1.0\nrules:\n  a:\n    why: x\n    context: ${value}\n`);
    assert.equal(found.length, 1, value);
    assert.equal(found[0]!.line, 5, value);
    assert.match(found[0]!.message, /'context' of rule 'a' takes a sequence of paths/, value);
  }
});

test('reviewer-slice §2: the codes of the reviewer slice are no rule ids', () => {
  for (const id of ['not-reviewed', 'too-large-to-review', 'config-invalid', 'reviewer-not-configured', 'too-many-reviews', 'reviewer-unreachable', 'reviewer-bad-answer']) {
    assert.match(problems(`lawcheck: 0.1.0\nrules:\n  ${id}:\n    why: x\n`)[0]!.message, /code of Lawcheck/, id);
  }
});

test('dependency-slice §2: may_use: ids of types anywhere in the law, each once', () => {
  const text = 'lawcheck: 0.1.0\ntypes:\n  a:\n    paths: [x]\n    may_use: [b, a, b]\n  c:\n    paths: [y]\n    may_use: []\n    types:\n      b:\n        paths: [z]\n';
  const { law, problems: found } = parseLaw(text);
  assert.deepEqual(found, []);
  assert.deepEqual(law!.byId.get('a')!.mayUse, ['b', 'a']);
  assert.deepEqual(law!.byId.get('c')!.mayUse, []);
  assert.equal(law!.byId.get('b')!.mayUse, null);
  assert.equal(law!.byId.get('b')!.line, 10);
});

test('dependency-slice §2: may_use values that are law-invalid, at the item or at the key', () => {
  const at = (value: string) => problems(`lawcheck: 0.1.0\ntypes:\n  a:\n    paths: [x]\n    may_use: ${value}\n`);
  assert.deepEqual(at('[nope]').map((p) => p.line), [5]);
  assert.match(at('[nope]')[0]!.message, /'may_use' of type 'a' names 'nope', which is no type of the law/);
  for (const value of ['', 'a', '1', '{ a: 1 }', '~']) assert.deepEqual(at(value).map((p) => p.line), [5], value);
  for (const value of ['[1]', '[a, ~]', '[[a]]', '[{ a: 1 }]']) assert.equal(at(value).length, 1, value);
  const multi = problems('lawcheck: 0.1.0\ntypes:\n  a:\n    paths: [x]\n    may_use:\n      - a\n      - 1\n      - nope\n');
  assert.deepEqual(multi.map((p) => p.line), [7]);
  const unknown = problems('lawcheck: 0.1.0\ntypes:\n  a:\n    paths: [x]\n    may_use:\n      - a\n      - nope\n');
  assert.deepEqual(unknown.map((p) => p.line), [7]);
});

test('dependency-slice §2: the codes of the dependency slice are reserved', () => {
  for (const id of ['forbidden-use', 'uses-not-read', 'parser-failed']) {
    assert.match(problems(`lawcheck: 0.1.0\nrules:\n  ${id}:\n    why: x\n`)[0]!.message, /code of Lawcheck/, id);
  }
});

test('I-law-1: a type that holds itself through an alias is law-invalid at its line', () => {
  const { law, problems } = parseLaw('lawcheck: 0.1.0\ntypes:\n  t: &t\n    paths: ["**"]\n    types:\n      u: *t\n');
  assert.equal(law, null);
  assert.deepEqual(problems, [{ line: 6, message: "type 'u' is, through an alias, a type that holds it" }]);
});

test('I-law-1: a deeper cycle through two aliases is law-invalid too', () => {
  const { law, problems } = parseLaw('lawcheck: 0.1.0\ntypes:\n  a: &a\n    paths: ["a/**"]\n    types:\n      b: &b\n        paths: ["a/b/**"]\n        types:\n          c: *a\n');
  assert.equal(law, null);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!.message, /^type 'c' is, through an alias, a type that holds it$/);
});
