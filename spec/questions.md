# Questions found while building the check slice

Each entry names the place in `check-slice.md`, what is unclear or wrong, and what the build does.

## 1. Tests 21 to 30: a replaced rule file is itself a change

Section 8 says tests 21 to 28 "replace `check` in `no-console.mjs`" in a fresh S on `work`. A rule file edited in the work tree is in the change, so the first line counts 2 changed files. Test 23 then expects `1 changed file`, and test 25 expects "as test 4", which also says `1 changed file`. Both fail when the rule is replaced on `work`.

Choice: the S of tests 21 to 30 gets its replaced rule files in a second commit on `main`, before `work` is made. Tests 22, 29 and 30 replace `no-todo.mjs` or `no-console.mjs` the same way. The expected outputs of the spec then hold as written.

## 2. Two waivers covering one finding

Section 5 says a waiver drops every finding of its rule on the covered line. It does not say which waiver counts as used when two cover the same line, for example one at the end of the line and one on its own line above. That decides which one is reported as `waiver-unused`.

Choice: the waiver on the finding's own line takes the finding. Otherwise the nearest waiver above takes it. The other waivers of that line stay unused unless another finding reaches them.

## 3. Which files are read for typing

Section 2 says every run "reads each file whose path matches a type". A subtype can match a path that its parent does not.

Choice: a file is read when its path matches the paths of any type at any level of the tree. Such a file can then be `file-unreadable` even though no type takes it.

## 4. `--version` and `--help` with other arguments

Section 4 lists `lawcheck --version`, `lawcheck --help` and `lawcheck check --help`. It does not say what `lawcheck --version --json` or `lawcheck check --full --help` do.

Choice: only those three exact forms print the version or the usage. Any other combination is `usage`.

## 5. Line breaks in a message

Section 3 says each line break in a message becomes one space. It does not say which characters count.

Choice: `\r\n`, a lone `\r` and `\n` each become one space. U+2028 and U+2029 stay as they are.

## 6. Rules run side by side

Section 3 says the tool calls `check` "one call at a time". It does not say whether two rules may run at once.

Choice: each rule keeps one call at a time in its own process. Up to as many rules as the machine has cores run at once. The output does not depend on it, because findings and crashes are sorted before printing.

## 7. The order and the `next:` line of exit 2

Section 6 says the errors of exit 2 print "in the same grammar". It does not give their order, and it gives a `next:` text only for `law-invalid` and `base-unreachable`.

Choice: errors sort like findings, by file, line and code, and an error without a place comes first. `next:` follows the first error after sorting. The texts for the other codes are worded in `src/output.ts`.

## 8. The order of `waivers` in JSON

Section 6 does not give the order of the `waivers` list.

Choice: by file path, then by line.

## 9. The Node version

Section 3 says the runner was measured on Node 24.22.2. The `javascript-node:24` image ships Node 24.22.1 today. Tests 26 and 27 pass on it.

