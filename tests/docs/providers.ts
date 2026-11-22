import type { Claims } from '../contract/docs-blocks.ts';

const READ = 'tests/acceptance/docs.test.ts > test 129: every page holds what section 7 asks, and its examples are real';

export const claims: Claims = {
  'block 1 under "openai"': READ,
  'block 1 under "ollama"': READ,
  'block 2 under "ollama"': READ,
  'block 1 under "codex"': READ,
  'block 1 under "Checking the setup"': READ,
};
