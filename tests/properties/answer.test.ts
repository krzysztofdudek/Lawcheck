import { test } from 'node:test';
import { answerProperties } from './answer.ts';
import { COMMIT } from './support.ts';

const properties = answerProperties(COMMIT);

test('I-answer-1: S3-3, the answer read is the one the reading of section 4 takes, on small input', () => properties['I-answer-1: S3-3, the answer read is the one the reading of section 4 takes, on small input']!());
test('I-answer-1: S3-3, any answer is a verdict or a named bad answer, in linear time, with lines in or out of range', () => properties['I-answer-1: S3-3, any answer is a verdict or a named bad answer, in linear time, with lines in or out of range']!());
test('I-answer-1: S3-4, two verdict objects that agree give their verdict, and a pass followed by a fail is never read as a pass', () => properties['I-answer-1: S3-4, two verdict objects that agree give their verdict, and a pass followed by a fail is never read as a pass']!());
