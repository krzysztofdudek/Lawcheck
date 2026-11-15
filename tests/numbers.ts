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

// The default stays 20 s, the design's budget per test (section 15): most tests take under a second on every system, and a test that needs more says so in SLOW_TESTS with its measured times.
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

// spec/reviewer-slice.md, section 6: a call ends at reviewer.timeout without waiting for the kill grace or a second full timeout. Tests 406 to 408 run with a timeout of 1 second, the shared list and call with one of 2, test 411 with one of 3; a timeout of 1 second of an HTTP provider in test 403, and a program that ended while a child holds its output, ended 2 seconds later.
export const PROGRAM_TIMEOUT_RUN_MS = 5_000;
export const SHARED_TIMEOUT_RUN_MS = 6_000;
export const RESEND_TIMEOUT_RUN_MS = 5_000;
export const HTTP_TIMEOUT_RUN_MS = 10_000;
export const HELD_OUTPUT_RUN_MS = 10_000;
// spec/reviewer-slice.md, section 6: the resend after a 429 waits 2 seconds.
export const RESEND_WAIT_MS = 2_000;

// Rule 7 of section 16 of the test design: a time budget is at least 20 times the measured time.
export const SLOW_MARGIN = 20;

export type System = 'linux' | 'darwin' | 'win32';

export interface Slow {
  // The tool's fixed waits in the test, which the margin does not multiply.
  fixed: number;
  // The longest time measured on CI, per system where it passes a fifth of TEST_BUDGET_MS.
  measured: Partial<Record<System, number>>;
}

// The tests that pass a fifth of TEST_BUDGET_MS on some system in CI, by the test file and the whole test name: inside the default such a test keeps less than SLOW_MARGIN over its time. On each system listed the budget is the tool's fixed waits plus SLOW_MARGIN times the rest of the longest time measured there, rounded up to 5 s; the reporter names every test of a run that passes a fifth with no entry. On Windows every process starts slowly and a test's time varies by half or more from run to run.
export const SLOW_TESTS: Record<string, Slow> = {
  // A check per counted run of the committed trial.
  'tests/acceptance/agent-result.test.ts > test 181: the committed result of the trial': { fixed: 0, measured: { darwin: 20_939, linux: 10_314, win32: 53_052 } },
  // A run of the tool per case.
  'tests/acceptance/cli.test.ts > test 38: the base': { fixed: 0, measured: { win32: 4_385 } },
  // A run of the tool per case.
  'tests/acceptance/doctor.test.ts > test 133: a change of the law, in doctor and in check': { fixed: 0, measured: { win32: 7_727 } },
  // A run of the tool per case.
  'tests/acceptance/doctor.test.ts > test 136: the reviewer check': { fixed: 0, measured: { darwin: 6_453, linux: 5_012, win32: 11_175 } },
  // A run of the tool per case.
  'tests/acceptance/doctor.test.ts > test 137: types, unread files and a broken grammar': { fixed: 0, measured: { win32: 4_456 } },
  // A run of the tool per case.
  'tests/acceptance/explain.test.ts > test 111: the state of each review, and no request': { fixed: 0, measured: { win32: 6_164 } },
  // A run of the tool per case.
  'tests/acceptance/languages.test.ts > test 88: one use from domain to app in each language': { fixed: 0, measured: { darwin: 7_032, win32: 5_044 } },
  // A run of the tool per case.
  'tests/acceptance/law.test.ts > test 18: each break of the law is law-invalid': { fixed: 0, measured: { darwin: 6_252, win32: 12_356 } },
  // A run of the tool per case.
  'tests/acceptance/law.test.ts > test 20: rule files': { fixed: 0, measured: { win32: 4_828 } },
  // A run of the tool per case.
  'tests/acceptance/paths.test.ts > test 149: the runner key in the config': { fixed: 0, measured: { darwin: 5_622, win32: 15_536 } },
  // A run of the tool per case.
  'tests/acceptance/paths.test.ts > test 150: prime names the command of the runner': { fixed: 0, measured: { win32: 5_811 } },
  // A run of the tool per case.
  'tests/acceptance/plugin.test.ts > test 154: the session start gives prime at the root, for every source': { fixed: 0, measured: { win32: 4_659 } },
  // A run of the tool per case.
  'tests/acceptance/plugin.test.ts > test 158: every runner starts the same Lawcheck with its own words': { fixed: 0, measured: { darwin: 9_922, linux: 7_839, win32: 19_425 } },
  // A run of the tool per case.
  'tests/acceptance/plugin.test.ts > test 160: edits that pass, and inputs the hook leaves alone': { fixed: 0, measured: { win32: 16_411 } },
  // The hook deadlines of 25 and 145 seconds (spec/plugin-slice.md, section 4) and the SIGTERM 2 seconds into the third hook.
  'tests/acceptance/plugin.test.ts > test 163: the deadline, and a hook that is stopped': { fixed: 172_000, measured: { darwin: 173_433, linux: 172_534, win32: 174_998 } },
  // A run of the tool per case.
  'tests/acceptance/plugin.test.ts > test 166 and 167: the hand-back, and the guard': { fixed: 0, measured: { darwin: 8_965, win32: 14_528 } },
  // A run of the tool per case.
  'tests/acceptance/plugin.test.ts > test 169: what counts as changed in the turn': { fixed: 0, measured: { darwin: 7_137, win32: 22_195 } },
  // One 429, answered after 2 seconds (spec/reviewer-slice.md, section 6).
  'tests/acceptance/providers.test.ts > test 57: what the HTTP reviewer answers': { fixed: 2_000, measured: { darwin: 7_372, linux: 5_364, win32: 26_763 } },
  // A run of the tool per case.
  'tests/acceptance/providers.test.ts > test 60: at most reviewer.parallel requests are in flight': { fixed: 0, measured: { win32: 4_477 } },
  // A run of the tool per case.
  'tests/acceptance/providers.test.ts > test 61: the cap on calls': { fixed: 0, measured: { darwin: 5_942, win32: 19_361 } },
  // A run of the tool per case.
  'tests/acceptance/providers.test.ts > test 64: the endpoint and the key come from the environment': { fixed: 0, measured: { win32: 15_317 } },
  // A run of the tool per case.
  'tests/acceptance/providers.test.ts > test 65: anthropic': { fixed: 0, measured: { win32: 6_356 } },
  // A run of the tool per case.
  'tests/acceptance/providers.test.ts > test 66: claude-code': { fixed: 0, measured: { darwin: 5_715, win32: 10_952 } },
  // reviewer.timeout of 1 second, then SIGKILL 5 seconds after the SIGTERM (spec/reviewer-slice.md, section 6).
  'tests/acceptance/providers.test.ts > test 67: claude-code past its timeout, and the tool killed': { fixed: 6_000, measured: { darwin: 10_541, linux: 7_770, win32: 18_254 } },
  // A run of the tool per case.
  'tests/acceptance/reviewer-law.test.ts > test 68: config-invalid': { fixed: 0, measured: { win32: 47_615 } },
  // A run of the tool per case.
  'tests/acceptance/reviewer-law.test.ts > test 69: the kind of a rule and its context': { fixed: 0, measured: { win32: 26_271 } },
  // A run of the tool per case.
  'tests/acceptance/reviewer-law.test.ts > test 70: what re-opens a verdict': { fixed: 0, measured: { win32: 13_666 } },
  // A run of the tool per case.
  'tests/acceptance/reviewer.test.ts > test 56: a bad answer is asked once more, then fails the run': { fixed: 0, measured: { darwin: 8_697, win32: 20_651 } },
  // A run of the tool per case.
  'tests/acceptance/rules.test.ts > test 21: each broken answer crashes the rule': { fixed: 0, measured: { win32: 7_512 } },
  // The 30 seconds a rule may run (spec/check-slice.md, section 3).
  'tests/acceptance/rules.test.ts > test 24: a rule that hangs is stopped': { fixed: 30_000, measured: { darwin: 30_868, linux: 30_608, win32: 34_041 } },
  // 300 requests to the fake reviewer.
  'tests/acceptance/stability.test.ts > test 76: the measurement against the fake': { fixed: 0, measured: { darwin: 11_934, linux: 6_267, win32: 17_482 } },
  // STABILITY_RUNS runs of 30 calls of the fake claude, each a process; on Windows ten runs took 116.8 s, so it makes two there.
  'tests/acceptance/stability.test.ts > test 76: the measurement through claude-code': { fixed: 0, measured: { darwin: 24_945, linux: 18_719, win32: 25_624 } },
  // Four runs of the stability script, each starting the tool for 30 reviews.
  'tests/acceptance/stability.test.ts > test 77: the measurement refuses to run, and its result holds the key only as [key]': { fixed: 0, measured: { darwin: 20_324, linux: 10_634, win32: 44_728 } },
  // A run of the tool per case.
  'tests/acceptance/try.test.ts > test 122: usage': { fixed: 0, measured: { win32: 4_203 } },
  // A run of the tool per case.
  'tests/acceptance/try.test.ts > test 125: what stops a reviewer rule before the first call': { fixed: 0, measured: { win32: 6_932 } },
  // A run of the tool per case.
  'tests/acceptance/uses.test.ts > test 87: may_use values and reserved ids are law-invalid': { fixed: 0, measured: { win32: 8_493 } },
  // A run of the tool per provider and per program, four runs each. Measured in the dev container; CI's times replace it.
  'tests/acceptance/http-providers.test.ts > test 404: the key canary': { fixed: 0, measured: { linux: 4_124 } },
  // A run of the tool per case, among them a timeout of 1 second and a list held 1.5 seconds. Measured in the dev container; CI's times replace it.
  'tests/acceptance/program-providers.test.ts > test 406: codex': { fixed: 0, measured: { linux: 4_089 } },
  // A 429 after 2.5 seconds, then a dropped connection after 2.5 seconds and a resend held to the 0.5 seconds left of a timeout of 3 (spec/reviewer-slice.md, test 411). Measured in the dev container; CI's times replace it.
  'tests/acceptance/http-providers.test.ts > test 411: the timeout bounds a request and its resend': { fixed: 5_500, measured: { linux: 5_769 } },
  // STABILITY_RUNS runs of 30 calls through the fake Ollama, the fake codex and the fake copilot, each call of a program a process. Measured in the dev container; CI's times replace it.
  'tests/acceptance/stability.test.ts > test 410: the measurement through ollama, codex and copilot-cli': { fixed: 0, measured: { linux: 12_580 } },
  // Two leftovers, each looked for during LEFTOVER_GRACE_MS.
  // A run of the tool per case.
  "tests/security/output-sources.test.ts > I-out-1: a reviewer message cannot forge a line, in the run that asked and from the cache afterwards": { fixed: 0, measured: { win32: 4_545 } },
  // A run of the tool per case.
  'tests/security/output-sources.test.ts > I-out-1: the about text of a type and a rule id cannot forge a line of prime, explain or check': { fixed: 0, measured: { win32: 5_231 } },
  // A run of the tool per case.
  "tests/security/output-sources.test.ts > I-out-1: file names cannot forge a line of check, explain or try, and each finding stays one line": { fixed: 0, measured: { win32: 4_316 } },
  // A run of the tool per case.
  "tests/security/runner.test.ts > I-runner-1: a rule reads nothing outside the root and the package at a root path holding *, a comma, a backslash, a space or non-ASCII (test 26, S8-4, S2-8)": { fixed: 0, measured: { darwin: 9_616, linux: 5_312, win32: 20_698 } },
  // A run of the tool per case.
  "tests/security/key-everywhere.test.ts > S3-2: a judged file named with the key shows [key] in check and explain, and the base named with it in its error (I-secret-1)": { fixed: 0, measured: { win32: 4_081 } },
  // A run of the tool per case.
  "tests/security/git-programs.test.ts > S5-14: a submodule whose own config names a filter starts nothing during check, explain and doctor (I-git-1)": { fixed: 0, measured: { win32: 4_485 } },
  // A run of the tool per case.
  "tests/security/git-programs.test.ts > S5-14: prime, explain, doctor and docs start no program that the repository names for git (I-git-1)": { fixed: 0, measured: { win32: 4_544 } },
  // A run of the tool per case.
  "tests/security/linked.test.ts > S5-15: a .lawcheck folder linked to a folder whose law holds a secret shows none of it (I-secret-2)": { fixed: 0, measured: { darwin: 9_029, linux: 8_832, win32: 23_738 } },
  // A run of the tool per case.
  "tests/security/linked.test.ts > S5-15: a .lawcheck/config.yaml linked to a one-line secret shows none of it (I-secret-2)": { fixed: 0, measured: { darwin: 9_957, linux: 8_800, win32: 24_095 } },
  // A run of the tool per case.
  "tests/security/linked.test.ts > S5-15: a .lawcheck/law.yaml linked to a one-line secret shows none of it (I-secret-2)": { fixed: 0, measured: { darwin: 7_780, linux: 6_706, win32: 21_982 } },
  'tests/contract/harness.test.ts > harness-6: a process the run leaves alive fails it, however quickly it left': { fixed: 4_000, measured: { darwin: 4_553, linux: 4_458 } },
  // A run of the tool per case.
  'tests/environments/ci-shapes.test.ts > S7-6: the variables of CI services count as CI, and CI set to an off word does not': { fixed: 0, measured: { darwin: 4_672, win32: 6_940 } },
  // A run of the tool per case.
  'tests/environments/git-faults.test.ts > S7-15: a repository owned by another user gives no-git with the safe.directory command of git, quoted for a POSIX shell, and that command run there lets check through': { fixed: 0, measured: { win32: 4_688 } },
  // The hooks, run in five repository shapes and from two directories each.
  'tests/environments/hook-shapes.test.ts > I-shape-2: a law broken in the turn is handed back under its header in every repository shape': { fixed: 0, measured: { darwin: 5_793, win32: 15_323 } },
  // The hooks, run in five repository shapes and from two directories each.
  'tests/environments/hook-shapes.test.ts > I-shape-2: control, a clean change lets the agent finish in every repository shape': { fixed: 0, measured: { darwin: 6_362, win32: 16_679 } },
  // The hooks, run in five repository shapes and from two directories each.
  'tests/environments/hook-shapes.test.ts > I-shape-2: the hook after an edit hands back a breach in every repository shape': { fixed: 0, measured: { darwin: 4_598, win32: 12_876 } },
  // The hooks, run in five repository shapes and from two directories each.
  'tests/environments/hook-shapes.test.ts > I-shape-2: the session start gives the primer in every repository shape': { fixed: 0, measured: { darwin: 4_244, win32: 12_435 } },
  // The hooks, run in five repository shapes and from two directories each.
  'tests/environments/hook-shapes.test.ts > S6-1: a check before finishing that cannot take its snapshot says so': { fixed: 0, measured: { darwin: 4_469, win32: 8_923 } },
  // The hooks, run in five repository shapes and from two directories each.
  'tests/environments/hook-shapes.test.ts > S6-1: the check before finishing hands back a breach written in the turn, in every repository shape': { fixed: 0, measured: { darwin: 5_963, win32: 16_780 } },
  // A run of the tool per case.
  'tests/environments/refusal.test.ts > I-env-1: every command but --version, --help and docs refuses an unsupported runtime in its first line, naming it, and doctor leads with the same line': { fixed: 0, measured: { darwin: 8_921, linux: 6_249, win32: 13_184 } },
  // A run of the tool per case.
  'tests/environments/refusal.test.ts > S8-1: a Lawcheck served from an archive of Yarn PnP refuses every command in its first line, and blames no rule file': { fixed: 0, measured: { darwin: 4_807, win32: 4_917 } },
  // A run of the tool per row, in a fresh sample, from two directories.
  'tests/environments/shapes.test.ts > I-shape-1: the core rows of check give the output the spec gives at a root path with a space and a non-ASCII letter': { fixed: 0, measured: { darwin: 11_139, linux: 5_134, win32: 26_169 } },
  // A run of the tool per row, in a fresh sample, from two directories.
  'tests/environments/shapes.test.ts > I-shape-1: the core rows of check give the output the spec gives at a root reached through a symbolic link': { fixed: 0, measured: { darwin: 10_818, linux: 5_067, win32: 27_432 } },
  // A run of the tool per row, in a fresh sample, from two directories.
  'tests/environments/shapes.test.ts > I-shape-1: the core rows of check give the output the spec gives in a linked worktree, from the root and from below it': { fixed: 0, measured: { darwin: 13_459, linux: 6_022, win32: 34_119 } },
  // A run of the tool per row, in a fresh sample, from two directories.
  'tests/environments/shapes.test.ts > I-shape-1: the core rows of check give the output the spec gives with the law at the top, from the root and from below it': { fixed: 0, measured: { darwin: 10_812, linux: 5_431, win32: 35_917 } },
  // A run of the tool per row, in a fresh sample, from two directories.
  'tests/environments/shapes.test.ts > I-shape-1: the core rows of check give the output the spec gives with the law in pkg/ of a monorepo, node_modules hoisted above it': { fixed: 0, measured: { darwin: 14_186, linux: 5_435, win32: 30_518 } },
  // A run of the tool per case.
  'tests/environments/shapes.test.ts > S2-2: control, the same rule loads the same package from a node_modules below the root': { fixed: 0, measured: { darwin: 4_020, win32: 9_298 } },
  // The packing, an install and a run from each shell of the system.
  'tests/environments/systems.test.ts > test 205: the packed tarball, installed globally without the network, starts from every shell of the system and checks the sample': { fixed: 0, measured: { darwin: 4_359, win32: 9_364 } },
  // A run of the tool per case.
  'tests/environments/refusal.test.ts > test 200: below git 2.34 every command but --version, --help and docs refuses in its first line, naming the version': { fixed: 0, measured: { darwin: 4_259 } },
  // The nightly containers of spec/environments.md, section 7: image pulls and package installs over the network take the time, not the tool, so each budget is a bound for its cells on Linux, given as fixed time, and no multiple of a measurement.
  'tests/environments/install.nightly.test.ts > test 206: the install matrix, each package manager on node:24 and node:24-alpine, passes or refuses as the spec says (network)': { fixed: 1_800_000, measured: { linux: 1_800_000 } },
  'tests/environments/install.nightly.test.ts > S8-2: on oven/bun, Bun with no Node, the installed Lawcheck refuses in its first line, and doctor agrees with check (network)': { fixed: 300_000, measured: { linux: 300_000 } },
  'tests/environments/install.nightly.test.ts > S8-3: on node:20 and node:22, npm installs Lawcheck with a warning, and every command refuses in its first line, naming the Node version (network)': { fixed: 600_000, measured: { linux: 600_000 } },
  'tests/environments/install.nightly.test.ts > S8-5: with Yarn 1, check --json through yarn --silent run, as docs/config.md gives it, is one JSON document (network)': { fixed: 600_000, measured: { linux: 600_000 } },
  'tests/environments/git.nightly.test.ts > test 207: the check slice acceptance tests pass on the git of ubuntu:22.04, debian:12, ubuntu:24.04 and debian:sid (network)': { fixed: 1_200_000, measured: { linux: 1_200_000 } },
  'tests/environments/ownership.nightly.test.ts > S7-15: in a container whose user does not own the checkout, check names the safe.directory command, and that command lets it through (network)': { fixed: 300_000, measured: { linux: 300_000 } },

};

// On Windows each call of the fake claude starts cmd.exe and node, so ten runs of 300 calls took 117 s there; two runs, the fewest that give a pair of runs to compare, prove the same promise of test 76.
export const STABILITY_RUNS: Record<System, number> = { linux: 10, darwin: 10, win32: 2 };

export function slowBudget(key: string): number | null {
  const slow = SLOW_TESTS[key];
  const measured = slow?.measured[process.platform as System];
  if (slow === undefined || measured === undefined) return null;
  return Math.ceil((slow.fixed + SLOW_MARGIN * Math.max(0, measured - slow.fixed)) / 5_000) * 5_000;
}


export const SLOWEST_SHOWN = 10;

// The share of a property's cases that must hold each class of input its generator claims to reach.
export const REACH_SHARE = 0.1;

// The live run of the attack files (spec/reviewer-slice.md, invariant I-frame-1): each attack file and its twin go through the real reviewer this many times, and the run holds when this share of pairs agrees and this share of verdicts is fail.
export const LIVE_TIMES = 5;
export const LIVE_SAME_SHARE = 1;
export const LIVE_FAIL_SHARE = 1;
// One try of LIVE_TIMES calls of the real claude.
export const LIVE_RUN_BUDGET_MS = 900_000;

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
  PROGRAM_TIMEOUT_RUN_MS: 'lower',
  SHARED_TIMEOUT_RUN_MS: 'lower',
  RESEND_TIMEOUT_RUN_MS: 'lower',
  HTTP_TIMEOUT_RUN_MS: 'lower',
  HELD_OUTPUT_RUN_MS: 'lower',
  RESEND_WAIT_MS: 'fixed',
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
