import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addedWaivers, parseWaivers, waive } from '../../dist/waivers.js';

const RULES = new Set(['no-console', 'no-todo']);

test('check-slice §5: a waiver after code covers its own line; one on a line of its own covers the next line that does not stand alone', () => {
  const { waivers, problems } = parseWaivers(
    [
      'x(); // lawcheck-waive no-console -- own line',
      '// lawcheck-waive no-console -- first',
      '  /* lawcheck-waive no-todo -- second */',
      'y();',
      '// lawcheck-waive no-todo -- at the end',
    ],
    RULES,
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(
    waivers.map((w) => [w.line, w.rule, w.reason, w.covers]),
    [
      [1, 'no-console', 'own line', 1],
      [2, 'no-console', 'first', 4],
      [3, 'no-todo', 'second', 4],
      [5, 'no-todo', 'at the end', null],
    ],
  );
});

test('check-slice §5: the reason drops a closing comment and is trimmed', () => {
  const { waivers } = parseWaivers(['<!-- lawcheck-waive no-console --   a demo  -->', 'x'], RULES);
  assert.equal(waivers[0]!.reason, 'a demo');
});

test('check-slice §5: the first marker counts; a second one on the line is text', () => {
  const { waivers } = parseWaivers(['a // lawcheck-waive no-todo -- see lawcheck-waive no-console -- x'], RULES);
  assert.deepEqual(waivers.map((w) => [w.rule, w.reason]), [['no-todo', 'see lawcheck-waive no-console -- x']]);
});

test('check-slice §5: problems', () => {
  const { waivers, problems } = parseWaivers(
    [
      '// lawcheck-waive',
      '// lawcheck-waive-file no-console -- x',
      '// lawcheck-waive no-such -- x',
      '// lawcheck-waive no-console',
      '// lawcheck-waive no-console --',
      '// lawcheck-waive no-console -- */',
      '// lawcheck-waive no-console reason without dashes',
      'x',
    ],
    RULES,
  );
  assert.deepEqual(waivers, []);
  assert.deepEqual(
    problems.map((p) => [p.line, p.code]),
    [
      [1, 'waiver-unknown-rule'],
      [2, 'waiver-unknown-rule'],
      [3, 'waiver-unknown-rule'],
      [4, 'waiver-without-reason'],
      [5, 'waiver-without-reason'],
      [6, 'waiver-without-reason'],
      [7, 'waiver-without-reason'],
    ],
  );
});

test('check-slice §5: a finding is credited to the waiver on its own line first, then to the nearest one above', () => {
  const { waivers } = parseWaivers(
    ['// lawcheck-waive no-console -- far', '// lawcheck-waive no-console -- near', 'x(); // lawcheck-waive no-console -- own'],
    RULES,
  );
  assert.equal(waive(waivers, 'no-console', 3), true);
  assert.deepEqual(waivers.map((w) => w.waived), [0, 0, 1]);
  const above = parseWaivers(['// lawcheck-waive no-console -- far', '// lawcheck-waive no-console -- near', 'x();'], RULES).waivers;
  assert.equal(waive(above, 'no-console', 3), true);
  assert.deepEqual(above.map((w) => w.waived), [0, 1]);
  assert.equal(waive(above, 'no-todo', 3), false);
});

test('check-slice §5: a closing comment is cut off before the separator is looked for', () => {
  const { waivers, problems } = parseWaivers(
    [
      'console.log(3); <!-- lawcheck-waive no-console -->',
      'console.log(4); <!-- lawcheck-waive no-console -- -->',
      'console.log(5); /* lawcheck-waive no-console */',
      'console.log(6); <!-- lawcheck-waive no-console -- kept -->',
    ],
    RULES,
  );
  assert.deepEqual(problems.map((p) => [p.line, p.code]), [
    [1, 'waiver-without-reason'],
    [2, 'waiver-without-reason'],
    [3, 'waiver-without-reason'],
  ]);
  assert.deepEqual(waivers.map((w) => [w.line, w.reason]), [[4, 'kept']]);
});

test('test 850: a waiver counts as added when the base holds fewer of its rule with its reason, and of equal ones the line the base lacks is the added one', () => {
  const added = (before: string[], now: string[]) => {
    const old = parseWaivers(before, RULES).waivers;
    const parsed = parseWaivers(now, RULES).waivers;
    const found = addedWaivers(parsed, now, old, before);
    return parsed.filter((w) => found.has(w)).map((w) => w.line);
  };
  const a = 'a(); // lawcheck-waive no-console -- legacy';
  const b = 'b(); // lawcheck-waive no-console -- legacy';
  assert.deepEqual(added([], [a]), [1]);
  assert.deepEqual(added([a], ['', a]), [], 'a waiver that moved is no addition');
  assert.deepEqual(added([a], [b, a]), [1]);
  assert.deepEqual(added([a], [a, b]), [2]);
  assert.deepEqual(added([a, a], [a, a, a]), [3]);
  assert.deepEqual(added([a], [a.replace('legacy', 'new reason')]), [1], 'a new reason is a new waiver');
  assert.deepEqual(added([a], [a.replace('no-console', 'no-todo')]), [1]);
});
