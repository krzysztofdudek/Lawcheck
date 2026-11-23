# Decisions

Each entry is a choice that a contributor could take for a mistake and "fix". It says what was decided, and why where the reason was recorded. The number is the one the decision had when it was taken, and test names cite it as `question <n>`; a row of `tests/weakenings.md` anchors it as `ruling <n>`. The gaps in the numbering are entries left out: choices a test now pins down on its own, notes of reviews, and questions still open.

## 1. Two waivers covering one finding

The waiver on the finding's own line takes the finding. Otherwise the nearest waiver above it takes it. The other waivers of that line stay unused unless another finding reaches them.

Why: this choice decides which waiver `waiver-unused` names, so it has to be one fixed rule.

## 5. Rules run side by side

Each rule keeps one call at a time in its own process. Up to as many rules as the machine has cores run at once.

The output does not depend on it, because findings and crashes are sorted before printing.

## 6. The order of errors and the `next:` line of exit 2

Errors sort like findings, by file, line and code, and an error without a place comes first. The `next:` line follows the first error after sorting.

## 7. The order of `waivers` in JSON

By file path, then by line.

## 18. Fixed texts of the reviewer calls

These texts are fixed in `src/review.ts` and `src/output.ts`:

- before the first call, on standard error: `lawcheck: <n> reviewer calls to <provider>`;
- the `next:` of `too-many-reviews`: `<n> reviewer calls are needed and the limit is <m>; raising reviewer.max_calls or --max-calls is the user's decision`;
- the `next:` of a `reviewer-unreachable` without a place: `make <provider> reachable as the error says, then run <review>`;
- the `next:` of a failed review: `run the same command again; what was answered is kept, so it asks only the rest`;
- the status of an HTTP failure: `HTTP <status> <status text>`, then `: ` and the first line of `error.message` when the body has one.

## 21. Tests 78 and 79

Test 79 is `npm test` itself, so no test inside `npm test` can carry it: the whole suite is the test.

Test 78 is the reviewer's reading of the committed result of `npm run stability`. `tests/acceptance/stability-result.test.ts` checks what a script can: the fixture against its checksums in `tests/stability/expected/fixture.json`, the model, the counts and shares against the pairs, `label_match.clear.share` of at least 0.9, and no `://`.

## 56. A hook stopped by a signal

A hook stopped by `SIGTERM`, `SIGINT` or `SIGHUP` kills the process group of a call in progress and exits with 0, printing nothing.

Why: the hook was stopped and did not fail, and Claude Code has already given up on its output.

## 58. Acceptance tests that run outside `npm test`

CI runs two checks in jobs of their own: `npm run real`, which needs the network, in the job `real`, and `claude plugin validate .` and `claude plugin validate ./plugin`, with a pinned Claude Code, in the job `plugin`. Two run by hand before a release: the agent trial, `npm run agent-trial`, on the host, and a person reading the README and the plugin's files for their wording and for names of other tools. Test 181 reads `tests/agent/result.json`, which the trial writes, so it fails until the trial has run once.

Why: each needs something `npm test` does not have: the network, Claude Code, a live agent, or a person's reading.

## 71. An ambiguous use whose every candidate is forbidden

Such a use is a `forbidden-use` whose message names its candidates with their types, and it stays counted as unresolved, with its candidates in the JSON output. A use with one allowed, binary or own file among its candidates is no finding.

Why: whichever candidate the use names, the list forbids it, so the finding rests on no guess. The readers still did not tie the use to one file, so it stays unresolved. Until alpha.5 such a use was only counted, which left a Java star import of a package with files of two forbidden types passing. The owner accepted the change on 2026-11-23, in the triage of what the first design left unbuilt.

## 73. The environments Lawcheck supports

Lawcheck runs on Node 24 and later, with git 2.34 and later. It installs with npm, pnpm, Yarn 1, Yarn 4 with `nodeLinker: node-modules` or `nodeLinker: pnpm`, and Bun beside Node. It refuses everything else in the first line of its output, with the reason: Node 20 and 22, Yarn Plug'n'Play, Bun without Node. A refused environment never blames a rule file.

Why: a narrow promise, said loudly. A wider one would put more code in the way rules start, and more cells in the install matrix for good.

## 74. Limits instead of "no size limit"

Every input has a named, measured limit: the largest file read as text, the count of findings, the size of a reviewer answer, the wall time of a run, and the others in `docs/config.md` and `docs/codes.md`. Past a limit the tool prints a named error with the path, never `internal`.

Why: reading every file as a stream would be a large rewrite for text files over 512 MB, which almost nobody has.

## 75. When the tests with a live model run

The tests with a live model run when the files they guard change (the prompt, the providers, the plugin) and before every release. A release does not go out when the last result is older than those files. They run through `claude` on the host, on the owner's subscription, never with an API key.

Why: a weekly run would show sooner when a new model version judges differently, at the price of a full run every week.

## 76. Who may weaken the suite

An ordinary weakening of the suite, such as a changed expected file or a removed test, needs a row in `tests/weakenings.md` approved by a fresh reviewer agent. Four kinds need the owner's approval, and nothing else stands in for it: removing or softening a promise, changing the suite guard, changing the CI files, and lowering a threshold. Who may approve each kind is configuration in `tests/guard/config.json`, not code. This is the owner's decision.

Why: if every weakening waited for the owner, work would stop while he is away. If a reviewer alone could approve everything, agents could move the anchor together without anyone seeing it.

## 77. Docs may name Runes

The docs pages name no other tool, with one exception: Runes, the library the readers come from. A test reads every page and fails on a tool named outside its allowed list.

Why: a user who meets a limit of a reader needs the library's name to look it up.

## 78. A change that touches the law is said plainly

When a change edits the law that judges it, the check says so in its output and in the JSON. `docs/ci.md` gives a recipe that catches it: judge the pull request against the law of its base, or make the law's folder need a review.

Why: a pull request can leave a rule out of a type, rewrite a rule script to return nothing, or add a waiver on the line it breaks, and its check still passes.

## 79. Every test leads its name with its source

Every test name starts with its source and a colon: an acceptance test number (`test 12:` or `tests 3 and 4:`), a promise id (`I-frame-1:`), a finding id (`S3-1:`, `R-34:` or `T6:`), a section label (`check-slice §4:`) or a decision of this file (`question 79:`). The rail `tests/contract/spec-map.test.ts` fails on a name with no source, or with a promise, harness check, section label or decision that does not exist; test numbers and finding ids it checks only for their form. Every promise of [promises.md](promises.md) and every check of `tests/harness/invariants.ts` needs a test that carries its id. Tests that cite only a section or a decision are counted in `SECTION_ONLY_TESTS` in `tests/numbers.ts`, and that count may only fall.

A skip needs a platform reason in `tests/harness/skips.ts`, and a test that asserts nothing fails the run. A test that ran and passed is the only thing that covers its source in a run.

Why: one list and one count that a rail reads, in place of a sentence nobody checks.

## 80. A file whose name holds a line break or invalid UTF-8

Such a file is judged. Its name prints with each line feed, carriage return, invalid byte and backslash escaped (`\n`, `\r`, `\xHH`, `\\`), in text and in JSON alike. `explain` and `try` take the escaped form.

Why: a file left out of the list is never judged and nothing says so, so a pull request could put code past every rule through such a name. The escapes keep one finding on one line, and the name maps back to the bytes on disk.

## 87. No base in CI

In CI, a plain `check` that finds no base ends as `base-unreachable`, exit 2. Its `next:` line names `--base origin/<the branch the change goes into>`, `LAWCHECK_BASE` with the history fetched, or `lawcheck check --full`. A job is in CI when `CI` is set and is not empty, `0`, `false`, `no` or `off`; without `CI`, when the variable of a known CI service is set. Outside CI, a check with no base judges every file as changed.

Why: in CI a missing base is a forgotten setting, and failing the whole repository would read as bad code.

## 89. The key a reviewer server echoes

Lawcheck writes the one exact key it sent as `[key]` wherever it prints or writes it: text and JSON output, error messages, the verdicts file, the failure cache and temporary files. It masks nothing else and scans for nothing that looks like a key. This is the owner's decision.

Why: the tool knows the key it sent, so it replaces that string. Text it does not own stays as it came.

## 90. Nine providers in the first alpha

The first alpha ships all nine reviewer providers. This is the owner's decision.

## 91. Windows blocks a release

A red run of the suite on Windows blocked the alpha exactly as a red run on Linux or macOS did. This is the owner's decision. The release workflow holds every release to it, since it needs a green Nightly, and the Nightly runs on all three systems.

Why: three systems are one gate.

## 93. A key shorter than 8 characters is not replaced

Only a key of 8 characters or more is written as `[key]`. `docs/providers.md` states the limit.

Why: a key of one to seven characters is a dummy or a test value, and replacing it garbled paths, words and numbers that contain it.

## 95. The suite's own machinery

The harness, the runner, the numbers, the map from `src/` to tests, the discovery of test files, the suite guard, the gate and the sabotage list belong to the suite itself. A test of that machinery that checks none of the harness invariants cites this decision in its name. [tests/README.md](../tests/README.md) describes its layers, the labels in test names and the suite guard.

Why: every test still leads its name with a source the rail checks, including tests that no feature of the tool can carry.

## 96. The rail over the whole suite

A test that carries an acceptance test number may list finding ids right after it: `test 240: S8-8, R-82, a write that fails`. Elsewhere a finding id counts only when it leads the name. A test that cites only decision 95 inside `tests/contract/`, `tests/guard/` or `tests/sabotage/`, or only decision 160 inside the tests of the repository's own law, is outside `SECTION_ONLY_TESTS`.

Why: without the first rule, the test of a fix that has its own number could never name the finding it fixes. Without the second, every new test of the suite's machinery would break the count.

## 100. The six added providers

`openai`, `google`, `ollama`, `codex`, `gemini-cli` and `copilot-cli` share the HTTP request and the program call of the first three providers. Tests 400 to 413 hold them.

## 135. A path longer than a system allows, given to `explain`

Such a path is `usage`, exit 2: `the path '<path>' cannot exist here: it is longer than this system allows for a name or a path`. A segment written with escapes is measured by the bytes it stands for.

Why: no file system Lawcheck runs on can hold such a path, so it is a mistake in the argument, not a file that does not exist yet.

## 160. Lawcheck's repository keeps its own law

Lawcheck's own repository runs under Lawcheck, and `npm test` checks it. The law in `.lawcheck/` is the architecture the code moves to: layers as folders under `src/`, script rules, and reviewer rules answered by `claude-code`, whose passes are committed in `.lawcheck/verdicts`. Files of `src/` not yet in a layer are listed in the law, and that list only shrinks. `tests/acceptance/self-law.test.ts` clones `HEAD`, runs `check --full`, and fails on any finding of an enforced rule or of a built-in code, on a waiver or an unresolved use it does not list, and on a new file of `src/` left without a type.

## 161. A release moves the version its pages show

The pages show the real output of `lawcheck --version`, and their scenarios compare each such block with the output of the command, which prints the version of `package.json`. The commit that moves the version therefore changes those blocks too, and each changed block gets a `docs-example-changed` row anchored on this decision.

Why: a block that kept an old version would be false from the day of the release, and the suite guard takes no path as the anchor of a changed block of a page.

## 162. A script rule reads the tree and the uses of its file by asking

A rule calls `file.tree()` and `file.uses()`, and the runner asks the tool for them during that call. The law declares nothing for it. The tool parses the file in its own process and sends the tree as numbers, eight to a node in preorder. The runner builds the nodes from them, so neither process recurses on a deep tree. The tree is plain data with Lawcheck's own keys (`type`, `named`, `field`, `start`, `end`, `line`, `column`, `children`). The rule gets no object of the parsing library. The first ask for uses in a run reads the uses of every file the rule judges in that run, with `readUses`, the code that `may_use` uses. A reader failure on a file the rule judges fails that file, and the other files are read again without it. Any other failure fails the files that share it, and the batch is read again one language or name-binding group at a time, so a failure never costs one read of a whole group per file. A file past 512 KiB, a file with no reader and a reader that fails give `absent`, never an error of the run. The time the tool spends on an ask does not count toward the call's 30 seconds.

Why: a rule that does not ask parses nothing, and a key in the law would only repeat what the call already says. The runner reads only the root and Lawcheck's folder, and a package manager can install the parsing library outside that folder. Opening another folder to the runner would change the promise I-runner-1. The library's own objects change between its versions, while Lawcheck's keys stay. A batch per rule parses a name-binding group, Java or C#, once per rule instead of once per file. Krzysztof, 2026-11-23 (translated from Polish): "I want script rules to have access to the AST of the file."

## 163. The base from the variables of the CI service

A plain `check` in a CI job takes its base from `--base`, then from `LAWCHECK_BASE`, then from the variables below, then from `origin/HEAD`. The order puts the owner's explicit words first and the guess last. Each service has its variables, and Lawcheck reads them only when the service's own variable is set (`GITHUB_ACTIONS`, `GITLAB_CI`, `TF_BUILD`) and `CI` is not off, so a stray variable on a developer's machine changes nothing.

- GitHub Actions: `GITHUB_BASE_REF`, "the name of the base ref or target branch of the pull request in a workflow run" (docs.github.com, Actions, Variables reference). The page lists no variable for the commit before a push, so a push has no base from the variables.
- GitLab CI: `CI_MERGE_REQUEST_TARGET_BRANCH_NAME`, "the target branch name of the merge request", then `CI_COMMIT_BEFORE_SHA`, "the previous latest commit present on a branch or tag", which GitLab sets to zeros for a merge request pipeline, a new branch and a manual run (docs.gitlab.com, CI/CD, Predefined variables). A value of zeros counts as not set.
- Azure Pipelines: `SYSTEM_PULLREQUEST_TARGETBRANCH`, which holds `refs/heads/main` for Azure Repos and `main` for GitHub, and exists only when a branch policy runs the build for the pull request (learn.microsoft.com, Azure Pipelines, Predefined variables). The page lists no variable for the commit before a push.

A branch name becomes `origin/<name>` and the prefix `refs/heads/` is removed. Lawcheck does not read the webhook payload that `GITHUB_EVENT_PATH` names, because the contents of that file are not a variable of the service. The history of the base is still the job's to fetch: a shallow clone ends as `base-unreachable` with the `git fetch` of its `next:` line, as under decision 87. The GitHub workflow of `docs/ci.md` keeps `--base`, because the merge queue and the push set no variable and its second check needs the base commit.

Why: the first run in CI failed with `base-unreachable` until the adopter copied a flag from the docs, which is the first five minutes of that adopter with CI. The variables are the services' own words for the target of a pull request, so nothing is guessed.

## 164. `check --strict` makes debt fail the run

`--strict` judges every file as `--full` does, and a finding of debt gets the severity that the same finding would have inside the change: an error for a finding of an `enforced` rule, a `forbidden-use`, a waiver with no reason or an unknown rule, and a file too large for its uses; a warning where the change would give a warning too (an `advisory` rule, `waiver-unused`, `uses-not-read` of a type). The finding stays marked as debt. The exit code is 1 when any finding, debt included, is an error, and `result` in JSON is then `fail`. `summary.errors` keeps counting the errors of the change alone, as `docs/json.md` and the harness check say, and the first line of the text counts the errors of debt apart (`2 errors in debt`). `--strict` includes `--full`, so the two together act as `--strict`, and it takes no paths, as `--full` does not. It needs a verdict for every file under an enforced reviewer rule: an old file with none is a `not-reviewed` error, and the review command of the `next:` line carries `--strict`, since `--review` alone leaves old files out and the run would fail again with the same line.

Why: a team that paid its debt had no way to keep it at zero, since `--full` only lists it. Holding the debt to the standard of the change adds no second set of severities to learn.

## 165. The reader cache

In Java, Kotlin, C#, Ruby and Rust, a run that reads the uses of one file reads what every file of its group declares. `readUses` keeps that in `.lawcheck/.local/readers/<group>`, one pack per group: for each file, the keys it declares and, in C#, its global usings. An entry is found by a sha256 of the pack format, the versions of Lawcheck and Runes, the extractor's revision, the grammar's digest (runtime and grammar WASM), the language, the path and the text. A file whose uses the run reads is always parsed; only a file read for what it declares is taken from the pack. A pack starts with its own sha256; one that does not match, holds another shape or is larger than 64 MiB counts as empty. A run that read every file writes only its own entries, so a pack holds at most one entry per file of the group. A run a reader failure stopped keeps the entries it did not reach. A write goes to a temporary file and is renamed over the pack, so two runs at once each leave a whole pack. A pack is neither read nor written when git lists a file under `.lawcheck/.local/` in any case of its letters, when `.lawcheck`, `.lawcheck/.local` or `readers` is a link or not a folder or holds `.git`, or when the pack is not a regular file. Any error of reading or writing a pack costs only the parse. After the last parse the run marks the step `resolving the uses`, so the memory it gains from there counts against no file.

`check` without `--review` now writes into `.lawcheck/.local/`, and so does every hook that starts it. The harness allows that write for `check` and the hooks (harness-7).

`node tests/real/speed.ts`, after `npm run build`, measures one changed file in guava at fce80fd and in Newtonsoft.Json at 52fa3ae, the commits of the measurement of 2026-11-15 (6.1 s and 4.2 s then). It checks that each run with the cache prints what the same run without it prints, before and after a changed, a renamed and a deleted file, and in `--full`. It fails when the median of `SPEED_RUNS` checks with the cache passes `ONE_FILE_CHECK_MS`, 500 ms. It runs by hand in the dev container, not in CI.

Why: the cache never decides a verdict that a parse would decide otherwise, because each entry is keyed by everything a parse of the file depends on, and a commit cannot place a pack that a run trusts. Only a person or a program with write access to the checkout can; that one can change Lawcheck itself. The extractors read nothing but the parsed file, so the path, the text and the versions are the whole input. A file whose uses the run reads is parsed anyway for its uses, so caching it would save nothing in a check of a change. A file system that ignores case, the default of macOS and Windows, shows a folder a commit adds as `.lawcheck/.LOCAL/` at `.lawcheck/.local/`, so the test of what git lists folds the case. The pack of guava's 3,267 files of Java and Kotlin holds 0.7 MB, and a whole pack of 420 MB ended a check with `memory-too-large`; the bound of 64 MiB leaves room for some 300,000 files. The threshold is the measured median with room for noise: the design's 0.3 s for one file was 0.29 to 0.38 s in five measurements on 2026-11-23, and a check of one changed Markdown file in guava took 0.14 s on 2026-11-15. A timing on a shared CI runner would fail on the runner, not on the code. The step mark after the last parse was needed for the same output with and without the cache: without it, `check --full` on guava stopped with `memory-too-large` at the last Kotlin file when that file was parsed, and passed when the file came from the cache.

## 166. A may_use list has no advisory status

A use that a `may_use` list forbids is an error in the change, and the law has no key that makes a list give warnings. A team whose old files break a list it brings in puts the list first on the types whose files are clean, waives each old use with its reason, and pays the waivers back. The page [Bring a law into an existing repository](../docs/adopt-in-an-existing-repository.md#bring-in-a-may-use-list) gives the steps.

Why: a list that gives warnings is one more switch that a team forgets to turn on, and a list with a waiver on each old use judges every use a change adds from the first day. Each waiver stays in its file and in the JSON until someone removes it. The owner chose the page over a new key on 2026-11-23.

## 167. A script rule's `line` of null means no line

A finding that a script rule returns with `line: null` is about the whole file, as one without `line` is. Any other value that is not an integer from 1 to the number of lines, such as the string `'2'`, a bigint or `1.5`, still makes the rule `rule-crashed`, and the message names the value and says it is not an integer. The reviewer's answer already reads a `line` of null this way.

Why: a rule author who writes `line: null` means no line, and a crash with a message about a range tells them nothing they can act on. The refusal of every other value stays because the line selects which waiver applies, and a wrong line would drop or keep a finding for the wrong reason. This was taken as a technical choice on 2026-11-23, and the owner may reverse it.

## 168. Two verdict objects that disagree read as the fail

When the answer of a reviewer holds more than one object with a `verdict` and one of them is a `fail`, the answer is the last of the fails, whatever else the answer holds and in whatever order. An object inside another object with a `verdict` does not count. A whole answer that is one verdict object, and the same verdict twice, read as before.

Why: a file can ask the reviewer to quote a pass, and a reviewer that reports the attempt and quotes what the file asked for would turn its own fail into a pass if the last object won. The price is a fail that a model quotes in a sentence after a pass, which fails the file with findings the user did not expect. A pass that was wrongly kept is silent and a fail that was wrongly given is visible and one more review away from correction, so the choice errs toward the visible one. This was taken as a technical choice on 2026-11-23, and the owner may reverse it.
