# The commands

Lawcheck has seven commands and two flags that stand alone, `--version` and `--help`. For each command, this page gives its usage line, what it reads and writes, its flags, its exit codes and one run. `lawcheck <command> --help` prints the usage of one command in the terminal.

The runs below come from one repository. Its `main` holds five files:

- `README.md`;
- the law below, in `.lawcheck/law.yaml`;
- the rule file `.lawcheck/rules/no-console.mjs` ([Script rules](script-rules.md));
- `src/core/price.ts`;
- `src/cli/main.ts`.

The rule reports each call of a `console` method, such as `console.log`. `src/cli/main.ts` makes one such call. `src/core/price.ts` makes none. You write that law by hand, without `lawcheck init`, so the repository has no `.lawcheck/.gitignore`. The law reads:

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

Lawcheck stops a command with exit 2 in the cases below. The error names the next step ([Codes](codes.md)). The code [`usage`](codes.md#usage) means that the command line does not match the usage line of its command.

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

`init` overwrites no file. It writes no `.lawcheck/config.yaml`. In a folder below the top of the git work tree, `init` starts a law that covers only the files below that folder. Its output says so in a note. `init` refuses with `already-initialized` in two cases: a law governs this folder from here or from above, or git lists a law below this folder. An extra word after `init` ends it with `usage`. When `.lawcheck` is a file, or a symbolic link to a file or to nothing, `init` stops with `file-unwritable`, names `.lawcheck` and writes nothing. It stops the same way, naming `.lawcheck/.gitignore`, when that is a folder or a symbolic link to nothing. When `.lawcheck/law.yaml` is a folder or a symbolic link to nothing, `init` says `already-initialized`, and `doctor` and `check` say `law-invalid`.

When git ignores `.lawcheck/law.yaml`, because `.gitignore` names `.lawcheck`, `init` still writes the files and exits 0. It adds a `note:` line under the first line: no commit carries the law, so no other checkout has it. The note gives `git check-ignore -v .lawcheck/law.yaml`, which shows the line to remove. With `--json`, `next.text` starts with the same warning.

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

`prime` reads the law, the rule files and the `runner` setting. It writes nothing, and it does none of the work of a check:

- it runs no rule;
- it reads no [use](concepts.md#use);
- it calls no reviewer.

The text holds at most 8,000 characters. For a large law, Lawcheck shortens the text in up to four steps. The text then says what it left out. With a `runner` setting other than `global`, the first line says how to start Lawcheck in this repository. Without a law, `prime` prints two lines that say so. With a law that is not valid, it prints the primer without its part about the law, then the errors. An extra word after `prime` ends it with `usage`.

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
usage: lawcheck check [--full] [--strict] [--base <ref>] [--review [--again] [--max-calls <n>]] [--sarif <file>] [--json]
       lawcheck check <path or pattern>... [--json]
```

`check` does five things:

- it gives each file its [type](concepts.md#type);
- it runs the [script rules](concepts.md#script-rule);
- it reads the [uses](concepts.md#use);
- it applies the [verdicts](concepts.md#verdict) of [reviewer rules](concepts.md#reviewer-rule), and the [waivers](concepts.md#waiver);
- it prints the [findings](concepts.md#finding).

A [plain check](concepts.md#plain-check) judges the files of the [change](concepts.md#change) against a [base](concepts.md#base) ([What a check judges](change.md)). Without `--review`, `check` calls no reviewer. A cached failure is a failed review that Lawcheck keeps in `.lawcheck/.local/failures/`. A file gets `not-reviewed` when one of its reviewer rules has no verdict and no cached failure for it. Without `--review`, `check` writes only the reader cache in `.lawcheck/.local/readers/`. `--review` also records passes and failures ([Files](files.md)).

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

With paths or patterns, `check` judges only the files you name, changed or not. Each argument names a file, a folder with every file below it, or a pattern ([The law file](law.md)). This check has no base. Its first line counts the named files. A check of named files takes `--json` and no other flag. With any other flag, the command ends with `usage`.

### --full

With `--full`, `check` judges every file, the files outside the change included. It lists their findings as [debt](concepts.md#debt). Every finding of debt is a warning, so debt does not fail the check. `--strict` changes that.

### --strict

With `--strict`, `check` judges every file as `--full` does, and holds the debt to the standard of the change. A finding of debt is an error exactly when the same finding inside the change would be one: a finding of an `enforced` rule, a `forbidden-use` or a waiver with no reason. A finding of an `advisory` rule stays a warning. The run exits 1 on such an error, and the first line counts it apart, as `2 errors in debt`. A run with no such debt passes. `--strict` includes `--full`, so giving both is the same as giving `--strict`. It takes the other flags of `check` and no paths.

`--strict` needs a verdict for every file that an `enforced` [reviewer rule](concepts.md#reviewer-rule) binds, old files included. A file with no verdict is a `not-reviewed` error, and its first run can ask the reviewer about the whole repository. The `next:` line then names `lawcheck check --strict --review`, which asks about the old files too. A check with `--review` and without `--strict` leaves them out.

### --base `<ref>`

`--base` names the base of the change: a branch, a tag or a commit. Without the flag, Lawcheck takes `LAWCHECK_BASE`, then the variable that a CI service sets for the target branch of a pull request or for the commit before a push, then `origin/HEAD`. [CI and git hooks](ci.md#_5-give-the-base-on-another-ci-service) lists the variables. With none of these, a plain check on a machine counts every file as changed. In a CI job, a plain check with none of them stops with `base-unreachable`, unless you pass `--full`.

### --review

With `--review`, Lawcheck asks the reviewer about each pair of a file and a reviewer rule that has no verdict and no cached failure. Lawcheck records each pass in `.lawcheck/verdicts` ([Reviewer rules](reviewer-rules.md)). Before the first call, it prints `lawcheck: N reviewer calls to <provider>` on standard error.

### --again

`--again` works with `--review` alone. With it, Lawcheck asks the reviewer again for each review whose failure `.lawcheck/.local/failures/` holds. Without `--again`, Lawcheck shows a cached failure again without a call.

### --max-calls `<n>`

`--max-calls` works with `--review` alone. It sets the most requests this run may send, in place of `reviewer.max_calls` ([Settings](config.md)). A run that needs more requests stops with `too-many-reviews` before its first call.

### --sarif `<file>`

`--sarif` writes the findings to the file in SARIF 2.1.0 as well, for GitHub code scanning ([CI and git hooks](ci.md#_3-show-the-findings-in-github-code-scanning)). The text output, the JSON and the exit code stay as they are. A check that ends with exit 2 writes no file. A file that cannot be written stops the run with `file-unwritable`. [JSON documents](json.md#sarif-2-1-0) lists what the file holds. A check of named files does not take `--sarif`.

### --json

`--json` prints the document `lawcheck-check/0`, with every finding. The text output prints 50 findings and the count of the rest.

### Exit codes of check

| Code | Meaning |
|---|---|
| 0 | no finding with severity error; warnings do not fail, and debt does not fail without `--strict` |
| 1 | at least one error: the code breaks the law |
| 2 | no conclusion: the law, the config, a rule, the base, the reviewer or a limit stopped the run |

## explain

```text
usage: lawcheck explain (<path> [--tree] | --type <id> | --rule <id>) [--json]
```

`explain` says why a file has the law it has. For a file, it prints:

- its type, and the chain of types above it;
- the pattern that matched;
- what the file may use, and whether Lawcheck reads its uses;
- its rules, with the state of each review;
- its waivers.

For a file without a type, `explain` gives the reason. These are some of the reasons:

- the file is not tracked, and `.gitignore` names it (git lists a tracked file even when `.gitignore` names it, and the file keeps its type);
- no type's paths match it;
- its content matches no type;
- it is binary or a symbolic link;
- it belongs to another repository;
- a pattern of `ignored` in the law matches it.

When a pattern of `required` matches a file with no type, `explain` adds that `check` reports it as `untyped-file`.

`explain` runs no rule and writes nothing. It runs only the companion of a reviewer rule, because the state of that rule's reviews depends on the files the companion returns. It takes one subject: a path, `--type` or `--rule`.

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

The path names a file, a file that does not exist yet, a folder, or `.` for the current folder. For a new file, the first line ends with `(does not exist yet)`. `explain` takes one path and no pattern: `*`, `?`, `[`, `]`, `{` and `}` in a path that no file has are letters of a name, and a last line says so. For a folder, `explain` counts its files of each type. On a file system that ignores case, `explain` answers for the spelling that git lists.

On Linux and macOS, each name in the path may hold at most 255 bytes, and the whole path on disk, with the folders above the root of the law, at most 4,095 bytes. On Windows, each name may hold at most 255 UTF-16 units and the whole path at most 32,767, so a name of 86 characters of three bytes each, which is 258 bytes, is a name there. A longer name or path ends the command with `usage`.

### --tree

`--tree` prints the syntax tree of one file, as a script rule gets it from `await file.tree()` ([Script rules](script-rules.md#the-syntax-tree) has an example). The first line names the file, its language, the count of nodes and the count of named nodes. Each line below is a named node, indented under its parent, with its field, its type and its line. A node with no named node below it also shows its text. The output stops at 12 levels, where a line says how many named nodes lie below it, and at 200 nodes, where the last line says how many follow. With `--json`, the document holds every node.

The tree depends on the file's path and text, so `--tree` also prints the tree of a file that git does not track and of a file with no type. It reads no law. A file with no tree gets one line with the reason, `no-reader`, `too-large` or `reader-failed`, and exit 0. A folder, a file that does not exist, a symbolic link and a binary file end the command with `usage`.

### --type `<id>`

`--type` prints one type of the law:

- its chain of types, its `paths`, `content` and `may_use`;
- its rules and its subtypes;
- whether it reads waivers;
- its files.

For an id that the law does not have, the command ends with `usage`. When a type id of the law differs by one or two letters, the message names it.

### --rule `<id>`

`--rule` prints one rule of the law:

- its kind, script or reviewer, with its `status` and `why`;
- its rule file, and the files its `context` names, which Lawcheck sends the reviewer with each file it judges;
- its `companion`, the module that names files for each judged file;
- the types that list it, and the files of those types and their subtypes;
- for a reviewer rule, how many of those files have a verdict.

For an id that the law does not have, the command ends with `usage`. When a rule id of the law differs by one or two letters, the message names it.

### --json

`--json` prints the document `lawcheck-explain/0`, with every file. The text output lists 50 files. With `--tree`, the document holds every node of the tree.

### Exit codes of explain

| Code | Meaning |
|---|---|
| 0 | the answer is printed, for a file with a type overlap too |
| 2 | no answer: the law is broken (`--tree` reads no law, so it answers under a broken law), the subject is not one, or a folder, a type or a rule meets a type overlap |

## try

```text
usage: lawcheck try <rule> [<path or pattern>...] [--times <n>] [--dry-run] [--max-calls <n>] [--json]
```

`try` runs one rule on the files you choose, with no base. It records nothing, so the verdicts, the cached failures and the files of the repository stay as they were. The rule needs an entry in the law, but no type has to list it yet. Each finding carries the severity of the rule's `status`. The waivers of the file apply.

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

The paths name the files to run the rule on, from the current folder: files, folders with every file below them, or patterns. `try` leaves binary files out. A target that selects no file ends it with `usage`. Without targets, `try` runs a script rule on every file whose type, or a type above it, lists the rule. For a reviewer rule, name at least one file, each by its path, because `try` refuses a folder or a pattern for such a rule.

### --times `<n>`

`--times` works with a reviewer rule alone. It asks the reviewer about each file n times, and n must be at least 1. With n of 2 or more, the first line counts the answers that fail and the answers that pass. Each file gets a line per answer, such as `src/core/refund.ts  answer 2 of 3: fail`.

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

`docs` prints the pages of this reference in the terminal, and it works offline, outside git and without a law. Without a topic, it lists the topics under their sections. A link to another page prints as the command that prints that page, such as `Codes (lawcheck docs codes)`.

Run `docs` on a machine without a browser, or to give an agent one page.

### `<topic>`

`<topic>` is the id of one page. Lawcheck ends the command with `usage` for two or more words, and for an id that no page has. When the id of a page differs by one or two letters, the message names it:

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

The `node` line names the version of the Node that runs Lawcheck, here 24.11.0. Three of the six files have no type: `README.md` and the two files under `.lawcheck/`. In a repository where `lawcheck init` started the law, `.lawcheck/.gitignore` is a seventh file. `doctor` then prints `3 of 7 files have a type`. The nine checks run in this order:

| Check | What it looks at |
|---|---|
| `node` | the Node version, and Bun or Yarn Plug'n'Play |
| `git` | git, its version, the work tree, and where the root lies in it |
| `law` | `.lawcheck/law.yaml` and the rule files, and whether git lists the law (when git ignores `.lawcheck/law.yaml`, the check shows `note`) |
| `config` | `.lawcheck/config.yaml`, and the program of the `runner` setting on the `PATH` |
| `types` | how many files have a type, and a type overlap |
| `base` | the base, where it came from, and how many files the change holds |
| `law-change` | whether the change touches the law |
| `readers` | the files whose uses are read, by language, the configuration files a reader could not read, and the 13 grammars, which it loads |
| `reviewer` | the reviewer rules, and whether the reviewer can be called |

The `readers` check reads the uses of the files whose `may_use` list is in force, as `check --full` does, so it takes about as long, and it writes no reader cache. When a reader consults a configuration file that does not parse, such as a `tsconfig.json` with a single-quoted key, the check shows `note`, and one line under it names each such file ([A configuration file a reader cannot read](languages.md#a-configuration-file-a-reader-cannot-read)). The lines are the same with `--base` and without it.

Each check ends as `ok`, `note`, `fail` or `skip`. A check shows `skip`, with `needs <check>`, when a check it needs did not pass. Lawcheck prints a `next:` line under each `note` and each `fail`.

### --base `<ref>`

`--base` gives the base for the `base` and `law-change` checks. Without the flag, `doctor` takes `LAWCHECK_BASE`, then the variables of a CI service, then `origin/HEAD`, as `check` does.

### --reviewer

`--reviewer` sends the reviewer one small test request, whose prompt asks for a pass. The `reviewer` check then fails in three cases:

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
0.1.0-alpha.4
```

## --help

`lawcheck --help` prints one line for each command and exits 0. `lawcheck <command> --help` prints the usage and flags of that command. For `check` and `try`, it adds the exit codes of the command after the flags. `--help` works only when it is the one argument, or the one argument after a command. `lawcheck --help` prints:

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
