import { test } from 'node:test';
import { gitStatesProperties } from './git-states.ts';
import { COMMIT } from './support.ts';

const properties = gitStatesProperties(COMMIT);

test('I-git-2: in any state a sequence of git commands leaves, a check changes nothing in git, its change gives what --full gives for those files, and it prints the same from below the root and twice', () => properties['I-git-2: in any state a sequence of git commands leaves, a check changes nothing in git, its change gives what --full gives for those files, and it prints the same from below the root and twice']!());
