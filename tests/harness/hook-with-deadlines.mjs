import { DEADLINES } from '../../plugin/hooks/start.mjs';

// startHook of tests/harness/start.ts passes the deadlines of a test as JSON in this variable; it is removed before the hook runs, so neither the hook nor what it starts sees it.
const NAME = 'LAWCHECK_TEST_DEADLINES';

const given = JSON.parse(process.env[NAME] ?? 'null');
delete process.env[NAME];

function problem() {
  if (given === null || typeof given !== 'object' || Object.keys(given).length === 0) return `${NAME} names no deadline`;
  for (const [event, seconds] of Object.entries(given)) {
    if (!Object.hasOwn(DEADLINES, event)) return `${NAME} names ${event}, which is no hook`;
    if (typeof seconds !== 'number' || !(seconds > 0) || seconds >= DEADLINES[event]) return `${NAME} gives ${event} ${seconds} seconds, and a test deadline is shorter than the shipped ${DEADLINES[event]}`;
  }
  return null;
}

// A refusal is one line on standard error, written before the process ends: an uncaught error would print the source line, which a Windows checkout ends with CR.
const refused = problem();
if (refused !== null) {
  process.stderr.write(`${refused}\n`);
  process.exitCode = 1;
} else {
  Object.assign(DEADLINES, given);
  await import('../../plugin/hooks/lawcheck-hook.mjs');
}
