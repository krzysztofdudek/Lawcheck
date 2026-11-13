import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLaw, nearestKey } from '../../dist/law.js';

const SAMPLE = readFileSync(new URL('../sample/.lawcheck/law.yaml', import.meta.url), 'utf8');

function problems(text: string) {
  return parseLaw(text).problems;
}

test('the sample law reads', () => {
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

test('an unknown key names the nearest known key within two edits', () => {
  assert.deepEqual(problems(SAMPLE.replace('status: advisory', 'statuss: advisory')), [
    { line: 8, message: "unknown key 'statuss' in rule 'no-todo' (did you mean 'status'?)" },
  ]);
  assert.equal(nearestKey('pathz', ['about', 'paths', 'content']), 'paths');
  assert.equal(nearestKey('required', ['about', 'paths', 'content', 'rules', 'types']), null);
});

test('the keys this slice leaves out are unknown keys', () => {
  for (const key of ['required: [x]', 'ignored: [x]', 'may_use: [command]']) {
    const found = problems(SAMPLE.replace('    about: Executable helpers.\n', `    about: Executable helpers.\n    ${key}\n`));
    assert.equal(found.length, 1, key);
    assert.match(found[0]!.message, /^unknown key/);
  }
});

test('values of the wrong kind', () => {
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

test('ids', () => {
  assert.match(problems('lawcheck: 0.1.0\nrules:\n  style/no-tabs:\n    why: x\n')[0]!.message, /kebab-case/);
  assert.match(problems('lawcheck: 0.1.0\nrules:\n  internal:\n    why: x\n')[0]!.message, /code of Lawcheck/);
  assert.match(problems('lawcheck: 0.1.0\nrules:\n  waiver-unused:\n    why: x\n')[0]!.message, /code of Lawcheck/);
  const twice = problems('lawcheck: 0.1.0\ntypes:\n  a:\n    paths: [x]\n    types:\n      b:\n        paths: [y]\n  b:\n    paths: [z]\n');
  assert.deepEqual(twice, [{ line: 8, message: "the type id 'b' appears twice in the law" }]);
  assert.equal(problems('lawcheck: 0.1.0\ntypes:\n  a:\n    paths: [x]\n  a:\n    paths: [y]\n').length, 1);
});

test('a rule that a type lists and the law lacks', () => {
  assert.deepEqual(problems('lawcheck: 0.1.0\ntypes:\n  a:\n    paths: [x]\n    rules: [nope]\n'), [
    { line: 5, message: "type 'a' lists the rule 'nope', which the law does not have" },
  ]);
});

test('a YAML error names its line', () => {
  const found = problems('lawcheck: 0.1.0\nrules: [\n');
  assert.equal(found.length >= 1, true);
  assert.match(found[0]!.message, /does not parse/);
});

test('a key that YAML reads as no string is law-invalid', () => {
  for (const key of ['~', 'true', '1e3', '12']) {
    const found = problems(`lawcheck: 0.1.0\nrules:\n  ${key}:\n    why: x\n`);
    assert.ok(found.some((p) => p.line === 3 && /is no string/.test(p.message)), `${key}: ${JSON.stringify(found)}`);
  }
  assert.deepEqual(problems('lawcheck: 0.1.0\nrules:\n  "12":\n    why: x\n'), []);
});

test('the code untyped-file is no rule id', () => {
  assert.match(problems('lawcheck: 0.1.0\nrules:\n  untyped-file:\n    why: x\n')[0]!.message, /code of Lawcheck/);
});

test('context is a sequence of paths, each with its line', () => {
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

test('the codes of the reviewer slice are no rule ids', () => {
  for (const id of ['not-reviewed', 'too-large-to-review', 'config-invalid', 'reviewer-not-configured', 'too-many-reviews', 'reviewer-unreachable', 'reviewer-bad-answer']) {
    assert.match(problems(`lawcheck: 0.1.0\nrules:\n  ${id}:\n    why: x\n`)[0]!.message, /code of Lawcheck/, id);
  }
});
