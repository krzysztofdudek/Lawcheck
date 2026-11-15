import * as NUMBERS from './numbers.ts';

export type Speed = 'loop' | 'commit' | 'nightly';

export const SPEED: Speed = ((): Speed => {
  const value = process.env.LAWCHECK_SPEED;
  return value === 'loop' || value === 'nightly' ? value : 'commit';
})();

export const SEED = 20261115;

export const CASES_PURE = 100;
export const CASES_TOOL = 25;
export const CASES_LOOP = 25;

export const TEST_BUDGET_MS = 20_000;
export const RUN_BUDGET_MS = 20_000;
export const LOOP_TARGET_MS = 30_000;
export const COMMIT_TARGET_MS = 600_000;
export const LEFTOVER_GRACE_MS = 2_000;
export const KILLED_GRACE_MS = 5_000;

// The whole-repository runs of tests/real on hono and gson, and one check --review of the stability fixture, 30 reviewer calls through a real model.
export const REAL_RUN_BUDGET_MS = 300_000;
export const STABILITY_RUN_BUDGET_MS = 900_000;

// spec/reviewer-slice.md, test 67: reviewer.timeout of 1 second, then SIGTERM and SIGKILL 5 seconds later.
export const CLAUDE_TIMEOUT_RUN_MS = 15_000;
export const FAKE_STARTED_MS = 20_000;

// spec/plugin-slice.md, test 163: within 30 seconds, within 150 seconds, SIGTERM after 2 seconds.
export const HOOK_EDIT_DEADLINE_MS = 30_000;
export const HOOK_STOP_DEADLINE_MS = 150_000;
export const HOOK_SIGTERM_AFTER_MS = 2_000;
export const STOPPED_HOOK_ENDS_MS = 10_000;

// Rule 7 of section 16 of the test design: a time budget is at least 20 times the measured time.
export const SLOW_MARGIN = 20;

export type System = 'linux' | 'darwin' | 'win32';

export interface Slow {
  // The tool's fixed waits in the test, which the margin does not multiply.
  fixed: number;
  // The longest time measured on CI, per system where the test needs more than TEST_BUDGET_MS.
  measured: Partial<Record<System, number>>;
}

// The tests that need more than TEST_BUDGET_MS on some system, by the test file and the whole test name. On each system listed the budget is the fixed waits plus SLOW_MARGIN times the rest of the measured time, rounded up to 5 s.
export const SLOW_TESTS: Record<string, Slow> = {
  // The 30 seconds a rule may run (spec/check-slice.md, section 3).
  'tests/acceptance/rules.test.ts > test 24: a rule that hangs is stopped': { fixed: 30_000, measured: { linux: 30_495, darwin: 30_865, win32: 32_283 } },
  // The hook deadlines of 25 and 145 seconds (spec/plugin-slice.md, section 4) and the SIGTERM 2 seconds into the third hook.
  'tests/acceptance/plugin.test.ts > test 163: the deadline, and a hook that is stopped': { fixed: 172_000, measured: { linux: 172_534, darwin: 173_654, win32: 172_514 } },
  // reviewer.timeout of 1 second, then SIGKILL 5 seconds after the SIGTERM (spec/reviewer-slice.md, section 6).
  'tests/acceptance/providers.test.ts > test 67: claude-code past its timeout, and the tool killed': { fixed: 6_000, measured: { linux: 7_770, darwin: 10_541, win32: 21_828 } },
  // A check per counted run of the committed trial.
  'tests/acceptance/agent-result.test.ts > test 181: the committed result of the trial': { fixed: 0, measured: { linux: 10_314, darwin: 20_602, win32: 53_052 } },
  // Four runs of the stability script, each starting the tool for 30 reviews.
  'tests/acceptance/stability.test.ts > test 77: the measurement refuses to run, or to write a secret': { fixed: 0, measured: { linux: 10_634, darwin: 20_324, win32: 44_728 } },
  // STABILITY_RUNS runs of 30 calls of the fake claude, each a process; on Windows ten runs took 116.8 s and two took 13.5 s (CI run 43741999136).
  'tests/acceptance/stability.test.ts > test 76: the measurement through claude-code': { fixed: 0, measured: { linux: 18_719, darwin: 20_439, win32: 13_530 } },
  // 300 requests to the fake reviewer.
  'tests/acceptance/stability.test.ts > test 76: the measurement against the fake': { fixed: 0, measured: { linux: 6_267, darwin: 5_463, win32: 16_603 } },
  // Four runners through four hooks each.
  'tests/acceptance/plugin.test.ts > test 158: every runner starts the same Lawcheck with its own words': { fixed: 0, measured: { linux: 7_839, darwin: 9_922, win32: 23_891 } },
  // A hook run per step of eight scenarios, each with its own commits.
  'tests/acceptance/plugin.test.ts > test 169: what counts as changed in the turn': { fixed: 0, measured: { darwin: 7_137, win32: 22_195 } },
  // The hand-back and the guard through a run of hooks.
  'tests/acceptance/plugin.test.ts > test 166 and 167: the hand-back, and the guard': { fixed: 0, measured: { darwin: 8_965, win32: 14_528 } },
  // A run per way of giving the endpoint and the key.
  'tests/acceptance/providers.test.ts > test 64: the endpoint and the key come from the environment': { fixed: 0, measured: { win32: 15_317 } },
  // Seven runs through the fake claude.
  'tests/acceptance/providers.test.ts > test 66: claude-code': { fixed: 0, measured: { darwin: 5_715, win32: 10_952 } },
  // Nine bad answers, a run and a resend each.
  'tests/acceptance/reviewer.test.ts > test 56: a bad answer is asked once more, then fails the run': { fixed: 0, measured: { darwin: 6_909, win32: 20_651 } },
  // A run per form of answer.
  'tests/acceptance/reviewer.test.ts > test 55: each form of a good answer': { fixed: 0, measured: { win32: 17_398 } },
  // Eleven configs, a run each.
  'tests/acceptance/reviewer-law.test.ts > test 68: config-invalid': { fixed: 0, measured: { win32: 15_395 } },
  // A run per runner key.
  'tests/acceptance/paths.test.ts > test 149: the runner key in the config': { fixed: 0, measured: { darwin: 5_622, win32: 17_419 } },
};

// On Windows each call of the fake claude starts cmd.exe and node, so ten runs of 300 calls took 117 s; two runs, the fewest that give a pair of runs to compare, prove the same promise of test 76.
export const STABILITY_RUNS: Record<System, number> = { linux: 10, darwin: 10, win32: 2 };

export function slowBudget(key: string): number | null {
  const slow = SLOW_TESTS[key];
  const measured = slow?.measured[process.platform as System];
  if (slow === undefined || measured === undefined) return null;
  return Math.ceil((slow.fixed + SLOW_MARGIN * Math.max(0, measured - slow.fixed)) / 5_000) * 5_000;
}


export const SLOWEST_SHOWN = 10;

// Which way each number makes the suite stronger, read by the suite guard; a seed is neither, so any change of it is a change to review.
export const stronger: Record<string, 'higher' | 'lower' | 'fixed'> = {
  SEED: 'fixed',
  CASES_PURE: 'higher',
  CASES_TOOL: 'higher',
  CASES_LOOP: 'higher',
  TEST_BUDGET_MS: 'lower',
  RUN_BUDGET_MS: 'lower',
  LOOP_TARGET_MS: 'lower',
  COMMIT_TARGET_MS: 'lower',
  LEFTOVER_GRACE_MS: 'lower',
  KILLED_GRACE_MS: 'lower',
  REAL_RUN_BUDGET_MS: 'lower',
  STABILITY_RUN_BUDGET_MS: 'lower',
  CLAUDE_TIMEOUT_RUN_MS: 'lower',
  FAKE_STARTED_MS: 'lower',
  HOOK_EDIT_DEADLINE_MS: 'lower',
  HOOK_STOP_DEADLINE_MS: 'lower',
  HOOK_SIGTERM_AFTER_MS: 'fixed',
  STOPPED_HOOK_ENDS_MS: 'lower',
  SLOW_TESTS: 'lower',
  SLOW_MARGIN: 'lower',
  STABILITY_RUNS: 'higher',
  SLOWEST_SHOWN: 'higher',
};

export function budgetNamed(key: string): number {
  const value = (NUMBERS as Record<string, unknown>)[key];
  if (typeof value !== 'number' || !key.endsWith('_MS')) throw new Error(`harness: a budget names a time of tests/numbers.ts, and ${JSON.stringify(key)} is none`);
  return value;
}

let printed = false;

export function seed(): number {
  const given = process.env.LAWCHECK_SEED;
  const value = given !== undefined && /^-?\d+$/.test(given) ? Number(given) : SEED;
  if (!printed) {
    printed = true;
    process.stdout.write(`seed ${value}\n`);
  }
  return value;
}

export function cases(kind: 'pure' | 'tool'): number {
  return SPEED === 'loop' ? CASES_LOOP : kind === 'pure' ? CASES_PURE : CASES_TOOL;
}
