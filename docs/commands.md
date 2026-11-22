# The commands

Lawcheck has seven commands and two flags of its own. For each command, this page gives its usage line, what it reads and writes, its flags, its exit codes and one run. `lawcheck <command> --help` prints the usage of one command in the terminal.

The runs below come from one repository. Its `main` holds five files: `README.md`, the law below, the rule file `.lawcheck/rules/no-console.mjs` ([Script rules](script-rules.md)), `src/core/price.ts` and `src/cli/main.ts`. The rule reports each call such as `console.log`. `src/cli/main.ts` makes one such call, and `src/core/price.ts` writes nothing. You write that law by hand, without `lawcheck init`, so the repository has no `.lawcheck/.gitignore`. The law reads:

```yaml
lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.

types:
  source:
    paths: ["src/**/*.ts"]
    types:
      library:
        paths: ["src/core/**"]
        rules: [no-console]
      command:
        paths: ["src/cli/**"]
```

The work is on a branch made from `main`. On that branch, `src/core/report.ts` calls `console.log` on its line 2.

## Every command

`--json` may stand anywhere among the arguments. With it, the command prints one JSON document in place of text ([JSON documents](json.md)).

Lawcheck stops a command with exit 2 in the cases below, and the error names the next step ([Codes](codes.md)). The code [`usage`](codes.md#usage) means that the command line does not match the usage line of its command.

| The case | The code |
|---|---|
| a flag the command does not take, a flag given twice, or a flag without its value | `usage` |
| a number with a character other than a digit | `usage` |
| a word after `init`, `prime` or `doctor`, which take flags alone | `usage` |
| no command, or a command Lawcheck does not have; the message names the seven commands | `usage` |
| a Node, a git or a package manager that Lawcheck does not run on, for every command but `docs` and `doctor` | `unsupported-environment` ([Supported environments](support.md)) |
| a run stopped by `SIGTERM`, `SIGINT` or `SIGHUP` | `stopped` |
| an output that Lawcheck cannot write; the error goes to standard error | `file-unwritable` |

Outside `doctor`, exit 2 means that the command reached no conclusion.

## init

```text
usage: lawcheck init [--json]
```

`init` starts a law in the current folder. That folder becomes the root of the law. `init` writes two files ([Files](files.md)):

- `.lawcheck/law.yaml`, with an empty law and a short example in comments;
- `.lawcheck/.gitignore`, with the lines `.local/` and `config.local.yaml`.

`init` overwrites no file, and it writes no `.lawcheck/config.yaml`. In a folder below the top of the git work tree, `init` starts a law that covers only the files below that folder, and its output says so in a note. `init` refuses with `already-initialized` when a law governs this folder from here or from above, or when git lists a law below this folder. An extra word after `init` ends it with `usage`.

Run `init` once per repository, at the root of the code you want to check. In a new repository:

```text
$ lawcheck init
```

```output
lawcheck: created .lawcheck/law.yaml and .lawcheck/.gitignore

Nothing is checked yet: the law has no types.
next: describe your first file type in .lawcheck/law.yaml  (lawcheck docs first-law shows how)
```

The law that `init` writes holds the version of the format and an example in comments. The example has the rule `no-console` and a type `source` that lists it:

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

### --json

`--json` prints the document `lawcheck-init/0` ([JSON documents](json.md)).

### Exit codes of init

| Code | Meaning |
|---|---|
| 0 | the law is started |
| 2 | no law was started: no git work tree, a law already governs here, or a file cannot be written |

## prime

```text
usage: lawcheck prime [--json]
```

`prime` prints the text that a coding agent reads at the start of a session. The text has four parts:

- how to work with Lawcheck in this repository;
- the steps that are the user's alone to take;
- what the agent may do unasked;
- the law in short.

`prime` reads the law, the rule files and the setting `runner`, and writes nothing. It does none of the work of a check:

- it runs no rule;
- it reads no [use](concepts.md#use);
- it calls no reviewer.

The text holds at most 8,000 characters. For a large law, Lawcheck shortens the text in up to four steps, and the text says what it left out. With a `runner` other than `global`, the first line says how to start Lawcheck in this repository. Without a law, `prime` prints two lines that say so. With a law that is not valid, it prints the primer without its part about the law, then the errors. An extra word after `prime` ends it with `usage`.

Name `prime` in the instructions of an agent other than Claude Code. The Claude Code plugin runs `prime` at the start of each session ([The Claude Code plugin](plugin.md)).

```text
$ lawcheck prime
```

The text ends with the law in short:

```output
The law here: 3 types, 1 rule
source  src/**/*.ts
  library  src/core/**  rules: no-console
  command  src/cli/**

Rules
no-console  script  Only the command layer writes to the terminal.

More: lawcheck docs
```

### --json

`--json` prints the document `lawcheck-prime/0`, with the text and its length.

### Exit codes of prime

| Code | Meaning |
|---|---|
| 0 | the text is printed, with a law or without one |
| 2 | the law, a rule file or the git work tree is broken; the text is followed by the errors |

## check

```text
usage: lawcheck check [--full] [--base <ref>] [--review [--again] [--max-calls <n>]] [--json]
       lawcheck check <path or pattern>... [--json]
```

`check` does five things:

- it gives each file its [type](concepts.md#type);
- it runs the [script rules](concepts.md#script-rule);
- it reads the [uses](concepts.md#use);
- it applies the [verdicts](concepts.md#verdict) of [reviewer rules](concepts.md#reviewer-rule), and the [waivers](concepts.md#waiver);
- it prints the [findings](concepts.md#finding).

A plain check judges the files of the [change](concepts.md#change) against a [base](concepts.md#base) ([What a check judges](change.md)). Without `--review`, `check` calls no reviewer. A cached failure is a failed review that Lawcheck keeps in `.lawcheck/.local/failures/`. A file gets `not-reviewed` when one of its reviewer rules has no verdict and no cached failure for it. `check` writes nothing, except what `--review` records ([Files](files.md)).

Run `check` after every change, in CI and in a git hook ([CI and git hooks](ci.md)).

```text
$ lawcheck check --base main
```

```output
lawcheck: FAIL  1 error in 1 changed file (against main)

src/core/report.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/report.ts:2
```

### `<path or pattern>...`

With paths or patterns, `check` judges only the files you name, changed or not. Each one is a file, a folder with every file below it, or a pattern ([The law file](law.md)). This check has no base. Its first line counts the named files. A check of named files takes `--json` and no other flag. Any other flag makes the command `usage`.

### --full

`--full` judges the files outside the change too, and lists their findings as [debt](concepts.md#debt). Debt never fails the check, since every finding of debt is a warning.

### --base `<ref>`

`--base` names the base of the change: a branch, a tag or a commit. Without the flag, Lawcheck takes `LAWCHECK_BASE`, then `origin/HEAD`. With none of the three, a plain check on a machine counts every file as changed. In a CI job, a plain check with none of the three stops with `base-unreachable`, unless you pass `--full`.

### --review

`--review` asks the reviewer about each pair of a file and a reviewer rule that has no verdict and no cached failure. Lawcheck records each pass in `.lawcheck/verdicts` ([Reviewer rules](reviewer-rules.md)). Before the first call, it prints `lawcheck: N reviewer calls to <provider>` on standard error.

### --again

`--again` works with `--review` alone. It asks the reviewer again where `.lawcheck/.local/failures/` holds a cached failure. Without `--again`, Lawcheck reports a cached failure again. That costs no call.

### --max-calls `<n>`

`--max-calls` works with `--review` alone. It caps the number of requests this run sends. It replaces `reviewer.max_calls` for this run ([Settings](config.md)). A run that needs more requests stops with `too-many-reviews` before its first call.

### --json

`--json` prints the document `lawcheck-check/0`, with every finding. The text output prints 50 findings and the count of the rest.

### Exit codes of check

| Code | Meaning |
|---|---|
| 0 | no finding with severity error; warnings and debt do not fail |
| 1 | at least one error: the code breaks the law |
| 2 | no conclusion: the law, the config, a rule, the base, the reviewer or a limit stopped the run |

## explain

```text
usage: lawcheck explain (<path> | --type <id> | --rule <id>) [--json]
```

`explain` says why a file has the law it has. For a file, it prints:

- its type, and the chain of types above it;
- the pattern that matched;
- what the file may use, and whether Lawcheck reads its uses;
- its rules, with the state of each review;
- its waivers.

For a file without a type, `explain` gives the reason. These are some of the reasons:

- git ignores the file;
- no type's paths match it;
- its content matches no type;
- it is binary or a symbolic link;
- it belongs to another repository.

`explain` runs no rule and writes nothing. It takes one subject: a path, `--type` or `--rule`.

Run `explain` before you create a file, to see the law the file will get. Run it on a file you have, to find why it has its type.

```text
$ lawcheck explain src/core/report.ts
```

```output
src/core/report.ts
  type:  library  (source > library)
  matched:  source by "src/**/*.ts", library by "src/core/**"
  may use:  any file; no type on the way up has may_use
  rules:
    no-console  script  enforced  from library  Only the command layer writes to the terminal.
  waivers:  none
```

### `<path>`

The path names a file, a file that does not exist yet, a folder, or `.` for the current folder. For a new file, the first line ends with `(does not exist yet)`. For a folder, `explain` counts its files of each type. On a file system that ignores case, `explain` answers for the spelling that git lists.

Each name in the path may hold at most 255 bytes. The whole path on disk, with the folders above the root of the law, may hold at most 4,095 bytes. A longer name or path is `usage`.

### --type `<id>`

`--type` prints one type of the law:

- its chain of types, its `paths`, `content` and `may_use`;
- its rules and its subtypes;
- whether it reads waivers;
- its files.

For an id that the law does not have, the command ends with `usage`. The message names an id of the law that is one or two letters away, when there is one.

### --rule `<id>`

`--rule` prints one rule of the law:

- its kind, script or reviewer, with its `status` and `why`;
- its rule file, and the files its `context` names, which a reviewer rule sends with each file it judges;
- the types that list it, and the files of those types and their subtypes;
- for a reviewer rule, how many of those files have a verdict.

For an id that the law does not have, the command ends with `usage`. The message names an id of the law that is one or two letters away, when there is one.

### --json

`--json` prints the document `lawcheck-explain/0`, with every file. The text output lists 50 files.

### Exit codes of explain

| Code | Meaning |
|---|---|
| 0 | the answer is printed, for a file with a type overlap too |
| 2 | no answer: the law is broken, the subject is not one, or a folder, a type or a rule meets a type overlap |

## try

```text
usage: lawcheck try <rule> [<path or pattern>...] [--times <n>] [--dry-run] [--max-calls <n>] [--json]
```

`try` runs one rule on the files you choose, with no base. It records nothing, so the verdicts, the cached failures and the files of the repository stay as they were. The rule needs an entry in the law, even while no type lists it. Each finding carries the severity of the rule's `status`, and the waivers of the file apply.

Run `try` while you write a rule, before a type lists it ([Script rules](script-rules.md)).

```text
$ lawcheck try no-console src/cli/main.ts
```

```output
lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 1 file

src/cli/main.ts:1  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
```

### `<rule>`

`<rule>` is the id of a rule of the law. A code of Lawcheck, such as `forbidden-use`, ends `try` with `usage`, because only `check` judges those codes.

### `<path or pattern>...`

The paths name the files to run the rule on, from the current folder: files, folders with every file below them, or patterns. `try` leaves binary files out, and a target that selects no file ends it with `usage`. Without targets, a script rule runs on every file whose type, or a type above it, lists the rule. A reviewer rule needs at least one file, named one by one: `try` refuses a folder or a pattern for it.

### --times `<n>`

`--times` works with a reviewer rule alone. It asks the reviewer about each file as many times as the number says, and at least once. The first line counts the answers that fail and the answers that pass. Each file gets a line per answer, such as `src/core/refund.ts  answer 2 of 3: fail`.

### --dry-run

`--dry-run` works with a reviewer rule alone. It prints the calls that `try` would make and the size of each prompt. It makes no call. `--dry-run` does not go with `--max-calls`.

### --max-calls `<n>`

`--max-calls` works with a reviewer rule alone. It caps the number of requests this run sends, in place of `reviewer.max_calls`.

### --json

`--json` prints the document `lawcheck-try/0`, with every answer.

### Exit codes of try

| Code | Meaning |
|---|---|
| 0 | no finding, or a dry run |
| 1 | a finding, an advisory one included |
| 2 | the run could not be made |

## docs

```text
usage: lawcheck docs [<topic>] [--json]
```

`docs` prints the pages of this reference in the terminal, even offline, outside git and without a law. Without a topic, it lists the topics under their sections. A link to another page prints as the command that prints that page, such as `Codes (lawcheck docs codes)`.

Run `docs` on a machine without a browser, or to give an agent one page.

### `<topic>`

`<topic>` is the id of one page. Two or more words end the command with `usage`. So does an id that no page has, and then the message names the id of a page that is one or two letters away:

```text
$ lawcheck docs jsn
```

```output
lawcheck: ERROR  1 error

error[usage]  there is no topic 'jsn' (did you mean 'json'?); lawcheck docs lists them
  why:  the tool does only what its usage line says

next: run lawcheck docs as its usage line says: lawcheck docs --help
```

### --json

`--json` prints the document `lawcheck-docs/0`. It holds the list, or one page as it is written.

### Exit codes of docs

| Code | Meaning |
|---|---|
| 0 | the list or the page is printed |
| 2 | no such topic, or more than one |

## doctor

```text
usage: lawcheck doctor [--base <ref>] [--reviewer] [--json]
```

`doctor` says what is wrong with this setup, with one next step for each problem. It writes nothing. It works without a law, and outside git. It opens no connection unless you pass `--reviewer`, with one exception. With the provider `ollama` and a reviewer rule in the law, `doctor` asks the server for its version without the flag. On an environment that Lawcheck refuses, `doctor` starts with the same refusal as every other command. It then runs its nine checks below that line. An extra word after `doctor` ends it with `usage`.

Run `doctor` after you install Lawcheck, after you change `.lawcheck/config.yaml`, and before you report a bug.

```text
$ lawcheck doctor --base main
```

```output
lawcheck: PASS  9 checks

ok  node  Node 24.11.0; Lawcheck needs 24 or later
ok  git  a git work tree, and the law's root is its top
ok  law  .lawcheck/law.yaml: 3 types, 1 rule (1 script, 0 reviewer)
ok  config  no .lawcheck/config.yaml; every setting has its default
ok  types  3 of 6 files have a type
ok  base  main, from --base; the change holds 1 file
ok  law-change  the change does not touch the law
ok  readers  no type has may_use, so no use is read; the 13 grammars load
ok  reviewer  no reviewer rule, so no reviewer is needed
```

The `node` line names the Node that runs Lawcheck. Three of the six files have no type: `README.md` and the two files under `.lawcheck/`. A repository where `lawcheck init` started the law holds `.lawcheck/.gitignore` as well, and there `doctor` prints `3 of 7 files have a type`. The nine checks run in this order:

| Check | What it looks at |
|---|---|
| `node` | the Node version, and Bun or Yarn Plug'n'Play |
| `git` | git, its version, the work tree, and where the root lies in it |
| `law` | `.lawcheck/law.yaml` and the rule files |
| `config` | `.lawcheck/config.yaml`, and the runner's program on the `PATH` |
| `types` | how many files have a type, and a type overlap |
| `base` | the base, where it came from, and how many files the change holds |
| `law-change` | whether the change touches the law |
| `readers` | the files whose uses are read, by language, and the 13 grammars, which it loads |
| `reviewer` | the reviewer rules, and whether the reviewer can be called |

Each check ends as `ok`, `note`, `fail` or `skip`. A check shows `skip`, with `needs <check>`, when a check it needs did not pass. Lawcheck prints a `next:` line under each `note` and each `fail`.

### --base `<ref>`

`--base` gives the base for the `base` and `law-change` checks. Without the flag, `doctor` takes `LAWCHECK_BASE`, then `origin/HEAD`, as `check` does.

### --reviewer

`--reviewer` sends the reviewer one small test request, which asks for a pass. The `reviewer` check then fails in three cases:

- `.lawcheck/config.yaml` sets no reviewer;
- Lawcheck cannot reach the reviewer;
- the answer is no pass.

### --json

`--json` prints the document `lawcheck-doctor/0`.

### Exit codes of doctor

| Code | Meaning |
|---|---|
| 0 | no check failed; notes are allowed |
| 2 | a check failed |

`doctor` never exits 1.

## --version

`lawcheck --version` prints the version of the installed package and exits 0. It works only when it is the one argument:

```output
0.1.0-alpha.2
```

## --help

`lawcheck --help` prints one line for each command and exits 0. `lawcheck <command> --help` prints the usage and flags of that command, and for `check` and `try` their exit codes too. `--help` works only when it is the one argument, or the one argument after a command. `lawcheck --help` prints:

```output
usage: lawcheck <command> [<arguments>] [--json]
  init  starts a law in the current directory
  prime  prints what a coding agent reads at the start of a session
  check  checks the files of this change, or the files named, against the law
  explain  says why a file, a type or a rule has the law it has
  try  runs one rule on chosen files and records nothing
  docs  prints the reference, one topic at a time
  doctor  says what is wrong with this setup
```

Next: [The law file](law.md)
