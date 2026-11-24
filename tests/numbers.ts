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

// The default stays 20 s, the budget of harness-6 for a test with no entry in SLOW_TESTS: most tests take under a second on every system, and a test that needs more says so in SLOW_TESTS with its measured times.
export const TEST_BUDGET_MS = 20_000;
// On Windows a test with no entry has 90 s: a fresh runner can stall for up to a minute in the first minutes of a job, and every test running then takes that minute longer (R-115, ruling windows-limit-90s of the loop).
export const WINDOWS_TEST_BUDGET_MS = 90_000;
export const RUN_BUDGET_MS = 20_000;
export const LOOP_TARGET_MS = 30_000;
export const COMMIT_TARGET_MS = 600_000;
export const LEFTOVER_GRACE_MS = 2_000;
export const KILLED_GRACE_MS = 5_000;
// Test 67 on Windows: the guard ends a killed tool's orphans from the first list of processes begun after the kill and waits up to 10 seconds for one, and PowerShell's first list came up to 6.2 seconds after it started on a Windows runner (R-67); when none comes, the guard takes a list itself and waits up to 10 seconds more for it.
export const WINDOWS_KILLED_GRACE_MS = 25_000;

// The whole-repository runs of tests/real on hono and gson, and one check --review of the stability fixture, 30 reviewer calls through a real model.
export const REAL_RUN_BUDGET_MS = 300_000;
export const STABILITY_RUN_BUDGET_MS = 900_000;
// tests/real/speed.ts: the most that the median of SPEED_RUNS checks of one changed file, in guava and in Newtonsoft.Json with the reader cache, may take in the dev container. The design aimed at 0.3 s for one file; the medians measured on 2026-11-23 were 0.29 to 0.38 s, so 0.3 s would fail on noise alone (decision 165).
export const ONE_FILE_CHECK_MS = 500;
export const SPEED_RUNS = 5;

// Test 67: reviewer.timeout of 1 second, then SIGTERM and SIGKILL 5 seconds later.
export const CLAUDE_TIMEOUT_RUN_MS = 15_000;
export const FAKE_STARTED_MS = 20_000;

// Test 163: within 30 seconds of the deadline of 25 and within 150 of the deadline of 145, so a hook ends within 5 seconds of its deadline; SIGTERM after 2 seconds.
export const HOOK_PAST_DEADLINE_MS = 5_000;
export const HOOK_SIGTERM_AFTER_MS = 2_000;
// The deadlines in seconds that the per-push runs of test 163 and of R-86's session-start and prompt hooks give in place of 25, 15, 25 and 145; the nightly runs the shipped ones. Each leaves the stand-in lawcheck time to start through cmd.exe on a busy Windows runner, so that each run ends at its deadline with the stand-in running. No two are the same, and prompt's, which no message names, is the longest, so a hook that reads another hook's deadline ends too early or names the wrong one.
export const TEST_HOOK_DEADLINES = { 'session-start': 5, prompt: 6, edit: 3, stop: 4 };
export const STOPPED_HOOK_ENDS_MS = 10_000;

// Test 24: a rule that hangs crashes within 40 seconds of a limit of 30, so within 10 seconds of its limit. The per-push run gives the tool a limit of 3 seconds in place of 30, which leaves the runner time to start on a busy Windows runner, so that the hang in check is stopped in its call and not in its load; the nightly runs the shipped one.
export const RULE_PAST_LIMIT_MS = 10_000;
export const TEST_RULE_MS = 3_000;
// How far past its limit a hung rule may run, as a share of the limit, counted from the moment the rule says it hangs: the runner is ended and the tool prints and exits. A timer set to twice the limit or more fails it.
export const RULE_PAST_LIMIT_SHARE = 0.5;
// Each of two calls of a rule takes this long under TEST_RULE_MS: each call is inside the limit, the two together are past it.
export const RULE_CALL_MS = 2_000;
// What the variables of the test entries would set if they reached the tool or the hook a user runs, and how long a rule and a stand-in lawcheck then take: past those, and far inside the shipped 30 and 25 seconds.
export const USER_SET_RULE_MS = 1_000;
export const USER_SET_DEADLINE_S = 1;
export const PAST_USER_SET_MS = 2_500;

// A call ends at reviewer.timeout without waiting for the kill grace or a second full timeout. Tests 406 to 408 run with a timeout of 1 second, the shared list and call with one of SHARED_TIMEOUT_S, test 411 with one of 3; a timeout of 1 second of an HTTP provider in test 403, and a program that ended while a child holds its output, ended 2 seconds later.
export const PROGRAM_TIMEOUT_RUN_MS = 5_000;
export const HTTP_TIMEOUT_RUN_MS = 10_000;
export const HELD_OUTPUT_RUN_MS = 10_000;
// docs/providers.md: the resend after a 429 waits 2 seconds.
export const RESEND_WAIT_MS = 2_000;
// Test 411: the fake answers after 2.5 seconds of a timeout of 3, so the resend has 0.5 seconds left; the bound adds 1 second, twenty times the tens of milliseconds a request takes to be cut off, and stays well below the full 3 seconds a resend had before.
export const RESEND_REPLY_DELAY_MS = 2_500;
export const RESEND_LEFT_BOUND_MS = 1_500;
// The case of tests 406 and 408 where the list of MCP servers takes 2 seconds and the answer 3 seconds more, past a timeout of 4. Neither alone reaches the timeout, and the two together pass it by 1 second: the list keeps 2 seconds for the starts of the fake and of its sleeping child, which take over half a second on a Windows runner, and an answer that got a timeout of its own would still end in time by 1 second.
export const SHARED_TIMEOUT_S = 4;
export const LIST_DELAY_MS = 2_000;
export const LATE_ANSWER_MS = 3_000;
// R-76: once the review has reached the lock of the verdicts file that the test holds, how long the test looks for a reviewer call, which a review the lock does not hold makes within moments.
export const LOCK_HELD_LOOK_MS = 1_000;

// The runs of the limits tests, tests/limits: a run at a limit of the table in docs/config.md; a nightly run of the large inputs; a nightly run that waits for the 600 seconds the script rules of a run may take; and the two seconds a run has to answer a signal.
export const LIMITS_RUN_MS = 120_000;
export const LIMITS_LARGE_RUN_MS = 300_000;
export const LIMITS_RULES_RUN_MS = 700_000;
export const LIMITS_STOPPED_MS = 2_000;

// The factor slowBudget applies to the measured time above a test's fixed waits (tests/README.md).
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
  // Measured on CI runs 43762617467 and 43764121085: 25 runs of the tool or of a hook.
  "tests/properties/arguments.test.ts > I-args-1: tokens of the tool and junk give usage or a run, never internal, and change nothing in git": { fixed: 0, measured: { darwin: 7_875, linux: 5_085, win32: 9_010 } },
  // Measured on CI runs 43762617467 and 43764121085: 25 runs of the tool or of a hook.
  "tests/properties/arguments.test.ts > I-hook-1: S6-6, S6-8, any input to a hook gives exit 0 with nothing or one hook document, or the defined notice, never a stack trace": { fixed: 0, measured: { darwin: 9_955, linux: 5_762, win32: 13_367 } },
  // Measured on CI runs 43762617467 and 43764121085: 25 sample repositories, a check in text and in JSON each.
  "tests/properties/contents.test.ts > I-lines-1: for any text of a judged file, every finding lies inside it, and the text and JSON forms agree": { fixed: 0, measured: { darwin: 24_953, linux: 12_949, win32: 66_110 } },
  // Measured on CI runs 43762617467 and 43764121085: 25 sequences of git commands, each followed by seven runs of the tool.
  "tests/properties/git-states.test.ts > I-git-3: in any state a sequence of git commands leaves, a check changes nothing in git, its change gives what --full gives for those files, and it prints the same from below the root and twice": { fixed: 0, measured: { darwin: 82_146, linux: 56_267, win32: 231_038 } },
  // Measured on CI runs 43762617467 and 43764121085: 25 laws, each printed back type by type and rule by rule.
  "tests/properties/law.test.ts > I-law-1: an accepted law is printed back by explain, every type and every rule whole": { fixed: 0, measured: { darwin: 19_307, linux: 20_115, win32: 69_905 } },
  // Measured on CI runs 43762617467 and 43764121085: 25 sample repositories with generated names, three runs of the tool each.
  "tests/properties/names.test.ts > I-files-1: every file a type matches is judged, whatever bytes its name holds, and its JSON path maps back to the file on disk": { fixed: 0, measured: { darwin: 30_513, linux: 32_388, win32: 84_470 } },
  // Measured on CI runs 43762617467 and 43764121085: 25 rules, each judged alone and with a second file.
  "tests/properties/rules.test.ts > I-rules-1: S2-4, S2-6, any value a rule returns, throws or rejects with gives findings or a rule-crashed naming its cause, and file A is judged the same alone or with B": { fixed: 0, measured: { darwin: 25_976, linux: 22_921, win32: 75_556 } },
  // The nightly run of a property searches for NIGHTLY_MS, a fixed wait, then ends the case it is in: up to two cases of the commit run's time, at least 5 s.
  "tests/properties/glob.nightly.test.ts > I-glob-1: S1-1, a pattern matches as the reference matcher does, on small input": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/glob.nightly.test.ts > I-glob-1: S1-1, a list with exclusions matches as the reference does": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/glob.nightly.test.ts > I-glob-1: S1-1, any text is a pattern that compiles or one with a named problem": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/glob.nightly.test.ts > I-glob-1: S1-1, a match costs time linear in the name, for any pattern and a name of up to 4,096 bytes": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/answer.nightly.test.ts > I-answer-1: S3-3, the answer read is the one the reading of section 4 takes, on small input": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/answer.nightly.test.ts > I-answer-1: S3-3, any answer is a verdict or a named bad answer, in linear time, with lines in or out of range": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/answer.nightly.test.ts > I-answer-1: S3-4, two verdict objects that agree give their verdict, and a pass followed by a fail is never read as a pass": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/names.nightly.test.ts > I-files-1: a name maps back to its bytes, holds no line break, and the hooks write it the same way": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/names.nightly.test.ts > I-files-1: every file a type matches is judged, whatever bytes its name holds, and its JSON path maps back to the file on disk": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 126_756 } },
  "tests/properties/contents.nightly.test.ts > I-lines-1: lines split as section 3 says, and every waiver sits on a line of the file and covers one": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/contents.nightly.test.ts > I-lines-1: a file is binary exactly when its first 8,000 bytes hold a NUL": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/contents.nightly.test.ts > I-lines-1: for any text of a judged file, every finding lies inside it, and the text and JSON forms agree": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_288 } },
  "tests/properties/law.nightly.test.ts > I-law-1: any text as law.yaml is a law or law-invalid at a line of the file": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/law.nightly.test.ts > I-law-1: an accepted law is printed back by explain, every type and every rule whole": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_592 } },
  "tests/properties/law.nightly.test.ts > I-law-1: any text as config.yaml is a config or config-invalid at a line of the file": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/rules.nightly.test.ts > I-rules-1: S2-4, S2-6, any value a rule returns, throws or rejects with gives findings or a rule-crashed naming its cause, and file A is judged the same alone or with B": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 126_044 } },
  "tests/properties/git-states.nightly.test.ts > I-git-3: in any state a sequence of git commands leaves, a check changes nothing in git, its change gives what --full gives for those files, and it prints the same from below the root and twice": { fixed: 120_000, measured: { darwin: 126_570, linux: 125_000, win32: 138_482 } },
  "tests/properties/arguments.nightly.test.ts > I-args-1: tokens of the tool and junk give usage or a run, never internal, and change nothing in git": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/arguments.nightly.test.ts > I-hook-1: S6-6, S6-8, any input to a hook gives exit 0 with nothing or one hook document, or the defined notice, never a stack trace": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  // The limits tests of the commit set, measured on CI: each starts the tool several times at a limit, which Windows starts slowly.
  'tests/limits/sizes.test.ts > test 254: R-28, a law may hold 10,000 rules, 1,000 types and 1 MiB, and past each it is file-too-large': { fixed: 0, measured: { darwin: 6_233, linux: 4_085, win32: 23_560 } },
  'tests/limits/reviews.test.ts > test 243: S3-6, a second run right after any run prints the same': { fixed: 0, measured: { darwin: 7_475, linux: 4_188, win32: 12_489 } },
  'tests/limits/reviews.test.ts > test 243: S3-6, a plain check right after a passing review passes, with a type whose paths cover .lawcheck/': { fixed: 0, measured: { win32: 4_079 } },
  'tests/limits/sizes.test.ts > test 263: a file whose uses are read may hold 512 KiB, even of the costliest text, past it its uses are not read and the run goes on, and a config may hold 1 MiB': { fixed: 0, measured: { darwin: 8_054, linux: 5_116, win32: 11_260 } },
  'tests/limits/writes.test.ts > test 240: S1-6, S5-13, S8-8, every command writing to an output opened only for reading ends with exit 2': { fixed: 0, measured: { win32: 8_675 } },
  'tests/limits/findings.test.ts > test 235: S2-1, 125,000 and 200,000 findings from one rule give the full report and exit 1': { fixed: 0, measured: { darwin: 5_663, linux: 4_143, win32: 8_518 } },
  'tests/limits/findings.test.ts > test 236: S2-1, 200,001 and 1,000,000 findings from one rule, and 300,000 over three files, are too-many-findings': { fixed: 0, measured: { win32: 7_853 } },
  'tests/limits/findings.test.ts > test 237: the messages of a run may hold 16,777,216 characters together, and a message 4,096': { fixed: 0, measured: { win32: 6_113 } },
  'tests/limits/findings.test.ts > test 264: waivers count toward the findings of a run: 200,000 waivers that name no rule are reported, and one more is too-many-findings': { fixed: 0, measured: { darwin: 4_005, win32: 5_283 } },
  // The nightly limits, measured in the container of 1 GB and 2 CPUs on Linux; the fixed parts are the tool's limits the tests wait on: 30 rules that each pass 30 seconds, 15 at a time; the 600 seconds of the script rules of a run; the 30 seconds of a step.
  'tests/limits/large.nightly.test.ts > test 248: 150,000 files: every one is typed and judged, and the one that breaks a rule is found': { fixed: 0, measured: { linux: 17_662 } },
  'tests/limits/large.nightly.test.ts > test 249: 4 GiB of text across files stops at the file that passes 128 MiB, as text-too-large': { fixed: 0, measured: { linux: 6_119 } },
  'tests/limits/large.nightly.test.ts > test 251: S2-5, 30 rules that hang end as rule-crashed, each after its 30 seconds, within the time of the run': { fixed: 450_000, measured: { linux: 450_462 } },
  'tests/limits/large.nightly.test.ts > test 251: S2-5, rules that take 29 seconds a file are stopped when the script rules of the run pass 600 seconds': { fixed: 600_000, measured: { linux: 600_156 } },
  'tests/limits/large.nightly.test.ts > test 252: kill -9 at a random moment of 50 reviews leaves a verdicts file that parses, and the next run passes': { fixed: 0, measured: { linux: 8_030 } },
  'tests/limits/large.nightly.test.ts > test 255: S1-1, a step that never ends, typing against a content pattern that backtracks, ends as step-too-slow after 30 seconds': { fixed: 30_000, measured: { linux: 30_237 } },
  'tests/limits/large.nightly.test.ts > test 259: a git that never answers ends as step-too-slow after 30 seconds, and git with it': { fixed: 30_000, measured: { linux: 30_193 } },
  'tests/limits/large.nightly.test.ts > test 269: explain of a file whose content pattern backtracks names its typing as the step past its limit': { fixed: 30_000, measured: { linux: 30_185 } },
  // A check per counted run of the committed trial.
  'tests/acceptance/agent-result.test.ts > test 181: the committed result of the trial': { fixed: 0, measured: { darwin: 20_939, linux: 10_314, win32: 53_052 } },
  // A run of the tool per case.
  'tests/contract/codes.test.ts > check-slice §6: usage, not-initialized, already-initialized, no-git and unsupported-environment, in text and in JSON, and the commands their next lines name': { fixed: 0, measured: { linux: 4_153, darwin: 8_162, win32: 14_285 } },
  // A run of the tool per case.
  'tests/contract/codes.test.ts > check-slice §6: law-invalid, config-invalid, rule-missing-file, rule-file-without-entry and type-overlap, in text and in JSON, and the commands their next lines name': { fixed: 0, measured: { darwin: 7_818, win32: 17_627 } },
  // A run of the tool per case.
  'tests/contract/codes.test.ts > check-slice §6: base-unreachable, rule-crashed, parser-failed, internal, link-outside-root, path-unsupported and runner-failed, in text and in JSON, and the commands their next lines name': { fixed: 0, measured: { linux: 4_574, darwin: 9_850, win32: 22_279 } },
  // A run of the tool per case.
  'tests/contract/codes.test.ts > check-slice §6: the reviewer codes, in text and in JSON, and the commands their next lines name': { fixed: 0, measured: { linux: 4_958, darwin: 7_325, win32: 22_535 } },
  // A run of the tool per case.
  'tests/contract/codes.test.ts > check-slice §6: the findings, with their exit codes and the exact text the spec fixes, and the notes of doctor': { fixed: 0, measured: { darwin: 4_710, win32: 15_407 } },
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
  // The hook deadlines of 25 and 145 seconds (docs/plugin.md) and the SIGTERM 2 seconds into the third hook.
  'tests/deadlines/hook-deadlines.nightly.test.ts > test 163: the deadline, and a hook that is stopped, at the deadlines the plugin ships': { fixed: 172_000, measured: { darwin: 175_080, linux: 174_217, win32: 174_998 } },
  // The session-start and prompt deadlines of 25 and 15 seconds (docs/plugin.md).
  'tests/deadlines/hook-deadlines.nightly.test.ts > R-86: the session-start and prompt hooks each end at their own deadline, at the deadlines the plugin ships': { fixed: 40_000, measured: { darwin: 40_734, linux: 40_201, win32: 41_022 } },
  // The test deadlines of the edit and stop hooks, 3 and 4 seconds, and on Linux and macOS the SIGKILL 2 seconds after SIGTERM.
  'tests/acceptance/plugin.test.ts > test 163: the deadline, and a hook that is stopped': { fixed: 7_000, measured: { linux: 9_515, win32: 8_375 } },
  // The test deadlines of the session-start and prompt hooks, 5 and 6 seconds.
  'tests/acceptance/plugin.test.ts > R-86: the session-start and prompt hooks each end at their own deadline': { fixed: 11_000, measured: { linux: 11_817, win32: 13_487 } },
  // Three waits of PAST_USER_SET_MS past the deadline of 1 second the variable would set (session-start and edit at once, prompt, stop).
  'tests/acceptance/plugin.test.ts > R-87: the hook a user runs keeps its shipped deadline for every event when the variable of the test entry is set': { fixed: 7_500, measured: { linux: 9_447, win32: 16_939 } },
  // A run of the tool per case.
  'tests/acceptance/plugin.test.ts > test 166 and 167: the hand-back, and the guard': { fixed: 0, measured: { darwin: 8_965, win32: 14_528 } },
  // A run of the tool per case.
  'tests/acceptance/plugin.test.ts > test 169: what counts as changed in the turn': { fixed: 0, measured: { darwin: 7_137, win32: 22_195 } },
  // One 429, answered after 2 seconds (docs/providers.md).
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
  // reviewer.timeout of 1 second, then SIGKILL 5 seconds after the SIGTERM.
  'tests/acceptance/providers.test.ts > test 67: claude-code past its timeout, and the tool killed': { fixed: 6_000, measured: { darwin: 10_541, linux: 7_770, win32: 18_254 } },
  // A run of the tool per case.
  'tests/acceptance/reviewer-law.test.ts > test 68: config-invalid': { fixed: 0, measured: { win32: 47_615 } },
  // A run of the tool per case.
  'tests/acceptance/reviewer-law.test.ts > test 69: the kind of a rule and its context': { fixed: 0, measured: { win32: 26_271 } },
  // A run of the tool per case.
  'tests/acceptance/reviewer-law.test.ts > test 70: what re-opens a verdict': { fixed: 0, measured: { win32: 13_666 } },
  // A run of the tool per case.
  'tests/acceptance/reviewer.test.ts > test 56: a bad answer is asked once more, then fails the run': { fixed: 0, measured: { darwin: 8_697, win32: 20_651 } },
  // Two calls of RULE_CALL_MS under the test limit of 3 seconds.
  'tests/acceptance/rules.test.ts > R-85: each call of a rule has the whole limit, so two calls that are each inside it pass however long they take together': { fixed: 4_000, measured: { linux: 4_438, win32: 6_710 } },
  // A run of the tool per case.
  'tests/acceptance/rules.test.ts > test 21: each broken answer crashes the rule': { fixed: 0, measured: { win32: 7_512 } },
  // The test limit of 3 seconds a rule may run, in place of 30.
  'tests/acceptance/rules.test.ts > test 24: a rule that hangs is stopped': { fixed: 3_000, measured: { win32: 5_717 } },
  // The 30 seconds a rule may run (docs/script-rules.md).
  'tests/deadlines/rule-limit.nightly.test.ts > test 24: a rule that hangs is stopped, at the limit the tool ships': { fixed: 30_000, measured: { darwin: 31_335, linux: 30_608, win32: 34_041 } },
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
  // A run of the tool per case, and one 429 answered after 2 seconds (docs/providers.md).
  'tests/acceptance/http-providers.test.ts > test 403: what openai answers': { fixed: 2_000, measured: { linux: 5_508, darwin: 12_768, win32: 15_075 } },
  'tests/acceptance/http-providers.test.ts > test 403: what google answers': { fixed: 2_000, measured: { linux: 5_682, darwin: 13_523, win32: 12_891 } },
  'tests/acceptance/http-providers.test.ts > test 403: what ollama answers': { fixed: 2_000, measured: { linux: 6_514, darwin: 10_669, win32: 12_815 } },
  // Four runs of the tool per HTTP provider and two per program.
  'tests/acceptance/http-providers.test.ts > test 404: the key canary': { fixed: 0, measured: { darwin: 18_425, win32: 27_263 } },
  // A run of the tool per provider and per program.
  'tests/acceptance/http-providers.test.ts > test 405: a key under a provider name goes to that provider alone': { fixed: 0, measured: { darwin: 5_010, win32: 7_929 } },
  // A run of the tool per case, each starting the fake program through cmd.exe on Windows. On Linux test 406 takes 11.6 to 17.5 s in every completed CI run since 43918757215, and took 29.1 s in shard 2 of CI run 44116929952, attempt 1, on Node 24.0.0.
  'tests/acceptance/program-providers.test.ts > test 406: codex': { fixed: 0, measured: { linux: 29_147, darwin: 11_854, win32: 64_931 } },
  'tests/acceptance/program-providers.test.ts > test 407: gemini-cli': { fixed: 0, measured: { linux: 5_194, darwin: 12_728, win32: 63_443 } },
  'tests/acceptance/program-providers.test.ts > test 408: copilot-cli': { fixed: 0, measured: { linux: 6_455, darwin: 12_112, win32: 86_831 } },
  // STABILITY_PROVIDER_RUNS runs of 30 calls through each fake, a process per call of a program.
  'tests/acceptance/stability.test.ts > test 410: the measurement through ollama, codex and copilot-cli': { fixed: 0, measured: { linux: 6_606, darwin: 26_998, win32: 52_639 } },
  // A 429 after 2.5 seconds, then a dropped connection after 2.5 seconds and a resend held to the 0.5 seconds left of a timeout of 3 (test 411).
  'tests/acceptance/http-providers.test.ts > test 411: the timeout bounds a request and its resend': { fixed: 5_500, measured: { linux: 5_769, darwin: 6_875, win32: 7_131 } },
  // Two leftovers, each looked for during LEFTOVER_GRACE_MS.
  // A run of the tool per case.
  "tests/security/output-sources.test.ts > I-out-1: a reviewer message cannot forge a line, in the run that asked and from the cache afterwards": { fixed: 0, measured: { win32: 4_545 } },
  // A run of the tool per case.
  'tests/security/output-sources.test.ts > I-out-1: the about text of a type and a rule id cannot forge a line of prime, explain or check': { fixed: 0, measured: { win32: 5_231 } },
  // A run of the tool per case.
  "tests/security/output-sources.test.ts > S1-5: file names cannot forge a line of check, explain or try, and each finding stays one line": { fixed: 0, measured: { win32: 4_316 } },
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
  'tests/environments/refusal.test.ts > R-18: I-env-1, every command but --version, --help and docs refuses an unsupported runtime in its first line, naming it, and doctor leads with the same line': { fixed: 0, measured: { darwin: 8_921, linux: 6_249, win32: 13_184 } },
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
  // The nightly containers of the install and git matrices (tests/environments/matrix.ts): image pulls and package installs over the network take the time, not the tool, so each budget is a bound for its cells on Linux, given as fixed time, and no multiple of a measurement.
  'tests/environments/install.nightly.test.ts > test 206: the install matrix, each package manager on node:24 and node:24-alpine, passes or refuses as the spec says (network)': { fixed: 1_800_000, measured: { linux: 1_800_000 } },
  'tests/environments/install.nightly.test.ts > S8-2: on oven/bun, Bun with no Node, the installed Lawcheck refuses in its first line, and doctor agrees with check (network)': { fixed: 300_000, measured: { linux: 300_000 } },
  'tests/environments/install.nightly.test.ts > S8-3: on node:20 and node:22, npm installs Lawcheck with a warning, and every command refuses in its first line, naming the Node version (network)': { fixed: 600_000, measured: { linux: 600_000 } },
  'tests/environments/install.nightly.test.ts > S8-5: with Yarn 1, check --json through yarn --silent run, as docs/config.md gives it, is one JSON document (network)': { fixed: 600_000, measured: { linux: 600_000 } },
  // The docs recipes of S7-1 to S7-4: a cell of each package manager runs the workflow of docs/ci.md as a pull request and as a push, and an install of Lawcheck from a tarball in every checkout, over the network, on a runner whose measured times were 98 s, 61 s, 40 s and 33 s. Each budget is twice the longest of those, rounded up to 5 s, given as fixed time.
  'tests/environments/ci-recipes.nightly.test.ts > tests 306 and 307: S7-1, S7-2, S7-3, S7-4, the workflow and the hooks of docs/ci.md (design tests 15 and 16), run as written on npm-lock, as a pull request and as a push (network)': { fixed: 200_000, measured: { linux: 200_000 } },
  'tests/environments/ci-recipes.nightly.test.ts > tests 306 and 307: S7-1, S7-2, S7-3, S7-4, the workflow and the hooks of docs/ci.md (design tests 15 and 16), run as written on npm-nolock, as a pull request and as a push (network)': { fixed: 125_000, measured: { linux: 125_000 } },
  'tests/environments/ci-recipes.nightly.test.ts > tests 306 and 307: S7-1, S7-2, S7-3, S7-4, the workflow and the hooks of docs/ci.md (design tests 15 and 16), run as written on yarn1, as a pull request and as a push (network)': { fixed: 80_000, measured: { linux: 80_000 } },
  'tests/environments/ci-recipes.nightly.test.ts > tests 306 and 307: S7-1, S7-2, S7-3, S7-4, the workflow and the hooks of docs/ci.md (design tests 15 and 16), run as written on pnpm, as a pull request and as a push (network)': { fixed: 70_000, measured: { linux: 70_000 } },
  'tests/environments/git.nightly.test.ts > test 207: the check slice acceptance tests and the security tests pass on the git of ubuntu:22.04, debian:12, ubuntu:24.04 and debian:sid (network)': { fixed: 2_400_000, measured: { linux: 2_400_000 } },
  'tests/environments/ownership.nightly.test.ts > S7-15: in a container whose user does not own the checkout, check names the safe.directory command, and that command lets it through (network)': { fixed: 300_000, measured: { linux: 300_000 } },
  // The longest time of each test on the Windows three-times jobs of the Nightlies 43899819915 to 44102549698 and of the Nightly that release run 44027365971 called (its round 1, as it was cancelled in round 2), every round included; there a system service can stall the disk and the processors for 34 to 55 seconds early in a job, and a test past 8 seconds kept too little of the default budget for it.
  'tests/contract/codes.test.ts > tests 232, 233, 236, 241 and 277: file-too-large, text-too-large, too-many-findings, file-unwritable and memory-too-large, in text and in JSON, and the commands their next lines name': { fixed: 0, measured: { win32: 23_265 } },
  'tests/acceptance/waivers.test.ts > test 33: a waiver of an unknown rule': { fixed: 0, measured: { win32: 20_350 } },
  'tests/acceptance/reviewer.test.ts > test 55: each form of a good answer': { fixed: 0, measured: { win32: 16_453 } },
  'tests/acceptance/self-law-rules.test.ts > question 160: no-import-cycles, a circle of value imports is found on each file of it; a type-only import closes no circle': { fixed: 0, measured: { win32: 15_275 } },
  'tests/acceptance/reviewer-law.test.ts > R-97: a pass recorded while the waiver counted is no pass once the type sets waivers: false, in check, check of a named file, explain and --review': { fixed: 0, measured: { win32: 15_130 } },
  'tests/acceptance/uses.test.ts > test 90: a grammar that cannot be loaded stops the run': { fixed: 0, measured: { win32: 15_012 } },
  'tests/acceptance/law-change.test.ts > test 300: S7-3, a rule taken off a type while the change breaks it is said in plain words, and the exit code stays': { fixed: 0, measured: { win32: 12_376 } },
  'tests/acceptance/providers.test.ts > test 62: a prompt larger than reviewer.max_chars is never sent': { fixed: 0, measured: { win32: 14_877 } },
  'tests/acceptance/paths.test.ts > test 143: directories, patterns, a file twice, an untyped file, files that select nothing, and a name that starts with -': { fixed: 0, measured: { win32: 11_583 } },
  'tests/acceptance/uses.test.ts > test 89: no grammar is loaded where no list reaches, and only the grammars a run parses': { fixed: 0, measured: { win32: 11_275 } },
  'tests/acceptance/providers.test.ts > test 63: no reviewer set': { fixed: 0, measured: { win32: 12_233 } },
  'tests/acceptance/plugin.test.ts > test 162: the two switches': { fixed: 0, measured: { win32: 11_228 } },
  'tests/acceptance/http-providers.test.ts > test 412: doctor asks the Ollama server whether it is there, and names its address': { fixed: 0, measured: { win32: 11_219 } },
  'tests/acceptance/http-providers.test.ts > test 413: the next line of a reviewer that cannot be called names the fix': { fixed: 0, measured: { win32: 11_163 } },
  'tests/security/output.test.ts > I-out-1: no file name, message or base forges a line or puts a forbidden character into text output, and one finding is one line': { fixed: 0, measured: { win32: 11_160 } },
  'tests/acceptance/plugin.test.ts > test 168: a fix lets the agent finish, and an empty turn checks nothing': { fixed: 0, measured: { win32: 10_836 } },
  'tests/security/output.test.ts > I-out-1: an error message the tool did not write stays on one line of text output': { fixed: 0, measured: { win32: 10_821 } },
  'tests/acceptance/reviewer-law.test.ts > test 71: two branches merge their verdicts': { fixed: 0, measured: { win32: 10_648 } },
  "tests/contract/shards.test.ts > question 95: when the call that reads the start of the run fails, the merge says so and gives the shards' time, and its verdict is the tests' verdict, as when the call works": { fixed: 0, measured: { win32: 10_312 } },
  'tests/acceptance/hostile.test.ts > S1-14: an edit of a file marked assume-unchanged or skip-worktree is in the change': { fixed: 0, measured: { win32: 10_222 } },
  'tests/security/runner.test.ts > R-98: a rule reads no SQLite database outside the root and writes none through node:sqlite, by any route to the module': { fixed: 0, measured: { win32: 10_057 } },
  'tests/acceptance/uses.test.ts > test 86: a waiver of forbidden-use, unused, and of a code that cannot be waived': { fixed: 0, measured: { win32: 9_994 } },
  'tests/acceptance/prime.test.ts > test 103: a law that cannot be read': { fixed: 0, measured: { win32: 9_818 } },
  'tests/acceptance/plugin.test.ts > test 177: no hook asks the reviewer': { fixed: 0, measured: { win32: 9_738 } },
  'tests/acceptance/law-change.test.ts > test 317: S7-3, a waiver the change adds is named in the line, and one the base already had is not': { fixed: 0, measured: { win32: 9_726 } },
  'tests/acceptance/uses.test.ts > test 85: untyped, binary, ignored and outside targets, and what is not read': { fixed: 0, measured: { win32: 8_927 } },
  'tests/acceptance/prime.test.ts > test 104: the budget takes the first step that fits': { fixed: 0, measured: { win32: 8_704 } },
  'tests/environments/shapes.test.ts > R-101: a package of a pnpm workspace in the store below node_modules/.pnpm is named by its own name in the next line, a scoped one with its scope': { fixed: 0, measured: { win32: 8_939 } },
  'tests/acceptance/providers.test.ts > test 59: the first error starts no new review, and what was answered is kept': { fixed: 0, measured: { win32: 8_575 } },
  'tests/acceptance/ci-docs.test.ts > S7-4: the page names the managers, the floors and the refusal of a plain check with no base in CI, and the code does what it says (report S8)': { fixed: 0, measured: { win32: 8_495 } },
  'tests/acceptance/reviewer.test.ts > test 49: a clone with no reviewer reads the committed verdict; CRLF keeps it, an edit loses it': { fixed: 0, measured: { win32: 8_290 } },
  'tests/acceptance/providers.test.ts > test 93: a key an HTTP header cannot carry stops the run before any call': { fixed: 0, measured: { win32: 8_269 } },
  'tests/acceptance/waivers.test.ts > test 35: two waivers in comments of other languages': { fixed: 0, measured: { win32: 8_176 } },
  'tests/acceptance/package.test.ts > release-readiness §Package: package: nothing the tarball or the plugin ships holds a test entry, names one or its variable, or changes the shipped limits and deadlines': { fixed: 0, measured: { win32: 8_163 } },
  'tests/acceptance/uses.test.ts > test 83: a forbidden use outside the change is debt': { fixed: 0, measured: { win32: 8_107 } },
  'tests/acceptance/rule-results.test.ts > S2-6: a rule that leaves an interval of ten minutes judges 200 files within the time of a rule that leaves nothing, plus one wait of 2 seconds': { fixed: 2_000, measured: { win32: 8_035 } },
  // The longest time of each test that passed a fifth of TEST_BUDGET_MS with no entry for win32 on the Windows runners of CI: the three-times jobs of the Nightlies 43899819915 to 44255743291 and of the Nightly that release run 44027365971 called, every round included, and the Windows commit jobs of CI runs 43918757215 to 44254948562 and of release runs 44027365971, 44159029678 and 44174812849. In round 1 of Nightly 44255743291 a stall of the machine took test 402 from about 6 to 31.9 seconds, so a test of 4 to 8 seconds is as exposed as one past 8. Fixed waits: R-87 of the rules waits PAST_USER_SET_MS, test 58 a reviewer.timeout of 1 second, R-110 the edit hook's test deadline of 3 seconds and half a second more, R-114 a write 2 seconds after the runner has ended, test 270 a worker held 2 seconds, R-76 looks for a reviewer call for 1 second once the review has reached the lock, and the four tests of tests/security/secrets.test.ts whose reply is first a 429 each wait the 2 seconds before the resend (docs/providers.md).
  'tests/acceptance/http-providers.test.ts > test 402: ollama': { fixed: 0, measured: { win32: 31_906 } },
  'tests/acceptance/init.test.ts > test 99: JSON, usage, and already-initialized as a reserved rule id': { fixed: 0, measured: { win32: 19_941 } },
  'tests/acceptance/languages.test.ts > test 88: debt, every finding and unresolved use of L outside the change': { fixed: 0, measured: { win32: 18_315 } },
  'tests/environments/shapes.test.ts > S2-2: a rule that imports a package from a node_modules above the root is refused in words that name the limit, never a flag': { fixed: 0, measured: { win32: 17_189 } },
  'tests/security/secrets.test.ts > S3-2: a key in the environment of claude-code appears in no output, file or temporary file, with claude in mode answer (I-secret-1)': { fixed: 0, measured: { win32: 13_953 } },
  'tests/acceptance/law-change.test.ts > test 301: S7-3, a rule script rewritten to return nothing is named by its file': { fixed: 0, measured: { win32: 13_663 } },
  'tests/security/secrets.test.ts > S3-2: a key in the environment of claude-code appears in no output, file or temporary file, with claude in mode raw (I-secret-1)': { fixed: 0, measured: { win32: 12_289 } },
  'tests/security/secrets.test.ts > S3-2: claude that prints the keys of its environment shows them as [key], with claude in mode echo-answer (I-secret-1)': { fixed: 0, measured: { win32: 12_054 } },
  'tests/security/secrets.test.ts > S3-2: claude that prints the keys of its environment shows them as [key], with claude in mode echo-error (I-secret-1)': { fixed: 0, measured: { win32: 11_527 } },
  'tests/security/secrets.test.ts > S3-2: a key in the environment of claude-code appears in no output, file or temporary file, with claude in mode error (I-secret-1)': { fixed: 0, measured: { win32: 11_254 } },
  'tests/acceptance/explain.test.ts > test 107: ignored, symbolic links and binary files': { fixed: 0, measured: { win32: 10_915 } },
  'tests/security/secrets.test.ts > S3-2: a key in the environment of claude-code appears in no output, file or temporary file, with claude in mode boom (I-secret-1)': { fixed: 0, measured: { win32: 10_395 } },
  'tests/security/secrets.test.ts > S3-2: the key of openai-compatible appears in no output, file, temporary file or request but its own header, for a reply that is 429 then pass (I-secret-1)': { fixed: 2_000, measured: { win32: 10_052 } },
  "tests/security/key-forms.test.ts > S3-2: claude-code with the key \"k\\\"e\\\\y-1x\" in its environment: the answer is read, and the key is replaced in its message (I-secret-1)": { fixed: 0, measured: { win32: 9_952 } },
  'tests/acceptance/cli.test.ts > test 45: at most 50 finding lines': { fixed: 0, measured: { win32: 9_875 } },
  'tests/environments/refusal.test.ts > test 201: control, the same copy with a sound runner judges the rules': { fixed: 0, measured: { win32: 9_054 } },
  'tests/limits/reviews.test.ts > test 242: S3-8, a review whose .lawcheck/.local cannot be written fails before the first call': { fixed: 0, measured: { win32: 8_589 } },
  "tests/security/links.test.ts > I-runner-1: an untracked link is the local user's own and does not stop the run": { fixed: 0, measured: { win32: 8_411 } },
  'tests/acceptance/package.test.ts > release-readiness §Package: package: the tarball holds the licence, the readme, the built tool, its docs and the grammars with their licences, and nothing else': { fixed: 0, measured: { win32: 8_377 } },
  'tests/security/secrets.test.ts > S3-2: a key in the environment of claude-code appears in no output, file or temporary file, with claude in mode expired (I-secret-1)': { fixed: 0, measured: { win32: 8_348 } },
  'tests/acceptance/explain.test.ts > test 113: usage': { fixed: 0, measured: { win32: 8_124 } },
  'tests/security/secrets.test.ts > S3-2: the key of anthropic appears in no output, file, temporary file or request but its own header, for a reply that is 429 then pass (I-secret-1)': { fixed: 2_000, measured: { win32: 8_112 } },
  'tests/acceptance/paths.test.ts > test 142: one named file, and its JSON': { fixed: 0, measured: { win32: 8_044 } },
  'tests/security/secrets.test.ts > S3-2: the key of openai-compatible appears in no output, file, temporary file or request but its own header, for a reply that is bad answer twice (I-secret-1)': { fixed: 0, measured: { win32: 8_002 } },
  'tests/contract/order.test.ts > R-57: the tests of a file run in the order of the seed, the same order for the same seed, and in definition order without one': { fixed: 0, measured: { win32: 7_982 } },
  'tests/security/links.test.ts > I-runner-1: a tracked link that leads outside the root stops the run before any rule runs, naming the link': { fixed: 0, measured: { win32: 7_979 } },
  'tests/environments/refusal.test.ts > test 210: doctor fails its config row when the runner the config names has no program on the PATH, and names it when it has': { fixed: 0, measured: { win32: 7_962 } },
  'tests/acceptance/waivers.test.ts > test 36: waivers outside the change count in the debt heading': { fixed: 0, measured: { win32: 7_958 } },
  'tests/security/secrets.test.ts > S3-2: the key of anthropic appears in no output, file, temporary file or request but its own header, for a reply that is 401 (I-secret-1)': { fixed: 0, measured: { win32: 7_940 } },
  'tests/environments/ci-shapes.test.ts > R-48: the clone of the no-base case has no origin/HEAD, whichever git made it, so the job is refused for its missing base': { fixed: 0, measured: { win32: 7_935 } },
  'tests/security/secrets.test.ts > S3-2: the key of openai-compatible appears in no output, file, temporary file or request but its own header, for a reply that is 500 HTML (I-secret-1)': { fixed: 0, measured: { win32: 7_932 } },
  'tests/acceptance/init.test.ts > test 97: init refuses where a law already governs, and writes nothing': { fixed: 0, measured: { win32: 7_931 } },
  'tests/acceptance/law-change.test.ts > test 304: S7-3, a change of the config is a change of the law, and a change that ends in exit 2 prints no note': { fixed: 0, measured: { win32: 7_919 } },
  'tests/acceptance/http-providers.test.ts > test 400: openai': { fixed: 0, measured: { win32: 7_898 } },
  'tests/security/secrets.test.ts > S3-2: the key of openai-compatible appears in no output, file, temporary file or request but its own header, for a reply that is closed connection (I-secret-1)': { fixed: 0, measured: { win32: 7_894 } },
  'tests/acceptance/http-providers.test.ts > test 401: google': { fixed: 0, measured: { win32: 7_892 } },
  'tests/security/secrets.test.ts > S3-2: the key of openai-compatible appears in no output, file, temporary file or request but its own header, for a reply that is 401 (I-secret-1)': { fixed: 0, measured: { win32: 7_872 } },
  'tests/acceptance/docs.test.ts > test 128: the list of topics, its JSON, and one page, outside git': { fixed: 0, measured: { win32: 7_832 } },
  'tests/security/start.test.ts > I-start-1: under runner npx and pnpm the hooks start no program of the repository through a relative PATH entry': { fixed: 0, measured: { win32: 7_816 } },
  'tests/acceptance/waivers.test.ts > test 31: a waiver on a line of its own covers the next line': { fixed: 0, measured: { win32: 7_803 } },
  'tests/acceptance/law-change.test.ts > test 318: S7-3, R-75, a changed waivers key is named by the type that writes it, and the types that inherit its value are not': { fixed: 0, measured: { win32: 7_783 } },
  'tests/acceptance/try.test.ts > test 120: a file with no type reaches a rule with type null': { fixed: 0, measured: { win32: 7_765 } },
  'tests/environments/refusal.test.ts > R-32: I-env-1, Node with --permission in NODE_OPTIONS, given the entry by its own path as the Windows shims give it, gets the refusal and no stack trace': { fixed: 0, measured: { win32: 7_750 } },
  'tests/acceptance/law-change.test.ts > R-99: a waiver of forbidden-use that the change adds is named in the line, in text and in JSON, as a waiver of a rule is': { fixed: 0, measured: { win32: 7_741 } },
  'tests/security/secrets.test.ts > S3-2: the key of openai-compatible appears in no output, file, temporary file or request but its own header, for a reply that is pass (I-secret-1)': { fixed: 0, measured: { win32: 7_732 } },
  'tests/security/links.test.ts > I-runner-1: a tracked link that stays inside the root does not stop the run': { fixed: 0, measured: { win32: 7_730 } },
  'tests/acceptance/self-law-rules.test.ts > question 160: layer-imports, an outside import a row does not hold, and a door taken by another file, are found; what a row holds passes': { fixed: 0, measured: { win32: 7_722 } },
  'tests/security/secrets.test.ts > S3-2: claude that prints the keys of its environment shows them as [key], with claude in mode echo-stderr (I-secret-1)': { fixed: 0, measured: { win32: 7_677 } },
  'tests/acceptance/plugin.test.ts > test 172: a stop without a state': { fixed: 0, measured: { win32: 7_677 } },
  'tests/security/secrets.test.ts > S3-2: a reply of anthropic that echoes the key shows it as [key] in every output and file, for 429 then a 403 that names the key (I-secret-1)': { fixed: 2_000, measured: { win32: 7_606 } },
  'tests/security/secrets.test.ts > S3-2: the key of openai-compatible appears in no output, file, temporary file or request but its own header, for a reply that is fail (I-secret-1)': { fixed: 0, measured: { win32: 7_551 } },
  'tests/acceptance/plugin.test.ts > test 176: a background agent keeps the turn open and says so; a background shell does not': { fixed: 0, measured: { win32: 7_483 } },
  'tests/acceptance/plugin.test.ts > test 161: a broken law reaches the agent once': { fixed: 0, measured: { win32: 7_469 } },
  'tests/acceptance/cli.test.ts > test 39: no base': { fixed: 0, measured: { win32: 7_426 } },
  "tests/guard/guard.test.ts > question 95: the suite guard, an owner's row that lands alone is refused for what is wrong with the row itself": { fixed: 0, measured: { win32: 7_351 } },
  'tests/security/secrets.test.ts > S3-2: a reply of openai-compatible that echoes the key shows it as [key] in every output and file, for 429 then a 403 that names the key (I-secret-1)': { fixed: 2_000, measured: { win32: 7_314 } },
  'tests/acceptance/first-law-docs.test.ts > test 309: R-7, the first-law page walked top to bottom in a new repository: every command it gives prints, byte for byte, the output the page shows after it': { fixed: 0, measured: { win32: 7_290 } },
  'tests/acceptance/targets.test.ts > dependency-slice §3.1: a name of the same package written without an import is a use': { fixed: 0, measured: { win32: 7_191 } },
  'tests/properties/law.test.ts > I-law-1: any text as law.yaml is a law or law-invalid at a line of the file': { fixed: 0, measured: { win32: 7_185 } },
  'tests/acceptance/try.test.ts > test 124: a pass that try paid for is not recorded': { fixed: 0, measured: { win32: 7_088 } },
  "tests/acceptance/reviewer-law.test.ts > R-97: the verdict line of F' from section 5, written while its waiver counted, passes it under a type that reads waivers and not under one with waivers: false": { fixed: 0, measured: { win32: 7_086 } },
  "tests/environments/refusal.test.ts > S8-1: control, a Lawcheck installed outside Plug'n'Play and started from a project that uses it judges the rules": { fixed: 0, measured: { win32: 7_084 } },
  'tests/contract/harness.test.ts > question 95: harness: the packed tarball starts as the package bin, and nothing else starts Lawcheck as a program': { fixed: 0, measured: { win32: 7_079 } },
  'tests/acceptance/package.test.ts > release-readiness §Package: package: every shipped grammar is named in the licence file': { fixed: 0, measured: { win32: 7_046 } },
  'tests/acceptance/try.test.ts > test 123: a reviewer rule is asked with check prompt, records nothing, and runs dry': { fixed: 0, measured: { win32: 7_016 } },
  'tests/acceptance/rules.test.ts > test 26: the runner stops writes, programs, workers and reads outside': { fixed: 0, measured: { win32: 6_988 } },
  'tests/acceptance/plugin.test.ts > test 173: a broken law, touched by the turn or not': { fixed: 0, measured: { win32: 6_965 } },
  'tests/acceptance/reviewer.test.ts > test 53: a cached failure is asked again only with --again': { fixed: 0, measured: { win32: 6_899 } },
  'tests/acceptance/try.test.ts > test 126: JSON of a reviewer rule asked twice': { fixed: 0, measured: { win32: 6_866 } },
  'tests/acceptance/law.test.ts > test 16: types that overlap': { fixed: 0, measured: { win32: 6_862 } },
  'tests/limits/memory.test.ts > test 277: a file read only for what it declares that takes too much memory names the step the user can take': { fixed: 0, measured: { win32: 6_765 } },
  'tests/acceptance/plugin.test.ts > R-110: the edit hook given the longest deadline the test entry takes waits for a lawcheck slower than its test deadline, as the test of R-88 needs on a loaded runner': { fixed: 3_500, measured: { win32: 6_718 } },
  'tests/acceptance/hostile.test.ts > S1-9: S5-8, a type that reaches into a submodule is named in a note, and explain and try give the true reason': { fixed: 0, measured: { win32: 6_713 } },
  'tests/acceptance/changes.test.ts > test 13: renames, deletions and staged edits': { fixed: 0, measured: { win32: 6_698 } },
  'tests/acceptance/hostile.test.ts > S1-9: S5-8, a type that reaches into a repository of its own is named in a note, and explain and try give the true reason': { fixed: 0, measured: { win32: 6_629 } },
  "tests/security/output-sources.test.ts > I-out-1: what a script rule prints on its own streams reaches the tool's standard error through the same escapes": { fixed: 0, measured: { win32: 6_570 } },
  'tests/acceptance/waivers.test.ts > test 32: a waiver without a reason': { fixed: 0, measured: { win32: 6_563 } },
  'tests/security/secrets.test.ts > S3-2: the key of anthropic appears in no output, file, temporary file or request but its own header, for a reply that is fail (I-secret-1)': { fixed: 0, measured: { win32: 6_559 } },
  'tests/acceptance/try.test.ts > test 116: a script rule on the files it binds, on a file, and on a file it does not bind': { fixed: 0, measured: { win32: 6_549 } },
  'tests/limits/reviews.test.ts > test 271: a review whose passes would push .lawcheck/verdicts past 16 MiB is refused before its first call': { fixed: 0, measured: { win32: 6_540 } },
  'tests/acceptance/plugin.test.ts > S6-6: a session_id of 5,000 characters keeps its state under its hash, and the hooks go on': { fixed: 0, measured: { win32: 6_491 } },
  "tests/guard/guard.test.ts > question 95: the suite guard, an owner's row on the base covers only the change it approves, so a later change of the same paths is refused": { fixed: 0, measured: { win32: 6_483 } },
  'tests/acceptance/explain.test.ts > test 105: explain a file, from a subdirectory, with content, and one that does not exist': { fixed: 0, measured: { win32: 6_429 } },
  'tests/acceptance/plugin.test.ts > test 171: a turn that never reached a stop is checked with the next': { fixed: 0, measured: { win32: 6_398 } },
  'tests/acceptance/paths.test.ts > test 145: a waiver in a named file, and a repository with no commit': { fixed: 0, measured: { win32: 6_341 } },
  'tests/environments/shapes.test.ts > I-out-1: a line a rule prints with CRLF reaches standard error as that line, with no carriage return shown': { fixed: 0, measured: { win32: 6_319 } },
  'tests/limits/sizes.test.ts > test 275: a file past the uses limit outside the change is debt, and one read only for what it declares is named, since the uses of it are not judged': { fixed: 0, measured: { win32: 6_296 } },
  'tests/acceptance/program-providers.test.ts > test 409: a copilot inside the folder of the VS Code extension is passed over': { fixed: 0, measured: { win32: 6_251 } },
  "tests/acceptance/waiver-key.test.ts > T6: waivers takes true or false, and a subtype takes its parent's value": { fixed: 0, measured: { win32: 6_232 } },
  'tests/security/secrets.test.ts > S3-2: a reply of anthropic that echoes the key shows it as [key] in every output and file, for fail whose message holds the key (I-secret-1)': { fixed: 0, measured: { win32: 6_200 } },
  "tests/acceptance/reviewer.test.ts > test 48: F' passes, and its pass is recorded": { fixed: 0, measured: { win32: 6_200 } },
  'tests/environments/ci-shapes.test.ts > S7-6: a depth-1 clone of a branch with no base fails every file outside CI, as the spec says, and a plain check refuses in CI with the ways out (question 87)': { fixed: 0, measured: { win32: 6_199 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, the judge is the guard of the base, so a branch that edits its own guard is still refused': { fixed: 0, measured: { win32: 6_168 } },
  'tests/acceptance/runes-limits.test.ts > test 313: S4-10, a large Java file with syntax errors is parsed on every run and bounded by nothing: the run passes, with no error and no named limit': { fixed: 0, measured: { win32: 6_165 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, case refused-platform-promise-skipped-elsewhere': { fixed: 0, measured: { win32: 6_156 } },
  'tests/acceptance/explain.test.ts > test 114: JSON': { fixed: 0, measured: { win32: 6_152 } },
  'tests/security/secrets.test.ts > S3-2: a reply of anthropic that echoes the key shows it as [key] in every output and file, for pass with the key in prose (I-secret-1)': { fixed: 0, measured: { win32: 6_149 } },
  'tests/security/secrets.test.ts > S3-2: the key of anthropic appears in no output, file, temporary file or request but its own header, for a reply that is pass (I-secret-1)': { fixed: 0, measured: { win32: 6_142 } },
  'tests/limits/sizes.test.ts > test 231: S1-4, S5-2, a text file of 600 MB is file-too-large with its path, in check, doctor, explain and try': { fixed: 0, measured: { win32: 6_140 } },
  'tests/acceptance/self-law-rules.test.ts > question 160: own-paths-in-one-place, import.meta outside src/adapters/package.ts and src/cli.ts is found': { fixed: 0, measured: { win32: 6_132 } },
  'tests/acceptance/prime.test.ts > test 100: prime in S, its JSON, and from a subdirectory': { fixed: 0, measured: { win32: 6_130 } },
  'tests/acceptance/paths.test.ts > test 144: paths with the flags of a change, and a path outside the root': { fixed: 0, measured: { win32: 6_064 } },
  'tests/acceptance/uses.test.ts > test 91: may_use: [] forbids every file, the own type included': { fixed: 0, measured: { win32: 6_037 } },
  'tests/acceptance/explain.test.ts > test 112: a directory, the root, a type and a rule': { fixed: 0, measured: { win32: 5_978 } },
  'tests/contract/harness.test.ts > harness-7: a change of git state fails the run, except the files its command writes by contract': { fixed: 0, measured: { win32: 5_974 } },
  'tests/acceptance/changes.test.ts > test 12: a path with letters outside ASCII': { fixed: 0, measured: { win32: 5_955 } },
  'tests/acceptance/rules.test.ts > test 29: repo.filesOf': { fixed: 0, measured: { win32: 5_939 } },
  'tests/environments/ci-shapes.test.ts > S7-5: a depth-1 clone given its base names the shallow clone and the fetch that fixes it; that fetch gives the right result': { fixed: 0, measured: { win32: 5_925 } },
  'tests/acceptance/law-change.test.ts > test 316: S7-3, a change of the why, the context or the about is named, and a note with no change of meaning says so': { fixed: 0, measured: { win32: 5_808 } },
  'tests/acceptance/try.test.ts > test 117: directories, patterns and their union': { fixed: 0, measured: { win32: 5_789 } },
  'tests/security/secrets.test.ts > S3-2: a reply of anthropic that echoes the key shows it as [key] in every output and file, for no verdict holding the key (I-secret-1)': { fixed: 0, measured: { win32: 5_706 } },
  'tests/limits/findings.test.ts > test 268: a message of 4,096 characters outside the first plane is a finding, and one more character crashes the rule': { fixed: 0, measured: { win32: 5_658 } },
  'tests/acceptance/reviewer.test.ts > test 47: --review asks once, keeps the failure, and the next plain run reads it': { fixed: 0, measured: { win32: 5_619 } },
  'tests/security/secrets.test.ts > S3-2: the key of anthropic appears in no output, file, temporary file or request but its own header, for a reply that is bad answer twice (I-secret-1)': { fixed: 0, measured: { win32: 5_577 } },
  'tests/security/secrets.test.ts > S3-2: the key of anthropic appears in no output, file, temporary file or request but its own header, for a reply that is 500 HTML (I-secret-1)': { fixed: 0, measured: { win32: 5_563 } },
  'tests/acceptance/doctor.test.ts > test 140: the usage of the program and of each command': { fixed: 0, measured: { win32: 5_547 } },
  'tests/security/secrets.test.ts > S3-2: the key of anthropic appears in no output, file, temporary file or request but its own header, for a reply that is closed connection (I-secret-1)': { fixed: 0, measured: { win32: 5_546 } },
  'tests/security/secrets.test.ts > S3-2: a reply of anthropic that echoes the key shows it as [key] in every output and file, for 401 that names the key (I-secret-1)': { fixed: 0, measured: { win32: 5_537 } },
  'tests/acceptance/law-change.test.ts > test 302: S7-3, the changes are told in a fixed order, and a law that only gains a note says that': { fixed: 0, measured: { win32: 5_531 } },
  "tests/guard/guard.test.ts > question 95: the suite guard, an owner's row lands alone first, and the change it approves passes once the row is on the base": { fixed: 0, measured: { win32: 5_514 } },
  'tests/security/git-programs.test.ts > R-22: S5-14, check and try start no program that the repository names for git, and still see the change (I-git-1)': { fixed: 0, measured: { win32: 5_506 } },
  'tests/acceptance/reviewer.test.ts > test 46: a plain run asks nothing and needs no reviewer': { fixed: 0, measured: { win32: 5_476 } },
  'tests/acceptance/reviewer.test.ts > test 54: waivers reach the reviewer through <waived>': { fixed: 0, measured: { win32: 5_439 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, case accepted-guard-by-owner': { fixed: 0, measured: { win32: 5_411 } },
  'tests/acceptance/rule-results.test.ts > S2-6: a rejection at the top of the module gives the same rule-crashed on one file and on two': { fixed: 0, measured: { win32: 5_384 } },
  'tests/acceptance/providers.test.ts > test 58: a request that passes reviewer.timeout is not sent again': { fixed: 1_000, measured: { win32: 5_344 } },
  'tests/acceptance/try.test.ts > test 121: a rule that throws is rule-crashed': { fixed: 0, measured: { win32: 5_334 } },
  'tests/acceptance/rule-results.test.ts > S2-6: a rejection in a call gives the same rule-crashed on one file and on two': { fixed: 0, measured: { win32: 5_323 } },
  'tests/security/secrets.test.ts > S3-2: a reply of openai-compatible that echoes the key shows it as [key] in every output and file, for no verdict holding the key (I-secret-1)': { fixed: 0, measured: { win32: 5_287 } },
  'tests/acceptance/rule-results.test.ts > S2-6: a throw from a timer 40 ms later gives the same rule-crashed on one file and on two': { fixed: 0, measured: { win32: 5_251 } },
  'tests/acceptance/rules.test.ts > check-slice §3: a rule that spins ends with the tool, whatever ends the tool': { fixed: 0, measured: { win32: 5_248 } },
  'tests/acceptance/explain.test.ts > test 115: explain and prime run no rule and send no request': { fixed: 0, measured: { win32: 5_245 } },
  'tests/environments/ci-shapes.test.ts > S7-6: doctor agrees with check in a CI job with no base': { fixed: 0, measured: { win32: 5_232 } },
  'tests/acceptance/rule-results.test.ts > S2-6: a rejection of an async call left behind gives the same rule-crashed on one file and on two': { fixed: 0, measured: { win32: 5_207 } },
  'tests/security/secrets.test.ts > S3-2: a reply of openai-compatible that echoes the key shows it as [key] in every output and file, for 401 that names the key (I-secret-1)': { fixed: 0, measured: { win32: 5_198 } },
  'tests/acceptance/law-change.test.ts > test 303: S7-3, the line holds five changes and counts the rest; JSON lists all': { fixed: 0, measured: { win32: 5_194 } },
  'tests/acceptance/reviewer-law.test.ts > test 74: the new flags': { fixed: 0, measured: { win32: 5_194 } },
  'tests/acceptance/reviewer.test.ts > test 50: --full lists the missing reviews of the debt': { fixed: 0, measured: { win32: 5_188 } },
  'tests/security/key-everywhere.test.ts > S3-2: a rule message that quotes a line holding the key shows [key], in text, JSON and try (I-secret-1)': { fixed: 0, measured: { win32: 5_183 } },
  'tests/environments/ci-shapes.test.ts > S7-6: --full needs no base, so it judges every file in CI as it does elsewhere': { fixed: 0, measured: { win32: 5_179 } },
  'tests/acceptance/waiver-key.test.ts > T6: a type with waivers: false reads a waiver marker in its files as text': { fixed: 0, measured: { win32: 5_175 } },
  'tests/acceptance/plugin.test.ts > test 159: an edit that breaks the law, by Write, by Edit, from another directory, and a notebook': { fixed: 0, measured: { win32: 5_171 } },
  'tests/security/secrets.test.ts > S3-2: a reply of openai-compatible that echoes the key shows it as [key] in every output and file, for pass with the key in prose (I-secret-1)': { fixed: 0, measured: { win32: 5_152 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, an anchor that does not exist, and one this change does not touch, are named as such': { fixed: 0, measured: { win32: 5_149 } },
  'tests/security/secrets.test.ts > S3-2: a reply of openai-compatible that echoes the key shows it as [key] in every output and file, for fail whose message holds the key (I-secret-1)': { fixed: 0, measured: { win32: 5_145 } },
  'tests/environments/refusal.test.ts > R-114: test 201, what a runner that did not start printed reaches standard error when it comes after the runner has ended': { fixed: 2_000, measured: { win32: 5_141 } },
  'tests/acceptance/law-change.test.ts > test 315: S7-3, a name in the law folder holding a format character is told as an escape, in text and in JSON': { fixed: 0, measured: { win32: 5_111 } },
  'tests/acceptance/rule-results.test.ts > S2-6: a rejection after a timer and several turns gives the same rule-crashed on one file and on two': { fixed: 0, measured: { win32: 5_104 } },
  'tests/acceptance/rule-results.test.ts > S2-6: a rule that leaves nothing running adds no wait: one file judged by it takes the time of a run that starts no rule, plus starting the runner': { fixed: 0, measured: { win32: 5_104 } },
  'tests/acceptance/paths.test.ts > test 146: a named file asks no reviewer, and its missing review is a warning': { fixed: 0, measured: { win32: 5_072 } },
  'tests/acceptance/plugin.test.ts > S6-8: a byte-order mark before the runner line, and the hook and the tool read the same runner': { fixed: 0, measured: { win32: 5_071 } },
  'tests/environments/refusal.test.ts > S8-2: on Bun with no node on the PATH a check names Bun in its first line, and says to install Node beside it': { fixed: 0, measured: { win32: 5_055 } },
  'tests/acceptance/try.test.ts > test 127: JSON of a script rule': { fixed: 0, measured: { win32: 5_042 } },
  'tests/limits/signals.test.ts > test 270: a worker slow to start is no step past its limit, since the watch starts with the command': { fixed: 2_000, measured: { win32: 5_016 } },
  'tests/acceptance/cli.test.ts > test 42: not initialized, and no git': { fixed: 0, measured: { win32: 4_903 } },
  'tests/environments/git-faults.test.ts > R-1: a repository whose HEAD git cannot read gives no-git that sends the user to repair it, and the repair lets check through': { fixed: 0, measured: { win32: 4_889 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, a record of an owner kind that the branch brings is refused, whoever it names': { fixed: 0, measured: { win32: 4_876 } },
  'tests/acceptance/rules.test.ts > R-87: the tool a user starts keeps its 30 seconds for a rule when the variable of the test entry is set': { fixed: 2_500, measured: { win32: 4_852 } },
  'tests/acceptance/cli.test.ts > test 43: usage': { fixed: 0, measured: { win32: 4_827 } },
  'tests/security/links.test.ts > I-runner-1: a tracked link inside a submodule that leads outside the root is refused': { fixed: 0, measured: { win32: 4_801 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, case accepted-expected-ruling': { fixed: 0, measured: { win32: 4_786 } },
  'tests/acceptance/uses.test.ts > test 84: a type may not use itself unless it names itself, and a subtype keeps its own list': { fixed: 0, measured: { win32: 4_776 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, case refused-expected-wrong-kind': { fixed: 0, measured: { win32: 4_775 } },
  'tests/acceptance/reviewer-law.test.ts > test 73: a crashed rule and an unreachable base stop the run before any call': { fixed: 0, measured: { win32: 4_762 } },
  'tests/security/git-programs.test.ts > S5-14: init starts no program that the repository names for git (I-git-1)': { fixed: 0, measured: { win32: 4_726 } },
  'tests/acceptance/rules.test.ts > check-slice §3: what a rule prints goes to standard error': { fixed: 0, measured: { win32: 4_680 } },
  'tests/acceptance/prime.test.ts > test 101: prime in R and in U': { fixed: 0, measured: { win32: 4_662 } },
  'tests/limits/reviews.test.ts > test 272: R-84, a pass that would take the verdicts file past 16 MiB when it is written is refused, even after the check before the calls': { fixed: 0, measured: { win32: 4_657 } },
  "tests/security/key-everywhere.test.ts > S3-2: a one-character key changes nothing in a plain check's output (I-secret-1)": { fixed: 0, measured: { win32: 4_656 } },
  'tests/security/output-sources.test.ts > I-out-1: a rule message cannot forge a line of check or try, in text or JSON': { fixed: 0, measured: { win32: 4_653 } },
  'tests/acceptance/plugin.test.ts > R-88: the test entry of the hooks refuses a deadline as long as the shipped one, and no program a hook starts sees its variable': { fixed: 0, measured: { win32: 4_648 } },
  'tests/security/output-sources.test.ts > I-out-1: an error text from the reviewer endpoint cannot forge a line of check or doctor': { fixed: 0, measured: { win32: 4_643 } },
  'tests/acceptance/waiver-key.test.ts > T6: the same file in a type that reads waivers gets waiver-unknown-rule (control)': { fixed: 0, measured: { win32: 4_625 } },
  'tests/acceptance/reviewer-law.test.ts > test 72: .lawcheck/verdicts and .lawcheck/.gitattributes have no type': { fixed: 0, measured: { win32: 4_623 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, case refused-platform-test-narrowed': { fixed: 0, measured: { win32: 4_621 } },
  'tests/limits/reviews.test.ts > test 261: a lock left by a run that ended, whose pid now names a live process, is taken over before the first call': { fixed: 0, measured: { win32: 4_588 } },
  'tests/acceptance/reviewer.test.ts > test 52: an advisory reviewer rule warns': { fixed: 0, measured: { win32: 4_586 } },
  "tests/environments/refusal.test.ts > test 201: a runner Node cannot start with its flags is runner-failed, with Node's words, and never rule-crashed on a rule file": { fixed: 0, measured: { win32: 4_570 } },
  'tests/acceptance/law.test.ts > test 15: a symlink and a binary file have no type; an unreadable file stops the run': { fixed: 0, measured: { win32: 4_544 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, case accepted-threshold-by-owner': { fixed: 0, measured: { win32: 4_508 } },
  "tests/acceptance/rules.test.ts > check-slice §3: a rule that writes to the runner's channel crashes as that rule": { fixed: 0, measured: { win32: 4_498 } },
  'tests/environments/ci-shapes.test.ts > test 208: a detached merge ref of a pull request, checked against its base, gives the change of the pull request': { fixed: 0, measured: { win32: 4_465 } },
  'tests/environments/refusal.test.ts > I-env-1: control, posed as Node 24 the same commands answer': { fixed: 0, measured: { win32: 4_456 } },
  'tests/acceptance/cli.test.ts > test 41: JSON': { fixed: 0, measured: { win32: 4_432 } },
  'tests/acceptance/plugin.test.ts > test 157: prime with a broken law': { fixed: 0, measured: { win32: 4_426 } },
  'tests/security/key-everywhere.test.ts > S3-2: what a script rule prints holding the key reaches standard error as [key] (I-secret-1)': { fixed: 0, measured: { win32: 4_425 } },
  'tests/environments/ci-shapes.test.ts > S7-5: the same clone with the base fetched at depth 1 names the shallow clone, and the fetch it names gives the right result': { fixed: 0, measured: { win32: 4_420 } },
  'tests/acceptance/doctor.test.ts > test 131: doctor in S with a base, and its JSON': { fixed: 0, measured: { win32: 4_400 } },
  'tests/acceptance/rules.test.ts > test 22: one line per broken rule': { fixed: 0, measured: { win32: 4_361 } },
  'tests/acceptance/try.test.ts > test 118: a reviewer rule takes files alone': { fixed: 0, measured: { win32: 4_348 } },
  "tests/security/key-everywhere.test.ts > S3-2: a key that is a word of Lawcheck's own output leaves that output as it is; only the text from outside shows [key] (I-secret-1)": { fixed: 0, measured: { win32: 4_343 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, case refused-platform-skip-added': { fixed: 0, measured: { win32: 4_305 } },
  'tests/acceptance/self-law.test.ts > question 160: a committed break of each script rule and a forbidden use are found by the same check': { fixed: 0, measured: { win32: 4_301 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, case refused-self-law-unsorted-grows': { fixed: 0, measured: { win32: 4_299 } },
  'tests/acceptance/hostile.test.ts > S1-14: with the law below it, in pkg/, a marked file with no edit passes and an edited one is in the change': { fixed: 0, measured: { win32: 4_262 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, case refused-platform-promise-added-unlisted': { fixed: 0, measured: { win32: 4_250 } },
  'tests/acceptance/plugin.test.ts > test 175: a check that does not run is told once per session': { fixed: 0, measured: { win32: 4_241 } },
  'tests/security/output-sources.test.ts > I-out-1: a config value cannot forge a line of check or doctor': { fixed: 0, measured: { win32: 4_192 } },
  'tests/acceptance/changes.test.ts > check-slice §4: a file staged and then put back is not in the change': { fixed: 0, measured: { win32: 4_188 } },
  'tests/acceptance/try.test.ts > commands-slice §5: a target that names a file git lists is that file, before it is a pattern': { fixed: 0, measured: { win32: 4_171 } },
  'tests/environments/ci-shapes.test.ts > test 209: a push with an empty base ref names the empty branch name, and a push of a new branch names the commit of zeros': { fixed: 0, measured: { win32: 4_168 } },
  'tests/security/start.test.ts > I-start-1: check, a review through claude-code and the hooks start no program that lies in the repository, through a relative PATH entry or the current folder': { fixed: 0, measured: { win32: 4_163 } },
  'tests/acceptance/hostile.test.ts > S1-14: with the law at the top of the work tree, a marked file with no edit passes and an edited one is in the change': { fixed: 0, measured: { win32: 4_138 } },
  'tests/acceptance/self-law.test.ts > question 160: the committed tree has no finding of an enforced rule and none of a built-in code, and only the waivers and the unresolved use listed here': { fixed: 0, measured: { win32: 4_135 } },
  'tests/limits/findings.test.ts > test 256: 60,000 findings with a line cost time in proportion to their count': { fixed: 0, measured: { win32: 4_123 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, case refused-platform-promise-dropped': { fixed: 0, measured: { win32: 4_094 } },
  'tests/acceptance/explain.test.ts > test 106: files with no type, and a new file of a type': { fixed: 0, measured: { win32: 4_051 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, who may approve each kind is configuration': { fixed: 0, measured: { win32: 4_026 } },
  'tests/security/frame-review.test.ts > S3-1: check --review records no pass for close-why.ts with a reviewer that takes every separator for a line end': { fixed: 0, measured: { win32: 4_026 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, case accepted-test-removed-with-row': { fixed: 0, measured: { win32: 4_025 } },
  'tests/guard/guard.test.ts > question 95: the suite guard, case refused-self-law-waiver-added': { fixed: 0, measured: { win32: 4_001 } },
  // Measured on Nightly run 43965209262 (seven entries of the list): each entry builds the broken code and runs its test; the run took 8.2 s with five.
  'tests/sabotage/sabotage.nightly.test.ts > question 95: the sabotage list, every break of the list turns its test red': { fixed: 0, measured: { linux: 21_000 } },

  // The longest time on the Windows three-times jobs: for the CI page, of the Nightly 45057543660, the first where its scenario passed its assertions on Windows; for the adopt page, of the Nightlies 45049413622 and 45057543660. Every round included.
  'tests/contract/docs-examples.test.ts > test 432: the scenario of docs/ci.md runs the blocks it claims, and each output the page shows is the one the tool prints, byte for byte': { fixed: 0, measured: { win32: 30_216 } },
  'tests/contract/docs-examples.test.ts > test 432: the scenario of docs/adopt-in-an-existing-repository.md runs the blocks it claims, and each output the page shows is the one the tool prints, byte for byte': { fixed: 0, measured: { win32: 13_265 } },
};

// Test 410 proves that the script takes ollama, codex and copilot-cli, which two runs, the fewest it accepts, show.
export const STABILITY_PROVIDER_RUNS = 2;

// On Windows each call of the fake claude starts cmd.exe and node, so ten runs of 300 calls took 117 s there; two runs, the fewest that give a pair of runs to compare, prove the same promise of test 76.
export const STABILITY_RUNS: Record<System, number> = { linux: 10, darwin: 10, win32: 2 };

// The budget of harness-6: the test's entry in SLOW_TESTS for the system, and never less than the system's default.
export function testBudget(key: string, system: System = process.platform as System): number {
  return Math.max(system === 'win32' ? WINDOWS_TEST_BUDGET_MS : TEST_BUDGET_MS, slowBudget(key, system) ?? 0);
}

export function slowBudget(key: string, system: System = process.platform as System): number | null {
  const slow = SLOW_TESTS[key];
  const measured = slow?.measured[system];
  if (slow === undefined || measured === undefined) return null;
  return Math.ceil((slow.fixed + SLOW_MARGIN * Math.max(0, measured - slow.fixed)) / 5_000) * 5_000;
}


// The tests whose names cite only a section label or a decision (design/decisions.md, decision 79), less the tests of the suite's machinery and of the repository's own law that cite only decision 95 or 160 (decision 96). The rail checks the count against this number, above and below, so that a lower count is written down here. That the number may only fall is the suite guard's, read from the base through `stronger`; the rail alone stays green when the number is raised.
export const SECTION_ONLY_TESTS = 177;

export const SLOWEST_SHOWN = 10;

// The share of a property's cases that must hold each class of input its generator claims to reach.
export const REACH_SHARE = 0.1;

// The live run of the attack files (promise I-frame-1 of design/promises.md): each attack file and its twin go through the real reviewer this many times, and the run holds when this share of pairs agrees and this share of verdicts is fail.
export const LIVE_TIMES = 5;
export const LIVE_SAME_SHARE = 1;
export const LIVE_FAIL_SHARE = 1;
// One try of LIVE_TIMES calls of the real claude.
export const LIVE_RUN_BUDGET_MS = 900_000;

// The nightly property files of tests/properties: the nightly run of a property goes on with a new seed until this much time has passed.
export const NIGHTLY_MS = 120_000;
// A match of src/**/*a*a*a*a*a*a*b.ts against a name of 240 `a`, through the matcher and through check --full (I-glob-1, S1-1); measured below 2 ms and 400 ms.
export const MATCH_BUDGET_MS = 100;
export const PATTERN_RUN_BUDGET_MS = 8_000;
// takeAnswer on one megabyte of `{` and on 50,000 nested objects (I-answer-1, S3-3); measured below 30 ms.
export const ANSWER_BUDGET_MS = 1_000;
// The same reading, without a clock that load can break (I-answer-1, S3-3): an answer 4 times as long may take at most this many times as long to read, the shortest of ANSWER_ROUNDS reads of each; a linear reader measures 4 to 7 on a loaded machine, a quadratic one 16 and more.
export const ANSWER_GROWTH = 10;
export const ANSWER_ROUNDS = 8;
// parseLaw on the generator's deepest text, 20,000 levels of brackets; measured at 57 ms in the dev container.
export const LAW_PARSE_BUDGET_MS = 1_500;
// What a rule that leaves an interval running may add to a run of 200 files: the one wait of 2 seconds after its last call (docs/script-rules.md), and 2 seconds for the noise of two runs.
export const LEFT_RUNNING_EXTRA_MS = 4_000;
// What starting the runners of a rule that leaves nothing adds to a run of one file: measured at 16 ms in the dev container; a runner that waited its full 2 seconds after the last call would pass it.
export const NOTHING_LEFT_EXTRA_MS = 1_000;
// One pure call on generated input, for the base oracle of no run over its budget; the slowest measured, glob on a name of 4,096 characters, takes under 14 ms.
export const PURE_CALL_BUDGET_MS = 1_000;
// One start of the tool on a generated case.
export const TOOL_RUN_BUDGET_MS = 20_000;

// tests/acceptance/runes-limits.test.ts, S4-10: a Java file of this many characters with syntax errors is parsed on every run, and the run passes.
export const UNPARSABLE_JAVA_CHARS = 400_000;

// tests/environments/ci-recipes.nightly.test.ts: the pnpm the docs recipes run with, installed with npm in the node:24 image. A string, not a number the guard reads.
export const RECIPE_PNPM = '12.21.0';

// The items of the code that no page of docs/ holds yet, the length of the list in tests/contract/docs-inventory.test.ts, which may only fall.
export const DOCS_NOT_COVERED = 0;

// Which way each number makes the suite stronger, read by the suite guard; a seed is neither, so any change of it is a change to review.
export const stronger: Record<string, 'higher' | 'lower' | 'fixed'> = {
  LIMITS_RUN_MS: 'lower',
  LIMITS_LARGE_RUN_MS: 'lower',
  LIMITS_RULES_RUN_MS: 'lower',
  LIMITS_STOPPED_MS: 'lower',
  SEED: 'fixed',
  UNPARSABLE_JAVA_CHARS: 'higher',
  CASES_PURE: 'higher',
  CASES_TOOL: 'higher',
  CASES_LOOP: 'higher',
  TEST_BUDGET_MS: 'lower',
  WINDOWS_TEST_BUDGET_MS: 'lower',
  RUN_BUDGET_MS: 'lower',
  LOOP_TARGET_MS: 'lower',
  COMMIT_TARGET_MS: 'lower',
  LEFTOVER_GRACE_MS: 'lower',
  KILLED_GRACE_MS: 'lower',
  WINDOWS_KILLED_GRACE_MS: 'lower',
  REAL_RUN_BUDGET_MS: 'lower',
  STABILITY_RUN_BUDGET_MS: 'lower',
  ONE_FILE_CHECK_MS: 'lower',
  SPEED_RUNS: 'higher',
  CLAUDE_TIMEOUT_RUN_MS: 'lower',
  FAKE_STARTED_MS: 'lower',
  HOOK_PAST_DEADLINE_MS: 'lower',
  RULE_PAST_LIMIT_MS: 'lower',
  RULE_PAST_LIMIT_SHARE: 'lower',
  RULE_CALL_MS: 'fixed',
  TEST_RULE_MS: 'fixed',
  USER_SET_RULE_MS: 'fixed',
  USER_SET_DEADLINE_S: 'fixed',
  PAST_USER_SET_MS: 'fixed',
  TEST_HOOK_DEADLINES: 'fixed',
  HOOK_SIGTERM_AFTER_MS: 'fixed',
  STOPPED_HOOK_ENDS_MS: 'lower',
  SLOW_TESTS: 'lower',
  SLOW_MARGIN: 'lower',
  STABILITY_RUNS: 'higher',
  SLOWEST_SHOWN: 'higher',
  SECTION_ONLY_TESTS: 'lower',
  REACH_SHARE: 'higher',
  LIVE_TIMES: 'higher',
  LIVE_SAME_SHARE: 'higher',
  LIVE_FAIL_SHARE: 'higher',
  LIVE_RUN_BUDGET_MS: 'lower',
  PROGRAM_TIMEOUT_RUN_MS: 'lower',
  RESEND_REPLY_DELAY_MS: 'fixed',
  RESEND_LEFT_BOUND_MS: 'lower',
  SHARED_TIMEOUT_S: 'fixed',
  LIST_DELAY_MS: 'fixed',
  LATE_ANSWER_MS: 'fixed',
  LOCK_HELD_LOOK_MS: 'higher',
  HTTP_TIMEOUT_RUN_MS: 'lower',
  HELD_OUTPUT_RUN_MS: 'lower',
  RESEND_WAIT_MS: 'fixed',
  STABILITY_PROVIDER_RUNS: 'higher',
  NIGHTLY_MS: 'higher',
  MATCH_BUDGET_MS: 'lower',
  PATTERN_RUN_BUDGET_MS: 'lower',
  ANSWER_BUDGET_MS: 'lower',
  ANSWER_GROWTH: 'lower',
  ANSWER_ROUNDS: 'higher',
  LAW_PARSE_BUDGET_MS: 'lower',
  LEFT_RUNNING_EXTRA_MS: 'lower',
  NOTHING_LEFT_EXTRA_MS: 'lower',
  PURE_CALL_BUDGET_MS: 'lower',
  TOOL_RUN_BUDGET_MS: 'lower',
  DOCS_NOT_COVERED: 'lower',
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
