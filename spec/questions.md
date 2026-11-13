# Questions found while building the check slice

Each entry names the place in `check-slice.md`, what is unclear or wrong, and what the build does.

## 1. Two waivers covering one finding

Section 5 says a waiver drops every finding of its rule on the covered line. It does not say which waiver counts as used when two cover the same line, for example one at the end of the line and one on its own line above. That decides which one is reported as `waiver-unused`.

Choice: the waiver on the finding's own line takes the finding. Otherwise the nearest waiver above takes it. The other waivers of that line stay unused unless another finding reaches them.

## 2. Which files are read for typing

Section 2 says every run "reads each file whose path matches a type". A subtype can match a path that its parent does not.

Choice: a file is read when its path matches the paths of any type at any level of the tree. Such a file can then be `file-unreadable` even though no type takes it.

## 3. `--version` and `--help` with other arguments

Section 4 lists `lawcheck --version`, `lawcheck --help` and `lawcheck check --help`. It does not say what `lawcheck --version --json` or `lawcheck check --full --help` do.

Choice: only those three exact forms print the version or the usage. Any other combination is `usage`.

## 4. Line breaks in a message

Section 3 says each line break in a message becomes one space. It does not say which characters count.

Choice: `\r\n`, a lone `\r` and `\n` each become one space. U+2028 and U+2029 stay as they are.

## 5. Rules run side by side

Section 3 says the tool calls `check` "one call at a time". It does not say whether two rules may run at once.

Choice: each rule keeps one call at a time in its own process. Up to as many rules as the machine has cores run at once. The output does not depend on it, because findings and crashes are sorted before printing.

## 6. The order and the `next:` line of exit 2

Section 6 says the errors of exit 2 print "in the same grammar". It does not give their order, and it gives a `next:` text only for `law-invalid` and `base-unreachable`.

Choice: errors sort like findings, by file, line and code, and an error without a place comes first. `next:` follows the first error after sorting. The texts for the other codes are worded in `src/output.ts`.

## 7. The order of `waivers` in JSON

Section 6 does not give the order of the `waivers` list.

Choice: by file path, then by line.

## 8. The Node version

Section 3 says the runner was measured on Node 24.22.2. The `javascript-node:24` image ships Node 24.22.1 today. Tests 26 and 27 pass on it.

# Questions found while building the reviewer slice

Each entry names the place in `reviewer-slice.md`, what is unclear or wrong, and what the build does.

## 9. Test 66: the large file does not fit `max_chars: 100000`

Test 66 sets `max_chars: 100000` and adds `src/core/big.ts` with 7,000 lines of `// filler`. Numbered, those lines make a prompt of 112,807 characters. The run then reports `too-large-to-review` and starts no program, so the case never reaches the broken pipe it is there for.

Choice: the test keeps the 7,000 lines and sets `max_chars: 120000`. The prompt stays larger than a pipe buffer, and the fake `claude` exits before it reads it.

Settled: test 66 in the spec now says `max_chars: 120000`.

## 10. Resends near the cap

Section 7 says a run sends at most `max_calls` requests, and that a request goes again while the count sent is below the cap. With a cap of 3 and three reviews, a resend in the first review would leave the third review's first request above the cap.

Choice: a request goes again only while the requests sent plus the first requests of the reviews not yet started stay below the cap. After the first error no new review starts, so that reserve drops to zero. The run never sends more than the cap.

Settled: section 7 of the spec now says this.

## 11. How many times one review may resend

Section 4 allows one more request after a bad answer. Section 6 allows one more after a 429 or a connection that gave no answer. It does not say whether the two add up.

Choice: each request may go once more for a 429 or a dropped connection, and each review may ask once more after a bad answer. Every request counts toward the cap.

## 12. A fail whose findings are all waived

Section 4 says a fail with no finding left after waivers is a pass. Section 5 says the failure cache holds the findings before waivers drop any. Test 48 expects F' to leave a line in `.lawcheck/verdicts`, and its only finding falls on a waived line.

Choice: an answer with no finding left after waivers is recorded in `.lawcheck/verdicts`. An answer with a finding left goes to the failure cache with all its findings, waived ones included. The run in which the answer arrives counts the dropped findings in the waiver's `waived`; later runs read the verdict and count 0.

## 13. What the failure cache holds

Section 5 says the cache holds the findings "as the answer gave them".

Choice: each finding is stored as `{ "line": <n or null>, "message": <text> }`, with the message as the reviewer wrote it. A finding without `line` is stored with `null`. Line breaks become spaces when the finding is printed, as for a fresh answer.

## 14. Context of a rule with no kind

Section 2 says the `context` of a rule with both files is not checked. It says nothing for a rule with neither file.

Choice: a rule with neither file is not checked either. A rule whose `.md` holds only whitespace still has its `context` checked.

## 15. A file read twice

Section 4 says each judged file, context file and rule file is read once per run. A context file or a rule file can also be judged, as in test 72.

Choice: the run keeps each file it reads and hands the same bytes to every step that asks for it.

## 16. A line ending in `\r` in `.lawcheck/.gitattributes`

Section 5 appends `verdicts merge=union` when no line of the file is exactly that.

Choice: a trailing `\r` is removed before the comparison, as for `.lawcheck/verdicts`, so a file with CRLF line ends does not get the line twice.

## 17. An empty `reviewer:`

Section 6 says `reviewer` takes a mapping. A file holding `reviewer:` and nothing under it gives a null.

Choice: `config-invalid` at that line. Only an empty file, or one of comments, sets nothing.

## 18. Texts the spec leaves to the worker

Choice: these are worded in `src/review.ts` and `src/output.ts`.

- The line on standard error before the first call: `lawcheck: <n> reviewer calls to <provider>`.
- The `next:` of `too-many-reviews`: `<n> reviewer calls are needed and the limit is <m>; raising reviewer.max_calls or --max-calls is the user's decision`.
- The `next:` of a `reviewer-unreachable` without place: `make <provider> reachable as the error says, then run <review>`.
- The `next:` of a failed review: `run the same command again; what was answered is kept, so it asks only the rest`.
- The status line of an HTTP failure: `HTTP <status> <status text>`, then `: ` and the first line of `error.message` when the body has one.

## 19. What is left of a `claude` program after it exits

Section 6 sends SIGTERM to the group at the timeout and SIGKILL 5 seconds later. It says nothing about a child the program leaves running after a normal exit. Such a child can hold the output pipes open, and the call would never end.

Choice: once the program exits on its own, the tool sends SIGKILL to its group at once. After a timeout it keeps the 5 seconds of section 6.

## 20. Tests 70 and 71: where the change is made

Test 70 says "one at a time on work". Test 71 runs `--full --review` on branch `a` and `--review` on branch `b` without naming a base.

Choice: test 70 makes each change in the working tree of `work`, uncommitted. Test 71 adds `--base main` to both runs, as slice one's default command does. Without a base, the run on `b` would also ask for `src/core/tax.ts` and send two requests.

## 21. Tests 78 and 79

Test 79 is `npm test` itself, so no test inside `npm test` can carry it. The whole suite is the test.

Test 78 is the reviewer's reading of the committed result. `tests/acceptance/stability-result.test.ts` automates what a script can check: the fixture against section 9 byte for byte, the model, the counts and shares against the pairs, `label_match.clear.share` of at least 0.9, and no `://`. Naming decision 16 to the owner stays with the reviewer.

## 22. The temperature of the measurement

Section 9 says an endpoint that drops `temperature` measures its own default. The endpoint used for `tests/stability/result.json` drops `temperature` and `top_p`. The result has no field for this, and `temperature_sent: 0` records only what the tool sent.

Choice: the result keeps the shape of section 9, and this entry records that the measured temperature is the endpoint's default.
## 23. Review notes not fixed

The review of this slice left seven notes. Notes 7, 12 and 13 are fixed, and note 9 led to the new fixture of section 9. These three stay as they are:

- Note 8, "each file is read once" has no test: a test would have to change a file inside a window of milliseconds between two reads, and the run reads each file into one shared map, which the review's probe 7 confirmed.
- Note 10, the model is not part of the verdict key: section 5 and test 70 say so on purpose, so a change of model keeps every pass, and changing that is the owner's design decision.
- Note 11, the answer reader's time grows with the square of the brace count: section 4 defines the spans by every `{`, 40,000 braces cost about 1.3 seconds, and a bound on the answer's length would be a rule the spec does not have.

## 24. The baseline's patterns

The review described its four regular expressions in words. The script writes them out in `tests/stability/baseline.ts`, as the table of section 9 lists them. On the earlier fixture these patterns give the same 240 of 240 the review reported.

## 25. Where the claude-code measurement ran

`claude` is signed in on the host and not in the dev container, so the claude-code measurement ran on the host with Node from the host and `dist/` built in the container. The script cannot see this itself, so it takes `LAWCHECK_STABILITY_NOTE` and copies it into the result.

# Questions found while building the dependency slice

Each entry names the place in `dependency-slice.md`, what is unclear or wrong, and what the build does.

## 26. `<language>` in the messages of `parser-failed`

Section 3.3 writes `the grammar of <language>` and `the <language> reader`, and test 90 expects `the grammar of typescript`. It does not say whether the reader rows take the language's id or its display name, while the C# project row writes `C#`.

Choice: `<language>` is the language's id in every row (`typescript`, `csharp`, `cpp`), as test 90 shows. The C# project row keeps its fixed text.

## 27. A request to an address with a user and a password

Section 8 has `<what>` fall back to the first line of the error's own message. For an address that holds a user and a password, `fetch` throws `Request cannot be constructed from a URL that includes credentials: <the address>`, so the message would print the password. Slice two's unit test handed `post` such an address and asserted that the password stays out of the failure.

Choice: `post` follows section 8 for every error of `fetch`, and refuses before `fetch`, with a fixed message that quotes neither, an address with a user or a password and a header value outside space to `~`. So no caller can print a secret through it, besides `endpointOf` and `ready()` refusing both before the first call. Slice two's unit test is back for both cases.

## 28. A use with no candidate

Section 3.3, step 8, takes `what` of an unresolved use from its first candidate. A use Runes reports without any candidate would have none.

Choice: such a use is an unresolved use with the answer `none` and an empty `what`. Neither L nor the two repositories of section 11 has one.

## 29. The form of `scripts/grammar-licenses.txt`

Section 6 says what the file holds for each grammar, not how it is laid out.

Choice: one block per grammar, in the order of the 13 ids: a line `<language>: <grammar file>`, the repository and the commit from Runes' manifest, then the licence file of that repository at that commit, word for word, its copyright line included. TSX shares TypeScript's repository and licence and has a block of its own. The unit test finds a block for every `.wasm` in `dist/grammars/` by its file name.

## 30. How the unit tests reach the failures of section 3.3

The real readers do not fail on request, and section 10 asks for a unit test of each failure row.

Choice: `src/readers.ts` takes the Runes calls it makes as one object, the real one by default. The unit tests hand it a stand-in whose grammar load, extraction, C# project reading or classification throws, and check the error, its place and that no later file is parsed or classified. The real readers are covered by tests 81 to 91 and by section 11.

## 31. Tests 94 and 95

Test 94 is `npm test` itself, as test 79 was (entry 21), so no test inside it can carry it. Test 95 is `npm run real`, which needs the network and stays outside `npm test` by design.

## 32. Notes of the review left as they are

- Note 8, a change that retypes a target or changes only the law judges no using file until that file is edited: section 3.2 states this and leaves widening the run to the owner.
- Note 9, a Java name of the same package written `Outer.Inner` is not followed (three uses in gson): a gap of the Runes reader that section 7 does not list; by the owner's ruling it goes to Runes and is not worked around here.
- Note 11, section 4's sentence on `from m import name` holds for relative imports only, and two of gson's 1,740 own-package keys are `LinkedTreeMap` member types: the spec's prose is the owner's to correct, and no expected line changes.

# Questions found while building the commands slice

Each entry names the place in `commands-slice.md`, what is unclear or wrong, and what the build does.

## 33. The `next:` of `usage` when no command was recognised

Section 2 gives `run lawcheck <command> as its usage line says: lawcheck <command> --help`, "or `lawcheck --help` when no command was recognised", without saying whether the second replaces the whole text or only its command.

Choice: the sentence keeps its form without a command: `run lawcheck as its usage line says: lawcheck --help`.

## 34. The `next:` of `no-git` outside `check`

Section 2 replaces only a `next:` that holds `then run lawcheck check`. `no-git`'s reads `run lawcheck check inside a git work tree, with git on the PATH`, so `init` and `explain` would tell the user to run `check`. Section 8 gives `doctor`'s git check `run lawcheck doctor inside a git work tree, with git on the PATH`.

Choice: `no-git` names the command that ran, in every command, as `doctor`'s row does.

## 35. The program's usage

Section 2 fixes the first line of `lawcheck --help` and says "one line per command", not what each holds.

Choice: eight lines and a line end: the first line, then `  <command>  <what it does>` for the seven, in section 2's order.

## 36. A file whose path matches only a subtype

Section 6 orders the reasons of a file with no type, and "no type's paths match" comes before "binary". A file whose path matches a subtype's `paths` and no root type's is not typed by slice one either, and no row names it.

Choice: "no type's paths match it" is decided at the root level, as slice one's walk decides it, and such a file is not read, so it cannot be `file-unreadable` under `explain`.

## 37. How several type ids are joined

The reasons `it matches the paths of <ids> ...`, `it matches <a> and <b> at one level` and the `then:` text `any file here matches <ids>` do not say how three or more ids are joined.

Choice: `a`, `a and b`, `a, b and c`, everywhere in `explain`.

## 38. Where a context file that cannot be read stops `explain`, `try` and `prime`

`check` reports a context file it cannot read with the typing row, as slice two does. Section 2 puts "`file-unreadable` of a rule file" in the rule-file row, and `prime` types no file, so it would never report it.

Choice: in the three new commands a context file that cannot be read stops the run at the rule-file row; `check` is unchanged.

## 39. Step 4 of `prime`'s budget: where `... and <n> more root types` stands

Section 4 says the type lines are added "followed by" that line, and test 104 says it "comes before the blank line and the last line".

Choice: right after the type lines, before the blank line and `Rules`, which satisfies both. When even the rule line with one id and `, and <n> more` does not fit, the rule line is left out; this guard cannot be reached at 8,000 characters, whose fixed part is about 1,900.

## 40. `try` arguments the spec leaves open

- `--times 0` is `usage`, since `--times` takes at least 1; it is refused with the other argument checks.
- A directory that holds no selectable file is `usage` with `matches no file`.
- A pattern that starts with `!` selects no file, so it is `usage` with `matches no file`.
- A reviewer rule's `too-large-to-review` under `try` is an exit-2 error at the file; its `next:` says to try the rule on a smaller file and that raising `reviewer.max_chars` is the user's decision.
- With `--times` above 1, a passing answer still prints its `answer <k> of <t>: pass` line.
- A dry run's JSON has one item per file and attempt, as section 5's table says for every run.

## 41. `doctor` messages the table leaves open

- `types` fails as `law` does: `<place>  <message>`, then `; and <n> more` when there are more.
- `readers` with lists in force and no file of the run read: `uses are read in 0 files; the 13 grammars load`.
- The note of `readers` reads `<n> files are not read for uses: <k> <extension>, ..., so check warns uses-not-read`, slice three's wording without a type.
- `law-change` lists three paths, then `, and <n> more`.
- `reviewer` with a provider set and no reviewer rule is `ok` with `no reviewer rule, so no reviewer is needed`, unless `--reviewer` asks for the test call.
- A test call answered with a valid `fail` is reported as `answered fail to a test call that asks for pass: <the answer's first 200 characters>`; an answer that is no verdict keeps section 8's `answered with no verdict`.
- The fails of a test call, and `--reviewer` without a provider, end their `next:` with `lawcheck doctor --reviewer`.
- `doctor`'s own `usage` errors print slice one's error output and `lawcheck-error/1`; only its report replaces them.

## 42. The Kind of `too-large-to-review` in `docs codes`

The code is a finding of `check` and an exit-2 error of `try`, and the table takes one Kind per row.

Choice: `finding`, with `try`'s case said in its When cell.

## 43. Test 88 compares `scope` too

Section 10 lists the documents of tests 41, 75, 82 and 88 as gaining `"law_changed": false`. Test 88's file holds two comparisons of `scope`, the first in `tests/acceptance/languages.test.ts`; both gained the key, as did the unit test of `tests/unit/output.test.ts`.

## 44. Test 141

Test 141 is `npm test` itself, as tests 79 and 94 were, so no test inside it can carry it.

## 45. Model names and the install in the pages

The pages may name no other tool, and the package is not published. The examples of `config` and `providers` write `your-model-id` for a model, and `ci` runs Lawcheck as a dev dependency of the project with `npx`, not from a global install.

# Questions found in the review of the commands slice

## 46. The `next:` of a failed reviewer call under `try`

Slice two's `next:` for `reviewer-unreachable` and `reviewer-bad-answer` says that what was answered is kept, so the next run asks only the rest. `try` keeps nothing (decision 5), so that line would be false.

Choice: under `try` both read `run the same command again; try keeps no answer, so it makes every call again`.

## 47. The `next:` of `internal` outside `check`

Slice one's `next:` for `internal` and any code without its own reads `run lawcheck check again, and report the error if it stays`, which section 2's rewrite does not reach.

Choice: it names the command that ran, as `no-git` does (entry 34). `init` where `.lawcheck` is a regular file stays `internal`: no code of the spec fits a file in the way, and a new code is the owner's to add.

## 48. Notes of the review left as they are

- Note 9: ruled by the director; section 6 now has the reason `it lies behind a symbolic link, which has no type`, checked before `git ignores it`.
- Note 10: ruled by the director; section 5 now reads a target that names a listed file as that file before it reads it as a pattern.
- Note 12: ruled by the director; section 4's first part now leaves out its reviewer lines without a reviewer rule and its may_use parts without a list, and the waiver line names a comment. S's output is 1,920 characters.
- Note 13: ruled by the director; the two phrases are gone from `commands-slice.md`, and a test of `docs.test.ts` keeps the pages and that spec free of them.

# Questions found while building the plugin slice

Each entry names the place in `plugin-slice.md`, what is unclear or wrong, and what the build does.

## 49. A pattern that does not parse under `check <paths>`

Section 2 lists the targets that add nothing: a file that does not exist, an ignored file, a binary file, an empty directory and a pattern that matches nothing. It does not name a pattern that does not parse, such as one with an unclosed `{`.

Choice: such a pattern stays `usage`, as under `try`, since it is no target that selects no file but a target that cannot be read.

## 50. Three runner names at the same distance

Section 3 gives `<near>` for one nearest name and for two at the same distance. Three or more cannot be reached by any value within two edits of the five names that the tests use, but the rule does not exclude them.

Choice: the first two of the nearest names, in the order of the five. A value that is no plain scalar is quoted as its YAML source, or as nothing.

## 51. The runner line in `prime`'s error output

Section 3 says the first line of the output gains ` Start it here as: <cmd>`. When the law cannot be read, `prime` prints its first part and then the errors, and its first line is the same first line.

Choice: that first line gains the part too, so an agent told how to start Lawcheck is told in both outputs.

## 52. Test 161 and an edit without a state file

Section 8, step 5, hands an exit-2 output "only when the SHA-256 of the output differs from the state's `last_error`", and "without a state file it is handed every time". Test 161 runs two edits with no prompt before them, so no state file exists, and expects the second to print nothing.

Choice: the hook after an edit writes `last_error` into the session's state file, creating the file when the session has none, with `open` false and every other field at its starting value. "Without a state file" is read as a session that cannot have one: a `session_id` with a character outside the allowed set, or a data folder another user owns. A file created this way does not count at a stop, since its `open` is false.

## 53. Test 169: a file the agent committed in the turn

Section 8, step 4, compares each candidate's blob at the prompt with its blob at the stop. In test 169's third case D is written before the prompt, so the prompt's snapshot holds its blob as an untracked file, and the agent commits it in the turn, so the stop's snapshot finds the same blob in the new HEAD. The two blobs are equal and D would not count, while the test expects a hand-back on D, and decision 4 says that "a file ... the agent committed counts".

Choice: the paths of the turn's own commits (the ancestor and committer-time rule of step 4) count as changed without the blob comparison; the comparison decides every other candidate. A touch, a stash and its pop, and a rewrite to the same bytes still change nothing, and a pull, a rebase or a checkout still adds no commit.

## 54. The reason for an old `lawcheck`

Section 5's table gives `this lawcheck does not take check <paths>; update it` when `check` exits 2 and every line that holds `error[` holds `error[usage]`. Read literally, an exit 2 with no such line at all would match too. Test 175's fake prints `lawcheck: ERROR  1 error` and `error[usage]  x`, which also has the form of an answer.

Choice: the row needs at least one line that holds `error[`, and it is decided before the answer rule, so test 175's output is not run with that reason.

## 55. Where `told` lives when the turn's state does not count

Section 8 sends a notice when `told` is false and then sets it. A notice can come from a stop whose state does not count, or from a session that never had a prompt.

Choice: `told` is read from and written to the session's state file whatever its `root` and `open`, and the file is created for it when absent, as in entry 52.

## 56. The exit code after a signal

Section 5 says the hook kills the group of a call in progress on `SIGTERM`, `SIGINT` or `SIGHUP` and exits, without a code.

Choice: exit 0 with nothing printed: the hook was stopped, it did not fail, and Claude Code has already given up on its output.

## 57. The trial's PATH on a host whose `git` is a wrapper

Section 10, step 3, puts the directories of `node`, `git` and `claude` on the agent's PATH. On the trial's host the first `git` is a wrapper script that runs the next `git` on the PATH, so with its own directory alone every git call fails.

Choice: the PATH holds the directory of every `git` found on the PATH, in order, after `node`'s and before `claude`'s, so the wrapper finds the program it wraps.

## 58. Acceptance tests not automated inside `npm test`

Tests 153 and 180 are the reviewer's, run on the host and read by hand, as section 12 says. Test 182 runs the trial on the host and is the reviewer's. Test 183 is `npm test` itself, as tests 79, 94 and 141 were, so no test inside it can carry it. Test 181 reads `tests/agent/result.json`, so it fails until the trial has run once.

# Questions found in the review of the plugin slice

## 59. A running background task and the check before finishing

The review's finding 1: section 8, step 2, skipped the check for any running background task, so a dev server or a watcher kept in the background turned the check off for the whole session, and nobody was told.

Choice: by the director's ruling, the stop hook never falls silent. Only a running `subagent`, `teammate` or `workflow`, which may still write files, holds the check back, and that stop sends a notice every time naming the task; the turn stays open, so the stop after the task ends checks it. Any other running task, a `shell` or a `monitor` included, is checked as usual. A Stop hook has no output that reaches the agent without continuing its turn, so the notice goes to the user. Section 8 and test 176 say this now.

## 60. A commit amended in the turn, or followed by a merge

The review's finding 2: step 4 counted the turn's commits only when the old `head` was an ancestor of the new one and every commit between them was the turn's, so an amended commit, or a merge of older commits after the turn's own, dropped the turn's changes from the check.

Choice: the commits counted run from the merge base of the two heads to the new `head`, merges left out, each kept when its committer time is at or after `started`, and the paths each commit changes count as changed. An amended commit counts with all its paths, those it held before the turn included. Section 8 and test 169 say this now.

## 61. Four behaviours without a test that fails when they break

The review's finding 4 broke each of these and saw no test fail. Each now has one, and each fails with that break back in: test 159 checks the log's `check ./notes/a.ipynb`; test 161 hands a second, different exit-2 output and then holds it back; a test of section 5 has a fake `lawcheck` print a pass and leave a child holding its output, and expects nothing within 5 seconds and the child gone; tests 166 and 167 send a stop with another `prompt_id` after three hand-backs and expect a hand-back.

## 62. A breach found by the agent's own call

The review's finding 6: step 5 took a breach from any caller, so a run where the agent found `.lawcheck/` and ran `lawcheck` itself counted without the arm's hook doing anything.

Choice: a breach is a line of the arm's own events; the agent's lines stay in `log` as they are. Section 10 says this now, and a test of `agent-result.test.ts` checks it.

## 63. The other findings of the review

- Finding 3, the trial's allow list does not bound what the agent runs (`Bash(node *)` runs any code, `Bash(git *)` any command through an alias, and `Read`, `Write` and `Edit` have no path scope, all on the host with the real home): not changed here, because the list is section 10's word for word and how tight it must be is the owner's to say when he is asked for the exception; the request must say it.
- Finding 5, the guard's bound assumes one `prompt_id` per turn: nothing to change in code; the stop arm will show it, and no run there should hold more than three `stop` lines with exit 1.
- Finding 7, the trial bounds time and not turns: not changed, since a turn cap would end runs as errors at a number nobody chose; the 15 minutes bound each run, and a cap is the owner's to set.
- Finding 8, a turn that waives its breach or changes the law finishes without a word: not changed, since telling the user of every waiver is a behaviour section 8 does not have, and waivers are the user's to weigh in review.
- Finding 9, the stop arm's state files stay under `~/.claude`: fixed; each run removes its session's file, and section 10, step 8, says so.
- Finding 10, one `told` covers every kind of notice: not changed, since section 5 fixes the state's shape with one boolean; a flag per kind is a change of that shape.
- Finding 11, `claude plugin validate plugin` warns `ICON_MISSING`: not changed, since the fix is a binary image in the public repository and the result line is still `Validation passed`.
