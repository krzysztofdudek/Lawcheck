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
