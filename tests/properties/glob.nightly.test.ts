import { test } from 'node:test';
import { globProperties } from './glob.ts';
import { nightly } from './support.ts';

const properties = globProperties(nightly());

test('I-glob-1, S1-1: a pattern matches as the reference matcher does, on small input', () => properties['I-glob-1, S1-1: a pattern matches as the reference matcher does, on small input']!());
test('I-glob-1, S1-1: a list with exclusions matches as the reference does', () => properties['I-glob-1, S1-1: a list with exclusions matches as the reference does']!());
test('I-glob-1, S1-1: any text is a pattern that compiles or one with a named problem', () => properties['I-glob-1, S1-1: any text is a pattern that compiles or one with a named problem']!());
test('I-glob-1, S1-1: a match costs time linear in the name, for any pattern and a name of up to 4,096 bytes', () => properties['I-glob-1, S1-1: a match costs time linear in the name, for any pattern and a name of up to 4,096 bytes']!());
