# Codes

Every code Lawcheck prints. A finding is a line of `check`'s report and comes with its rule's `why`, or with the fixed why below for a built-in code. An exit-2 code stops the run before any conclusion, and its output ends with one `next:` line that says what to fix.

| Code | Kind | When | Why |
|---|---|---|---|
| `usage` | exit 2 | the arguments break the command's usage line | the tool does only what its usage line says |
| `unsupported-environment` | exit 2 | Lawcheck runs where it is not supported: Node older than 24, Bun without Node, Yarn's Plug'n'Play, or git older than 2.34; the first line names the cause | Lawcheck answers only where its rules and readers are known to run |
| `not-initialized` | exit 2 | no `.lawcheck/law.yaml` here or above | without a law there is nothing to check the code against |
| `already-initialized` | exit 2 | `init` finds a law here, above or below | a second law would split one repository's rules between two files |
| `no-git` | exit 2 | git cannot be started, refuses the repository, or the root is outside a git work tree; for a repository owned by another user the next line gives git's `safe.directory` command | the files and the change come from git |
| `law-invalid` | exit 2 | the law cannot be read, does not parse, or breaks its rules: a key, a value, an id, a pattern, an expression | a misspelled key changes the law without a word |
| `config-invalid` | exit 2 | `.lawcheck/config.yaml` holds an unknown key or a wrong value | a misspelled setting changes the reviewer without a word |
| `rule-missing-file` | exit 2 | a rule has neither its `.mjs` nor its `.md` file | a rule without its file would never be checked |
| `rule-file-without-entry` | exit 2 | a file in `.lawcheck/rules/` outside `lib/` is no rule of the law, or a rule has both files | a rule file that the law does not name never runs |
| `file-unreadable` | exit 2 | a file that must be read cannot be | a file that cannot be read cannot be typed or judged |
| `file-too-large` | exit 2 | a file that must be read as text holds more than 16 MiB or 1,048,576 lines, a file whose uses are read more than 4 MiB, the config more than 1 MiB, or the law more than 1 MiB, 10,000 rules or 1,000 types | a run holds every file it reads as text in memory, so one file may hold only so much |
| `text-too-large` | exit 2 | the files a run reads as text hold more than 128 MiB together | a run holds the text it reads in memory, so all of it together may hold only so much |
| `file-unwritable` | exit 2 | a file or folder the tool must write cannot be written, standard output included | what Lawcheck cannot write is lost, so the run cannot say it is done |
| `type-overlap` | exit 2 | two types of one level match one file | a file has one type, so the rules that bind it are never in doubt |
| `base-unreachable` | exit 2 | the base names no commit, or shares no history with `HEAD`, or a CI job has no base; in a shallow clone the next line gives the fetch that brings the history | without its base a change cannot be told from debt |
| `link-outside-root` | exit 2 | a script rule is to run, and a link git tracks under the root or in a submodule leads outside the git work tree and Lawcheck's folder | a script rule reads nothing outside the work tree, and a link that leads out of it would let it |
| `path-unsupported` | exit 2 | a script rule is to run, and the path of the root or of Lawcheck holds a `*` or, outside Windows, a backslash, where the runner cannot keep the rule inside the root | a script rule reads nothing outside the root and Lawcheck's folder, and the runner can keep that only on such a path |
| `runner-failed` | exit 2 | the process that runs script rules ends before it starts, and the message gives the line Node printed | a runner that does not start says nothing about the rules |
| `rule-crashed` | exit 2 | a script rule does not load, throws, returns no list of findings, returns a message over 4,096 characters, or passes 30 seconds | a broken rule says nothing about the code |
| `too-many-findings` | exit 2 | the findings of a run, its rules', its waivers', its uses' and its reviewer's together, pass 200,000, or 16,777,216 characters of message | a run holds every finding in memory, so the rules may return only so many |
| `rules-too-slow` | exit 2 | the script rules of a run take more than 600 seconds together | a run that never ends gives no answer, so the script rules of a run share one limit of time |
| `parser-failed` | exit 2 | a grammar cannot be loaded, or a reader fails on a file | a file whose uses were not read is not taken to use nothing |
| `reviewer-not-configured` | exit 2 | reviews are to be asked and no provider is set | reviewer rules need a reviewer to judge them |
| `too-many-reviews` | exit 2 | a run needs more reviewer calls than its cap | reviewer.max_calls bounds what one run spends |
| `reviewer-unreachable` | exit 2 | the reviewer cannot be called, or a request fails | without the reviewer's answer a reviewer rule says nothing |
| `reviewer-bad-answer` | exit 2 | the reviewer's answer is no verdict twice | an answer that is no verdict cannot be recorded |
| `step-too-slow` | exit 2 | one step of a run, such as typing one file, takes more than 60 seconds | a step that never ends gives no answer, so one step of a run has a limit of time |
| `stopped` | exit 2 | SIGINT, SIGTERM or SIGHUP ended the run | a run stopped before its end says nothing about the code |
| `internal` | exit 2 | any other failure, a fault of Lawcheck included | a fault of Lawcheck says nothing about the code |
| `not-reviewed` | finding | a reviewer rule has no verdict for a file's content | a reviewer rule says nothing about content it has not judged |
| `too-large-to-review` | finding | a prompt would exceed `reviewer.max_chars`; under `try` it ends the run with exit 2 | the reviewer is never sent more than reviewer.max_chars characters |
| `forbidden-use` | finding | a file uses a file its `may_use` list does not allow | a type's may_use names every type its files may use |
| `uses-not-read` | finding | files of a type with a list in force have no reader | a restriction that cannot be checked is not shown as kept |
| `waiver-unknown-rule` | finding | a waiver names no rule of the law | a waiver that names no rule of the law waives nothing |
| `waiver-without-reason` | finding | a waiver has no reason after `--` | a waiver without a reason cannot be weighed later |
| `waiver-unused` | finding | a counted waiver drops no finding | a waiver that drops nothing would hide the next finding on its line |

A finding of a rule of the law carries the rule's id as its code, and the rule's own `why`. A rule id may not equal any code above.

## Escapes in the output

A file name, a rule or reviewer message, the base, the law's ids, `about` texts and patterns, config values, and the text that git, a reviewer endpoint or a reviewer program prints can hold any character. Lawcheck writes these characters as escapes, so one finding or error stays one line and a terminal or a CI log reads no control sequence:

| Character | Written as |
|---|---|
| a line feed inside such text | `\n` |
| a carriage return | `\r` |
| a tab | `\t` |
| any other character below U+0020, and U+007F | `\x` and two hexadecimal digits, such as `\x1b` |
| U+0080 to U+009F, U+2028, U+2029, and every format character of Unicode (category Cf, such as a zero-width space or a mark that changes the direction of text) except the joiners U+200C and U+200D | `\u` and four hexadecimal digits for each UTF-16 unit, such as `\u202e` |
| a line that a CI runner would read as a command of GitHub Actions or Azure Pipelines | its first character as `\x3a` or `\x23` |

Nothing else is escaped, a backslash included. In `--json` a string keeps the text as it is, except that the characters of the last two rows are written as `\u` escapes, so the printed document holds none of them raw and a program that parses it gets the text unchanged. What a script rule prints on its own streams reaches standard error through the same escapes.
