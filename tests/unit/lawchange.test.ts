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
