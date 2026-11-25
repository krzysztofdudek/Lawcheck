import type { Claims } from '../contract/docs-blocks.ts';

const ANNOTATE = 'tests/acceptance/ci-docs.test.ts > S7-13: the recipes of docs/ci-findings.md turn --json into GitHub annotations and a GitLab code quality report, run as written';

const SARIF = 'tests/acceptance/ci-docs.test.ts > test 1033: the code scanning recipe of docs/ci-findings.md writes the SARIF file of every file from the first check, run as written on a pull request and on a push, and uploads it when the check fails too';

export const claims: Claims = {
  'example annotations-script': ANNOTATE,
  'example annotations-step': ANNOTATE,
  'example code-quality-script': ANNOTATE,
  'example gitlab-code-quality-job': ANNOTATE,
  'example sarif-upload': SARIF,
};
