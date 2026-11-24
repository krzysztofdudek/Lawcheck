import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { argumentsProperties, hookInputs, patchText } from './arguments.ts';
import { COMMIT, tool } from './support.ts';

const properties = argumentsProperties(COMMIT);

test('I-args-1: tokens of the tool and junk give usage or a run, never internal, and change nothing in git', () => properties['I-args-1: tokens of the tool and junk give usage or a run, never internal, and change nothing in git']!());
test('I-hook-1: S6-6, S6-8, any input to a hook gives exit 0 with nothing or one hook document, or the defined notice, never a stack trace', () => properties['I-hook-1: S6-6, S6-8, any input to a hook gives exit 0 with nothing or one hook document, or the defined notice, never a stack trace']!());

test('R-77: the 25 cases of the hook property of I-hook-1 reach every class it claims, the byte-order mark at the start of the input included, on each seed that once missed it', async () => {
  for (const seed of [2, 777, 99, 12345]) {
    const { arbitrary, claim } = hookInputs('/repository');
    await tool({ nightly: false, seed }, arbitrary, claim, async () => undefined);
  }
});

test('test 1330: the patch text of the hook property of I-hook-1 holds a path of any JSON shape, an object whose toString is not a function included, and every input it draws is built', () => {
  for (const path of [{ toString: 1 }, { toString: 1, valueOf: 2 }, { toString: null }, { a: { toString: 'x' } }, [{ toString: 1 }], 'src/a.ts', null, 7]) {
    const text = patchText(JSON.parse(JSON.stringify(path)));
    assert.match(text, /^\*\*\* Begin Patch\n\*\*\* Update File: [^\n]*\n\*\*\* End Patch\n$/s);
  }
  assert.equal(patchText({ a: 1 }), '*** Begin Patch\n*** Update File: [object Object]\n*** End Patch\n');
  assert.equal(patchText(['a', 'b']), '*** Begin Patch\n*** Update File: a,b\n*** End Patch\n');
  assert.equal(patchText({ toString: 1 }), '*** Begin Patch\n*** Update File: {"toString":1}\n*** End Patch\n');
  const { arbitrary } = hookInputs('/repository');
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) assert.equal(fc.sample(arbitrary, { numRuns: 5000, seed }).length, 5000);
});
