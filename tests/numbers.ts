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

export const SLOW_MARGIN = 2;

export type System = 'linux' | 'darwin' | 'win32';

// The tests past half of TEST_BUDGET_MS on some system, by the test file and the whole test name, and on each such system the longest time measured on CI times SLOW_MARGIN, rounded up to 5 s. Tests 24 and 163 wait on fixed limits of the tool on every system: the 30 seconds a rule may run (spec/check-slice.md, section 3) and the hook deadlines of 25 and 145 seconds (spec/plugin-slice.md, section 4). The others are slow only on a slow CI system, where every process starts slowly and a test's time varies by half from run to run; the comment of each names what it waits on.
export const SLOW_TESTS: Record<string, Partial<Record<System, number>>> = {
  // 30 to 32 s on every system.
  'tests/acceptance/rules.test.ts > test 24: a rule that hangs is stopped': { linux: 65_000, darwin: 65_000, win32: 65_000 },
  // 172 to 173 s on every system.
  'tests/acceptance/plugin.test.ts > test 163: the deadline, and a hook that is stopped': { linux: 350_000, darwin: 350_000, win32: 350_000 },
  // 53 s on Windows, 22 s on macOS: a check per counted run of the committed trial.
  'tests/acceptance/agent-result.test.ts > test 181: the committed result of the trial': { darwin: 45_000, win32: 110_000 },
  // 45 s on Windows, 20 s on macOS: four runs of the stability script, each starting the tool for 30 reviews.
  'tests/acceptance/stability.test.ts > test 77: the measurement refuses to run, or to write a secret': { darwin: 45_000, win32: 90_000 },
  // 108 s on Windows, 26 s on macOS, 18 s on Linux: 300 calls of the fake claude, each a process, and on Windows a cmd.exe beside it.
  'tests/acceptance/stability.test.ts > test 76: the measurement through claude-code': { linux: 40_000, darwin: 55_000, win32: 220_000 },
  // 15 s on Windows: 300 requests to the fake reviewer.
  'tests/acceptance/stability.test.ts > test 76: the measurement against the fake': { win32: 35_000 },
  // 24 s on Windows, 11 s on macOS: four runners through four hooks each.
  'tests/acceptance/plugin.test.ts > test 158: every runner starts the same Lawcheck with its own words': { darwin: 25_000, win32: 50_000 },
  // 22 s on Windows: a hook run per step of eight scenarios, each with its own commits.
  'tests/acceptance/plugin.test.ts > test 169: what counts as changed in the turn': { win32: 45_000 },
  // 15 s on Windows: the hand-back and the guard through a run of hooks.
  'tests/acceptance/plugin.test.ts > test 166 and 167: the hand-back, and the guard': { win32: 30_000 },
  // 22 s on Windows, 11 s on macOS: the tool's 1-second timeout and 5-second kill, three times.
  'tests/acceptance/providers.test.ts > test 67: claude-code past its timeout, and the tool killed': { darwin: 25_000, win32: 45_000 },
  // 15 s on Windows: a run per way of giving the endpoint and the key.
  'tests/acceptance/providers.test.ts > test 64: the endpoint and the key come from the environment': { win32: 35_000 },
  // 11 s on Windows: seven runs through the fake claude.
  'tests/acceptance/providers.test.ts > test 66: claude-code': { win32: 25_000 },
  // 21 s on Windows: 2 seconds of wait per resend.
  'tests/acceptance/reviewer.test.ts > test 56: a bad answer is asked once more, then fails the run': { win32: 45_000 },
  // 17 s on Windows: a run per form of answer.
  'tests/acceptance/reviewer.test.ts > test 55: each form of a good answer': { win32: 35_000 },
  // 15 s on Windows: eleven configs, a run each.
  'tests/acceptance/reviewer-law.test.ts > test 68: config-invalid': { win32: 35_000 },
  // 17 s on Windows: a run per runner key.
  'tests/acceptance/paths.test.ts > test 149: the runner key in the config': { win32: 35_000 },
};

export function slowBudget(key: string): number | null {
  return SLOW_TESTS[key]?.[process.platform as System] ?? null;
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
