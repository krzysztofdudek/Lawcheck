import { test } from 'node:test';
import { argumentsProperties } from './arguments.ts';
import { nightly } from './support.ts';

const properties = argumentsProperties(nightly());

test('I-args-1: tokens of the tool and junk give usage or a run, never internal, and change nothing in git', () => properties['I-args-1: tokens of the tool and junk give usage or a run, never internal, and change nothing in git']!());
test('I-hook-1, S6-6, S6-8: any input to a hook gives exit 0 with nothing or one hook document, or the defined notice, never a stack trace', () => properties['I-hook-1, S6-6, S6-8: any input to a hook gives exit 0 with nothing or one hook document, or the defined notice, never a stack trace']!());
