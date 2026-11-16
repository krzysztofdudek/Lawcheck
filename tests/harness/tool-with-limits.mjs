import { LIMITS } from '../../dist/rules.js';

// startTool of tests/harness/start.ts passes the limits of a test as JSON in this variable; it is removed before the tool runs, so neither the tool nor what it starts sees it.
const NAME = 'LAWCHECK_TEST_LIMITS';

const given = JSON.parse(process.env[NAME] ?? 'null');
delete process.env[NAME];

function problem() {
  if (given === null || typeof given !== 'object' || Object.keys(given).length === 0) return `${NAME} names no limit`;
  for (const [name, value] of Object.entries(given)) {
    if (!Object.hasOwn(LIMITS, name)) return `${NAME} names ${name}, which is no limit of the tool`;
    if (typeof value !== 'number' || !(value > 0) || value >= LIMITS[name]) return `${NAME} gives ${name} ${value}, and a test limit is shorter than the shipped ${LIMITS[name]}`;
  }
  return null;
}

// A refusal is one line on standard error, written before the process ends: an uncaught error would print the source line, which a Windows checkout ends with CR.
const refused = problem();
if (refused !== null) {
  process.stderr.write(`${refused}\n`);
  process.exitCode = 1;
} else {
  Object.assign(LIMITS, given);
  await import('../../dist/bin.cjs');
}
