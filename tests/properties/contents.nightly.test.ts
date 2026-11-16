import { test } from 'node:test';
import { contentsProperties } from './contents.ts';
import { nightly } from './support.ts';

const properties = contentsProperties(nightly());

test('I-lines-1: lines split as section 3 says, and every waiver sits on a line of the file and covers one', () => properties['I-lines-1: lines split as section 3 says, and every waiver sits on a line of the file and covers one']!());
test('I-lines-1: a file is binary exactly when its first 8,000 bytes hold a NUL', () => properties['I-lines-1: a file is binary exactly when its first 8,000 bytes hold a NUL']!());
test('I-lines-1: for any text of a judged file, every finding lies inside it, and the text and JSON forms agree', () => properties['I-lines-1: for any text of a judged file, every finding lies inside it, and the text and JSON forms agree']!());
