import type { Claims } from '../contract/docs-blocks.ts';

// The Example of a code is compared with the output of the first case of that code, in the test of codes.test.ts that runs the case.
const CODES = 'tests/contract/codes.test.ts > ';
const BY: Record<string, string[]> = {
  'check-slice §6: usage, not-initialized, already-initialized, no-git and unsupported-environment, in text and in JSON, and the commands their next lines name': ['usage', 'not-initialized', 'already-initialized', 'no-git', 'unsupported-environment'],
  'check-slice §6: law-invalid, config-invalid, rule-missing-file, rule-file-without-entry and type-overlap, in text and in JSON, and the commands their next lines name': ['law-invalid', 'config-invalid', 'rule-missing-file', 'rule-file-without-entry', 'type-overlap'],
  'check-slice §6: base-unreachable, rule-crashed, parser-failed, internal, link-outside-root, path-unsupported and runner-failed, in text and in JSON, and the commands their next lines name': ['base-unreachable', 'rule-crashed', 'parser-failed', 'internal', 'link-outside-root', 'path-unsupported', 'runner-failed'],
  'check-slice §6: the reviewer codes, in text and in JSON, and the commands their next lines name': ['reviewer-not-configured', 'too-many-reviews', 'reviewer-unreachable', 'reviewer-bad-answer', 'not-a-signer', 'not-reviewed', 'too-large-to-review'],
  'check-slice §6: the findings, with their exit codes and the exact text the spec fixes, and the notes of doctor': ['forbidden-use', 'uses-not-read', 'untyped-file', 'waiver-unknown-rule', 'waiver-without-reason', 'waiver-unused'],
  'tests 232, 233, 236, 241 and 277: file-too-large, text-too-large, too-many-findings, file-unwritable and memory-too-large, in text and in JSON, and the commands their next lines name': ['file-too-large', 'text-too-large', 'too-many-findings', 'file-unwritable', 'memory-too-large'],
  'test 239: stopped, in text and in JSON, and the command its next line names': ['stopped'],
  'check-slice §6: file-unreadable, in text and in JSON, and its next line gets further': ['file-unreadable'],
  'test 1075: law-from-unreachable, in text and in JSON, and its next line': ['law-from-unreachable'],
};

const NIGHTLY = 'tests/limits/large.nightly.test.ts > ';

export const claims: Claims = {
  ...Object.fromEntries(Object.entries(BY).flatMap(([name, codes]) => codes.map((code) => [`block 1 under "${code}"`, CODES + name]))),
  'block 1 under "rules-too-slow"': `${NIGHTLY}test 251: S2-5, rules that take 29 seconds a file are stopped when the script rules of the run pass 600 seconds`,
  'block 1 under "step-too-slow"': `${NIGHTLY}test 255: S1-1, a step that never ends, typing against a content pattern that backtracks, ends as step-too-slow after 30 seconds`,
};
