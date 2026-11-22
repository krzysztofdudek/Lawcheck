import type { Claims } from '../contract/docs-blocks.ts';

const WALK = 'tests/acceptance/first-law-docs.test.ts > test 309: R-7, the first-law page walked top to bottom in a new repository: every command it gives prints, byte for byte, the output the page shows after it';

export const claims: Claims = {
  'block 1 under "Start the law"': WALK,
  'block 2 under "Start the law"': WALK,
  'example first-law-type': WALK,
  'block 2 under "Describe one type"': WALK,
  'block 3 under "Describe one type"': WALK,
  'example first-law-entry': WALK,
  'block 2 under "Write one script rule"': WALK,
  'example first-law-rule': WALK,
  'block 1 under "Try it before a type lists it"': WALK,
  'block 2 under "Try it before a type lists it"': WALK,
  'block 3 under "Try it before a type lists it"': WALK,
  'block 4 under "Try it before a type lists it"': WALK,
  'block 5 under "Try it before a type lists it"': WALK,
  'block 6 under "Try it before a type lists it"': WALK,
  'example first-law-law': WALK,
  'block 1 under "See the debt"': WALK,
  'block 2 under "See the debt"': WALK,
  'block 1 under "Pay the debt, or start advisory"': 'tests/acceptance/docs.test.ts > test 129: every page holds what section 7 asks, and its examples are real',
};
