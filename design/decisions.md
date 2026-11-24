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

In CI, a check of the change, which is a `check` that names no path and does not use `--full`, with or without `--review`, and finds no base ends as `base-unreachable`, exit 2. Its `next:` line names `--base origin/<the branch the change goes into>`, `LAWCHECK_BASE` with the history fetched, or `lawcheck check --full`. A job is in CI when `CI` is set and is not empty, `0`, `false`, `no` or `off`; without `CI`, when the variable of a known CI service is set. Outside CI, a check with no base judges every file as changed.

Why: in CI a missing base is a forgotten setting, and failing the whole repository would read as bad code.

## 89. The key a reviewer server echoes

Lawcheck writes the one exact key it sent as `[key]` wherever it prints or writes it: text and JSON output, error messages, the verdicts file, the failure cache and temporary files. It masks nothing else and scans for nothing that looks like a key. This is the owner's decision.

Why: the tool knows the key it sent, so it replaces that string. Text it does not own stays as it came.

## 90. Nine providers in the first alpha

The first alpha ships all nine reviewer providers. This is the owner's decision.

## 91. Windows blocks a release

A red run of the suite on Windows blocked the alpha exactly as a red run on Linux or macOS did. This is the owner's decision. The release workflow holds every release to it, since it needs two green Nightlies, and the Nightly runs on all three systems.

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

## 167. Doctor reads the uses to name the configuration a reader could not read

Runes tells the caller, through `onDiagnostic`, when resolution consults a configuration file that does not parse (`config-unreadable`). `readUses` collects those diagnostics and returns them as `unreadable`, one entry for each file. `check` ignores them. The `readers` check of `doctor` now reads the uses of the files whose `may_use` list is in force, as `check --full` does, with `cacheWrites: false` so that `doctor` still writes nothing, and prints one line under its row for each file. The row shows `note` and the exit code stays 0. In `--json` the check carries `details`, a list that exists only when it has lines. A reader failure while `doctor` reads the uses makes the check fail with the same message `check` gives.

Why: a file the reader cannot parse leaves every use that goes through it unresolved, and a law that forbids those uses looks kept. `doctor` is the command that says what is wrong with a setup, and it needs no change to the output of `check`. A diagnostic fires only for a file that a use consults, so the lines cost one read of the uses `check --full` would read anyway. An alias that a bundler configuration writes in a form the reader does not follow raises no diagnostic in Runes 1.2.0, so `doctor` says nothing about it, and the page of languages says so.
## 168. The two timed cases of tests 406 to 408 run alone

In tests 406 to 408, the case past the timeout and the case where a child holds the output run after the other cases, one at a time. The other cases run side by side.

Why: these two cases time a run in the test's own process, against bounds of 5 and 10 seconds (`PROGRAM_TIMEOUT_RUN_MS` and `HELD_OUTPUT_RUN_MS` in `tests/numbers.ts`). The setup of the cases beside them and the harness's checks of their runs are synchronous, and they held that process for up to 4.75 seconds on macOS. The held-output case then took 10.4 seconds in Nightly 43807148586 and 10.8 to 12.3 seconds in CI runs 43828039971 and 43838956695 (R-65). Alone it takes about 3 seconds on macOS, and it failed in none of the 25 Nightlies since it runs alone: of their macOS jobs that run the commit set three times, 22 were green and 3 were red on other tests. The tool ends such a call 2 seconds after the program ends, and the bound of 10 seconds stays close to that. A bound raised to fit the shared process would let a longer wait pass.

## 169. A fetch command in a `next:` line is one git fetch or none

The command of `base-unreachable` that fetches a branch or the history (`git fetch [--unshallow] <remote> +refs/heads/<branch>:refs/remotes/<remote>/<branch>`) is written for a POSIX shell, as the `safe.directory` command of `no-git` is. `fetchCommand` in `src/files.ts` prints it only when git's `check-ref-format` accepts `refs/heads/<branch>` and `refs/remotes/<remote>/<branch>`, the remote does not start with a dash, and neither name holds a control character, a format character of Unicode or U+2028 or U+2029. It writes the remote, and the refspec, in single quotes when it holds a character outside the ASCII letters, the digits and `_@%+=:,./\-`. For any other name the line gives `git fetch --unshallow` on a shallow clone and no command on a full one, and the JSON `next.command` holds the same.

Why: the base comes from `--base`, `LAWCHECK_BASE` and now from the variables of the CI service (decision 163), and a branch name can hold `;`, `$(`, a backtick and `&`, which git accepts. The old guard refused only whitespace, quotes and backslashes, so `GITHUB_BASE_REF='x;touch${IFS}pwned'` gave a line that a shell, or an agent that follows `next:`, ran as two commands. Lawcheck itself runs nothing, and only someone who can name a target branch can set the value. The output escapes control characters and format characters, so a command that held one would no longer be the text it was built from; such a name gets no ref. A name git refuses cannot be a branch, so no fetch of it helps.
## 171. The waivers a change adds

`check` against a base reads each changed file at the merge base of `HEAD` and the base, parses its waivers with the rules of the current law, and marks a waiver of the change as added when the base holds fewer waivers of its rule with its reason. Of equal waivers, those whose line the base lacks count as added first. The text output names them in a note under the first line, and the JSON gives each item of `waivers` the field `added`, null where no base was compared. The law-change note no longer lists waivers. A marker in a file that no type takes, or in a file under `ignored`, is not named, because it waives nothing; the law-change note names the pattern of `required` or `ignored` that a change adds or takes off. A file moved to a new path counts its waivers as added.

The Claude Code plugin tells the user once, at the stop that ends a turn, which waivers the turn added and which files of the law it changed, and never sends the agent back for it (the owner's choice of 2026-11-23). The hook compares the text from the marker to the end of each line with the file at the start of the turn: `UserPromptSubmit` keeps those lines of each file that differs from `HEAD`, and `HEAD` holds the rest. The text of the message is built in `plugin/hooks/turn.mjs` alone, so the plugins of other agents can send the same text.

Why: an agent that cannot fix a breach adds a waiver and ends green, and the owner does not see it. Matching by rule and reason, not by line, keeps a waiver that only moved from being named on every edit near it. The hook reads text and not the parse of `check`, because `check` of named files has no base, and a file at the start of a turn may exist only on disk.

## 172. A waiver at the end of a multi-line import

A waiver after code covers its own line, and a waiver on a line of its own covers the next line. The `forbidden-use` finding of an import over several lines sits on the statement's first line, so a waiver at the end of its last line covers nothing and is `waiver-unused`. The waiver goes on the line above the statement, as `docs/waivers.md` shows for TypeScript and Python.

Why: a waiver that covered the statement it ends would need the statement's extent from the reader of each language, and in Java, Kotlin and C#, where a use can be any type in a declaration, the same rule would let a waiver at the closing brace of a method cover a use in its signature. One rule of two lines is easier to know than a rule per language, and `waiver-unused` already tells the author that the waiver missed.
## 173. Init and doctor say that git ignores the law

`init` writes the law as before when git ignores `.lawcheck/law.yaml`, and exits 0. It then adds a `note:` line to its text output, and in `--json` it starts `next.text` with the same warning; the document keeps its fields. `doctor` shows its `law` check as `note`, with a `next:` line, when git does not list `.lawcheck/law.yaml`. A law that git tracks and `.gitignore` also names is listed, so it gets no note. When `.lawcheck` is a symbolic link to a folder, both pass as before with no note: git lists no file beyond a link, and `git check-ignore` refuses such a path.

Why: a law that git ignores works on the machine that made it and is in no commit, so every other checkout, and CI, has no law and checks nothing. Refusing in `init` would take away a repository's own choice and a global exclude the user may have for good reasons, and a new field would change the schema of `lawcheck-init/0` for a warning. `next.text` is the one field of the document that a person or an agent acts on.
## 174. A script rule's `line` of null means no line

A finding that a script rule returns with `line: null` is about the whole file, as one without `line` is. Any other value that is not an integer from 1 to the number of lines, such as the string `'2'`, a bigint or `1.5`, still makes the rule `rule-crashed`, and the message names the value and says it is not an integer. The reviewer's answer already reads a `line` of null this way.

Why: a rule author who writes `line: null` means no line, and a crash with a message about a range tells them nothing they can act on. The refusal of every other value stays because the line selects which waiver applies, and a wrong line would drop or keep a finding for the wrong reason. This was taken as a technical choice on 2026-11-23, and the owner may reverse it.

## 175. Two verdict objects that disagree read as the fail

When the answer of a reviewer holds more than one object with a `verdict` and one of them is a `fail`, the answer is a fail, whatever else the answer holds and in whatever order: the object that the reading of the answer takes when that object is a fail, else the last of the fails. The first rule keeps the findings of a fail in a fenced block when the model quotes another fail after it. An object inside another object with a `verdict` does not count. A whole answer that is one verdict object, and the same verdict twice, read as before.

Why: a file can ask the reviewer to quote a pass, and a reviewer that reports the attempt and quotes what the file asked for would turn its own fail into a pass if the last object won. The price is a fail that a model quotes in a sentence after a pass, which fails the file with findings the user did not expect. A pass that was wrongly kept is silent and a fail that was wrongly given is visible and one more review away from correction, so the choice errs toward the visible one. This was taken as a technical choice on 2026-11-23, and the owner may reverse it.

## 176. An error after reviewer requests names how many were sent

The first line of a `check` or `try` that ends with exit 2 after it sent requests to a reviewer ends with the count, as the lines of PASS and FAIL do: `lawcheck: ERROR  1 error, 2 reviewer calls`. The JSON document `lawcheck-error/1` gains the key `calls_made` after `errors`, only when the count is above 0. A run that stops before its first request, and one that stops on `file-unwritable`, name no count.

Why: a run that fails after calls has spent what the user pays for, and the same count stands in the other two forms. The key is added to `lawcheck-error/1` and the schema is not raised to `/2`, because a document of a run with no request stays byte for byte as it was, and a reader that ignores keys it does not know reads the new one as it read the old. `file-unwritable` is left out because the run is cut off while other requests may still be in flight, so a count taken then would be too low. This was taken as a technical choice on 2026-11-23, and the owner may reverse it.

## 177. The landing page deploys to Vercel from the released commit, and the card is a picture made by hand

`.github/workflows/landing.yml` deploys the landing page after a green Release run, from the commit that run released, or by hand, as `docs.yml` does for the documentation. Its build job has a read-only token and no secret, checks the built folder with `site/landing/check.mjs` and uploads it. Its deploy job runs in the GitHub environment `vercel`, which only `main` may use, and runs one command on that folder: `vercel deploy landing --prod --yes`. A manual run without its `production` input runs the same command without `--prod`, which gives a preview at an address of vercel.app. The Vercel project is not connected to the repository by Git, so a push to `main` deploys nothing. `vercel.json` sits in the built folder, so the redirects and headers are in the repository.

The card of both sites is `site/landing/public/og.png`, 1200 by 630 pixels and under 300 KB. `node site/theme/og.mjs <inter.woff2> <mono.woff2>` prints its page from `brand/tokens.json` and `brand/mark.svg`, and a screenshot of that page at 1200 by 630 in Chromium is the file. The landing page names the card in `og:image` with its alt text and in `twitter:card`, and each page of the documentation names the same file by its full address, `https://lawcheck.dev/og.png`. `site/landing/check.mjs` and `site/check-docs-card.mjs` fail a build whose page lacks one of these tags, or whose file is not a PNG of that size.

Why: the deploy job is the only one that holds the Vercel token, and the only program that runs there is the Vercel CLI at the exact version the file names, not anything of the repository or its dependencies. A release deploys the commit it released, not the head of `main`, so the page shows what npm has. A manual run with `production` deploys the head of `main` instead, and only the owner starts one. A preview is the same job without `--prod`, so what a person looks at is what a release would ship. The card is a file that a person redraws when the brand or the finding changes, since drawing it in the build would add a browser to every build of the site. The finding on it is a line of `README.md`, which test 891 checks. When the film has its own card frame, that frame replaces this file under the same name.
## 178. A reviewer rule's companion

The key `companion` of a reviewer rule names an ES module in `.lawcheck/rules/lib/` that exports `companion`. For each file the rule judges, the tool runs it in the runner of script rules, with `file` and `repo` as a script rule's `check` gets them, so `tree()`, `uses()` and `filesOf()` work and the limits of I-runner-1 hold. The module returns a list of paths. Each path must name a file that git lists and that is not binary; any other path, a value that is no list of strings, a throw and a failed load stop the run with `rule-crashed` on the module's file. The files go into that file's prompt as `<context>` blocks after the rule's `context`, in the order the module gives, and a path the prompt already holds (the judged file, a file of `context`, a repeat) goes in once. The frame stays as it was. The review key folds in the returned files with the rule's context, and adds one part, the module's path and text, only for a rule with a companion. The size of the prompt, and so `too-large-to-review`, counts the returned files. Every command that needs a review state runs the module: `check` with or without `--review`, `try` with or without `--dry-run`, and `explain` of a file or of a rule. A change to the key is named in the note of a law change, and a change to the module is named there as a changed file of `.lawcheck/rules/`.

Why: a rule that pairs files, a test with its spec or a handler with its contract, had to send every pair to every file through `context`. The prompt reuses `<context>` because the frame already tells the reviewer what a `<context>` is, and a new frame would make every recorded pass stale. The module decides what the reviewer sees, so it lives where the law lives: a change to it is a change of the law that `check` and the plugin name, and a path elsewhere in the repository could change the reviews without that note. The module's text is in the key so that an edit to it makes the verdicts it fed stale, as the owner's issue asks; a helper that the module imports is not followed, because the files the module returns are in the key anyway. A plain check must know the key to find a pass, so it runs the module, as it runs the script rules; `explain` runs it for the same reason, and the page of commands says so. A rule without a companion gives the key it gave before, so no recorded pass goes stale. Yggdrasil had a companion of its own, and this is Lawcheck's form of it. Krzysztof, 2026-11-23 (translated from Polish): "In Yggdrasil there was something like a companion. Do we have an analogous mechanism for an md rule?"

## 179. The plugin's messages, and a reviewer rule with no reviewer

Every text the plugin's hooks hand to the agent or the user is built in `plugin/hooks/messages.mjs`. Each message after an edit, at the end of a turn and to the user starts with `Lawcheck:`, the name of the tool, where the output of `lawcheck` starts its lines with the command `lawcheck:`. The texts that stand in for the primer at the start of a session name Lawcheck in their first sentence, and a hook that fails prints `Lawcheck plugin:` and the cause on standard error. The message of decision 171 moved there from `plugin/hooks/turn.mjs`. A plugin for another agent can import the same file, so the same case gives the same words on every agent. The description in `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` names the three tools the `PostToolUse` hook runs for, `Write`, `Edit` and `NotebookEdit`, since a file the agent writes from the shell is checked only at the end of the turn.

When the law has a reviewer rule and `.lawcheck/config.yaml` sets no reviewer, `prime` replaces its line about `not-reviewed` with one that says so and asks the agent to tell the user once. The `SessionStart` hook finds that line in the output of `prime` by its start, kept in `PRIME_NO_REVIEWER`, and sends the user a message once per session, marked in the session's state. A config that Lawcheck cannot read gives the old line, since `check` stops on it anyway.

The `PostToolUse` hook forgets the last law error it handed over after a check that Lawcheck could run, with exit 0 or 1, so a law broken, fixed and broken again the same way reaches the agent again.

Why: the hook reads no YAML, and a second reader of `.lawcheck/config.yaml` in the hook could disagree with Lawcheck about what is set, so it takes the answer from `prime`. A change of the wording of that line in `src/prime.ts` must change `PRIME_NO_REVIEWER` with it; test S6-5 runs the real `prime` and fails on a mismatch. The message goes at the start of the session, because a check of named files reports `not-reviewed` as a warning, and the hook at the end of a turn lets such a check pass in silence. Forgetting the error on a pass keeps the purpose of handing it over once: the user editing a broken law does not repeat it to the agent at every edit.

## 180. One read of the uses serves every rule of a run, and no call pays for another rule's read

A run keeps the uses of each file it has read for a rule. A rule's first `uses()` reads, in one batch, the files it judges that no rule of the run has asked for, and a file another rule's batch is still reading waits for that batch. The tool reads in its own thread, so while it reads it cannot take another rule's ask, and that rule's clock would run. The clock of every call therefore leaves out the time any read of the run takes, not only the reads of its own call. The reads of a run take turns, one tree or one batch at a time. A use that reaches a file Lawcheck cannot read fails only the file that holds it, and the files after it in the batch are resolved anew.

Why: the uses of a file do not depend on the batch that reads them (decision 162), so a second read gives nothing new. On a C# repository of 1,062 files, two rules that call `uses()` parsed 2,124 files and took 526 MiB, against 1,062 files and 385 MiB for one rule. While the tool read for the first rule, the first `uses()` of the second waited 3.1 seconds, and its 30 seconds ran. A rule that loops forever while other rules read gets that time on top of its 30 seconds; the 600 seconds of the run still bound it. A read waits for its grammar between the step that names its file and the parse, so a second read let in then wrote its own step, and memory-too-large named the other read's file and rule; the tool parses on one thread, so taking turns costs no time. When a batch failed as a whole on a file that could not be read, every file of the batch in its language failed with it, and the rule that asked first decided what every other rule got for those files. Runes keeps what it has read for a resolver, and a read that stops part-way leaves its entry half built: two TypeScript files importing an in-repo package, with another package.json unreadable, gave the first reader-failed and the second a use that leaves the repository.

## 181. A pass beside a doubtful verdict is a bad answer

A pass is a bad answer when an object of the answer holds the key `verdict` twice, or when another verdict object of the answer holds a verdict that is neither `pass` nor `fail`. A fail stays a fail beside either. Only the verdict objects that the reading of the answer counts are looked at: an object inside a verdict object is not one. The bad answer is asked once more, as every bad answer is.

Why: `JSON.parse` keeps the last of two equal keys, so `{"verdict": "fail", "findings": [...], "verdict": "pass", "findings": []}` read as a pass, and an object with `"Fail"` before a pass read as the pass, since `"Fail"` is no fail. Both carry a fail, and a file under review can ask the model to write either. Reading them as a fail would keep findings that the last key had dropped, so the answer is bad and the reviewer is asked again. Promise I-answer-1 names this as a named bad answer, and the object it says the answer reads stays the same. The price is one more request when a model writes such an answer by habit.

## 182. memory-too-large names the rule that asked first

When two rules call `uses()` on the same file, the run reads the file once, for the rule whose request came first (decision 180), and memory-too-large names that rule. Which request comes first depends on how the runners of the rules are scheduled, so two runs of the same check can name different rules. `docs/codes.md` says so.

Why: the step that runs out of memory belongs to one read, and that read served the rule that asked. Naming every rule that judges the file would name rules that never call `uses()`, and naming the same rule every time would need the rules to take turns or to declare their calls before they run. Either costs more than the message is worth: each rule named is a rule that makes Lawcheck read the file, and the fix of the law for the other rule is the same step.

## 183. One hook for Claude Code and Codex

The hook takes the agent after the event, as `--host codex`; without it the hook reads and answers as Claude Code does, so `plugin/hooks/hooks.json` is unchanged. `plugin/hooks/hosts.mjs` describes each agent: where its input names the turn, which files an edit wrote, how the hook sends the agent back, and which variables switch the two checks off. Codex names the turn in `turn_id`. Its edit is one `apply_patch`, and the hook checks every file the patch adds, updates or moves to, in one `lawcheck check`. The hook sends Codex back with `{"decision": "block", "reason": ...}`. Codex gives a plugin no settings, so `LAWCHECK_PLUGIN_CHECK_AFTER_EDIT` and `LAWCHECK_PLUGIN_CHECK_BEFORE_STOP` stand in for them, with the same values. The texts, limits, deadlines and the state file are the same for both agents. Codex reads `plugin/.codex-plugin/plugin.json`, which points to `plugin/hooks/codex.json`; there each hook is one command line, because Codex ignores `args`. Codex sets `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` for a plugin's hooks, so the command and the state file use them as in Claude Code.

Codex shows `systemMessage` to the user in its window, as a line under the turn, and `codex exec` does not print it. So on Codex the plugin tells the user what it tells the user in Claude Code, and does not send the agent back to relay it, as it does on agents with no such field.

The plugin for an agent other than Claude Code ships only with a trial of real sessions of that agent that passes its thresholds: `npm run agent-trial -- --host <agent>` writes `tests/agent/result-<agent>.json`, and test 928 fails while that file is missing or misses a threshold. The trial runs in the shop of the film, `film/fixture/`, with the film's prompt, in five arms: no law and no plugin, the whole plugin, the edit hook alone, the prompt and stop hooks alone, and those two with a `lawcheck` that fails every check of a hook. The sizes are those of the owner's ruling proby-wtyczek-oszczednie: 10 sessions with no plugin, 10 with the whole plugin, 5 counted breaches in at most 15 runs for each hook alone, and 3 with the failing `lawcheck`. The design's thresholds scale with them: the law reaches the agent in every session of the whole plugin, none ends with an import of the API code into `src/core`, and 9 of 10 end clean; 4 of 5 counted breaches are fixed; 3 of 3 sessions with the failing `lawcheck` go back exactly three times and end. An arm stops as soon as its threshold is met or can no longer be met, the result file keeps every session as it ends, and a trial started again goes on from it, at a later commit too when `src/` and `plugin/` are the same there, so no session runs twice. When fewer than 3 of the 10 sessions with no plugin import the API code, the two arms of a hook alone run on the repository and task of the trial of Claude Code, `tests/agent/fixture` and `tests/agent/task.md`, as the design says, since the shop then gives them too few breaches. Codex passes on the arms with no plugin, with the whole plugin and with the failing `lawcheck`, by the owner's ruling codex-dowod: in its trial no session of an arm of a hook alone broke the law, so those arms stay in the result and decide nothing, and test 921 proves the check at the end of a turn with a planted breach.

Why: one hook keeps one meaning of each case on every agent; a second hook per agent would drift from the first. Codex 0.171.0 passes the names of Claude Code's input (`session_id`, `cwd`, `tool_name`, `tool_input`, `stop_hook_active`), so the description of an agent stays small. The thresholds and arms come from the design of the plugins for other agents, and the trial of Claude Code keeps its own arms and `tests/agent/result.json`. Krzysztof, 2026-11-23 (translated from Polish), on the plugins for Codex, Copilot and Cursor: "All of them".

## 184. explain --tree lists the nodes in a flat list, each with the index of its parent

`lawcheck explain <path> --tree` prints the syntax tree of a file as a script rule gets it from `tree()`: the same reader, the same grammar and the same nodes. The text output shows the named nodes, one line each with the field, the type, the line and, for a node with no named node below it, the first 40 characters of its text; it stops at 12 levels and at 200 nodes and counts what it left out. `--json` gives every node with the keys of a node of `tree()`, but in one list in preorder, where `parent` is the index of the parent and replaces `children`. The command reads no law, and a file that git does not track has a tree too.

Why: node types and fields differ between grammars (`call_expression` in TypeScript, `call` in Python), so an agent that writes a rule from memory names types the grammar does not have, and the rule finds nothing without saying so. A nested JSON tree would break on real code: a generated sum of 5,000 terms is a binary expression 5,000 levels deep, and the output's nested writer fails with a stack overflow between 1,000 and 3,000 levels, while pretty-printing a tree 1,000 levels deep already takes 22 MB of indentation. A flat list stays three levels deep at any depth, its size grows with the count of nodes, and a rule's tree turns into it by one walk in preorder, which the tests do. The tree depends on the path and the text, and for a header of C or C++ on the files git lists in its folder, never on the law, so a broken law or a scratch file that is not committed does not stop an agent from looking. Text past 40 characters, levels past 12 and nodes past 200 would bury the shape an agent needs; `--json` has them all.

## 185. A repository that develops Lawcheck starts its own build with `runner: npx`

The `runner` setting keeps its five values. A repository whose `package.json` names the build it makes as its `lawcheck` program writes `runner: npx`, and the plugin then starts that build. `npx --no-install lawcheck` runs the program that the `bin` of the project's own `package.json` names, from the root and from any folder below it, when no `node_modules/.bin/lawcheck` exists. It does not look at the `name` of the package. With the default `global` runner the plugin looks for a `lawcheck` on the `PATH`, finds none or an installed one, and says nothing. A test in `tests/environments/own-build.nightly.test.ts` runs both with the npm that the machine has.

Why: `npx` already starts such a build, so a sixth value, such as a path to `dist/cli.js`, would add a setting, its checks and its page for a case that has a way. It would not be safer either: with `runner: npx` the repository already decides which program runs, as [Settings](../docs/config.md#runner) says of every value but `global`. The case is rare: a contributor to Lawcheck itself, who builds before every check. The decision holds while npm keeps that behaviour of `npx`.

## 186. Lines end at a line feed, a file with a NUL is binary, and a file with no reader counts whatever its name

Lawcheck ends a line at a line feed, with or without a carriage return before it, and never at a lone carriage return. A use in a file with lone CR line ends is on the line that holds its start in that count, so an import that an editor shows on line 3 is reported on line 1. A file with a byte of value 0 in its first 8,000 bytes is binary, has no type and is judged by no rule, and a file in UTF-16 holds such bytes. `uses-not-read` counts each file of a typed folder that no reader takes by its extension, `tsconfig.json` and `package.json` among them.

Why: a finding's line, a waiver's line, the `lines` of a rule's file and the numbered lines of a reviewer's prompt are one count, and promise I-lines-1 says every finding's line lies inside the file's `lines`. A reader that numbered by its own count would put a finding on a line the file does not have. Runes counts a lone CR as a line end, so Lawcheck maps its line back to its own. The NUL test is the one git applies when it calls a file binary. A file that git shows as binary is binary here, and a UTF-16 file would need its encoding found and converted in every reader, rule and prompt, for a file a repository of code almost never holds. A list of file names that `uses-not-read` leaves out would be a second definition of what a use is, beside the readers; the warning never fails a run, and a `!` pattern in the type's `paths` clears it (docs/codes.md). `docs/languages.md` and `docs/law.md` state all three behaviours, and the tests named S4-9 hold the first two.

## 187. A pass beside a fail that does not parse is a bad answer

A pass is a bad answer when the answer holds a `"verdict": "fail"` that no verdict object of the answer holds, which is the text of an object that does not parse, such as one with a trailing comma. The key and the word may be written with `\u` escapes, as JSON allows. A pass whose own object holds such text inside it, in a nested object that parses or in a string, stays a pass, since the object read holds it. A fail stays a fail beside it, and a lone fail that does not parse stays "the answer holds no JSON object with a verdict". The bad answer is asked once more, as every bad answer is.

Why: a fail that does not parse is no verdict object, so neither rule of the decision "A pass beside a doubtful verdict is a bad answer" saw it, and `{"verdict": "fail", "findings": [{"line": 1, "message": "m"}],} {"verdict": "pass", "findings": []}` read as a pass. A file under review can ask the model to write that answer, and a model can write the trailing comma by habit. The text is looked for by its key and word, not parsed again, so a fail spelled another way, such as `"Fail"` in an object that does not parse, is not caught. The price is one more request for a pass that stands beside prose quoting a fail that does not parse.

## 188. A fatal exit of git is no-git, not internal

When a git command that Lawcheck runs ends with exit 128, git's own exit for a repository it cannot read, the run ends with `no-git`. The message holds the line git printed, and the `next:` line sends the user to repair the repository until `git status` works. A corrupt `.git/index` is the case that was found. Any other exit of a git command, and a git that ends by a signal, stays `internal`, since it means Lawcheck sent git a call that git does not take.

Why: `docs/codes.md` already names a damaged repository as a cause of `no-git`, and `internal` asks the user to report a fault of Lawcheck, which this is not. Under `doctor`, the check that met the failure shows `fail` with the same message and step, and the run ends with exit 2 as for any failed check.

## 189. A law that cannot be read is a law, so init and doctor do not send the user in a circle

Whatever stands at `.lawcheck/law.yaml` makes that folder the root of the law: a file, a folder, a symbolic link to nothing. The run then says `law-invalid` with the cause, such as `the law cannot be read (EISDIR)`, as it does for a law in a folder it cannot search. `init` finds that law and ends with `already-initialized`, `doctor` shows the `law` check as `fail` with the same cause. Only a missing entry, or one below a path that is no folder, is no law.

`init` also stops with `file-unwritable` when `.lawcheck/.gitignore` is a folder or a symbolic link to nothing, before it writes any file. A regular file or a link to a regular file there is kept as before.

Why: with a folder as the law, `init` said `already-initialized` and sent the user to `doctor`, which said there was no law and sent the user to `init`. A `kept` file that is a folder leaves `.local/` and `config.local.yaml` unignored without a word.

## 190. A rule file is never read through a symbolic link, though the law and the config are

`.lawcheck/law.yaml` and `.lawcheck/config.yaml` are read through a link, and an error about either quotes none of the file. A rule file under `.lawcheck/rules/` is not: a link there counts as no file, and the error `rule-missing-file` names the link and says that Lawcheck reads no rule through one.

Why: the text of a reviewer rule goes into every prompt, and a script rule runs. A link that a repository commits could lead to a file outside the work tree, such as a key in the home folder, and its text would reach the reviewer. The law and the config send no text to a reviewer, and their errors hide the text. Only the message was false, since it said the rule had neither file.

## 191. A name or path is refused as too long by what its system counts

`explain` refuses a name or a path that cannot exist, and it measures it as the system does: bytes on Linux and macOS (255 for a name, 4,095 for a path), UTF-16 units on Windows (255 and 32,767). A name that exists on a system is never refused as one that cannot.

Why: Windows answers that a name that is too long is missing, not too long, so Lawcheck measures it before it asks. Counting bytes there refused a real name of 86 CJK characters, which is 258 bytes and 86 units.

## 192. The primer names the runner's command once

When `runner` in `.lawcheck/config.yaml` is not `global`, `prime` ends its first line with `Start it here as: <the runner's command>` and writes every other command of its text as `lawcheck <command>`, as it does for the global runner. It does not put the runner's words before each command.

Why: the text is fitted to one budget and checked line by line, and the plugin and the docs hand an agent the same lines whatever the runner, so one line says how to start the tool and the agent reads `lawcheck` in every other line as that command. The words of `npx --no-install` before each of the commands in the text would give one text per runner and leave the types and rules the primer lists less of the budget. What is given up: an agent that reads one line alone sees `lawcheck check`, not `npx --no-install lawcheck check`; the first line of the same text tells it how to start the tool.

## 193. init at the top refuses while git lists a law below, even one that serves as a sample

`init` ends with `already-initialized` when git lists a `.lawcheck/law.yaml` below the folder, and it does not ask what that law is for. A repository that tracks a sample repository with its own law, such as one under `tests/`, gets the refusal at its top. `doctor` there names the laws below and sends the user into the folder of one; it does not offer `init`. The user writes `.lawcheck/law.yaml` at the top by hand ([The first type and the first rule](../docs/first-law.md)), and a run in the sample folder keeps using the sample's law.

Why: to Lawcheck a sample and a package of a monorepo are the same thing, a folder with a law of its own, and `init` never starts a law above or below another ([Monorepo](../docs/monorepo.md)). A rule that left some laws out would be a list of paths that someone keeps up. A law written by hand is read like any other, so the refusal takes nothing from the user. Test R-3 holds the refusal, the line of `doctor` and the law written by hand.

## 194. The check after an edit starts from the folder of the edited file, so a file of a sample repository below the root is judged by that sample's law

The hook after an edit looks for `.lawcheck/law.yaml` from the folder of the edited file and upward, and the first law it finds judges the file ([The Claude Code plugin](../docs/plugin.md)). An agent that works in a repository and edits a file of a sample repository under `tests/` hears what the sample's law says about that file, not what the law of the repository says. The other hooks start from the folder of the session.

Why: the plugin cannot tell a sample from a package of a monorepo, and the nearest law is what `lawcheck check` uses when the user runs it in that folder, so the hook says what the user would see there. Test R-4 holds both cases: a file in the sample goes to the sample's law, a file outside it to the law of the repository.

## 195. The landing page says when its build is ahead of its release

The landing page takes its sentences from README.md and docs/ of the commit it is built from, and shows the version in package.json. When the Unreleased section of CHANGELOG.md holds text, the footer adds a line: this build also shows text for the next release, so a flag or command it names may not be in the shown version yet. A release deploys from its tagged commit, where Unreleased is empty and the line is absent.

Why: a build of `main` between two releases showed `--strict` under the version alpha.4, which has no such flag, and a reader who tried it got an error. The page cannot read the tag in a shallow clone, so the line follows the CHANGELOG, which every release empties.

## 196. The plugin in GitHub Copilot CLI

Copilot CLI reads `plugin/.plugin/plugin.json` before `plugin/.claude-plugin/plugin.json`, so it takes its own manifest, which points to `plugin/hooks/copilot.json`. There each hook runs `node` with its arguments and `${PLUGIN_ROOT}`, on Copilot's own events, `sessionStart`, `userPromptSubmitted`, `postToolUse` and `agentStop`, with the timeouts of `hooks.json` as `timeoutSec`, since Copilot's default is 30 seconds. The hook takes `--host copilot`. Copilot names the session in `sessionId` and gives no id of the turn. Its edit tools `create`, `edit` and `str_replace_editor` name the file in `toolArgs.path`, and `apply_patch` carries a patch, read as for Codex. The text for the agent is a top-level `additionalContext`, the hand-back is `{"decision": "block", "reason": ...}`, and the text after an edit is held to 10,000 bytes of UTF-8, under the 10 KB that Copilot takes. Copilot sets `CLAUDE_PLUGIN_DATA` for a plugin's hooks, so the state file sits where it sits in Claude Code, and the two switches are the variables of Codex.

Copilot CLI gives a hook no field for the user. By the owner's ruling wtyczki-odsylaja-agenta-raz, every message the plugin has for the user at the end of a turn goes back to the agent once per turn as a hand-back that asks it to tell the user the message word for word: the check that still fails, the waivers and the law the turn changed, a check that did not run. The state of the session marks the message as told, and a prompt event of the next turn writes a state without the mark. When the plugin keeps no state for the session, it tells the agent only on a stop that is not itself a stop after a hand-back. The hand-back opens a prompt event with its reason as the prompt, so the turn it opens has its own snapshot, and the stop after the message checks only what the agent changed while it told the user. The message that no reviewer is set joins the text of the session start, with a line that asks the agent to tell the user in its first answer.

The trial runs Copilot CLI 1.0.105 with `COPILOT_PROVIDER_BASE_URL`, `COPILOT_PROVIDER_WIRE_MODEL` set to the model of the trial and `COPILOT_PROVIDER_MODEL_ID` set to `claude-sonnet-4`, because Copilot gives a model with no id of its catalog only the shell. Its arm with the failing `lawcheck` also counts the sessions whose last answer holds the words `still fail`, and needs them all.

Why: one hook keeps one meaning of each case on every agent, as for Codex. A message the user never sees is the hole the ruling closes, at the cost of one more answer of the model per turn that has one. In the trial, Copilot ran a plugin's `postToolUse` hook after every tool, its `matcher` notwithstanding, so the hook still picks the edit tools by name.

## 197. The suite guard reads the tables of the codes and fields, a budget is judged call by call, its report reaches a pipe, and a test number leads names in one file

The three programs of the suite guard that print its report, `tests/guard/cli.ts`, `tests/guard/from-base.ts` and `tests/gate/run.ts`, set `process.exitCode` and let the process end, instead of calling `process.exit` after one large write. When the guard refuses several files of one kind under a folder for the same reasons, the row it suggests for `<folder>/**` carries the approval hash of every change of that kind the folder's path matches, refused or not, as the check of a row on the base computes it, so the row landed as printed passes. The one reader of the numbers a test name leads with is `leadingTestNumbers` in `tests/guard/names.ts`, and the spec map, the guard and the platform selection read them through it, so `tests 3, 4, and 5:` is read alike by all three. Outside `tests/unit/`, a test number leads names in one file; the pairs of number and file that already break this are listed in `tests/contract/shared-numbers.json`, which the guard's ratchet lets only shrink, and `tests/contract/spec-map.test.ts` fails on a pair that is not listed and on a listed pair that is no longer shared.

The guard reads each row of the code table of `docs/codes.md` and of the field tables of `docs/json.md` by its first cell, under its heading, as a promise, matching the rows of one first cell and heading by their text, so no table or row added among them is read as a change: a changed or removed row is `promise-changed`, the owner's kind, and an added row is no weakening. It judges the times a test names from `tests/numbers.ts` one by one, from the largest down, padded with `RUN_BUDGET_MS`, and reads a name written as literals joined with `+`; a new test in a file that loses a test in the same change may not name a larger time than each removed test.

Why: the codes and the fields are what users and agents read in the output, so the owner decides their change as he decides a promise's. A budget compared by its largest time hid a call that rose beside a larger one, a call that fell to the default, a rename and a name built from parts. A report cut at 64 KiB on a pipe lost the reasons of a refusal in a CI log while the exit code stayed right, and a suggested row that the guard refused again sent the owner round the same loop. Two readers of one label had drifted, and with numbers taken from test names a reused number makes a removed test's anchor look unchanged while a twin still carries it. A strict rail cannot hold today, since ten numbers lead names in two or more files, so the list holds them and only shrinks.

## 198. On Windows the orphans of a killed tool end from the first list of processes begun after the kill

When the tool is killed on Windows while a program reviewer runs, the program's root ends with the tool, and what the root started lives on below the root's id. The guard ends those processes only from a list of processes that PowerShell began after the guard learned of the kill, and waits up to 10 seconds for one. When the kill comes while PowerShell still starts, that is its first list: on a Windows runner the first list came up to 6.2 seconds after the guard started it, so the orphans can live longer than 5 seconds after the kill. On Windows, test 67 and the harness's checks of a killed run (harness-6 and harness-8) give the tool `WINDOWS_KILLED_GRACE_MS`, 25 seconds: the guard's 10 seconds of waiting for a list, 10 more for a list of its own when none came (decision 206), and 5 for the kill and the removal of the call's folder. On Linux and macOS they keep `KILLED_GRACE_MS`, 5 seconds.

Why: Windows gives the id of an ended process to a new one soon, and a list is printed after its snapshot ends, so a list begun before the kill can name a process that has since ended and whose id a stranger now holds. Killing from it could end a process that is not the tool's. Node has no way to ask Windows for one process's time of making without PowerShell, and PowerShell is the slow part, so no faster list is at hand. The list starts when the tool is about to call a program (R-74 keeps `doctor` from starting it), and starting it earlier would start PowerShell for runs that call nothing.

## 199. The suite guard reads a time named by its identifier, not only one named in a string

A test or a helper that stops using one `*_MS` number of `tests/numbers.ts` and uses a new, larger one is `threshold-lowered` of its file, though no string names the number. The guard counts the uses of each such name outside `import` lines, per test and for the part of a file outside its tests. A name that is new in that place and holds more than the longest time whose uses fell is a rise. When no use fell, the new name is compared with the longest time the place named before and with `RUN_BUDGET_MS`. A new name that is not larger, and a name that is only imported, is no weakening.

Why: on Windows test 67 and the harness moved from `KILLED_GRACE_MS`, 5 seconds, to `WINDOWS_KILLED_GRACE_MS`, 15 seconds, and the guard passed it, because it read only times named in strings. A time loosened through a name that is new needs the owner's row like one loosened through a number that is raised.

## 200. The check of Lawcheck's own law runs per push on Linux, and on all three systems in the nightly

`tests/acceptance/self-law.test.ts` has no entry in `PLATFORM_TESTS`, so a push runs it on Linux alone, and the nightly runs it on Linux, macOS and Windows (R-80).

Why: a test is listed for Windows or macOS when what it checks behaves differently there, and none of the behaviours of `PLATFORM_BEHAVIOURS` reaches this one. The test clones `HEAD` and runs `check --full` on the clone. The law reads text, `.gitattributes` sets `eol=lf` so the clone has the same bytes on every system, and the reviewer's verdicts hash the text with its line ends normalised to LF (`lf` in `src/verdicts.ts`). The runner of the script rules has its own platform tests, as test 26 has on Windows. What staying costs is a push that breaks the law only on Windows or macOS, which the nightly then finds.

## 201. The places the harness leaves unread, and the path lists every rule runner holds

The harness that compares what a run changes reads four things as unchanged by design, and a change there passes harness-7 and harness-8: the lock files of git (a name ending in `.lock`, in any folder of `.git`), the objects, logs and worktrees folders at the top of `.git`, a `.git` below the top of the repository (a nested repository), and every `node_modules`. The test of harness-7 that writes `.git/objects/stray` holds the objects case. A rule runner receives the sorted paths of every type, because `repo.filesOf(typeId)` of [docs/script-rules.md](docs/script-rules.md) answers for any type, and each runner holds them in its own memory: about 46 MiB at 150,000 files.

Why: a lock is a file git makes and removes inside one command, and Lawcheck runs only commands that read, so a lock left by a run would stop the next write of git in that repository and nothing of Lawcheck's. Objects are content-addressed and only ever added, so a new one changes no file, ref or index. A nested `.git` and a `node_modules` are not the repository's own state: the `node_modules` of a test's repository is a link to the checkout's, and a walk into it would read a whole install on every run. What stays open is a run that writes into one of these four, and no test would say so. The path lists stay because a rule that asks for another type's files is part of the contract, and the 46 MiB of each runner at 150,000 files is inside the 1,536 MiB a run may hold (test 248 runs that size nightly). The cgroup's reclaimable slab that the memory guard counts as free (`withCache` in `src/limits.ts`) is held by the R-79 test.

## 202. Signed passes

The law may name signers, each a kebab-case name with an Ed25519 public key of 43 characters of base64url. Under such a law, `check --review` signs each pass with the key in `LAWCHECK_SIGNING_KEY` and writes the line `<hash> <rule> <signer> <signature>`, whose signature covers the text `lawcheck-signed-pass/1 <hash> <rule>`. A pass counts in `check` and in `explain` only when its line names a signer of the law and that signer's key verifies the signature, so a pass stops counting when its signer leaves the law or gets another key. A review that would record passes without the key of a signer stops with `not-a-signer` before its first call. `--review` asks again about a pass that does not count, and it signs only the answers it gets. A law without `signers` writes the lines of alpha.4 and counts every line of a file and rule, signed or not, so no verdicts file of alpha.4 changes its meaning. Lawcheck writes the signing key as `[key]`, and no reviewer program gets the variable. [verdict-provenance.md](verdict-provenance.md) weighs this choice against a CI job that asks the reviewer itself and against a line that names its reviewer.

Why: finding R-38. A line of the file proved that someone wrote it, so a pull request could add passes for its own files, or record them with a reviewer that answers pass to everything, and CI counted them. No reviewer signs its answers, so no line can prove that a model judged. A signature proves that someone the law names recorded the pass, and a check verifies it with the public key alone, so the job of a fork's pull request needs no secret. The second check of the workflow in `docs/ci.md` reads the law of the base, so the base decides who signs. A team that names no signers keeps the trust of alpha.4, as `docs/ci.md` says. The line names the signer, not the key, so a diff of the file shows who recorded each pass. This was taken as a technical choice on 2026-11-24, and the owner may reverse it.

## 203. `check --sarif` writes SARIF 2.1.0 for GitHub code scanning

`lawcheck check --sarif <file>` writes the findings of the run to that file in SARIF 2.1.0, beside the text or the JSON on standard output, which stay byte for byte as they are. The file holds one run with one result per item of `findings`, the debt of `--full` included. A result's `ruleId` is the finding's `code`, its `level` is the severity, and its location is the file's path from the top of the git work tree, written as a URI with `%SRCROOT%` as its base, with `startLine` set to the finding's line. A finding about the whole file gets line 1. `rules` lists only the codes the results hold, each with the `why` of its first finding. The file carries no fingerprints. `check` writes the file only when it ends with exit 0 or 1, and a file it cannot write stops the run with `file-unwritable`. A check of named files refuses the flag with the same usage error as the other flags of a change. The tests validate the file against the OASIS schema and against the copy GitHub's upload action validates with, both kept unchanged in `tests/acceptance/sarif/` with their licences.

Why: a CI step needs the exit code, the text in its log and the file for the upload from one run, and the upload action reads a file, so the flag writes a file and leaves standard output alone; a SARIF log on standard output would also be the one `--json` document whose first key is not `schema`. Code scanning takes each upload of a branch as the whole analysis and closes as fixed every alert the upload lacks. A run that ends with exit 2 judged nothing, and a file with no result would close every open alert, so it writes none and the upload step fails visibly. For the same reason the workflow of `docs/ci.md` writes the file from `check --full --base`: a check of the change holds no finding of a file it leaves alone, so a push to `main` that touches no such file would close the alerts of code that still breaks the law. `--full` keeps the exit code of the change, since debt fails nothing without `--strict`, and the pull request and `main` then upload analyses of the same files. The second check of that workflow, with the law of the base, writes no file, since its findings would replace those of the first. GitHub's page on SARIF requires `startLine`, and the GitLab recipe of `docs/ci.md` already puts a finding of the whole file on line 1. GitHub reads a relative URI from the top of the repository, while the JSON names a file from the folder that holds `.lawcheck`, so the path gains the prefix of that folder. The upload action computes the fingerprint `primaryLocationLineHash` from the checkout when the file has none, and code scanning reads no other fingerprint, so a hash of Lawcheck's own would only disagree with GitHub's. A check of named files has no base and serves an agent, not a CI job.

## 204. Cursor runs the Claude Code plugin, and the hook knows it by its input

Cursor has no plugin of its own here and no trial. It loads the plugins that Claude Code installed (`~/.claude/plugins/installed_plugins.json`, those for which `enabledPlugins` holds `true` in `~/.claude/settings.json` for an install for the user, or in the project's `.claude/settings.json` or `.claude/settings.local.json` for an install for that project) and runs their `hooks/hooks.json` on its own events, so the plugin of Claude Code is the plugin for Cursor, with the same marketplace and the same manifest. The hook cannot take `--host` there, because Cursor starts the command that `hooks.json` holds. It reads Cursor from `cursor_version`, which every Cursor input has, and `--host cursor` stays an unknown host. `plugin/hooks/hosts.mjs` holds Cursor beside the other agents, outside `HOSTS`.

What Cursor needs of the hook, each read from Cursor's documentation of its hooks and the code of Cursor Agent CLI 2026.11.22: a start directory from `workspace_roots` when the input has no `cwd`, since Cursor runs a plugin's hook from the plugin's folder; a hand-back by `{"decision": "block", "reason": ...}`, since Cursor turns that into the next message and ignores a Stop hook's `additionalContext`; `loop_count` for what `stop_hook_active` says elsewhere, and no work on a stop whose `status` is not `completed`; the messages for the user told through the agent once, as on Copilot, since Cursor has no field for a message from a hook (the owner's ruling wtyczki-odsylaja-agenta-raz). Nested `hookSpecificOutput` with `additionalContext` works for the session start, the prompt and the edit, so those outputs stay as they are. Cursor gives a hook of a Claude Code plugin no loop limit, so the plugin's own three returns are the only limit. The command-line agent queues the follow-up message without running `beforeSubmitPrompt`, so the turn stays open between returns (read in its code). The prompt hook keeps an open turn's returns as well, so the limit also holds in a Cursor that runs the event for a follow-up.

Of the four hooks, Cursor's command-line agent 2026.11.22 runs `sessionStart` and `postToolUse` from the plugin alone, and runs `beforeSubmitPrompt` and `stop` only when `~/.cursor/hooks.json` or the project's `.cursor/hooks.json` holds an entry for the event; the hooks of plugins do not count. So the docs ask the user for `{"version": 1, "hooks": {"beforeSubmitPrompt": [{"command": "echo {}"}], "stop": [{"command": "echo {}"}]}}` in `.cursor/hooks.json`: the entries print `{}`, open the two events, and Cursor runs the plugin's hook beside them (read in its code, not seen in a session). A turn the user stops runs the stop hook with a status that is not `completed`; the hook then forgets the turn's returns, so the next turn has its three.

What no one checked: a session of Cursor with the plugin, which needs a Cursor account (the owner's ruling cursor-jak-claude: no trial, and the docs say what was checked and what was not), the Cursor editor, Windows and the marketplace commands of Cursor. `docs/cursor.md`, the README, the landing and the CHANGELOG say so, and the scenario of `tests/docs/cursor.ts` holds those sentences, with tests 970 to 976 for the hook. The tests build the inputs of the hooks from the fields that Cursor's documentation and code give them, and no session recorded them.

Why: the owner treats Cursor as compatible with Claude Code plugins, and the code of Cursor Agent CLI loads them, so a second plugin would copy files that Cursor already reads. The changes to the hook are the ones that code shows Cursor to need, and no change to the plugin's files that Claude Code reads.

## 205. On Windows the guard never ends a tree by its root's id

When the tool is killed on Windows, the guard ends a program's tree only from a list of processes begun after the kill. It ends the processes that list shows below the root that were made after the guard, and, where another process now holds the root's id, only those made before that process. It runs no `taskkill /T` on a root's id. When no list comes within its 10 seconds, it takes one itself with PowerShell and ends from it the same processes. When PowerShell gives no list at all, the guard ends none of the tree.

Why: the root ends with the tool, so by the time the guard acts, Windows may have given the root's id to another process. `taskkill /T` on that id ends that process and everything it started. A search by parent id alone also finds the children of an older process that held the id before the root. An orphan of a killed run left alive is a smaller harm than a process ended that Lawcheck did not start.

## 206. On Windows the guard ends a rule runner only from a list of processes, and waits at most 10 seconds for a list of its own

When the tool is killed on Windows, the guard ends a rule's runner the way it ends a program's tree: only if a list of processes begun after the kill shows the runner's id made at the same time as an earlier list showed it, together with what the list shows below it. It no longer ends a runner by its id. A runner that no earlier list showed is left alone. The guard's own call to PowerShell for a list stops after 10 seconds, and a list that did not come whole counts as no list: the guard then ends nothing from it, removes the call's folders and exits.

Why: a runner is in the tool's job on Windows and ends with the tool, so by the time the guard acts Windows may have given its id to another process, and ending by id ends that process. A PowerShell that never answers would hold the guard, and the folders it is to remove, for ever; a process left alive is a smaller harm than a guard that never ends. The price is that a runner that survived the tool stays alive unless the tool was killed during a call of a program reviewer and a list had already shown the runner. The guard takes no list when no such call is open (the decision on a killed tool with no program call open), and the lists begin just before a run's first call. In a run that calls none, no list ever runs, so the guard ends none of its runners, and only the tool's job ends them.


## 207. On Windows a program is ended by its id only while it runs, and the guard knows when the tool started it

The tool on Windows ends a program reviewer's tree by the program's id only until it has seen the program exit: after that it runs no `taskkill /T` on the id, at the end of a call or when it exits. When it registers a program with the guard, the tool also gives the time it took from its clock just before it started the program, and the list of processes gives each process's time of making in UTC, so the two compare. Below a program that no earlier list shows, the guard ends only what was made at or after that time, and not only after the guard's own start. A process an earlier list shows with the program's id made before that time is an earlier holder of the id: the guard ends neither it nor what it made.

Why: Windows frees a process's id once the tool has seen the process end, and may give it to a new process at once. `taskkill /T` on that id ends that process and everything it started. When the tool is killed before the guard's first list, the guard's own start was the only bound it had on when a program was made, so the child that an older holder of the program's id made after the guard started and left below that id looked like the program's own. The tool's clock and the time Windows records for a new process can differ by a few milliseconds. If the tool's clock is ahead, a child the program makes within that difference of its start is left alive; if it is behind, a child an older holder of the id made within that difference before the program's start is ended. Both are far smaller windows than the guard's whole life, and a process left alive stays the smaller harm.

## 208. Outside Windows a program's group is ended by its number at the moment its end is seen, and never after

On Linux and macOS the tool ends a program reviewer's process group by the program's id while the program runs, and once more at the moment it sees the program exit, for what the program left in its group. It then tells the guard to forget the group, and ends nothing by that number again: not when it cleans up the call, not when it exits, and the guard not when the tool is killed. The tool and the guard keep one entry for each call, with the time the tool took before it started the program, so two calls whose programs got the same id one after the other are released one at a time. Of two such entries, the guard on Windows takes the later time as the bound below the id.

Why: the system does not give a group's number to a new process while any process of the group lives, and gives a free number again only after it has gone through the others. At the moment the tool sees the program exit the number is still the group's, or free for an instant; at the end of the call, after a wait for the program's output, a new group may hold it, and a kill would end that group. With one entry per id, the release of a call whose program had ended removed the entry of the next call, whose program Windows had given the same id, and a killed tool then left that program running. The guard takes the later of two times because what was made below the id before the later program may be an earlier holder's.

## 209. The Nightly runs on demand, twice by hand before a release

The Nightly has no schedule: nightly.yml starts only by a dispatch or a call. Before a release it runs twice by hand on the tagged commit, and both runs must be green. The release workflow counts the dispatched runs of nightly.yml on the tagged commit and stops the release below two green ones.

Why: this is the owner's decision (ruling nightly-recznie-przed-wydaniem). A run every night spent runner time on commits that no release named, while the runs that decide a release are the ones on the tagged commit; two runs there draw two seeds and two orders, so a test with mixed results shows itself.

## 210. The documentation deploys to its own Vercel project, and its old addresses redirect there

`.github/workflows/docs-vercel.yml` builds the documentation as `docs.yml` does and deploys it to the Vercel project `lawcheck-docs`, with the same shape as `landing.yml`: after a green Release run from the commit it released, or by hand, with a preview unless the `production` input is set. Its build job holds no token. Its deploy job runs in the GitHub environment `vercel` and runs the pinned Vercel CLI on the built folder, with the project in the variable `VERCEL_DOCS_PROJECT_ID` of that environment beside the landing page's `VERCEL_PROJECT_ID`. `node site/docs-vercel.mjs` checks that every page of `docs/topics.json` is in the build and writes `vercel.json` into it. That file redirects `/<page>` to `/<page>.html` and `/index` and `/index.html` to `/`, each with a permanent redirect (308), and sets `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy`. Tests 1051 to 1053 hold the redirects, the check and the workflow.

`docs.yml` keeps deploying GitHub Pages, and Pages answers `docs.lawcheck.dev` until the DNS record of that address points at Vercel, so the address answers from one host at a time. The Pages site keeps `docs.lawcheck.dev` as its custom domain after the record moves, because GitHub's redirect of `krzysztofdudek.github.io/Lawcheck/<path>` comes from that setting. `docs.lawcheck.dev` is attached to `lawcheck-docs`. The landing project keeps its own redirects of `lawcheck.dev/<page>`, each one hop to `docs.lawcheck.dev/<page>.html`.

What this does not give: GitHub redirects `krzysztofdudek.github.io/Lawcheck/<path>` to `docs.lawcheck.dev/<path>` by itself and keeps the path, so `/<page>`, `/index` and `/index.html` take two hops there (GitHub's, then this project's), and `/` and `/<page>.html` take one. One hop for both forms would need each page to answer 200 on both addresses, and then one of them is not the address the page names.

Why: the owner chose to serve the documentation from Vercel beside the landing page, so each old address lands on its page through redirects that the repository holds, which GitHub Pages cannot do. A page of `docs/topics.json` needs no edit of the redirects. The headers carry no Content-Security-Policy, because the policy of the landing page was not tried on the pages of the documentation.

## 211. On Windows the guard of a killed tool with no program call open takes no list of processes

When the tool is killed on Windows while no call of a program reviewer is open, as in a run that calls none, the guard removes the folders it was told of and exits without starting PowerShell, and ends no process.

Why: only rule runners are left then. A runner is in the tool's job and ends with the tool, and a rule starts no program under Node's permission model, so nothing they started outlives the tool. A list could end nothing, and taking one only delayed the guard's end, and the removal of the folders, by up to 10 seconds.

## 212. A change judged by the law of its base

`lawcheck check --law-from <ref>` judges the change by the law of another commit (the owner's ruling law-from-w-alpha-5, option A of `design/proposals.md`). Lawcheck reads `.lawcheck/law.yaml`, `.lawcheck/config.yaml` and every file of `.lawcheck/rules/` of that commit through git, and the checkout stays as it is. The files judged, and the change itself, are those of the work tree. The workflow of `docs/ci.md` checks a second time with `--law-from "$base"`, in place of the shell lines that checked out the base's law and removed the branch's rules. It still runs that check only when the base holds a law, so the pull request that adds the first law passes.

What a rule of the commit reads: its rule files, its companion's module and any `context` file among the law's own files (`law.yaml`, `config.yaml`, `rules/`) come from the commit; every other file, the rest of `.lawcheck/` and the files a companion returns included, is the work tree's. Script rules and companions load from a copy of the commit's `.lawcheck/rules/` in a folder of `.lawcheck/.local/`, so a rule imports the commit's helpers and the runner still reads only below the root and Lawcheck's folder (I-runner-1). The folder holds a `.gitignore` of `*`, so git never lists it, and the guard removes it if the tool is killed. A rule that reads a file by its path, rather than by import, reads the work tree's copy, `.lawcheck/` included, since its working directory stays the root; the docs say so. A package a rule imports by name resolves from the `node_modules` folders above the copy, which are the work tree's, `.lawcheck/node_modules` and `.lawcheck/.local/node_modules` included, so a pull request can put its own copy of the package there; the docs say so, and `docs/ci.md` lists `.lawcheck/` among the paths a code owner guards. The verdicts are the work tree's `.lawcheck/verdicts`, counted under the commit's law: a pass is keyed by the rule's text, so a pass recorded under the branch's text does not count for the commit's, and only a signer of the commit's law signs a pass that counts. `--review` with `--law-from` records passes under the commit's text, and the `next:` line of `not-reviewed` names that command.

A ref that names no commit, and a commit with no `.lawcheck/law.yaml` at the root's place, stop the run with the new code `law-from-unreachable`. A law or a config of the commit that is not valid stops it with `law-invalid` or `config-invalid`, and the message ends with the ref, since the line it gives is in the commit and not in the work tree. The JSON and the exit codes are those of `check`. When the change edits the law, the note `the law changed in this change; lawcheck check --full ...` is left out, since the law of the change judges nothing in that run, and the line that names the changes reads `note: this change edits its own law, and the law of <ref> judged it: ...`. A check of named files does not take the flag.

Why: a change that takes a rule off a type and breaks it passed its own check with only a note (finding T7). The CI step that caught it changed the checkout, so a git hook or a local run could not use it; one option does the same without touching the checkout, and a pre-push hook can add it. Without the option a check behaves as before, so no change that grows the law and the code together starts to fail.

## 213. The packages of a law judged by --law-from cannot come from the change

Under `lawcheck check --law-from <ref>`, when git lists any file in `.lawcheck/node_modules` or `.lawcheck/.local`, the run stops with the new code `law-from-packages` before any rule runs. The error names the first such file of each folder, counts the others, and its `next:` line says to take the folder out of git and name it in `.gitignore`. The two folder names are compared as a file system that ignores case compares them, since macOS finds `.lawcheck/Node_Modules`, and `.lawcheck/node_moduleſ` with a long s, as `.lawcheck/node_modules`. HFS+ also skips some code points when it compares names, the ones of Apple's Technical Note TN1150 that git skips when it guards `.git` (U+200C to U+200F, U+202A to U+202E, U+206A to U+206F and U+FEFF), so they are dropped before the names are compared, and `.lawcheck/node_\u200cmodules` stops the run too. The error names the folder as git lists it, so its `next:` line works on that folder. The test is what git lists, tracked or not ignored, whether the change added the file or the base already held it.

What this does not cover: the `node_modules` at the root, which the install step fills from the change's own `package.json` and lockfile, a `file:` dependency included, or which the change commits. The workflow of `lawcheck docs ci` starts Lawcheck itself from that folder, so no check of Lawcheck can guard it. `docs/ci.md` keeps `.lawcheck/`, `package.json` and the lockfile among the paths a code owner guards.

The `package.json` files come from the commit. Node resolves a package name equal to the `name` of the nearest `package.json` through its `exports` before it looks in any `node_modules`, and a name that starts with `#` through its `imports`. Above the copy that file was the work tree's `.lawcheck/package.json`, else the root's, so a change that edited either handed a rule of the base a module of its own. The copy now holds the commit's `package.json` at its top, or `{}` when the commit has none, and the commit's `.lawcheck/package.json` when it has one, so the nearest file is always in the copy. A rule of the commit then resolves its own name and its `#` imports as at the commit, and a bare name in a target still resolves from the `node_modules` folders above. A target that leads outside `.lawcheck/rules/` is not in the copy, so the rule stops with `rule-crashed`, where before it loaded the change's file. Node's error names only the file it looked for, by its place in the copy, which the run then removes, so the runner keeps the import and the module that wrote it, and the error names that module and its import as the commit holds them, with the file the import leads to; its `next:` line copies what the module needs of that file into `.lawcheck/rules/lib/` on the commit, since the check of the work tree loads the work tree's file and passes. Any other crash of a rule under `--law-from` names the files of the copy by their paths in the commit, and its `next:` line fixes the rule on the commit and runs the same check again. A link instead of a file at the commit counts as no file. Refusing a change to the `name`, `exports` or `imports` of those files was the other way, and it would stop every pull request of a package that adds an export, while the copy keeps the commit's own `#` imports working (ruling law-from-pakiety-galezi-2 of the jarl, under autonomy-quality).

Why: a script rule of the commit loads from its copy in `.lawcheck/.local/`, and a package it imports by name resolves from the `node_modules` folders above that copy, first `.lawcheck/.local/node_modules`, then `.lawcheck/node_modules`. A pull request that commits its own copy of the package in either folder made the base's rule pass its code, which is what `--law-from` exists to prevent (ruling law-from-pakiety-galezi of the jarl, under autonomy-quality). A code owner on `.lawcheck/` stays a second guard, not the only one. A project that installs the packages of its rules in `.lawcheck/` and ignores that folder loses nothing; one that commits them there must move them to the project's `node_modules` to use `--law-from`.

## 214. On Windows a run waits out a lock folder whose delete has not ended

When a run makes the folder `.lawcheck/.local/verdicts.lock` and Windows refuses with `EPERM` while the name `verdicts.lock` is still listed in `.lawcheck/.local`, the run waits and tries again every 5 milliseconds, as it waits for a lock another run holds, within the same 10 seconds. Past them it stops with `file-unwritable` and `EPERM`, and its `next:` line says that a program still holds the lock open, such as another run or a virus scanner, and to run again once it is closed. When the name is not listed, the run tries once more at once, and a second refusal stops it with `file-unwritable` and `EPERM` and a `next:` line that asks to let Lawcheck make folders in `.lawcheck/.local`. On Linux and macOS `EPERM` stops the run at once, as before.

Why: Windows refuses to make a folder whose name a delete still holds, and a run that lets go of the lock leaves it so for a moment while another run waiting at the lock has the folder or its `pid` open. On windows-latest two processes that took and let go of the lock for 4 seconds met that refusal twice, and a review stopped on it in CI while the run that held the lock let go (R-76). The refusal ends when the last handle closes, so it is a lock being let go, not a folder the user must make writable. Windows gives the same `EPERM` for a folder that the rights of `.lawcheck/.local` deny, and such a folder can pass the probe of `.lawcheck/.local`, which makes a file, not a folder. The listing tells the two apart: the name of a pending delete stays listed until its last handle closes, and a refused new folder is never listed. A run that waited on every `EPERM` would wait the whole 10 seconds before the first call for a right it never gets. The one more try covers a delete that ends between the refusal and the listing.

## 215. What a script rule prints waits until Lawcheck has taken it

The rule runner makes its standard output and standard error blocking before the rule loads. A print returns once the pipe to Lawcheck has taken it, so the runner holds none of what the rule prints. Lawcheck relays it to its own standard error, as `docs/script-rules.md` says. The time a print waits counts toward the 30 seconds of the call.

Why: Node makes those pipes blocking on Windows and leaves them non-blocking elsewhere, where a print that does not fit in the pipe waits in the runner. A rule that prints in a loop, the usual way to debug one, printed faster than Lawcheck relays it: 531 MB printed over 442 files held 1,019 MiB in the runner, and 4 GB ended the run as `memory-too-large` with the machine's memory named as the cause, since the memory guard does not see the runner. A limit on what a rule may print would also have bounded the runner, but it would end a run that Windows already completes and break what `docs/script-rules.md` says, that Lawcheck passes on what a rule prints. With blocking pipes the same 531 MB holds at most 68 MiB in the runner, and the 4 GB run passes. The cost: a print waits while Lawcheck relays what the rule printed before it. The 4 GB run took 7 seconds in all, so a call passes its 30 seconds by printing only when it prints gigabytes; Windows behaves as before. The wait ends once Lawcheck has read the print. Lawcheck reads it whether or not anyone reads Lawcheck's own standard error, so a caller that reads that stream slowly, or only after the run, does not slow the rule. Lawcheck's own process then holds what its standard error has not taken yet, where the memory guard sees it: on Linux, 531 MB printed to a caller that read standard error only after the run held 722 MiB in Lawcheck, and 64 KB of it reached the caller, as before this decision.
