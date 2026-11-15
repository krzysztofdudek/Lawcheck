import { test } from 'node:test';
import { lawProperties } from './law.ts';
import { COMMIT } from './support.ts';

const properties = lawProperties(COMMIT);

test('I-law-1: any text as law.yaml is a law or law-invalid at a line of the file', () => properties['I-law-1: any text as law.yaml is a law or law-invalid at a line of the file']!());
test('I-law-1: an accepted law is printed back by explain, every type and every rule whole', () => properties['I-law-1: an accepted law is printed back by explain, every type and every rule whole']!());
test('I-law-1: any text as config.yaml is a config or config-invalid at a line of the file', () => properties['I-law-1: any text as config.yaml is a config or config-invalid at a line of the file']!());
