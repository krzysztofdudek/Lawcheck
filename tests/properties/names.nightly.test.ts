import { test } from 'node:test';
import { namesProperties } from './names.ts';
import { nightly } from './support.ts';

const properties = namesProperties(nightly());

test('I-files-1: a name maps back to its bytes, holds no line break, and the hooks write it the same way', () => properties['I-files-1: a name maps back to its bytes, holds no line break, and the hooks write it the same way']!());
test('I-files-1: every file a type matches is judged, whatever bytes its name holds, and its JSON path maps back to the file on disk', () => properties['I-files-1: every file a type matches is judged, whatever bytes its name holds, and its JSON path maps back to the file on disk']!());
