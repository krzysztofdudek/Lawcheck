import type { Claims } from '../contract/docs-blocks.ts';

const WALK = 'tests/acceptance/first-law-docs.test.ts > test 309: R-7, the first-law page walked top to bottom in a new repository: every command it gives prints, byte for byte, the output the page shows after it';

export const claims: Claims = {
  'block 1 under "1. Start the law"': WALK,
  'block 2 under "1. Start the law"': WALK,
  'example first-law-type': WALK,
  'block 1 under "3. See what a file gets"': WALK,
  'block 2 under "3. See what a file gets"': WALK,
  'example first-law-entry': WALK,
  'block 1 under "5. Make the rules folder"': WALK,
  'example first-law-rule': WALK,
  'block 1 under "7. Try the rule on one file"': WALK,
  'block 2 under "7. Try the rule on one file"': WALK,
  'block 1 under "8. Try it on a file that breaks it"': WALK,
  'block 2 under "8. Try it on a file that breaks it"': WALK,
  'block 1 under "9. Try it on a whole folder"': WALK,
  'block 2 under "9. Try it on a whole folder"': WALK,
  'example first-law-law': WALK,
  'block 2 under "10. List the rule on the type"': WALK,
  'block 3 under "10. List the rule on the type"': WALK,
  'block 1 under "11. See the debt"': WALK,
  'block 2 under "11. See the debt"': WALK,
  'block 1 under "12. Fix the debt, or start the rule advisory"': 'tests/acceptance/docs.test.ts > test 129: every page holds what section 7 asks, and its examples are real',
};
