import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lawChangeLine, named } from '../../dist/lawchange.js';

test('S7-3: a path is shown with control, format and separator characters as escapes, except the joiners', () => {
  assert.equal(named('.lawcheck/rules/lib/a\u001b[2Kb\u0085c\u2028d\u202ee\u007f.mjs'), '.lawcheck/rules/lib/a\\u001b[2Kb\\u0085c\\u2028d\\u202ee\\u007f.mjs');
  assert.equal(named('a\u200db\u200cc'), 'a\u200db\u200cc');
  assert.equal(named('plain/name.mjs'), 'plain/name.mjs');
  assert.equal(named('a\u{e0001}b'), 'a\\u{e0001}b');
});

test('S7-3: the line holds five items and counts the rest', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.equal(lawChangeLine(items.slice(0, 5)), 'note: this change edits the law that judges it: a; b; c; d; e');
  assert.equal(lawChangeLine(items), 'note: this change edits the law that judges it: a; b; c; d; e; and 2 more');
});

test('S7-3: a literal backslash in a name is escaped, so a name never reads as an escape of its own', () => {
  assert.equal(named('a\\u001b'), 'a\\\\u001b');
  assert.equal(named('a\\\\b'), 'a\\\\\\\\b');
});

const SAID_TO_LOOSEN = [
  'removes the type library',
  'removes the rule no-console',
  'removes the signer alice',
  'adds the signer mallory',
  'changes the key of the signer alice',
  'makes the rule no-console advisory',
  'takes the rule no-console off the type library',
  'adds src/gen/** to ignored',
  'adds !src/legacy/** to required',
  'takes src/** off required',
  'takes !src/gen/keep/** off ignored',
];
const MAY_LOOSEN = [
  'changes may_use of the type library',
  'changes the waivers of the type library',
  'changes the paths of the type library',
  'changes the content of the type library',
  'moves the type library from source to the top of types',
  'changes .lawcheck/rules/no-console.mjs',
  'removes .lawcheck/rules/no-console.md',
  'changes .lawcheck/law.yaml',
  'removes .lawcheck/law.yaml',
  'adds the type special',
];
const NOT_LOOSENING = [
  'adds the rule extra',
  'makes the rule no-todo enforced',
  'puts the rule no-console on the type command',
  'changes the why of the rule no-console',
  'changes the context of the rule clear-errors',
  'changes the companion of the rule clear-errors',
  'changes the about of the type library',
  'adds src/** to required',
  'takes !src/legacy/** off required',
  'takes src/gen/** off ignored',
  'adds !src/gen/keep/** to ignored',
  'changes required',
  'changes ignored',
  'adds .lawcheck/law.yaml',
  'edits .lawcheck/law.yaml without changing a rule or a type',
  'adds .lawcheck/rules/extra.mjs',
  'adds .lawcheck/config.yaml',
  'removes .lawcheck/config.yaml',
  'changes .lawcheck/config.yaml',
];

function shownItems(items: string[]): string[] {
  return lawChangeLine(items).slice('note: this change edits the law that judges it: '.length).split('; ').slice(0, 5);
}

test('test 1370: S7-3, past five items, each item that loosens the law or may loosen it goes before every item that does not', () => {
  for (const item of [...SAID_TO_LOOSEN, ...MAY_LOOSEN]) assert.equal(shownItems([...NOT_LOOSENING, item])[0], item, item);
  for (const item of NOT_LOOSENING) assert.ok(!shownItems(['a', 'b', 'c', 'd', 'e', item]).includes(item), item);
});

test('test 1370: S7-3, what the words say loosens the law goes before what may loosen it, and an added type comes after both', () => {
  const [certain, other] = ['takes the rule no-console off the type library', 'adds src/gen/** to ignored'];
  assert.deepEqual(shownItems(['adds the type special', 'changes the paths of the type a', certain!, 'changes may_use of the type b', other!, 'adds the rule extra']), [certain, other, 'changes the paths of the type a', 'changes may_use of the type b', 'adds the type special']);
});
