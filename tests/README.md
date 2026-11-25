# Tests

Every command below runs inside the dev container, except `npm run agent-trial` and `node tests/live/run.ts`, which need Claude Code on the host. `npm test` needs no network and no key.

## Running them

| Command | What it runs |
|---|---|
| `npm test` | builds, then runs the commit set: the tests CI runs on every push |
| `npm run t -- <file or test id>` | the tests of the files you name, or of the source files you changed; `tests/map.json` maps each file of `src/` to its tests |
| `npm run nightly` | builds, then runs the nightly set |
| `npm run gate -- --base origin/main` | `npm test`, then the suite guard of the base, and the reviewer's pack: test ids added, changed and removed, and which of them fail on the base |
| `npm run real` | builds, then checks two real repositories, hono and gson, against their expected results; needs the network |
| `npm run build && node tests/real/speed.ts` | builds, then checks one changed file in guava and in Newtonsoft.Json with the reader cache and without it: the outputs must be the same, and the median of five checks with the cache must stay under `ONE_FILE_CHECK_MS`; needs the network |
| `npm run stability` | builds, then asks a real reviewer the same questions ten times and writes `tests/stability/result.json`; needs `LAWCHECK_STABILITY_MODEL` and a reviewer that answers |
| `npm run agent-trial` | the trial of the plugin with a live agent, run on the host through `claude`; writes `tests/agent/result.json` |
| `npm run agent-trial -- --host codex` | the trial of the plugin in Codex, in a container with the `codex` program; `LAWCHECK_TRIAL_BASE_URL` and `LAWCHECK_TRIAL_API_KEY` name a Responses API endpoint, else it takes the sign-in of `~/.codex`; writes `tests/agent/result-codex.json` |
| `npm run agent-trial -- --host copilot --model gpt-4o` | the trial of the plugin in GitHub Copilot CLI, in a container with the `copilot` program; `LAWCHECK_TRIAL_BASE_URL` and `LAWCHECK_TRIAL_API_KEY` name an OpenAI-compatible endpoint, which gets `--model` as the name of its model, else it takes the sign-in of `COPILOT_GITHUB_TOKEN`; writes `tests/agent/result-copilot.json` |
| `node tests/live/run.ts` | the attack files through the real reviewer, `claude-code` on the host; writes `tests/live/result.json` |

CI runs `npm run real` in its job `real`; `npm run agent-trial` runs by hand, and no release of the Claude Code plugin waits for it ([decision 58](../design/decisions.md#58-acceptance-tests-that-run-outside-npm-test)). `npm run stability` and `node tests/live/run.ts` run when the prompt, the providers or the plugin changed since their last result ([decision 75](../design/decisions.md#75-when-the-tests-with-a-live-model-run)).

## The layers

| Folder | What its tests hold |
|---|---|
| `unit/` | one file per source file |
| `acceptance/` | the tool from the outside: one command in a repository built in a temporary folder, with its exact output |
| `contract/` | the suite's own rules: every test leads with a source, the docs name only allowed tools, every code has a case, the CI groups match the sets |
| `guard/` | the suite guard and its cases in `guard/cases/` |
| `gate/` | the code of `npm run gate`; its group of the commit set holds no tests yet |
| `properties/` | generated inputs for the promises of [design/promises.md](../design/promises.md); the nightly files run more of them |
| `security/` | the security promises: output, keys, the runner, git programs, the reviewer's frame |
| `limits/` | every limit, at its edge and past it |
| `environments/` | Node and git versions, package managers, repository shapes, CI shapes, operating systems |
| `deadlines/` | the shipped deadlines of rules and hooks, run nightly at their real length |
| `docs/` | one file per page of `docs/`, named as the page, and `README.ts` for `README.md`: each fenced block of the page claimed by the file's scenario or by an existing test that checks it; `contract/docs-examples.test.ts` runs them and fails on a block no one claims |
| `sabotage/` | breaks the code on purpose, one entry of `sabotage/list.json` at a time, and expects the test the entry names to fail |
| `harness/` | the code that starts the tool in tests and checks every run |
| `real/`, `stability/`, `agent/`, `live/` | the runs outside `npm test`, and their committed results: `real/` runs in its own CI job, the others by hand |

The folders `sample/`, `reviewer-sample/`, `uses-sample/` and `languages-sample/` hold repositories that tests copy. They hold no tests of their own.

Every run of the tool in a test passes the checks of `harness/invariants.ts`: `harness-1` to `harness-8` and `harness-count`. Among them, the exit code is 0, 1 or 2, standard error is empty unless the test expects text there, no process outlives the run, and git is unchanged.

## The labels in test names

Every test name starts with its source and a colon ([decision 79](../design/decisions.md#79-every-test-leads-its-name-with-its-source)). The rail `contract/spec-map.test.ts` fails on a name with no source, or with a promise, harness check, section label or decision that does not exist; it checks test numbers and finding ids only for their form.

| Label | What it is |
|---|---|
| `test N:` or `tests N and M:` | the number of an acceptance test; a new acceptance test takes a number above the highest in use, never one that `design/decisions.md` or `tests/weakenings.md` names, and the unit tests of its parts may carry it too; outside `unit/`, a number leads names in one file, except the pairs of `contract/shared-numbers.json`, a list that may only shrink, and `contract/spec-map.test.ts` fails on any other pair |
| `I-<name>-<n>:` | a promise of [design/promises.md](../design/promises.md) |
| `harness-<n>:` | a check of `harness/invariants.ts` |
| `S<report>-<n>:`, `R-<n>:`, `U-<n>:`, `T1:` to `T8:` | the number of a bug found in a stress test (`S`), a review (`R`), a user's report (`U`) or Lawcheck's own law (`T`); the test is its regression test |
| `question N:` | a decision of [design/decisions.md](../design/decisions.md), by the same number |
| `<slice> §<n>:` | a topic of the first design, written as one spec per slice before the build; the table below says what each covers and where it is described |

A finding id may also follow an acceptance test number: `test 240: S8-8, R-82, a write that fails` ([decision 96](../design/decisions.md#96-the-rail-over-the-whole-suite)).

| Section label | What it covers | Described in |
|---|---|---|
| `check-slice §2` | the law file, types and patterns | [docs/law.md](../docs/law.md) |
| `check-slice §3` | the script rule contract and the runner | [docs/script-rules.md](../docs/script-rules.md) |
| `check-slice §4` | the command `check`, the base and the change | [docs/change.md](../docs/change.md) |
| `check-slice §5` | waivers | [docs/waivers.md](../docs/waivers.md) |
| `check-slice §6` | output and exit codes | [docs/codes.md](../docs/codes.md), [docs/json.md](../docs/json.md) |
| `commands-slice §2` | what every command shares: usage, errors, the `next:` line | [docs/commands.md](../docs/commands.md#every-command), [docs/codes.md](../docs/codes.md) |
| `commands-slice §3` | `init` | [docs/commands.md](../docs/commands.md#init), [docs/files.md](../docs/files.md), [docs/first-law.md](../docs/first-law.md) |
| `commands-slice §4` | `prime` | [docs/commands.md](../docs/commands.md#prime), [docs/other-agents.md](../docs/other-agents.md), [docs/json.md](../docs/json.md) |
| `commands-slice §5` | `try` | [docs/script-rules.md](../docs/script-rules.md), [docs/reviewer-rules.md](../docs/reviewer-rules.md) |
| `commands-slice §6` | `explain` | [docs/commands.md](../docs/commands.md#explain), [docs/json.md](../docs/json.md) |
| `commands-slice §7` | `docs` | [docs/commands.md](../docs/commands.md#docs), [docs/json.md](../docs/json.md) |
| `commands-slice §8` | `doctor`, and a change of the law | [docs/commands.md](../docs/commands.md#doctor), [docs/ci.md](../docs/ci.md#a-change-to-the-law), [docs/json.md](../docs/json.md) |
| `dependency-slice §2` | `may_use` in the law | [docs/law.md](../docs/law.md) |
| `dependency-slice §3.1` | what counts as a use | [docs/languages.md](../docs/languages.md) |
| `dependency-slice §3.2` | which files are read for uses | [docs/languages.md](../docs/languages.md) |
| `dependency-slice §3.3` | the readers | [docs/languages.md](../docs/languages.md) |
| `dependency-slice §3.5` | from a use to a type | [docs/languages.md](../docs/languages.md) |
| `dependency-slice §5` | the findings and output of uses | [docs/languages.md](../docs/languages.md), [docs/codes.md](../docs/codes.md) |
| `dependency-slice §6` | the readers and their grammars | [docs/languages.md](../docs/languages.md) |
| `plugin-slice §5` | what every hook shares: its deadline, its root and its runner | [docs/plugin.md](../docs/plugin.md), [docs/config.md](../docs/config.md) |
| `plugin-slice §10` | the agent trial | `agent/` |
| `release-readiness §Package` | what the npm package holds | `package.json` |
| `reviewer-slice §2` | reviewer rules in the law | [docs/reviewer-rules.md](../docs/reviewer-rules.md) |
| `reviewer-slice §4` | the review: what the reviewer receives and must answer | [docs/reviewer-rules.md](../docs/reviewer-rules.md) |
| `reviewer-slice §5` | verdicts | [docs/reviewer-rules.md](../docs/reviewer-rules.md) |
| `reviewer-slice §6` | providers, keys and config | [docs/providers.md](../docs/providers.md), [docs/config.md](../docs/config.md) |
| `reviewer-slice §7` | the cap on reviewer calls | [docs/config.md](../docs/config.md) |
| `reviewer-slice §8` | `check --review` | [docs/reviewer-rules.md](../docs/reviewer-rules.md) |

## The suite guard

Agents write most of this code, and an agent under pressure makes a red test green by weakening it. The suite guard, in `guard/`, compares a change with its base and finds what makes the suite weaker: a removed or renamed test, a changed expected output, a removed sabotage entry, a changed harness, a raised time budget, a changed guard or CI file, a changed law of the repository. Each such weakening passes only with a row in `weakenings.md` that gives its reason, an anchor and an approver. The change adds that row itself, except for the four kinds the owner approves: their row lands on `main` first, in a change of its own, and names the change it approves with `approves <hash>`.

- The rows of `weakenings.md` are only ever added. The guard refuses a change that edits or removes one.
- A changed or removed row of [design/promises.md](../design/promises.md), a changed example block of `docs/codes.md` or `docs/json.md`, and a changed or removed row of the code table of `docs/codes.md` or of a field table of `docs/json.md` (read by its first cell, under its heading), is `promise-changed`; an added row is no weakening. A removed or renamed test needs an anchor: the test number (`test <n>`; an older row writes `row <n>` for the same number) or the `S<r>-<n>` finding its name leads with, a promise it names whose row the same change changes, `ruling <n>` of design/decisions.md, or `Runes <version>`.
- `guard/config.json` says who approves each kind. A fresh reviewer agent approves most kinds. The owner approves `promise-changed`, `guard-changed`, `ci-changed` and `threshold-lowered` ([decision 76](../design/decisions.md#76-who-may-weaken-the-suite)).
- The guard that judges a change is always the one on the base, never the one on the branch. CI runs it from `.github/workflows/guard.yml`, and `npm run gate` runs it locally.
- When the guard refuses, it prints the row it needs. Run the guard of the base alone with `node tests/guard/from-base.ts --base origin/main`.

The opening paragraph of `weakenings.md` and its older rows name `spec/questions.md` and the rows of the specs, the anchors of the first design. They stay as they were written. [design/decisions.md](../design/decisions.md) keeps the decisions it took over under the same numbers. The kind `finding-weakened` that the opening paragraph lists is gone with the findings ledger.

`numbers.ts` holds the budgets, the seed and the counts that may only move one way. A test that takes more time than its budget fails, and a budget raised in `numbers.ts` is a weakening. So is any change of its code, the part that is not one of the numbers the guard reads, such as `testBudget`: code can raise a budget that no number shows, so the guard reports it as `threshold-lowered` of `tests/numbers.ts`. A new number alone, with its direction in `stronger`, is no weakening. A value is read as written up to the type after `as` or `satisfies`: anything else after it, such as `0 as number || 90_000`, leaves the value unreadable and is refused. A test or a helper that names a larger time of `numbers.ts` than it named before, a different `*_MS` or a new one, is `threshold-lowered` of that file, and so is a test that named none and now names a time past `RUN_BUDGET_MS`; a new test is no weakening. The guard compares the times each test names one by one, from the largest down, and pads the shorter list with `RUN_BUDGET_MS`, so a call whose time rises, a call that drops its time and falls to the default, and a time named by two strings joined with `+` are all read. A new test is no weakening, except in a file that loses a test in the same change: a new test whose times are larger than those of each removed test is a rise, which is how a rename with a larger time shows. A time written as a bare name, such as `KILLED_GRACE_MS` in a call or in a choice between two numbers, is read too, outside `import` lines, by the name and the count of its uses in a test or in the part of a file outside its tests: a name that is new there and holds more than the longest time whose uses fell, or, when no use fell, more than everything the test named and `RUN_BUDGET_MS`, is `threshold-lowered` of that file. That is how a switch to a new, larger number shows even when no string names it. A name the code builds in any other way, from a variable or a call, is not read, and a reviewer reads every change to the times a test names. The guard compares numbers only: an exported text or list of `numbers.ts` is no value it compares, so once code reads one, a later change of it can raise a budget that no check sees, and a reviewer reads every change to such a constant. A test's budget is `TEST_BUDGET_MS`, 20 seconds, and on Windows `WINDOWS_TEST_BUDGET_MS`, 90 seconds, because a fresh Windows runner can stall for up to a minute. When `SLOW_TESTS` lists the test for the system it runs on, the budget is the test's fixed waits plus `SLOW_MARGIN`, 20, times the rest of its longest measured time there, rounded up to 5 seconds, and never less than that system's default.
