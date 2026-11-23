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

Such a use is not reported as `forbidden-use`. It is counted as unresolved, and its candidates are listed in the JSON output.

Why: a finding would rest on an answer the readers did not resolve, and the readers never guess. An explicit import of the forbidden member still fails. The owner may decide otherwise.

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

## 164. The reader cache

In Java, Kotlin, C#, Ruby and Rust, a run that reads the uses of one file reads what every file of its group declares. `readUses` keeps that in `.lawcheck/.local/readers/<group>`, one pack per group: for each file, the keys it declares and, in C#, its global usings. An entry is found by a sha256 of the pack format, the versions of Lawcheck and Runes, the extractor's revision, the grammar's digest (runtime and grammar WASM), the language, the path and the text. A file whose uses the run reads is always parsed; only a file read for what it declares is taken from the pack. A pack starts with its own sha256; one that does not match, or holds another shape, counts as empty. A run that read every file writes only its own entries, so a pack holds at most one entry per file of the group. A run a reader failure stopped keeps the entries it did not reach. A write goes to a temporary file and is renamed over the pack, so two runs at once each leave a whole pack. A pack is neither read nor written when git lists a file under `.lawcheck/.local/`, when `.lawcheck`, `.lawcheck/.local` or `readers` is a link or not a folder or holds `.git`, or when the pack is not a regular file. Any error of reading or writing a pack costs only the parse. After the last parse the run marks the step `resolving the uses`, so the memory it gains from there counts against no file.

`check` without `--review` now writes into `.lawcheck/.local/`, and so does every hook that starts it. The harness allows that write for `check` and the hooks (harness-7).

`npm run speed` measures one changed file in guava at fce80fd and in Newtonsoft.Json at 52fa3ae, the commits of the measurement of 2026-11-15 (6.1 s and 4.2 s then). It checks that each run with the cache prints what the same run without it prints, before and after a changed, a renamed and a deleted file, and in `--full`. It fails when the median of `SPEED_RUNS` checks with the cache passes `ONE_FILE_CHECK_MS`, 500 ms. It runs by hand in the dev container, not in CI.

Why: the cache never decides a verdict that a parse would decide otherwise, because each entry is keyed by everything a parse of the file depends on, and a commit cannot place a pack that a run trusts. Only a person or a program with write access to the checkout can; that one can change Lawcheck itself. The extractors read nothing but the parsed file, so the path, the text and the versions are the whole input. A file whose uses the run reads is parsed anyway for its uses, so caching it would save nothing in a check of a change. The threshold is the measured median with room for noise: the design's 0.3 s for one file was 0.29 to 0.38 s in five measurements on 2026-11-23, and a check of one changed Markdown file in guava took 0.14 s on 2026-11-15. A timing on a shared CI runner would fail on the runner, not on the code. The step mark after the last parse was needed for the same output with and without the cache: without it, `check --full` on guava stopped with `memory-too-large` at the last Kotlin file when that file was parsed, and passed when the file came from the cache.
