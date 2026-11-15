import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLaw } from '../../dist/law.js';
import { alternatives, fileText, names, walkPath } from '../../dist/explain.js';

const law = parseLaw(`lawcheck: 0.1.0
types:
  source:
    paths: ["src/**"]
    types:
      lib:
        paths: ["src/lib/**"]
      entry:
        paths: ["src/lib/main.ts"]
        content: "^#!"
      both:
        paths: ["src/two/**"]
      twin:
        paths: ["src/two/**"]
  script:
    paths: ["tools/**"]
    content: "^#!"
  hook:
    paths: ["tools/**", "hooks/**"]
    content: "^// hook"
`).law!;

const ids = (types: { id: string }[]) => types.map((t) => t.id);

test('commands-slice §6: the walk goes down while one type without content matches', () => {
  assert.deepEqual(ids(walkPath(law.types, 'src/lib/a.ts').chain), ['source', 'lib']);
  assert.deepEqual(walkPath(law.types, 'src/lib/a.ts').stop, []);
  assert.deepEqual(ids(walkPath(law.types, 'README.md').chain), []);
});

test('commands-slice §6: it stops at the root where only types with content match', () => {
  const { chain, stop } = walkPath(law.types, 'tools/x.mjs');
  assert.deepEqual(ids(chain), []);
  assert.deepEqual(alternatives(stop, null), { then: 'script if its text matches "^#!"; hook if its text matches "^// hook"; otherwise none', overlap: false });
});

test('commands-slice §6: below the root, beside a type without content, and two without content', () => {
  const beside = walkPath(law.types, 'src/lib/main.ts');
  assert.deepEqual(ids(beside.chain), ['source']);
  assert.deepEqual(alternatives(beside.stop, beside.chain[0]!), { then: 'a type-overlap of lib and entry if its text matches "^#!"; otherwise lib', overlap: false });
  const two = walkPath(law.types, 'src/two/a.ts');
  assert.deepEqual(alternatives(two.stop, two.chain[0]!), { then: 'any file here matches both and twin at one level (type-overlap)', overlap: true });
});

test('commands-slice §6: names join with and', () => {
  assert.equal(names(['a']), 'a');
  assert.equal(names(['a', 'b']), 'a and b');
  assert.equal(names(['a', 'b', 'c']), 'a, b and c');
});

test('commands-slice §6: a file that does not exist has no waivers line', () => {
  const source = law.byId.get('source')!;
  const text = fileText({ path: 'src/x.ts', exists: false, type: source, chain: [source], none: null, matched: [{ type: 'source', pattern: 'src/**', content: null }], notMatched: [], then: null, uses: null, rules: [], waivers: [] });
  assert.equal(text, 'src/x.ts  (does not exist yet)\n  type:  source  (source)\n  matched:  source by "src/**"\n  may use:  any file; no type on the way up has may_use\n  rules:  none\n');
});
