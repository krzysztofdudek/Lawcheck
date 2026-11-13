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
