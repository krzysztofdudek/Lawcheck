import { test } from 'node:test';
import { rulesProperties } from './rules.ts';
import { nightly } from './support.ts';

const properties = rulesProperties(nightly());

test('I-rules-1: S2-4, S2-6, any value a rule returns, throws or rejects with gives findings or a rule-crashed naming its cause, and file A is judged the same alone or with B', () => properties['I-rules-1: S2-4, S2-6, any value a rule returns, throws or rejects with gives findings or a rule-crashed naming its cause, and file A is judged the same alone or with B']!());
