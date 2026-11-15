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

// spec/plugin-slice.md, test 163: within 30 seconds of the deadline of 25 and within 150 of the deadline of 145, so a hook ends within 5 seconds of its deadline; SIGTERM after 2 seconds.
export const HOOK_PAST_DEADLINE_MS = 5_000;
export const HOOK_SIGTERM_AFTER_MS = 2_000;
// The deadlines in seconds that the per-push runs of test 163 and of section 5's session-start and prompt hooks give in place of 25, 15, 25 and 145; the nightly runs the shipped ones. Each leaves the stand-in lawcheck time to start through cmd.exe on a busy Windows runner, so that each run ends at its deadline with the stand-in running. No two are the same, and prompt's, which no message names, is the longest, so a hook that reads another hook's deadline ends too early or names the wrong one.
export const TEST_HOOK_DEADLINES = { 'session-start': 5, prompt: 6, edit: 3, stop: 4 };
export const STOPPED_HOOK_ENDS_MS = 10_000;

// spec/check-slice.md, test 24: a rule that hangs crashes within 40 seconds of a limit of 30, so within 10 seconds of its limit. The per-push run gives the tool a limit of 3 seconds in place of 30, which leaves the runner time to start on a busy Windows runner, so that the hang in check is stopped in its call and not in its load; the nightly runs the shipped one.
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

// spec/reviewer-slice.md, section 6: a call ends at reviewer.timeout without waiting for the kill grace or a second full timeout. Tests 406 to 408 run with a timeout of 1 second, the shared list and call with one of SHARED_TIMEOUT_S, test 411 with one of 3; a timeout of 1 second of an HTTP provider in test 403, and a program that ended while a child holds its output, ended 2 seconds later.
export const PROGRAM_TIMEOUT_RUN_MS = 5_000;
export const HTTP_TIMEOUT_RUN_MS = 10_000;
export const HELD_OUTPUT_RUN_MS = 10_000;
// spec/reviewer-slice.md, section 6: the resend after a 429 waits 2 seconds.
export const RESEND_WAIT_MS = 2_000;
// Test 411: the fake answers after 2.5 seconds of a timeout of 3, so the resend has 0.5 seconds left; the bound adds 1 second, twenty times the tens of milliseconds a request takes to be cut off, and stays well below the full 3 seconds a resend had before.
export const RESEND_REPLY_DELAY_MS = 2_500;
export const RESEND_LEFT_BOUND_MS = 1_500;
// The case of tests 406 and 408 where the list of MCP servers takes 2 seconds and the answer 3 seconds more, past a timeout of 4. Neither alone reaches the timeout, and the two together pass it by 1 second: the list keeps 2 seconds for the starts of the fake and of its sleeping child, which take over half a second on a Windows runner, and an answer that got a timeout of its own would still end in time by 1 second.
export const SHARED_TIMEOUT_S = 4;
export const LIST_DELAY_MS = 2_000;
export const LATE_ANSWER_MS = 3_000;

// Rule 7 of section 16 of the test design: a time budget is at least 20 times the measured time.
// The runs of the limits tests, tests/limits: a run at a limit of spec/check-slice.md, section 10; a nightly run of the large inputs; a nightly run that waits for the 600 seconds the script rules of a run may take; and the two seconds a run has to answer a signal.
export const LIMITS_RUN_MS = 120_000;
export const LIMITS_LARGE_RUN_MS = 300_000;
export const LIMITS_RULES_RUN_MS = 700_000;
export const LIMITS_STOPPED_MS = 2_000;

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
  "tests/properties/arguments.test.ts > I-hook-1, S6-6, S6-8: any input to a hook gives exit 0 with nothing or one hook document, or the defined notice, never a stack trace": { fixed: 0, measured: { darwin: 9_955, linux: 5_762, win32: 13_367 } },
  // Measured on CI runs 43762617467 and 43764121085: 25 sample repositories, a check in text and in JSON each.
  "tests/properties/contents.test.ts > I-lines-1: for any text of a judged file, every finding lies inside it, and the text and JSON forms agree": { fixed: 0, measured: { darwin: 24_953, linux: 12_949, win32: 66_110 } },
  // Measured on CI runs 43762617467 and 43764121085: 25 sequences of git commands, each followed by seven runs of the tool.
  "tests/properties/git-states.test.ts > I-git-2: in any state a sequence of git commands leaves, a check changes nothing in git, its change gives what --full gives for those files, and it prints the same from below the root and twice": { fixed: 0, measured: { darwin: 82_146, linux: 56_267, win32: 231_038 } },
  // Measured on CI runs 43762617467 and 43764121085: 25 laws, each printed back type by type and rule by rule.
  "tests/properties/law.test.ts > I-law-1: an accepted law is printed back by explain, every type and every rule whole": { fixed: 0, measured: { darwin: 19_307, linux: 20_115, win32: 69_905 } },
  // Measured on CI runs 43762617467 and 43764121085: 25 sample repositories with generated names, three runs of the tool each.
  "tests/properties/names.test.ts > I-files-1: every file a type matches is judged, whatever bytes its name holds, and its JSON path maps back to the file on disk": { fixed: 0, measured: { darwin: 30_513, linux: 32_388, win32: 84_470 } },
  // Measured on CI runs 43762617467 and 43764121085: 25 rules, each judged alone and with a second file.
  "tests/properties/rules.test.ts > I-rules-1, S2-4, S2-6: any value a rule returns, throws or rejects with gives findings or a rule-crashed naming its cause, and file A is judged the same alone or with B": { fixed: 0, measured: { darwin: 25_976, linux: 22_921, win32: 75_556 } },
  // The nightly run of a property searches for NIGHTLY_MS, a fixed wait, then ends the case it is in: up to two cases of the commit run's time, at least 5 s.
  "tests/properties/glob.nightly.test.ts > I-glob-1, S1-1: a pattern matches as the reference matcher does, on small input": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/glob.nightly.test.ts > I-glob-1, S1-1: a list with exclusions matches as the reference does": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/glob.nightly.test.ts > I-glob-1, S1-1: any text is a pattern that compiles or one with a named problem": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/glob.nightly.test.ts > I-glob-1, S1-1: a match costs time linear in the name, for any pattern and a name of up to 4,096 bytes": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/answer.nightly.test.ts > I-answer-1, S3-3: the answer read is the one the reading of section 4 takes, on small input": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/answer.nightly.test.ts > I-answer-1, S3-3: any answer is a verdict or a named bad answer, in linear time, with lines in or out of range": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/answer.nightly.test.ts > I-answer-1, S3-4: two verdict objects that agree give their verdict, and a pass followed by a fail is never read as a pass": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/names.nightly.test.ts > I-files-1: a name maps back to its bytes, holds no line break, and the hooks write it the same way": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/names.nightly.test.ts > I-files-1: every file a type matches is judged, whatever bytes its name holds, and its JSON path maps back to the file on disk": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 126_756 } },
  "tests/properties/contents.nightly.test.ts > I-lines-1: lines split as section 3 says, and every waiver sits on a line of the file and covers one": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/contents.nightly.test.ts > I-lines-1: a file is binary exactly when its first 8,000 bytes hold a NUL": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/contents.nightly.test.ts > I-lines-1: for any text of a judged file, every finding lies inside it, and the text and JSON forms agree": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_288 } },
  "tests/properties/law.nightly.test.ts > I-law-1: any text as law.yaml is a law or law-invalid at a line of the file": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/law.nightly.test.ts > I-law-1: an accepted law is printed back by explain, every type and every rule whole": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_592 } },
  "tests/properties/law.nightly.test.ts > I-law-1: any text as config.yaml is a config or config-invalid at a line of the file": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/rules.nightly.test.ts > I-rules-1, S2-4, S2-6: any value a rule returns, throws or rejects with gives findings or a rule-crashed naming its cause, and file A is judged the same alone or with B": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 126_044 } },
  "tests/properties/git-states.nightly.test.ts > I-git-2: in any state a sequence of git commands leaves, a check changes nothing in git, its change gives what --full gives for those files, and it prints the same from below the root and twice": { fixed: 120_000, measured: { darwin: 126_570, linux: 125_000, win32: 138_482 } },
  "tests/properties/arguments.nightly.test.ts > I-args-1: tokens of the tool and junk give usage or a run, never internal, and change nothing in git": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  "tests/properties/arguments.nightly.test.ts > I-hook-1, S6-6, S6-8: any input to a hook gives exit 0 with nothing or one hook document, or the defined notice, never a stack trace": { fixed: 120_000, measured: { darwin: 125_000, linux: 125_000, win32: 125_000 } },
  // The limits tests of the commit set, measured on CI: each starts the tool several times at a limit, which Windows starts slowly.
  'tests/limits/sizes.test.ts > test 254: a law may hold 10,000 rules, 1,000 types and 1 MiB, and past each it is file-too-large': { fixed: 0, measured: { darwin: 6_233, linux: 4_085, win32: 23_560 } },
  'tests/limits/reviews.test.ts > S3-6: test 243: a second run right after any run prints the same': { fixed: 0, measured: { darwin: 7_475, linux: 4_188, win32: 12_489 } },
  'tests/limits/reviews.test.ts > S3-6: test 243: a plain check right after a passing review passes, with a type whose paths cover .lawcheck/': { fixed: 0, measured: { win32: 4_079 } },
  'tests/limits/sizes.test.ts > test 263: a file whose uses are read may hold 512 KiB, even of the costliest text, and a config 1 MiB': { fixed: 0, measured: { darwin: 8_054, linux: 5_116, win32: 11_260 } },
  'tests/limits/writes.test.ts > S1-6: S5-13: S8-8: test 240: every command writing to an output opened only for reading ends with exit 2': { fixed: 0, measured: { win32: 8_675 } },
  'tests/limits/findings.test.ts > S2-1: test 235: 125,000 and 200,000 findings from one rule give the full report and exit 1': { fixed: 0, measured: { darwin: 5_663, linux: 4_143, win32: 8_518 } },
  'tests/limits/findings.test.ts > S2-1: test 236: 200,001 and 1,000,000 findings from one rule, and 300,000 over three files, are too-many-findings': { fixed: 0, measured: { win32: 7_853 } },
  'tests/limits/findings.test.ts > test 237: the messages of a run may hold 16,777,216 characters together, and a message 4,096': { fixed: 0, measured: { win32: 6_113 } },
  'tests/limits/findings.test.ts > test 264: waivers count toward the findings of a run: 200,000 waivers that name no rule are reported, and one more is too-many-findings': { fixed: 0, measured: { darwin: 4_005, win32: 5_283 } },
  // The nightly limits, measured in the container of 1 GB and 2 CPUs on Linux; the fixed parts are the tool's limits the tests wait on: 30 rules that each pass 30 seconds, 15 at a time; the 600 seconds of the script rules of a run; the 30 seconds of a step.
  'tests/limits/large.nightly.test.ts > test 248: 150,000 files: every one is typed and judged, and the one that breaks a rule is found': { fixed: 0, measured: { linux: 17_662 } },
  'tests/limits/large.nightly.test.ts > test 249: 4 GiB of text across files stops at the file that passes 128 MiB, as text-too-large': { fixed: 0, measured: { linux: 6_119 } },
  'tests/limits/large.nightly.test.ts > S2-5: test 251: 30 rules that hang end as rule-crashed, each after its 30 seconds, within the time of the run': { fixed: 450_000, measured: { linux: 450_462 } },
  'tests/limits/large.nightly.test.ts > S2-5: test 251: rules that take 29 seconds a file are stopped when the script rules of the run pass 600 seconds': { fixed: 600_000, measured: { linux: 600_156 } },
  'tests/limits/large.nightly.test.ts > test 252: kill -9 at a random moment of 50 reviews leaves a verdicts file that parses, and the next run passes': { fixed: 0, measured: { linux: 8_030 } },
  'tests/limits/large.nightly.test.ts > S1-1: test 255: a step that never ends, typing against a content pattern that backtracks, ends as step-too-slow after 30 seconds': { fixed: 30_000, measured: { linux: 30_237 } },
  'tests/limits/large.nightly.test.ts > test 259: a git that never answers ends as step-too-slow after 30 seconds, and git with it': { fixed: 30_000, measured: { linux: 30_193 } },
  'tests/limits/large.nightly.test.ts > test 269: explain of a file whose content pattern backtracks names its typing as the step past its limit': { fixed: 30_000, measured: { linux: 30_185 } },
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
  'tests/deadlines/hook-deadlines.nightly.test.ts > test 163: the deadline, and a hook that is stopped, at the deadlines the plugin ships': { fixed: 172_000, measured: { darwin: 175_080, linux: 174_217, win32: 174_998 } },
  // The session-start and prompt deadlines of 25 and 15 seconds (spec/plugin-slice.md, section 5).
  'tests/deadlines/hook-deadlines.nightly.test.ts > section 5: the session-start and prompt hooks each end at their own deadline, at the deadlines the plugin ships': { fixed: 40_000, measured: { darwin: 40_734, linux: 40_201, win32: 41_022 } },
  // The test deadlines of the edit and stop hooks, 3 and 4 seconds, and on Linux and macOS the SIGKILL 2 seconds after SIGTERM (spec/plugin-slice.md, section 5).
  'tests/acceptance/plugin.test.ts > test 163: the deadline, and a hook that is stopped': { fixed: 7_000, measured: { linux: 9_515, win32: 8_375 } },
  // The test deadlines of the session-start and prompt hooks, 5 and 6 seconds (spec/plugin-slice.md, section 5).
  'tests/acceptance/plugin.test.ts > section 5: the session-start and prompt hooks each end at their own deadline': { fixed: 11_000, measured: { linux: 11_817 } },
  // Three waits of PAST_USER_SET_MS past the deadline of 1 second the variable would set (session-start and edit at once, prompt, stop).
  'tests/acceptance/plugin.test.ts > section 5: the hook a user runs keeps its shipped deadline for every event when the variable of the test entry is set': { fixed: 7_500, measured: { linux: 9_447 } },
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
  // Two calls of RULE_CALL_MS under the test limit of 3 seconds (spec/check-slice.md, section 3).
  'tests/acceptance/rules.test.ts > section 3: each call of a rule has the whole limit, so two calls that are each inside it pass however long they take together': { fixed: 4_000, measured: { linux: 4_438 } },
  // A run of the tool per case.
  'tests/acceptance/rules.test.ts > test 21: each broken answer crashes the rule': { fixed: 0, measured: { win32: 7_512 } },
  // The test limit of 3 seconds a rule may run, in place of 30 (spec/check-slice.md, section 3).
  'tests/acceptance/rules.test.ts > test 24: a rule that hangs is stopped': { fixed: 3_000, measured: { win32: 5_717 } },
  // The 30 seconds a rule may run (spec/check-slice.md, section 3).
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
  // A run of the tool per case, and one 429 answered after 2 seconds (spec/reviewer-slice.md, section 6).
  'tests/acceptance/http-providers.test.ts > test 403: what openai answers': { fixed: 2_000, measured: { linux: 5_508, darwin: 12_768, win32: 15_075 } },
  'tests/acceptance/http-providers.test.ts > test 403: what google answers': { fixed: 2_000, measured: { linux: 5_682, darwin: 13_523, win32: 12_891 } },
  'tests/acceptance/http-providers.test.ts > test 403: what ollama answers': { fixed: 2_000, measured: { linux: 6_514, darwin: 10_669, win32: 12_815 } },
  // Four runs of the tool per HTTP provider and two per program.
  'tests/acceptance/http-providers.test.ts > test 404: the key canary': { fixed: 0, measured: { darwin: 18_425, win32: 27_263 } },
  // A run of the tool per provider and per program.
  'tests/acceptance/http-providers.test.ts > test 405: a key under a provider name goes to that provider alone': { fixed: 0, measured: { darwin: 5_010, win32: 7_929 } },
  // A run of the tool per case, each starting the fake program through cmd.exe on Windows.
  'tests/acceptance/program-providers.test.ts > test 406: codex': { fixed: 0, measured: { darwin: 11_854, win32: 64_931 } },
  'tests/acceptance/program-providers.test.ts > test 407: gemini-cli': { fixed: 0, measured: { linux: 5_194, darwin: 12_728, win32: 63_443 } },
  'tests/acceptance/program-providers.test.ts > test 408: copilot-cli': { fixed: 0, measured: { linux: 6_455, darwin: 12_112, win32: 86_831 } },
  // STABILITY_PROVIDER_RUNS runs of 30 calls through each fake, a process per call of a program.
  'tests/acceptance/stability.test.ts > test 410: the measurement through ollama, codex and copilot-cli': { fixed: 0, measured: { linux: 6_606, darwin: 26_998, win32: 52_639 } },
  // A 429 after 2.5 seconds, then a dropped connection after 2.5 seconds and a resend held to the 0.5 seconds left of a timeout of 3 (spec/reviewer-slice.md, test 411).
  'tests/acceptance/http-providers.test.ts > test 411: the timeout bounds a request and its resend': { fixed: 5_500, measured: { linux: 5_769, darwin: 6_875, win32: 7_131 } },
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
  'tests/environments/git.nightly.test.ts > test 207: the check slice acceptance tests and the security tests pass on the git of ubuntu:22.04, debian:12, ubuntu:24.04 and debian:sid (network)': { fixed: 2_400_000, measured: { linux: 2_400_000 } },
  'tests/environments/ownership.nightly.test.ts > S7-15: in a container whose user does not own the checkout, check names the safe.directory command, and that command lets it through (network)': { fixed: 300_000, measured: { linux: 300_000 } },

};

// Test 410 proves that the script takes ollama, codex and copilot-cli, which two runs, the fewest it accepts, show.
export const STABILITY_PROVIDER_RUNS = 2;

// On Windows each call of the fake claude starts cmd.exe and node, so ten runs of 300 calls took 117 s there; two runs, the fewest that give a pair of runs to compare, prove the same promise of test 76.
export const STABILITY_RUNS: Record<System, number> = { linux: 10, darwin: 10, win32: 2 };

export function slowBudget(key: string, system: System = process.platform as System): number | null {
  const slow = SLOW_TESTS[key];
  const measured = slow?.measured[system];
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

// Layer 2, the properties of tests/properties: the nightly run of a property goes on with a new seed until this much time has passed.
export const NIGHTLY_MS = 120_000;
// A match of src/**/*a*a*a*a*a*a*b.ts against a name of 240 `a`, through the matcher and through check --full (design test 4, stress finding S1-1); measured below 2 ms and 400 ms.
export const MATCH_BUDGET_MS = 100;
export const PATTERN_RUN_BUDGET_MS = 8_000;
// takeAnswer on one megabyte of `{` and on 50,000 nested objects (design test 6, stress finding S3-3); measured below 30 ms.
export const ANSWER_BUDGET_MS = 1_000;
// parseLaw on the generator's deepest text, 20,000 levels of brackets; measured at 57 ms in the dev container.
export const LAW_PARSE_BUDGET_MS = 1_500;
// What a rule that leaves an interval running may add to a run of 200 files: the one wait of 2 seconds after its last call (spec/check-slice.md, section 3), and 2 seconds for the noise of two runs.
export const LEFT_RUNNING_EXTRA_MS = 4_000;
// What starting the runners of a rule that leaves nothing adds to a run of one file: measured at 16 ms in the dev container; a runner that waited its full 2 seconds after the last call would pass it.
export const NOTHING_LEFT_EXTRA_MS = 1_000;
// One pure call on generated input, for the base oracle of no run over its budget; the slowest measured, glob on a name of 4,096 characters, takes under 14 ms.
export const PURE_CALL_BUDGET_MS = 1_000;
// One start of the tool on a generated case.
export const TOOL_RUN_BUDGET_MS = 20_000;

// Which way each number makes the suite stronger, read by the suite guard; a seed is neither, so any change of it is a change to review.
export const stronger: Record<string, 'higher' | 'lower' | 'fixed'> = {
  LIMITS_RUN_MS: 'lower',
  LIMITS_LARGE_RUN_MS: 'lower',
  LIMITS_RULES_RUN_MS: 'lower',
  LIMITS_STOPPED_MS: 'lower',
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
  HTTP_TIMEOUT_RUN_MS: 'lower',
  HELD_OUTPUT_RUN_MS: 'lower',
  RESEND_WAIT_MS: 'fixed',
  STABILITY_PROVIDER_RUNS: 'higher',
  NIGHTLY_MS: 'higher',
  MATCH_BUDGET_MS: 'lower',
  PATTERN_RUN_BUDGET_MS: 'lower',
  ANSWER_BUDGET_MS: 'lower',
  LAW_PARSE_BUDGET_MS: 'lower',
  LEFT_RUNNING_EXTRA_MS: 'lower',
  NOTHING_LEFT_EXTRA_MS: 'lower',
  PURE_CALL_BUDGET_MS: 'lower',
  TOOL_RUN_BUDGET_MS: 'lower',
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
