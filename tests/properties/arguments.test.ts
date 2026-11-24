import { test } from 'node:test';
import { argumentsProperties, hookInputs } from './arguments.ts';
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
