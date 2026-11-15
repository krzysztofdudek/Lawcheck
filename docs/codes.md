# Codes

Every code Lawcheck prints. A finding is a line of `check`'s report and comes with its rule's `why`, or with the fixed why below for a built-in code. An exit-2 code stops the run before any conclusion, and its output ends with one `next:` line that says what to fix.

| Code | Kind | When | Why |
|---|---|---|---|
| `usage` | exit 2 | the arguments break the command's usage line | the tool does only what its usage line says |
| `not-initialized` | exit 2 | no `.lawcheck/law.yaml` here or above | without a law there is nothing to check the code against |
| `already-initialized` | exit 2 | `init` finds a law here, above or below | a second law would split one repository's rules between two files |
| `no-git` | exit 2 | git cannot be started, or the root is outside a git work tree | the files and the change come from git |
| `law-invalid` | exit 2 | the law cannot be read, does not parse, or breaks its rules: a key, a value, an id, a pattern, an expression | a misspelled key changes the law without a word |
| `config-invalid` | exit 2 | `.lawcheck/config.yaml` holds an unknown key or a wrong value | a misspelled setting changes the reviewer without a word |
| `rule-missing-file` | exit 2 | a rule has neither its `.mjs` nor its `.md` file | a rule without its file would never be checked |
| `rule-file-without-entry` | exit 2 | a file in `.lawcheck/rules/` outside `lib/` is no rule of the law, or a rule has both files | a rule file that the law does not name never runs |
| `file-unreadable` | exit 2 | a file that must be read cannot be | a file that cannot be read cannot be typed or judged |
| `type-overlap` | exit 2 | two types of one level match one file | a file has one type, so the rules that bind it are never in doubt |
| `base-unreachable` | exit 2 | the base names no commit, or shares no history with `HEAD` | without its base a change cannot be told from debt |
| `link-outside-root` | exit 2 | a script rule is to run, and a link git tracks under the root leads outside it and Lawcheck's folder | a script rule reads nothing outside the root, and a link that leads out of it would let it |
| `path-unsupported` | exit 2 | a script rule is to run, and the path of the root or of Lawcheck holds a `*` or, outside Windows, a backslash, where the runner cannot keep the rule inside the root | a script rule reads nothing outside the root and Lawcheck's folder, and the runner can keep that only on such a path |
| `rule-crashed` | exit 2 | a script rule does not load, throws, returns no list of findings, or passes 30 seconds | a broken rule says nothing about the code |
| `parser-failed` | exit 2 | a grammar cannot be loaded, or a reader fails on a file | a file whose uses were not read is not taken to use nothing |
| `reviewer-not-configured` | exit 2 | reviews are to be asked and no provider is set | reviewer rules need a reviewer to judge them |
| `too-many-reviews` | exit 2 | a run needs more reviewer calls than its cap | reviewer.max_calls bounds what one run spends |
| `reviewer-unreachable` | exit 2 | the reviewer cannot be called, or a request fails | without the reviewer's answer a reviewer rule says nothing |
| `reviewer-bad-answer` | exit 2 | the reviewer's answer is no verdict twice | an answer that is no verdict cannot be recorded |
| `internal` | exit 2 | any other failure, a fault of Lawcheck included | a fault of Lawcheck says nothing about the code |
| `not-reviewed` | finding | a reviewer rule has no verdict for a file's content | a reviewer rule says nothing about content it has not judged |
| `too-large-to-review` | finding | a prompt would exceed `reviewer.max_chars`; under `try` it ends the run with exit 2 | the reviewer is never sent more than reviewer.max_chars characters |
| `forbidden-use` | finding | a file uses a file its `may_use` list does not allow | a type's may_use names every type its files may use |
| `uses-not-read` | finding | files of a type with a list in force have no reader | a restriction that cannot be checked is not shown as kept |
| `waiver-unknown-rule` | finding | a waiver names no rule of the law | a waiver that names no rule of the law waives nothing |
| `waiver-without-reason` | finding | a waiver has no reason after `--` | a waiver without a reason cannot be weighed later |
| `waiver-unused` | finding | a counted waiver drops no finding | a waiver that drops nothing would hide the next finding on its line |

A finding of a rule of the law carries the rule's id as its code, and the rule's own `why`. A rule id may not equal any code above.
