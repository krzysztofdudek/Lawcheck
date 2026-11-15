# Lawcheck: the commands slice

The fourth working slice: the six commands the design names beside `check`. It extends `spec/check-slice.md` (slice one), `spec/reviewer-slice.md` (slice two) and `spec/dependency-slice.md` (slice three), and keeps their tests 1 to 95, with the amendments of section 10. A worker builds what this file says, and a reviewer ticks section 11. The conventions of the earlier slices hold: quoted text output is exact, byte for byte; JSON is compared as parsed data; for every other message this file fixes the code, the place and the exit code, and the worker words one line. Where this file says nothing, the earlier slices decide.

## 1. Scope

In: `lawcheck init`, `prime`, `explain`, `try`, `docs` and `doctor`; one usage per command and a usage for the program; the reference pages `docs` prints; one line in `check` when its change touches the law (section 8).

Out: what the design has and no slice builds yet is listed in [`deferred.md`](deferred.md), with where it is mentioned and why it waits. What this slice does in its place:

| Out | Here |
|---|---|
| `--staged`, `--strict`, `--no-scripts`, `--rule` and `--type` on `check` | `usage`, as before |
| the version line's update documents: `law-needs-update`, `law-newer-than-cli`, the topics `update-<from>-to-<to>` | absent: no release has an update document yet |
| `--no-color` | `usage`: nothing is coloured (slice one, decision 18) |
| `try --type`, `try --all`, and `try` on a file outside the root | `usage`; a script rule without paths takes the files it binds (section 5), and `check --full` runs every rule (decision 4) |
| Windows | not built for, as in the earlier slices, whose runners stop process groups: a typed path is a POSIX path |
| a `.lawcheck/config.yaml` written by `init` | absent (decision 3) |
| the levels Full, Tree and Text in `explain` and `doctor` | each says whether a file's uses are read, and in which language |

## 2. What every command shares

**The program.** `lawcheck <command> [<arguments>]`. `lawcheck --version` prints the version, as before. `lawcheck --help` prints the program's usage, whose first line is `usage: lawcheck <command> [<arguments>] [--json]`, followed by one line per command. `lawcheck <command> --help`, those two words exactly, prints that command's usage. Each exits 0. No command, an unknown command, and any other combination with `--help` are `usage`; the message lists the seven commands. The first line of each command's usage:

```
usage: lawcheck init [--json]
usage: lawcheck prime [--json]
usage: lawcheck check [--full] [--base <ref>] [--review [--again] [--max-calls <n>]] [--json]
usage: lawcheck explain (<path> | --type <id> | --rule <id>) [--json]
usage: lawcheck try <rule> [<path or pattern>...] [--times <n>] [--dry-run] [--max-calls <n>] [--json]
usage: lawcheck docs [<topic>] [--json]
usage: lawcheck doctor [--base <ref>] [--reviewer] [--json]
```

Slice one's rules for flags hold for every command: a flag given twice, an unknown flag, a flag that takes a value given last or before a word that starts with `-`, and the form `--flag=<value>` are `usage`; `--json` anywhere selects JSON, for a `usage` error too. A value of `--times` or `--max-calls` is digits alone, at most 9007199254740991, the largest whole number JavaScript holds exactly. The `next:` of `usage` is `run lawcheck <command> as its usage line says: lawcheck <command> --help`, or `lawcheck --help` when no command was recognised.

**Paths a person types** are relative to the current directory. A path that resolves outside the root is `usage`. Paths the tool prints are relative to the root, with forward slashes, as before.

**Output.** Text goes to standard output, two spaces between the parts of a line, no alignment, no colour. Exit 0, 1 and 2 keep their meaning for every command; which commands can end with 1 is said for each. Exit 2 prints slice one's error output, `lawcheck: ERROR  <n> errors` and the error lines, with one `next:`; `doctor` alone ends with 2 on its own report (section 8). In every command but `check`, a `next:` that holds `then run lawcheck check` has the text from there to its end replaced by `then run lawcheck <command> again`.

**The front of a run.** `explain`, `try` and `prime` begin as `check` does and stop at the first row with errors:

| Step | Codes | `explain` | `try` | `prime` |
|---|---|---|---|---|
| arguments | `usage` | yes | yes | yes |
| the root | `not-initialized` | yes | yes | no: two lines, exit 0 (section 4) |
| git | `no-git` | yes | yes | yes |
| the law | `law-invalid` | yes | yes | yes |
| the rule or type named | `usage` (section 5, 6) | yes | yes | |
| the config | `config-invalid` | yes | yes | no |
| the rule files | `rule-missing-file`, `rule-file-without-entry`, `law-invalid` of `context`, `file-unreadable` of a rule file | yes | yes | yes |
| the paths named, and `try`'s flags that need the rule's kind | `usage` | yes | yes | |
| typing | `file-unreadable`, `type-overlap` | the files it reports on (section 6) | every file | no |

None of them resolves a base, reads a verdict it does not report, or writes a file. The front of `check`'s run moves to `src/setup.ts` and is shared; `check` behaves as before.

**JSON.** Every document of this slice is named `/0`: none matches a `/1` of the design key for key, and none is published yet. Exit 2 prints `lawcheck-error/1`, as before, except under `doctor`.

| Schema | From |
|---|---|
| `lawcheck-init/0` | `init` |
| `lawcheck-prime/0` | `prime` |
| `lawcheck-explain/0` | `explain` |
| `lawcheck-try/0` | `try` |
| `lawcheck-docs/0` | `docs` |
| `lawcheck-doctor/0` | `doctor` |

**One code more.** `already-initialized`, exit 2, from `init` alone. Its fixed why: `a second law would split one repository's rules between two files`. It joins the reserved rule ids.

## 3. `init`

`lawcheck init [--json]` starts a law in the current directory, which becomes the root.

**Order.** `usage`; then `no-git` when the current directory is outside a git work tree (slice one's first git command, run there); then `already-initialized` when `.lawcheck/law.yaml` exists in the current directory or any directory above it, as slice one finds a root, or when slice one's file list, run in the current directory, holds a `.lawcheck/law.yaml` below it. Its place is that law file, relative to the current directory, and its `next:` is `lawcheck doctor  (shows how the law here stands)`. Nothing is written in any of these cases.

**What it writes.** It makes `.lawcheck/` when absent, then each of the two files below only when it does not exist, opening it with the exclusive flag (`wx`), so a file that appears meanwhile is never overwritten: `.lawcheck/law.yaml` that appears meanwhile is `already-initialized`, an existing `.lawcheck/.gitignore` is kept byte for byte. Nothing else is touched: no other file, no git setting, nothing outside `.lawcheck/`.

`.lawcheck/law.yaml`, with `0.1.0` standing for the `MAJOR.MINOR.PATCH` part of the package version:

<!-- example: init-law -->
```yaml
lawcheck: 0.1.0

# The law of this repository: the types of its files, and the rules each type keeps.
# lawcheck docs first-law shows how to write them. A small example:
#
# rules:
#   no-console:
#     why: Only the command layer writes to the terminal.
#
# types:
#   source:
#     about: Everything that ships.
#     paths: ["src/**/*.ts"]
#     rules: [no-console]
#
# Each rule has one file: .lawcheck/rules/no-console.mjs for a script,
# or .lawcheck/rules/no-console.md for the reviewer.
```

`.lawcheck/.gitignore`:

<!-- example: init-gitignore -->
```
.local/
config.local.yaml
```

**Output.** Exit 0:

<!-- example: init-output -->
```
lawcheck: created .lawcheck/law.yaml and .lawcheck/.gitignore

Nothing is checked yet: the law has no types.
next: describe your first file type in .lawcheck/law.yaml  (lawcheck docs first-law shows how)
```

With `.lawcheck/.gitignore` already there, the first line is `lawcheck: created .lawcheck/law.yaml; kept .lawcheck/.gitignore`. When the current directory lies below the top of the work tree (`git rev-parse --show-prefix` prints a non-empty prefix), one line follows the first: `note: the law covers only the files below <prefix>`, the prefix as git prints it, with its trailing `/`.

**JSON.** `{ "schema": "lawcheck-init/0", "root": <the prefix, "" at the top>, "created": [...], "kept": [...], "next": { "command": null, "text": <the text after next:> } }`, paths relative to the new root.

## 4. `prime`

`lawcheck prime [--json]` prints what a coding agent reads at the start of a session: how to work with Lawcheck, then this repository's law in short. It runs no rule, reads no use, calls no reviewer, reads no config and types no file; its git commands are slice one's first two, the work tree and the file list, the second for the kind of each rule; it reads each reviewer rule's file and the first bytes of each `context` file, as the rule-file row of section 2 does. Like every command, it lets git start no program that the repository names (slice one, invariant `I-git-1`). It never ends with 1.

**Without a law** (no `.lawcheck/law.yaml` here or above), inside git or not, it prints these two lines and exits 0:

```
Lawcheck is installed, and this directory has no law (.lawcheck/law.yaml here or above).
Run lawcheck init only when the user asks for a law here.
```

**With a law**, its whole output for S, slice one's sample, exit 0:

```
Lawcheck checks this repository's code against its law: the file types and the rules each type keeps. The law is .lawcheck/law.yaml; rule files are in .lawcheck/rules/.

How to work here
- Before you create a file, or first edit a file of a type new to you: lawcheck explain <path>
- After you change code: lawcheck check. If it says "no base", run lawcheck check --base <the branch you started from>.
- Exit 0: nothing blocks; warnings are advisory. Exit 1: the code breaks the law; fix the code. Exit 2: Lawcheck or the law is broken; fix what the error names, not the code.
- Never report work as done while lawcheck check exits 1.
- A failing run ends with a next line; do what it says. When it asks for something listed below as the user's, or a finding cannot be fixed in the code, ask the user.
- A plain check judges only changed files. After you change the law or a rule file, run lawcheck check --full and tell the user how many findings it lists outside your change.
- Findings outside your change are debt. Leave them unless the user asks.

Only on the user's word
- a waiver comment: lawcheck-waive <rule> -- <reason> (lawcheck docs waivers), or taking a rule off a type
- deleting a rule, or changing its status or its why
- any edit of .lawcheck/verdicts or of .lawcheck/config.yaml

You may, unasked
- add a type for a new kind of file, or make a type finer
- write a rule the user asked for, and try it first: lawcheck try <rule> <files>

The law here: 4 types, 2 rules
source  src/**/*.ts, !src/**/*.d.ts  Everything that ships.  rules: no-todo
  library  src/core/**  Code the commands call.  rules: no-console
  command  src/cli/**  The command layer.
script  tools/**/*.{mjs,js}  content: ^#!  Executable helpers.  rules: no-todo

Rules
no-console  script  Only the command layer writes to the terminal.
no-todo  script  advisory  A TODO without an issue number gets forgotten.

More: lawcheck docs
```

**The first part** is its lines up to `- write a rule ...`, and a blank line follows it. It depends on two facts of the law and on nothing else, so an agent reads no line about a feature the law does not use:

- When at least one rule is a reviewer rule, three parts are added: after `- A failing run ends with a next line; ...`, the line `- not-reviewed: fix every other finding first, then run lawcheck check --review`; after `- deleting a rule, or changing its status or its why` (and after `- widening may_use` when that is there), the line `- lawcheck check --review --again, or --max-calls above reviewer.max_calls`; and at the end of `- write a rule ...`, the words `; a reviewer rule pays one call per file, so add --dry-run first`.
- When at least one type of the tree has `may_use`, two parts change: the first line's `the file types and the rules each type keeps` reads `the file types, the rules each type keeps, and which types may use which`, and after `- deleting a rule, or changing its status or its why` comes the line `- widening may_use`.

Without either, as in S, it is 19 lines and 1,455 characters with its last line end; with both it is 22 lines and 1,721 characters, never more than 1,800. The waiver line names the waiver a comment, so it does not read as a command.

**The law part** is generated from the law:

- `The law here: <t> types, <r> rules`, counting every type of the tree and every rule, singular for 1.
- One line per type, depth first in the order the law writes them, indented two spaces per level: the id, the `paths` joined by `, `, `content: <expression>` when it has one, the `about` when it has one, `rules: <ids>` when it lists rules, and `may use: <ids>` when a list is in force (slice three, section 2), `nothing` for an empty one, with ` (from <ancestor>)` when the list is inherited. Parts that are absent are left out with their separator.
- A blank line, `Rules`, then one line per rule in the order the law writes them: the id, `script` or `reviewer`, `advisory` when it is, `on no type` when no type lists it, and the `why`.
- A blank line and the last line, `More: lawcheck docs`.

The law part of R (slice two), whose third rule is a reviewer rule:

```
The law here: 4 types, 3 rules
source  src/**/*.ts, !src/**/*.d.ts  Everything that ships.  rules: no-todo
  library  src/core/**  Code the commands call.  rules: no-console, clear-errors
  command  src/cli/**  The command layer.
script  tools/**/*.{mjs,js}  content: ^#!  Executable helpers.  rules: no-todo

Rules
no-console  script  Only the command layer writes to the terminal.
no-todo  script  advisory  A TODO without an issue number gets forgotten.
clear-errors  reviewer  An error a caller sees says what happened and what to do next.
```

The type lines of U (slice three), with lists of its own and inherited:

```
source  src/**/*.ts, !src/**/*.d.ts  Everything that ships.  rules: no-todo  may use: library
  library  src/core/**  Code the commands call.  rules: no-console  may use: library (from source)
  command  src/cli/**  The command layer.  may use: command, library
script  tools/**/*.{mjs,js}  content: ^#!  Executable helpers.  rules: no-todo  may use: source
```

**The budget.** The whole output, its final line end included, holds at most 8,000 characters, counted as code points. When step 1 does not fit, the law part takes the first step that does:

1. everything, as above;
2. each `about` and each `why` longer than 60 characters cut to its first 59 and `…` (U+2026);
3. as step 2, and the rule lines without their `why`, and the lines of subtypes (indented ones) without their paths and `content`;
4. only the root types, each as its id, paths, `content`, `about` cut as in step 2, `subtypes: <n>` (all levels below it) and `rules: <n>` (the distinct rules it and its subtypes list), a count of zero left out; after `Rules`, one line `<ids joined by ", ">`. When even this does not fit, the rule line is first cut to the ids that fit with no type line, ending `, and <n> more`; then type lines are added in order while they fit, followed by `... and <n> more root types`.

After steps 2 to 4 the last line is `shortened to fit; lawcheck explain --type <id> shows a type in full, lawcheck explain --rule <id> a rule`, in place of `More: lawcheck docs`.

**A law that cannot be read.** `usage` prints its error alone. `no-git`, `law-invalid` and the rule-file rows print the first part with both facts (the law could not be read for them), a blank line, then slice one's error output with at most 20 error lines (`why:` lines not counted) and, past them, `... and <n> more errors (lawcheck check lists all)`, and exit 2. Test 17's case prints the first part, a blank line and test 17's output, whose last line reads `next: fix .lawcheck/law.yaml, then run lawcheck prime again` (section 2).

**JSON.** `{ "schema": "lawcheck-prime/0", "text": <the whole text output>, "step": <1 to 4, or null without a law>, "characters": <its length in code points> }`. Exit 2 prints `lawcheck-error/1`.

## 5. `try`

`lawcheck try <rule> [<target>...]` runs one rule on chosen files. It is how a rule is tried before a type lists it, without a base and without a fixture in the repository. Lawcheck writes nothing in the repository: no verdict, no failure cache, nothing in `.lawcheck/.local/`. A script rule is still the repository's code and can do what slice one, section 3, says the runner does not stop.

**Arguments.** The first word that is no flag is the rule; every other such word is a target. The rule is a rule id of the law; anything else is `usage`, naming the nearest id within two edits, and a built-in code such as `forbidden-use` is `usage` saying that `lawcheck check` judges it. `--times <n>` (at least 1), `--dry-run` and `--max-calls <n>` go only with a reviewer rule, and `--max-calls` not with `--dry-run`; otherwise they are `usage`.

**Targets.** A target that names a file of slice one's section 2, from the current directory, is that file. Any other target holding `*`, `?` or `{` is a pattern of slice one's syntax, checked as slice one checks a pattern of the law (`usage` when it breaks those rules), matched against paths from the root after the current directory's path from the root and `/` are put in front of it; it selects the files of slice one's section 2 that match it, binary ones left out. Any other target is a path: a file, which must be one of those files and not binary, or a directory, which selects those files below it at any depth, binary ones left out. An empty target, and an empty path given to `explain`, is `usage` (`an empty path names no file`). A target that selects no file is `usage`, saying why (`git ignores it or it does not exist`, `it is binary`, `matches no file`). The chosen files are the union, each once, in path order.

Without a target, a script rule takes every file it binds through its type; one that binds none is `usage`, asking for the files to try it on. A reviewer rule takes files alone: no target, a directory or a pattern is `usage`, so every file sent to the reviewer is one the person named.

**Script rules** run as in `check`: slice one's runner, one call per chosen file, in path order, `repo.filesOf` over every typed file. The one change to the contract: `try` may hand a rule a file with no type, whose `type` is `null`. A rule that breaks is `rule-crashed`, exit 2.

**Reviewer rules** are asked as `check --review` asks them (slice two, sections 4, 6 and 7): the same prompt for each file, its waived lines included, so the answer is the one `check` would get; the same reading of the answer, the same resends and the same cap, from `reviewer.max_calls` or `--max-calls`, counting every request. Each chosen file is asked `--times` times, 1 by default. Nothing is read from `.lawcheck/verdicts` or the failure cache, and nothing is written to them. Before the first call, in this order: each chosen file whose prompt is larger than `reviewer.max_chars` is `too-large-to-review` at the file, exit 2; then slice two's three checks (`reviewer-not-configured`, `too-many-reviews` counting files times `--times`, `reviewer-unreachable`). The line on standard error before the calls is slice two's.

`--dry-run` makes no call and checks nothing before one, the cap and the provider included: it prints the calls and the size of each prompt.

**Waivers** work as in `check`: a finding on a line that a valid waiver of its rule covers is dropped and counted. Waiver problems are `check`'s and are not shown.

**Output.** The first line, then a blank line and the findings in `check`'s grammar, `error` for an `enforced` rule and `warning` for an `advisory` one, whatever the file; `why:` after the first finding of the run; sorted by file and line; at most 50 finding lines, other lines not counted, then `... <n> more findings (--json lists all)`. No `next:`. The first line:

```
lawcheck: try <rule> (<script|reviewer> rule, <status>)  <f> findings in <k> of <n> files<waived><calls>
```

`nothing found in <n> files` stands for the counts when `f` is zero, and nothing follows the line. `<waived>` is `, <w> waived` and `<calls>` is `, <c> reviewer calls`, each left out at zero.

With `--times` above 1 the counts are `<a> answers for <n> files: <x> fail, <y> pass`, an answer counting as a fail when a finding is left after waivers; then a blank line and, per file and answer, `<file>  answer <k> of <t>: fail` or `: pass`, each fail followed by its findings. With `--dry-run` the counts are `dry run: <c> reviewer calls, none made`, then a blank line and one line per file, `<file>  <t> calls, a prompt of <m> characters`, or `<file>  too large: a prompt of <m> characters; reviewer.max_chars is <x>`, which counts no call.

**Exit.** 0 when no finding is left, 1 when one is, whatever its status and in any answer, and 2 when the run could not be made. A dry run exits 0.

**Examples.** In S, `lawcheck try no-console` exits 1:

<!-- example: try-script -->
```
lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 2 files

src/core/price.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
```

In R with F added and the fake reviewer of slice two, `lawcheck try clear-errors src/core/refund.ts` exits 1. The fake fails lines 2 and 4, and the waiver on line 3 drops line 4:

<!-- example: try-reviewer -->
```
lawcheck: try clear-errors (reviewer rule, enforced)  1 finding in 1 of 1 file, 1 waived, 1 reviewer call

src/core/refund.ts:2  error[clear-errors]  the message says neither what happened nor what to do next
  why:  An error a caller sees says what happened and what to do next.
```

The same with `--times 2` exits 1:

<!-- example: try-times -->
```
lawcheck: try clear-errors (reviewer rule, enforced)  2 answers for 1 file: 2 fail, 0 pass, 2 waived, 2 reviewer calls

src/core/refund.ts  answer 1 of 2: fail
src/core/refund.ts:2  error[clear-errors]  the message says neither what happened nor what to do next
  why:  An error a caller sees says what happened and what to do next.
src/core/refund.ts  answer 2 of 2: fail
src/core/refund.ts:2  error[clear-errors]  the message says neither what happened nor what to do next
```

The same with `--dry-run --times 3` exits 0:

<!-- example: try-dry-run -->
```
lawcheck: try clear-errors (reviewer rule, enforced)  dry run: 3 reviewer calls, none made

src/core/refund.ts  3 calls, a prompt of 2127 characters
```

**JSON.** `lawcheck-try/0`:

| Key | Value |
|---|---|
| `rule` | the rule's id |
| `files` | the chosen files' count |
| `summary` | `{ "findings", "files_with_findings", "waived", "calls_made" }`: findings and waived over every answer, the files with a finding in any answer |
| `runs` | one item per file and answer, sorted by file, then `attempt`: `{ "file", "attempt", "verdict", "findings", "waived", "answer", "prompt_chars" }`. `findings` holds `{ "line", "message", "severity" }` after waivers, `line` absent for a whole file. For a script rule `attempt` is 1 and `verdict`, `answer` and `prompt_chars` are null. For a reviewer rule `verdict` is `pass` or `fail` after waivers, `answer` the reviewer's whole answer, `prompt_chars` the prompt's size. In a dry run `findings` is empty and `verdict` and `answer` null |
| `next` | null |

## 6. `explain`

`lawcheck explain <path>` says why a file has the law it has. `--type <id>` and `--rule <id>` explain a type or a rule instead. Exactly one of the three is given; anything else is `usage`, and so is an id the law lacks, naming the nearest within two edits. It runs no rule, calls no reviewer, reads no use and writes nothing. It ends with 0 when it answered and 2 when it could not; never with 1.

### A file

The path names a file that exists, or one that does not exist yet. Only that file is typed, so a `type-overlap` elsewhere does not stop it, and its own overlap is part of the answer.

```
<path>[  (does not exist yet)]
  type:  <id>  (<the chain from the root type, joined by " > ">)[  <about>]
  matched:  <type> by "<pattern>"[ and content "<expression>"], ...[, not <subtype>: content "<expression>" does not match]
  [then:  <alternatives>]
  may use:  <list>[  (from <ancestor>)]
  [uses:  read as <language> | not read: Lawcheck has no reader for this file]
  rules:  none | one line per rule below
    <id>  <script|reviewer>  <status>  from <type>[  <review>]  <why>
  waivers:  none | one line per waiver below
    <path>:<line>  <rule>  <reason>
```

- `matched` names, for each type of the chain, the first plain pattern of its `paths`, in the law's order, that the path matches, and its `content` when it has one; then, for a file that exists, each subtype of the deepest type whose paths match and whose content does not.
- `may use` is the list in force, its ids joined by `, `, `nothing` for an empty list, with the ancestor it comes from when inherited; without a list, `any file; no type on the way up has may_use`. `uses` comes only when a list is in force, and says what slice three's section 3.2 decides for this file; the language is the reader's id (`typescript`).
- `rules` holds every rule that binds the file, in the order of the chain and then of each type's list, a rule listed twice once, at the first type that lists it. `<review>` comes for a reviewer rule of a file that exists, from slice two's state of a review: `reviewed`, `failed earlier`, `too large to review` or `not reviewed`.
- `waivers` lists the counted waivers of the file (slice one, section 5) with their own line. A file that does not exist has no `waivers` line.

**A file with no type** prints its path line and one `type:` line, `none: <reason>`, the first reason that holds in the order of the table, which is the order slice one types a file in. A symbolic link is one whatever it points at, a directory included.

| Case | Reason |
|---|---|
| a directory on its path is a symbolic link | `it lies behind a symbolic link, which has no type` |
| git ignores it | `git ignores it, so Lawcheck never sees it` |
| a symbolic link | `it is a symbolic link, which has no type` |
| `.lawcheck/verdicts` | `Lawcheck writes this file, and it has no type` |
| no type's paths match | `no type's paths match it, so no rule judges it` |
| binary | `it is binary, which has no type` |
| root types' paths match and their content does not | `it matches the paths of <ids> but not their content, so no rule judges it` |
| two types of one level match | `it matches <a> and <b> at one level (type-overlap); check stops with exit 2 until a ! pattern in one of them leaves it out` |

**A path in another case.** On a file system that ignores case, a path that git does not list, that exists, and that is the same file as exactly one path git lists, equal to it but for case, is answered as that path, under the name git lists (`spec/environments.md`, section 6).

**A file that does not exist yet** is typed from its path. A path with a symbolic link among its directories is `none: it lies behind a symbolic link, which has no type`. A path that `git check-ignore -q --no-index -- <path>` reports (exit 0) is `none: git ignores this path, so Lawcheck would never see it`. This and `init`'s `git rev-parse --show-prefix` are the two git commands this slice adds. Otherwise the tool walks the tree: at each level it takes the types whose paths match; when that is one type without `content`, it goes down into it; otherwise it stops, and `then:` says what the text decides:

- only types with `content`: `<id> if its text matches "<expression>"` for each, joined by `; `, ending `; otherwise <the deepest type so far, or none>`;
- one type without `content` beside them: `a type-overlap of <that type> and <id> if its text matches "<expression>"` for each, ending `; otherwise <that type>`;
- two or more types without `content`: `any file here matches <ids> at one level (type-overlap)`.

When the stop is at the root level, there is no type yet: the `type:` line is `depends on its text: <the alternatives>` in the first two cases and `none: <the third>` in the last, and no other line follows. Otherwise the lines are those of the types above the stop, with `then:` after `matched`.

**Examples.** In S, `lawcheck explain src/core/price.ts`, and the same as `lawcheck explain price.ts` in `src/core`:

<!-- example: explain-price -->
```
src/core/price.ts
  type:  library  (source > library)  Code the commands call.
  matched:  source by "src/**/*.ts", library by "src/core/**"
  may use:  any file; no type on the way up has may_use
  rules:
    no-todo  script  advisory  from source  A TODO without an issue number gets forgotten.
    no-console  script  enforced  from library  Only the command layer writes to the terminal.
  waivers:  none
```

`lawcheck explain tools/release.mjs`:

<!-- example: explain-release -->
```
tools/release.mjs
  type:  script  (script)  Executable helpers.
  matched:  script by "tools/**/*.{mjs,js}" and content "^#!"
  may use:  any file; no type on the way up has may_use
  rules:
    no-todo  script  advisory  from script  A TODO without an issue number gets forgotten.
  waivers:  none
```

`lawcheck explain tools/build.mjs`, a file that does not exist:

<!-- example: explain-build -->
```
tools/build.mjs  (does not exist yet)
  type:  depends on its text: script if its text matches "^#!"; otherwise none
```

In R with F added, `lawcheck explain src/core/refund.ts`:

<!-- example: explain-refund -->
```
src/core/refund.ts
  type:  library  (source > library)  Code the commands call.
  matched:  source by "src/**/*.ts", library by "src/core/**"
  may use:  any file; no type on the way up has may_use
  rules:
    no-todo  script  advisory  from source  A TODO without an issue number gets forgotten.
    no-console  script  enforced  from library  Only the command layer writes to the terminal.
    clear-errors  reviewer  enforced  from library  not reviewed  An error a caller sees says what happened and what to do next.
  waivers:
    src/core/refund.ts:3  clear-errors  the payment provider matches this exact text
```

In U, `lawcheck explain src/core/price.ts` prints `  may use:  library  (from source)` and `  uses:  read as typescript` in place of S's `may use` line.

### A directory

Every file of slice one's section 2 below it is typed; slice one's `file-unreadable` and `type-overlap` stop the run with exit 2. The first line is the directory with a trailing `/` (`./` for the root) and its file count; then one line per type that is the type of at least one of them, in the law's depth-first order, and `no type` last, each with its count. In S, `lawcheck explain src`:

<!-- example: explain-src -->
```
src/  3 files
  library  2 files
  command  1 file
```

### A type and a rule

Both type every file, as a directory does. `lawcheck explain --type source` in S:

<!-- example: explain-type-source -->
```
type source  (source)  Everything that ships.
  paths:  src/**/*.ts, !src/**/*.d.ts
  may use:  any file; no type on the way up has may_use
  rules:
    no-todo  script  advisory  from source  A TODO without an issue number gets forgotten.
  subtypes:  library, command
  files:  3
    src/cli/main.ts
    src/core/price.ts
    src/core/tax.ts
```

A `content:  <expression>` line follows `paths` when the type has one; the line `  waivers:  not read; a waiver marker in its files is text` follows the rules when the type's files hold no waivers; `subtypes` names the direct subtypes, or `none`; `files` holds the files of the type and its subtypes.

`lawcheck explain --rule no-todo` in S:

<!-- example: explain-rule-no-todo -->
```
rule no-todo  script  advisory
  why:  A TODO without an issue number gets forgotten.
  file:  .lawcheck/rules/no-todo.mjs
  on types:  source, script
  binds:  4 files
    src/cli/main.ts
    src/core/price.ts
    src/core/tax.ts
    tools/release.mjs
```

For a reviewer rule a `context:  <paths joined by ", ">` line follows `file` when the rule has `context`, and `binds` reads `<n> files; <m> have a verdict for their content`, `has` when `m` is 1. A rule no type lists reads `on types:  none; it judges no file until a type lists it` and `binds:  0 files`. Both lists of files show at most 50, then `    ... <n> more (--json lists all)`.

### JSON

`lawcheck-explain/0`, with `subject` one of `file`, `directory`, `type`, `rule`:

| Subject | Keys after `schema` and `subject` |
|---|---|
| `file` | `path`, `exists`, `type` (id or null), `chain` (ids from the root), `about`, `none` (the reason, or null), `matched` (`{ "type", "pattern", "content" }`), `not_matched` (`{ "type", "content" }`, the `not <subtype>` parts), `then` (the text after `then:` or `depends on its text:`, or null), `may_use` (`{ "types", "from" }` or null), `uses` (`{ "read", "language" }` or null), `rules` (`{ "id", "kind", "status", "why", "from", "review" }`, `review` one of `reviewed`, `failed`, `too-large`, `not-reviewed`, or null), `waivers` (`{ "line", "rule", "reason" }`, `[]` for a file that does not exist) |
| `directory` | `path` (with its trailing `/`), `files`, `types` (`{ "type", "files" }`, `type` null for no type) |
| `type` | `id`, `chain`, `about`, `paths`, `content`, `may_use` and `rules` shaped as for a file, `rules` without `review`, `subtypes`, `waivers` (false when the type's files hold no waivers, slice one's section 2), `files` (every one) |
| `rule` | `id`, `kind`, `status`, `why`, `file`, `context` (paths or null), `types`, `files` (every one), `reviewed` (a count, or null for a script rule) |

A file with no type, an overlap included, has `type`, `about`, `then`, `may_use` and `uses` null and `chain`, `matched`, `not_matched`, `rules` and `waivers` empty. A path that does not exist yet whose type depends on its text at the root level has `type` and `none` null and its alternatives in `then`. Absent parts are null, never left out.

## 7. `docs`

`lawcheck docs [<topic>] [--json]` prints the tool's reference, one topic at a time. It needs no law, no git and no network, and never ends with 1. Each topic is a file `docs/<topic>.md` of the repository, shipped in the package (`"files"` gains `docs`), printed as it is. The same files are the published documentation, so the two cannot disagree. An unknown topic is `usage`, naming the nearest within two edits; more than one word is `usage`.

Without a topic, exit 0:

```
lawcheck docs: 12 topics; lawcheck docs <topic> prints one

first-law  The first type and the first rule
law  The law file
change  What a check judges
script-rules  Script rules
reviewer-rules  Reviewer rules
waivers  Waivers
config  Settings
providers  Reviewers and keys
languages  Languages and uses
ci  CI and git hooks
json  JSON documents
codes  Codes
```

A page's first line is `# <its title>`. A page holds at most 8,000 characters, so an agent can read one whole. Each describes what is built, and only that, which the reviewer checks by reading; no page names another tool; what each must hold:

| Topic | Holds |
|---|---|
| `first-law` | `init`; one type with `paths` and `about`; one script rule, its entry and its file; `try` on a file that fails and one that passes; listing the rule on the type; `check --full` for the debt; the choice between paying the debt and `status: advisory` |
| `law` | every key of `law.yaml` this release reads, with its values; ids; patterns; how a file gets its type, and `type-overlap`; `may_use` and the list in force; rule files and `rules/lib/`; the reserved ids |
| `change` | the base and the order it is taken in; what the change is; `--full` and debt; the exit codes; and, word for word, the paragraph below |
| `script-rules` | the contract of slice one, section 3, with `type` null under `try`; what the runner stops and what it does not; what makes a rule `rule-crashed` |
| `reviewer-rules` | the rule file; what the reviewer receives and must answer; verdicts, what re-opens one and what does not; the failure cache; `--review`, `--again`, `--max-calls`; `try --times` and `--dry-run` |
| `waivers` | the form, what it covers, the reason, `forbidden-use`, the three waiver codes, how waivers are counted |
| `config` | every key of `.lawcheck/config.yaml` with its default and bounds, and what is refused there |
| `providers` | the nine providers, the variables, where a key goes, what leaves the machine, `doctor --reviewer` |
| `languages` | the languages whose uses are read, by extension; the languages that read declarations of other files; unresolved uses; `uses-not-read` |
| `ci` | a CI job with history deep enough for the merge base and `--base`; a git pre-commit hook; that no key is needed; that a check runs the repository's script rules, so it runs only where the tests would |
| `json` | every schema the tool prints, with its keys |
| `codes` | one Markdown table with the columns Code, Kind, When and Why, one row per code the tool can print, the code in backticks, Kind `finding` or `exit 2`, and Why its fixed why word for word |

The paragraph of `change`:

> A plain check judges only the files that differ from the base. Three kinds of change can alter a judgment without changing the file judged: a change of the law (`.lawcheck/law.yaml` or a rule file); a file whose new text moves it to another type, which changes the judgment of every file that uses it; and a file the language readers consult, such as `tsconfig.json`, `package.json`, `go.mod`, `Cargo.toml`, `composer.json` or a C# project file. Each passes a plain check, and the files it affects are judged the next time they change. This is deliberate: the default judges the change, and code nobody touched never turns a build red. To judge everything after such a change, run `lawcheck check --full`; what it finds outside the change is listed as debt and blocks nothing. When the change touches the law, `check` and `doctor` say so.

Pages are checked by test 129: every fenced `yaml` block whose first line starts with `lawcheck:` is a law that the reading of `law.yaml`'s text alone (`parseLaw`) accepts with no problem, so an example's `context` needs no file; every fenced `yaml` block of `config` and `providers` is a settings file that slice two's reading accepts, and a refused setting is shown in a `text` block; every line of a fenced block that starts with `$ lawcheck ` is a command line the tool's argument reading accepts, so examples are real ones (`--max-calls 3`, not `--max-calls <n>`).

**JSON.** Without a topic, `{ "schema": "lawcheck-docs/0", "topics": [{ "id", "title" }] }`; with one, `{ "schema": "lawcheck-docs/0", "id", "title", "text" }`.

## 8. `doctor`, and a change of the law

### `doctor`

`lawcheck doctor [--base <ref>] [--reviewer] [--json]` says what is wrong with this setup, with one next step for each problem. Where `spec/environments.md`, section 3, refuses the environment, the first line of `doctor` is that refusal's, `lawcheck: ERROR  <message>`, as for every other command, and the nine checks still run below it: the `node` check fails with the refusal of the runtime, the `git` check with that of git. It goes through nine checks in this order and stops at none. A check runs only when the checks it waits for passed, `ok` and `note` counting as passed; otherwise it is `skip`. Lawcheck writes nothing in the repository, and without `--reviewer` it opens no connection and starts no reviewer program. It works without a law and outside git. Exit 0 when no check is `fail`, 2 otherwise; never 1.

| Check | Waits for | `ok` | `note` or `fail`, with its `next:` |
|---|---|---|---|
| `node` | | `Node <version>; Lawcheck needs 24 or later` | fail where `spec/environments.md`, section 3, refuses the runtime, with that message and next line, worded for `doctor` |
| `git` | | `a git work tree`, then `, and the law's root is its top` or `, and the law's root is <prefix> below its top` when a law is found, the prefix as git prints it | fail below git 2.34 with the refusal of `spec/environments.md`, section 3; fail: git's message, as `no-git` has it, with the next line `no-git` has (check slice, section 6), worded for `doctor`; `run lawcheck doctor inside a git work tree, with git on the PATH` otherwise |
| `law` | `git` | `.lawcheck/law.yaml: <t> types, <r> rules (<s> script, <v> reviewer)` | fail without a law: `no .lawcheck/law.yaml in this directory or any above it`, next `lawcheck init  (only when the user wants a law here)`; when git lists laws below, the message gains `not-initialized`'s ending and the next line is `cd <the first>, where a law is, then run lawcheck doctor again` (check slice, section 6); fail on the first error of `law-invalid` and the rule-file rows, whatever the config holds: `<place>  <message>`, `; and <n> more` when there are more, with that error's `next:` |
| `config` | `git` and a law file | `no .lawcheck/config.yaml; every setting has its default`, or `.lawcheck/config.yaml: no reviewer set`, or `.lawcheck/config.yaml: reviewer <provider>`, and `, model <model>` when set | fail on the first `config-invalid`, as for `law`. When the config names a runner, the program it starts first (`lawcheck`, `npx`, `pnpm`, `yarn` or `bun`) is looked up on `PATH`: found, `; runner <name>, <program> at <path>` ends the `ok` message; missing, fail with `.lawcheck/config.yaml: runner <name>, and <program> is not on the PATH`, next `install <program>, or set runner to the way this repository starts Lawcheck, then run lawcheck doctor again` |
| `types` | `law` | `<t> of <n> files have a type`, `has` when `t` is 1 | fail on `file-unreadable` or `type-overlap`: the first, and the count |
| `base` | `git` and a law file | `<base>, from --base` (or `from LAWCHECK_BASE`, `from origin/HEAD`), `; the change holds <n> files` | note without a base: `no base: no --base, LAWCHECK_BASE or origin/HEAD, so a plain check counts every file as changed`, next `pass --base <branch>, or set LAWCHECK_BASE`; in a CI job without a base, and on `base-unreachable`, fail with its message and `next:` (check slice, section 4) |
| `law-change` | `base` | `the change does not touch the law`; without a base, `no base, so a plain check judges every file` | note: `the change touches the law: <paths>; a plain check judges only the files that changed`, at most three paths and then `and <n> more`; next `lawcheck check --full  (lists what the law finds in the rest of the code, as debt)`, with ` --base <ref>` after `--full` when `doctor` was given one |
| `readers` | `types` | `no type has may_use, so no use is read; the 13 grammars load`, or `uses are read in <n> files: <language> <count>, ...; the 13 grammars load`, the languages sorted by id | note when files of the run of `check --full` would count toward `uses-not-read`: their count in total and their extensions, worded as slice three words one type's, then `, so check warns uses-not-read`, next `lawcheck docs languages`; fail when a grammar does not load: slice three's message and `next:` for it |
| `reviewer` | `law` and `config` | `no reviewer rule, so no reviewer is needed`, or `<r> reviewer rules; <provider> can be called (lawcheck doctor --reviewer makes one call)`, for `ollama` `can be called at <address>` after its server answered `GET <address>/api/version` with 200, or with `--reviewer`, `<r> reviewer rules; <provider> answered a test call` | fail with reviewer rules and no provider: `<r> reviewer rules and no reviewer set, so their files stay not-reviewed`, next slice two's for `reviewer-not-configured` with `lawcheck doctor` as the command to run; the other fails start `<r> reviewer rules; <provider> ` and go on `cannot be called: <the reason ready() or the probe of ollama gives>`, next `<the provider's fix>, then run lawcheck doctor`, or `did not answer a test call: <the failure>`, next `<the failure's fix>, then run lawcheck doctor --reviewer`, or `answered with no verdict: <the answer's first 200 characters>`, next `check reviewer.model in .lawcheck/config.yaml, or try another model, then run lawcheck doctor --reviewer`; the fixes are those of `spec/reviewer-slice.md`, section 6 |

A skipped check's message is `needs <the id of the first check it waits for that did not pass>`, or `needs law` when no law file was found. `readers` loads all 13 grammars, so a broken install shows before a check needs one. `--reviewer` with no provider set is a fail, `no reviewer is set, so --reviewer has nothing to call`. With a provider it sends one request, never again, outside every cap, `reviewer.max_calls: 0` included, because the flag asks for it; its whole prompt is:

```
Answer with this JSON object and nothing else: {"verdict": "pass", "findings": []}
```

and reads the answer by slice two's rules for a file of no lines; anything but a pass is a fail.

**Output.** The first line, a blank line, then one line per check, `<state>  <id>  <message>`, and under each `note` and `fail` one line `  next: <text>`. No other `next:`. Counts take the singular for 1, as everywhere. The first line is `lawcheck: PASS  9 checks`, or `lawcheck: FAIL  9 checks, <p> problems`, followed by `, <n> notes` when there are notes.

In S on `work`, nothing changed, `lawcheck doctor --base main` exits 0; the `node` line carries the version that runs:

```
lawcheck: PASS  9 checks

ok  node  Node 24.22.1; Lawcheck needs 24 or later
ok  git  a git work tree, and the law's root is its top
ok  law  .lawcheck/law.yaml: 4 types, 2 rules (2 script, 0 reviewer)
ok  config  no .lawcheck/config.yaml; every setting has its default
ok  types  4 of 8 files have a type
ok  base  main, from --base; the change holds 0 files
ok  law-change  the change does not touch the law
ok  readers  no type has may_use, so no use is read; the 13 grammars load
ok  reviewer  no reviewer rule, so no reviewer is needed
```

The same in S with `# a note` appended to `.lawcheck/law.yaml` on `work` exits 0, with these lines in place of the first and of `base` and `law-change`:

```
lawcheck: PASS  9 checks, 1 note
ok  base  main, from --base; the change holds 1 file
note  law-change  the change touches the law: .lawcheck/law.yaml; a plain check judges only the files that changed
  next: lawcheck check --full --base main  (lists what the law finds in the rest of the code, as debt)
```

**JSON.** `{ "schema": "lawcheck-doctor/0", "result": "pass" or "fail", "checks": [{ "id", "state", "message", "next" }] }`, `next` being `{ "command", "text" }` or null. `command` is the command alone (`lawcheck check --full --base main`, `lawcheck init`, `lawcheck docs languages`) where the next step is one, else null.

### A change of the law

Slice three's section 3.2 found that a change that only touches the law, or a file whose new text moves it to another type, or a file the readers consult, judges nothing beyond the files that changed, and the open question about the default mode left it to the owner. The owner has ruled that the default judges only the change and that the gap is deliberate. This slice keeps that default and does not widen the run. What it adds is that the gap is said where it bites:

- **`check`.** When a run has a base and its change holds `.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a file under `.lawcheck/rules/`, the run says so, and it changes no count and no exit code. A run that ends with 2 does not print it. Without `--full`, the line right after the first is `note: the law changed in this change; lawcheck check --full shows what it finds in the rest of the code`, with ` --base <ref>` after `--full` when the run was given one. In every mode, a line after that one says what the change does to the law that judges it (the next item). The JSON document gains `scope.law_changed`, true when a base exists and the change holds such a file, in every mode, and `scope.law_changes`, the list of the sentences below, present only when `law_changed` is true.
- **What the change does to the law** (S7-3). In the open mode a pull request can change the law that judges it, so the line is `note: this change edits the law that judges it: <items>`, the items joined by `; `, at most five, then `; and <n> more` for the rest. The base is the merge base of `HEAD` and the run's base; the law now is the work tree's. An item is, in this order: `removes the type <id>` for each type of the base's law that the law lacks, by id; `adds the type <id>`; `removes the rule <id>`; `adds the rule <id>`; `makes the rule <id> advisory` or `makes the rule <id> enforced` for a rule whose status changed; then for each type in both, by id: `takes the rule <id> off the type <id>` and `puts the rule <id> on the type <id>` (only for a rule both laws define), `changes the paths of the type <id>`, `changes the content of the type <id>` and `changes may_use of the type <id>`; then, by path, `adds <path>`, `removes <path>` or `changes <path>` for each file under `.lawcheck/rules/`, and the same for `.lawcheck/config.yaml`. A `.lawcheck/law.yaml` whose text changed and tells none of the above is `edits .lawcheck/law.yaml without changing a rule or a type`; one that either side cannot parse is `changes .lawcheck/law.yaml`. The tool reads the base's files with git and compares what they say, never what a script does: a rule script that changed is `changes <path>`, whatever the change does.
- **`doctor`**, its `law-change` check above.
- **`prime`**, its line that starts `A plain check judges`.
- **`docs change`**, the paragraph of section 7, which also names the two kinds of change no line reports: a file moved to another type by its text, and a file the readers consult.

In S on `work` with `# a note` appended to `.lawcheck/law.yaml`, `lawcheck check --base main` exits 0:

```
lawcheck: PASS  1 changed file (against main)
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
note: this change edits the law that judges it: edits .lawcheck/law.yaml without changing a rule or a type
```

## 9. Decisions taken here

1. **The default mode stays, and the gap is said where it bites** (section 8). The owner's ruling holds: a plain check judges the change, and code nobody touched never turns a build red. Widening the run on a law change would make every new rule fail on the debt it finds. So `check` prints the design's `note:` line, which slice one left out, `doctor` reports it, `prime` teaches it, and `docs change` states all three kinds of gap, the two that no line reports included.
2. **`init` starts the law in the current directory, and refuses wherever a law already governs it.** A package of a larger repository may hold its own law (slice one, decision 9), and a second law above or below an existing one would split the rules of one file between two laws, so it refuses a law below as well, found in git's file list. It writes only what is absent, with the exclusive flag, so a repository that has a law keeps every byte.
3. **`init` writes no `config.yaml`**, where the brief asked it to lay down the config. The design's default is no file: every setting has a default, a fresh law needs no reviewer, and a commented copy of the settings would be a second reference to keep in step with `docs config`. `check` names the two lines to add when a reviewer rule first needs them. `.gitignore` names `config.local.yaml`, which no slice reads yet, so a key put there later is never committed.
4. **`try` takes one rule, and no `--all`.** Every rule on every file is `check --full`, and every rule on chosen files is the design's `check <paths>`; a second form of either would have to be kept in step with it. A reviewer rule takes files the person names, one by one: each costs a call, and the reviewer is sent only what was asked for.
5. **`try` reads no verdict and no cache and writes nothing.** It asks afresh, with `check`'s prompt, so it shows what `check --review` would get. A pass it pays for is not recorded: recording it would make `try` a second way to write the verdicts file.
6. **A script rule without paths takes the files it binds**, in place of the design's `try --type` and `check --full --rule`: one flag fewer, and "what does this rule find everywhere" needs no base and costs nothing.
7. **A file with no type reaches a script rule with `type` null, under `try` alone**: a rule is tried on files before a type covers them.
8. **`try` exits 1 on any finding, whatever its status**, as the design says, and a file too large to send stops the run before any call: a file the reviewer could not see was not tried.
9. **`explain` reads and never runs**: no script, no reader of uses, no reviewer. It answers in a fraction of a second, has no side effect, and exits 0 when it answered, the overlap of the file asked about included, because that answer is what fixing it needs.
10. **`explain` on a path that does not exist goes down while the path alone decides**, and lists the alternatives where the text decides. It adds one git command, `check-ignore --no-index`, so an agent is never told that a path git ignores will be judged.
11. **`prime` reads the law, the list of rule files, the reviewer rules' files and the first bytes of each `context` file, nothing else.** It keeps the design's budget and four steps, adds a last guard, and bounds the errors it prints, so 8,000 characters are never passed. It drops "Start it as", since `runner` is out. With a broken law it still prints the first part, so the agent learns the loop and the error together.
12. **The reference pages are files of the repository**, shipped and published as they are, and test 129 holds them to the code: the codes and their whys, every example law and setting, every command line. The topics are the design's, less the update documents, plus `change`, which states the gap. `codes` is checked row by row against the code's table, so it needs no generator.
13. **`doctor` has four states, and only `fail` makes exit 2**: a missing base, a law change and unread files are notes, because `check` runs with each. It loads every grammar, so a broken install shows before a check needs one, and its test call is one small request outside every cap.
14. **No `--no-color`**: nothing is coloured, and a flag that changes nothing is not added.
15. **Every new document is `/0`**, as `lawcheck-check/0` is: none matches a `/1` of the design.
16. **One new code, `already-initialized`**, and one usage per command; `lawcheck --help` now describes the program.

## 10. What changes in the earlier slices

- Slice one, section 1: the other commands are in. Section 3: `type` may be null under `try`. Slice two, section 6, "What leaves the machine": under `try`, a judged file is a file named on the command line, among section 2's files and not binary, typed or not. Section 4: the usage of the program; test 44 now expects `usage: lawcheck <command> [<arguments>] [--json]` as the first line of `lawcheck --help`, and still check's line for `lawcheck check --help`; the messages of test 43's `usage` errors name the seven commands. Section 6: the `note:` line of section 8, and `scope.law_changed` in every `lawcheck-check/0`.
- `scope` gains `law_changed` as its last key. The expected documents gain `"law_changed": false`: tests 41, 75, 82 and 88, and the unit test of `tests/unit/output.test.ts` that compares `scope`. The unit test "version and help exit 0" of `tests/unit/cli.test.ts` expects the program's usage from `lawcheck --help`.
- Slice two, test 74: `lawcheck --help` as test 44 now expects.
- Slice three, section 1: `doctor` and `explain` naming a file's language are in.
- The reserved rule ids gain `already-initialized`.
- `package.json`'s `"files"` gains `docs`.
- No earlier test runs a plain check with the law in its change and compares its whole output: tests 20 and 70 put the law in the change and assert codes, or run with `--full`.

## 11. Acceptance tests

The earlier slices' terms hold: S, R, U, D, E, F, F', the fake, the fake claude and the copy. Each test on S, R or U starts from it in a new git repository, one commit on `main`, then branch `work`, and a change to the law, the config or a rule file is a second commit on `main` before `work` unless the test says "on `work`". "A new repository" is a new git repository in a `mktemp -d` folder with one commit on `main` holding `README.md`. Every run in R has `LAWCHECK_REVIEWER_ENDPOINT` set to the fake's `/v1` unless the test says otherwise, as in slice two. "No request" means the fake recorded none. The `node` line of `doctor` is compared with `^ok  node  Node \d+\.\d+\.\d+; Lawcheck needs 24 or later$`.

| # | Do | See |
|---|---|---|
| 96 | a new repository: `git config --list --local`; `lawcheck init`; `git status --porcelain`; `git config --list --local` again; then `lawcheck check` | section 3's output, exit 0; `.lawcheck/` holds exactly `law.yaml`, section 3's text with the package version, and `.gitignore`, `.local/\nconfig.local.yaml\n`; `?? .lawcheck/` alone; the same lines as before `init`; `lawcheck: PASS  3 files (no base: every file counts as changed)`, exit 0 |
| 97 | one at a time: `lawcheck init` twice in a new repository; `lawcheck init` in S; `lawcheck init` in S's `src/core`; `lawcheck init` at the top of a new repository whose commit holds `packages/api/.lawcheck/law.yaml` with section 3's text | `error[already-initialized]` at `.lawcheck/law.yaml`, exit 2, both files byte for byte as the first run wrote them; exit 2 with `already-initialized` and no `.lawcheck/.gitignore`; exit 2 with `already-initialized` at `../../.lawcheck/law.yaml` and no `src/core/.lawcheck`; exit 2 with `already-initialized` at `packages/api/.lawcheck/law.yaml` and no `.lawcheck` at the top |
| 98 | one at a time: a new repository whose commit also holds `.lawcheck/.gitignore` with `x\n`, `init`; a new repository, `init` in a new folder `packages/api`; `init` in a `mktemp -d` folder outside git | `lawcheck: created .lawcheck/law.yaml; kept .lawcheck/.gitignore` and the file still `x\n`, exit 0; a second line `note: the law covers only the files below packages/api/` and the law at `packages/api/.lawcheck/law.yaml`, exit 0; `error[no-git]`, exit 2, no `.lawcheck` |
| 99 | `init --json` in a new repository; `init x`; `init --full`; then in S a rule `already-initialized` with `why: x` and its file, `lawcheck check --base main` | `{ "schema": "lawcheck-init/0", "root": "", "created": [".lawcheck/law.yaml", ".lawcheck/.gitignore"], "kept": [], "next": { "command": null, "text": "describe your first file type in .lawcheck/law.yaml  (lawcheck docs first-law shows how)" } }`, exit 0; `usage`, exit 2, twice; `law-invalid`, exit 2 |
| 100 | S: `lawcheck prime`; `lawcheck prime --json`; `lawcheck prime` in `src/core` | section 4's output, exit 0; `step` 1, `text` that output, `characters` 1920; section 4's output |
| 101 | `prime` in R; in U | the first part with the three reviewer parts, a blank line, R's law part of section 4, a blank line and `More: lawcheck docs`, exit 0; S's output with the two may_use parts and its four type lines replaced by U's of section 4, exit 0 |
| 102 | `prime` in a new repository; in a `mktemp -d` folder outside git | section 4's two lines, exit 0, each |
| 103 | S with test 17's `statuss`: `prime`; `prime --json`. S whose law also holds rules `x01` to `x25`, each `why: x` and `statuss: y`: `prime`. S whose `no-todo.mjs` throws at load: `prime` | the first part with both facts, a blank line and test 17's output with the last line `next: fix .lawcheck/law.yaml, then run lawcheck prime again`, exit 2; a `lawcheck-error/1` document, exit 2; the first part with both facts, a blank line, `lawcheck: ERROR  25 errors`, a blank line, 20 `error[law-invalid]` lines and their one `why:`, then `... and 5 more errors (lawcheck check lists all)`, a blank line and the `next:` line, exit 2; section 4's output, exit 0 |
| 104 | four laws, each in a new repository with a script rule file `export function check() { return []; }` for every rule, `a` and `w` standing for 200 letters each: (a) root types `t01` to `t20`, each `paths: ["src/tNN/**"]`, `about: a`, `rules: [rNN]`, and rules `r01` to `r20` with `why: w`; (b) one root type `root`, `paths: ["src/**"]`, `about: Root.`, with subtypes `t01` to `t39`, each `paths: ["src/tNN/**"]`, `about: a`, and rules `r01` to `r73` with `why: w` on no type; (c) root types `t01` to `t40`, each `paths: ["src/tNN/**"]`, `about: a`, with three subtypes `tNNa`, `tNNb`, `tNNc` (`paths: ["src/tNN/a/**"]` and so on, `about: a`), and rules `r001` to `r150` with `why: w` on no type; (d) root types `t001` to `t300`, each `paths: ["src/tNNN/**"]`, `about: a`, and rules `r001` to `r300` with `why: w` on no type. `prime --json` in each | `step` 2, 3, 4, 4; `characters` at most 8,000 and equal to the text's length in code points; the text starts with the first part; its last line is `shortened to fit; lawcheck explain --type <id> shows a type in full, lawcheck explain --rule <id> a rule`; in (a) every rule line ends in `…` and every type line holds `…  rules: r`; in (b) no rule line holds `w`; in (c) the type lines hold `subtypes: 3` and no `rules:`; in (d) the law part's first line is `The law here: 300 types, 300 rules`, the line after `Rules` lists `r001` to `r300` whole, no line holds `subtypes:` or `rules:`, and a line `... and <n> more root types` comes before the blank line and the last line |
| 105 | S: `explain src/core/price.ts`; `explain price.ts` in `src/core`; `explain tools/release.mjs`; `explain tools/build.mjs` | section 6's outputs, exit 0 each |
| 106 | S: `explain README.md`; `explain src/core/api.d.ts`; `explain src/core/new.ts`; on `work` add `tools/plain.mjs` holding `console.log(1);`, `explain tools/plain.mjs` | `README.md` and `  type:  none: no type's paths match it, so no rule judges it`; `src/core/api.d.ts  (does not exist yet)` and the same `type:` line; `src/core/new.ts  (does not exist yet)` followed by the `type`, `matched`, `may use` and `rules` lines of section 6's first example and no `waivers` line; `  type:  none: it matches the paths of script but not their content, so no rule judges it`; exit 0 each |
| 107 | S on `work`: add `.gitignore` holding `src/core/gen*.ts` and `src/core/gen.ts`; `explain src/core/gen.ts`; `explain src/core/gen2.ts`; add `src/core/link.ts`, a symlink to `price.ts`, and `explain` it; add `src/core/blob.ts` holding `x` and a NUL byte, and `explain` it | `none: git ignores it, so Lawcheck never sees it`; `src/core/gen2.ts  (does not exist yet)` and `none: git ignores this path, so Lawcheck would never see it`; `none: it is a symbolic link, which has no type`; `none: it is binary, which has no type`; exit 0 each |
| 108 | S with test 16's subtype `pricing`: `explain src/core/price.ts`; `explain src/core/tax.ts`; `explain src` | `  type:  none: it matches library and pricing at one level (type-overlap); check stops with exit 2 until a ! pattern in one of them leaves it out`, exit 0; `  type:  library  (source > library)  Code the commands call.`, exit 0; `error[type-overlap]` at `src/core/price.ts`, exit 2 |
| 109 | S with a subtype `entry` under `command`, `about: Entry points.`, `paths: ["src/cli/**"]`, `content: "^#!"`: `explain src/cli/main.ts`, then with `--json`; `explain src/cli/run.ts` | the line `  matched:  source by "src/**/*.ts", command by "src/cli/**", not entry: content "^#!" does not match`, exit 0, then `not_matched` `[{ "type": "entry", "content": "^#!" }]`; `src/cli/run.ts  (does not exist yet)`, `  type:  command  (source > command)  The command layer.`, `  matched:  source by "src/**/*.ts", command by "src/cli/**"`, `  then:  entry if its text matches "^#!"; otherwise command`, the `may use` line, and `rules` with `no-todo  script  advisory  from source` alone; exit 0 |
| 110 | U: `explain src/core/price.ts`; `explain src/cli/main.ts`; U with `may_use: []` on `source`, `explain src/core/price.ts` | `  may use:  library  (from source)` and `  uses:  read as typescript`; `  may use:  command, library` and `  uses:  read as typescript`; `  may use:  nothing  (from source)`; exit 0 each |
| 111 | R, on `work` add F: `explain src/core/refund.ts`; then `lawcheck check --review --base main` and `explain` again. R with F' added: `check --review --base main`, then `explain`. R with `max_chars: 100` in the config and F added: `explain` | section 6's output; the same with `failed earlier` for `not reviewed`; `reviewed`; `too large to review`; exit 0 each, and no `explain` sends a request |
| 112 | S: `explain src`; `explain .`; `explain --type source`; `explain --rule no-todo`. R: `explain --rule clear-errors` | section 6's output; `./  8 files`, `  library  2 files`, `  command  1 file`, `  script  1 file`, `  no type  4 files`; section 6's; section 6's; the line `  context:  docs/errors.md` after `file`, and `  binds:  2 files; 0 have a verdict for their content`; exit 0 each |
| 113 | S: `explain`; `explain a b`; `explain --type nope`; `explain --rule no-tod`; `explain --type source --rule no-todo`; `explain ../outside`; `explain --type` | `usage`, exit 2, each; the fourth names `no-todo` |
| 114 | S: `explain src/core/price.ts --json`; `explain README.md --json`; `explain src --json` | `{ "schema": "lawcheck-explain/0", "subject": "file", "path": "src/core/price.ts", "exists": true, "type": "library", "chain": ["source", "library"], "about": "Code the commands call.", "none": null, "matched": [{ "type": "source", "pattern": "src/**/*.ts", "content": null }, { "type": "library", "pattern": "src/core/**", "content": null }], "not_matched": [], "then": null, "may_use": null, "uses": null, "rules": [{ "id": "no-todo", "kind": "script", "status": "advisory", "why": "A TODO without an issue number gets forgotten.", "from": "source", "review": null }, { "id": "no-console", "kind": "script", "status": "enforced", "why": "Only the command layer writes to the terminal.", "from": "library", "review": null }], "waivers": [] }`; `{ "schema": "lawcheck-explain/0", "subject": "file", "path": "README.md", "exists": true, "type": null, "chain": [], "about": null, "none": "no type's paths match it, so no rule judges it", "matched": [], "not_matched": [], "then": null, "may_use": null, "uses": null, "rules": [], "waivers": [] }`; `{ "schema": "lawcheck-explain/0", "subject": "directory", "path": "src/", "files": 3, "types": [{ "type": "library", "files": 2 }, { "type": "command", "files": 1 }] }`; exit 0 each |
| 115 | R whose `no-console.mjs` throws at load, on `work` add F: `explain src/core/refund.ts`; `explain --rule clear-errors`; `prime` | exit 0 each, no request |
| 116 | S: `try no-console`; `try no-console src/cli/main.ts`; `try no-todo README.md` | section 5's first example, exit 1; `lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 1 file`, a blank line, `src/cli/main.ts:2  error[no-console]  writes to the terminal with console.log` and its why, exit 1; `lawcheck: try no-todo (script rule, advisory)  nothing found in 1 file`, exit 0 |
| 117 | S: `try no-console src`; `try no-console 'src/**/*.ts'`; in `src`, `try no-console 'c*/*.ts'`; `try no-console src/core/price.ts src/core`; on `work` add `src/core/blob.ts` holding `x` and a NUL byte, `try no-console 'src/core/*'` | the first three: `lawcheck: try no-console (script rule, enforced)  2 findings in 2 of 3 files` with findings at `src/cli/main.ts:2` and `src/core/price.ts:2`, exit 1; the last two: `1 finding in 1 of 2 files`, exit 1 |
| 118 | R, on `work` add F: `try clear-errors`; `try clear-errors src/core`; `try clear-errors 'src/core/*.ts'`; `try clear-errors src/core/refund.ts --dry-run --max-calls 3` | `usage`, exit 2, each, no request |
| 119 | S, on `work` add D: `try no-console src/core/discount.ts`; then `git status --porcelain` | `lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 1 file, 1 waived` and one finding, at `src/core/discount.ts:2`, exit 1; `?? src/core/discount.ts` alone, and no `.lawcheck/.local` |
| 120 | S with a rule `spare`, `why: Nothing lists it.`, on no type, whose `check` returns `[{ message: String(files[0].type) }]`: `try spare README.md`; `try spare src/core/price.ts`; `try spare` | `README.md  error[spare]  null`, exit 1; `src/core/price.ts  error[spare]  library`, exit 1; `usage`, exit 2 |
| 121 | S whose `check` of `no-console.mjs` throws: `try no-console` | `.lawcheck/rules/no-console.mjs  error[rule-crashed]`, exit 2 |
| 122 | S: `try`; `try nope`; `try no-consol`; `try forbidden-use src`; `try no-console --times 2`; `try no-console --dry-run`; `try no-console --max-calls 3`; `try --all`; `try no-console nope.ts`; `try no-console 'src/**/*.zzz'`; `try no-console 'src/{a'`; `try no-console ../x`; on `work` with `.gitignore` holding `src/core/gen.ts` and that file added, `try no-console src/core/gen.ts`; on `work` with `src/core/blob.ts` holding `x` and a NUL byte, `try no-console src/core/blob.ts` | `usage`, exit 2, each; the third names `no-console` |
| 123 | R, on `work` add F: `try clear-errors src/core/refund.ts`; then `git status --porcelain`. Then with `--times 2`; then `--dry-run --times 3` | section 5's output, exit 1, one request whose `messages[0].content` equals slice two's prompt for F byte for byte; `?? src/core/refund.ts` alone, no `.lawcheck/verdicts`, no `.lawcheck/.local`. Then section 5's output for `--times 2`, exit 1, two requests. Then section 5's dry run, exit 0, no request |
| 124 | R, on `work` add F': `try clear-errors src/core/refund.ts`; then `lawcheck check --base main` | `lawcheck: try clear-errors (reviewer rule, enforced)  nothing found in 1 file, 1 waived, 1 reviewer call`, exit 0; `src/core/refund.ts  error[not-reviewed]`, exit 1 |
| 125 | R, on `work` add F, `try clear-errors src/core/refund.ts` one at a time: R without `.lawcheck/config.yaml`; with `--times 3 --max-calls 2`; R with `max_chars: 2126`; without `LAWCHECK_REVIEWER_ENDPOINT`; with the fake answering HTTP 500 | exit 2 each: `error[reviewer-not-configured]`; `error[too-many-reviews]` holding `3` and `2`; `src/core/refund.ts  error[too-large-to-review]`; `error[reviewer-unreachable]` without place; `src/core/refund.ts  error[reviewer-unreachable]` holding `500`, with `next: wait until the reviewer at <the fake's address> works again, then run the same command again; try keeps no answer, so it makes every call again`. The first four send no request |
| 126 | R, on `work` add F: `try clear-errors src/core/refund.ts --times 2 --json` | `rule` `clear-errors`, `files` 1, `summary` `{ "findings": 2, "files_with_findings": 1, "waived": 2, "calls_made": 2 }`, `runs` two items for `src/core/refund.ts` with `attempt` 1 and 2, each `verdict` `fail`, `findings` `[{ "line": 2, "message": "the message says neither what happened nor what to do next", "severity": "error" }]`, `waived` 1, `answer` the fake's answer, `prompt_chars` 2127; `next` null; exit 1 |
| 127 | S: `try no-console --json` | `rule` `no-console`, `files` 2, `summary` `{ "findings": 1, "files_with_findings": 1, "waived": 0, "calls_made": 0 }`, `runs` `[{ "file": "src/core/price.ts", "attempt": 1, "verdict": null, "findings": [{ "line": 2, "message": "writes to the terminal with console.log", "severity": "error" }], "waived": 0, "answer": null, "prompt_chars": null }, { "file": "src/core/tax.ts", "attempt": 1, "verdict": null, "findings": [], "waived": 0, "answer": null, "prompt_chars": null }]`, `next` null, exit 1 |
| 128 | in a `mktemp -d` folder outside git: `lawcheck docs`; `docs --json`; `docs law` | section 7's list, exit 0; `topics` holds the twelve ids and titles in that order; text whose first line is `# The law file`, exit 0 |
| 129 | for each of the twelve topics, `lawcheck docs <topic>` | the first line is `# <its title>`; at most 8,000 code points; every check of section 7 holds; `codes` has one row per code of `src/output.ts`'s table of fixed whys, `already-initialized` among them, and no other, each Kind cell `finding` or `exit 2` and each Why cell equal to that code's why; `change` holds section 7's paragraph word for word; `law` names in backticks `lawcheck`, `rules`, `types`, `why`, `status`, `context`, `about`, `paths`, `content`, `may_use`; `config` names every key of slice two's config table; `languages` names `typescript`, `tsx`, `javascript`, `python`, `go`, `rust`, `java`, `kotlin`, `csharp`, `c`, `cpp`, `php` and `ruby`; `json` names the six schemas of section 2, `lawcheck-check/0` and `lawcheck-error/1` |
| 130 | `docs nope`; `docs codez`; `docs law codes`; `docs --all` | `usage`, exit 2, each; the second names `codes` |
| 131 | S: `doctor --base main`; then `--json` | section 8's output, exit 0; `result` `pass`, the nine `checks` in section 8's order, each `state` `ok` and `next` null |
| 132 | S: `doctor` | `lawcheck: PASS  9 checks, 1 note`; `note  base  no base: no --base, LAWCHECK_BASE or origin/HEAD, so a plain check counts every file as changed` and `  next: pass --base <branch>, or set LAWCHECK_BASE`; `ok  law-change  no base, so a plain check judges every file`; exit 0 |
| 133 | S, on `work` append `# a note` to `.lawcheck/law.yaml`: `doctor --base main`; `check --base main`; `check --base main --json`; `check --full --base main`; `check` with no base. Then, one at a time: on `work` append `// end` to `.lawcheck/rules/no-todo.mjs` and run `check --base main`; the `# a note` in the second commit on `main`, `check --base main` | section 8's lines, exit 0; section 8's `check` output, exit 0; `scope` `{ "mode": "change", "base": "main", "files": 1, "law_changed": true, "law_changes": ["edits .lawcheck/law.yaml without changing a rule or a type"] }`; only the law-change line, `note: this change edits the law that judges it: edits .lawcheck/law.yaml without changing a rule or a type`, second and exit 0; no `note:` line, exit 1 as in test 39. Then `note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code` as the second line and the law-change line, `...: changes .lawcheck/rules/no-todo.mjs`, as the third, exit 0; `lawcheck: PASS  nothing changed against main` alone, exit 0 |
| 134 | S with test 17's `statuss`: `doctor --base main`; then `--json` | `lawcheck: FAIL  9 checks, 1 problem`; `fail  law  .lawcheck/law.yaml:8  unknown key 'statuss' in rule 'no-todo' (did you mean 'status'?)` and `  next: fix .lawcheck/law.yaml, then run lawcheck doctor again`; `ok` for `node`, `git`, `config`, `base` and `law-change`; `skip  types  needs law`, `skip  readers  needs types`, `skip  reviewer  needs law`; exit 2. Then `result` `fail` and those states |
| 135 | `doctor` in a new repository; then `--json`; `doctor` in a `mktemp -d` folder outside git | `fail  law  no .lawcheck/law.yaml in this directory or any above it` and `  next: lawcheck init  (only when the user wants a law here)`, `skip` for the six after it, exit 2; the `law` check's `next` `{ "command": "lawcheck init", "text": "lawcheck init  (only when the user wants a law here)" }`; `fail  git` and `skip` for the seven after it, exit 2 |
| 136 | R: `doctor --base main` without `LAWCHECK_REVIEWER_ENDPOINT`; with it; `doctor --base main --reviewer`; the same with the fake answering HTTP 500; the same with the fake answering `fine`; R without `.lawcheck/config.yaml`, `doctor --base main`; R with the config `provider: claude-code`, `model: test-model` and the fake claude first on `PATH`, `doctor --base main`. S: `doctor --base main --reviewer` | `fail  reviewer  1 reviewer rule; openai-compatible cannot be called: ` and slice two's reason, exit 2, no request; `ok  law  .lawcheck/law.yaml: 4 types, 3 rules (2 script, 1 reviewer)`, `ok  config  .lawcheck/config.yaml: reviewer openai-compatible, model test-model`, `ok  reviewer  1 reviewer rule; openai-compatible can be called (lawcheck doctor --reviewer makes one call)`, exit 0, no request; `ok  reviewer  1 reviewer rule; openai-compatible answered a test call`, exit 0, one request whose `messages[0].content` is section 8's prompt; `fail  reviewer` holding `500`, exit 2, one request; `fail  reviewer` holding `answered with no verdict: fine`, exit 2; `fail  reviewer  1 reviewer rule and no reviewer set, so their files stay not-reviewed`, exit 2; `ok  reviewer  1 reviewer rule; claude-code can be called (lawcheck doctor --reviewer makes one call)`, exit 0, the fake claude records no start; `fail  reviewer  no reviewer is set, so --reviewer has nothing to call`, exit 2 |
| 137 | S with test 16's `pricing`: `doctor --base main`. U with a root type `notes`, `paths: ["notes/**"]`, `may_use: [notes]`, and a file `notes/a.md` holding `# A`: `doctor --base main`. S with the copy whose `dist/grammars/tree-sitter-ruby.wasm` holds the one byte `x`: `doctor --base main` | `fail  types` naming `src/core/price.ts`, `skip  readers  needs types`, exit 2; `note  readers` holding `1 .md` and `so check warns uses-not-read`, `  next: lawcheck docs languages`, exit 0; `fail  readers` holding `ruby`, `  next: reinstall Lawcheck; a grammar it ships cannot be loaded`, exit 2 |
| 138 | S: `doctor --base nope` | `fail  base  the base 'nope' names no commit here`, `  next: pass --base with a branch or a commit that exists here`, `skip  law-change  needs base`, exit 2 |
| 139 | `doctor x`; `doctor --base`; `doctor --reviewer --reviewer`; `doctor --no-color`; `prime x`; `docs --base main` | `usage`, exit 2, each |
| 140 | `lawcheck --help`; `lawcheck <command> --help` for each of the seven; `lawcheck`; `lawcheck fix`; `lawcheck init --help --json`; `lawcheck --version` | the first line `usage: lawcheck <command> [<arguments>] [--json]`, exit 0; each first line of section 2, exit 0; `usage`, exit 2, twice; a `lawcheck-error/1` document with `usage`, exit 2; `0.1.0`, exit 0 |
| 300 | S, on `work` change the `library` type's `rules: [no-console]` to `rules: []` and append `console.log('sneaky');` to `src/core/price.ts`: `check --base main`; then `--json`. Then in a new S the same breach without the law change | `lawcheck: PASS  2 changed files (against main)`, the generic note, then `note: this change edits the law that judges it: takes the rule no-console off the type library`, exit 0; `scope` `{ "mode": "change", "base": "main", "files": 2, "law_changed": true, "law_changes": ["takes the rule no-console off the type library"] }`, exit 0. The control: exit 1, no `note:` line and no `law_changes` |
| 301 | S, on `work` replace `.lawcheck/rules/no-console.mjs` with a rule that returns `[]` and append `console.log('sneaky');` to `src/core/price.ts`: `check --base main`. Then in a new S add the rule `extra` to the law and its file `.lawcheck/rules/extra.mjs` | the generic note and `note: this change edits the law that judges it: changes .lawcheck/rules/no-console.mjs`, exit 0; the third line `note: this change edits the law that judges it: adds the rule extra; adds .lawcheck/rules/extra.mjs`, exit 0 |
| 302 | S, on `work`, in the law: add the type `docs` with `paths: ["docs/**"]`, remove the rule `no-todo` and every line that lists it, delete `.lawcheck/rules/no-todo.mjs`, make `no-console` `status: advisory`, change the paths of `script` to `["tools/**/*.mjs"]`: `check --full --base main`. Then in a new S append `# a note` to the law | the second line is `note: this change edits the law that judges it: adds the type docs; removes the rule no-todo; makes the rule no-console advisory; changes the paths of the type script; removes .lawcheck/rules/no-todo.mjs`, no generic note, exit 0; with the note appended, `...: edits .lawcheck/law.yaml without changing a rule or a type` |
| 303 | S, on `work` add seven rules `a-rule` to `g-rule`, each with a file and an entry: `check --base main`; then `--json` | the law-change line holds `adds the rule a-rule` to `adds the rule e-rule`, then `; and 9 more`; `scope.law_changes` holds all fourteen items |
| 304 | S, on `work` write `.lawcheck/config.yaml` with `runner: npx`: `check --base main`. A law whose type lists a rule it lacks: `check --base main`. The `# a note` in the law with no base: `check` | the generic note and `note: this change edits the law that judges it: adds .lawcheck/config.yaml`, exit 0; exit 2 with no `note:` line; no `note:` line |
| 141 | `npm test` | tests 1 to 140 pass, those section 10 amends as amended, offline |

The unit tests carry the rest, one file per new source file: each command's argument reading; the walk of section 6 for a path that does not exist, at the root, below it, on types with and without `content`; each step of section 4's budget, the cut at 60 characters and the guard; the selection of `try`'s targets from paths, directories and patterns; each `doctor` check's states from hand-made inputs; and the first part of `prime` at 1,455 and 1,721 characters.

## 12. Repository layout additions

No new runtime dependency.

```
package.json                  "files" gains "docs"
spec/commands-slice.md
docs/                         the twelve pages of section 7, <topic>.md
src/
  cli.ts                      the program's usage and the choice of command
  args.ts                     each command's arguments, as slice one reads check's
  setup.ts                    the front of a run (section 2), moved out of check.ts and shared
  init.ts
  prime.ts                    the text, the law part and the budget
  explain.ts                  a file, a path that does not exist, a directory, a type, a rule
  try.ts                      the targets, the runs, the reviewer calls without writing
  docs.ts                     the topics, read from the package's docs/
  doctor.ts                   the nine checks
  check.ts, output.ts, review.ts, files.ts, law.ts   changed as sections 2, 5 and 8 say: the note and law_changed, a run of calls that records nothing, git check-ignore and --show-prefix, about kept on a type
tests/
  acceptance/                 tests 96 to 140, named by number
  unit/                       one file per new source file
```

`npm test` builds and runs the unit tests and tests 1 to 140, offline and deterministic. Both run inside the dev container.
