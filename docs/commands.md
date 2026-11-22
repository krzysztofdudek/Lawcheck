# The commands

Lawcheck has seven commands and two flags of its own. This page gives each command its usage line, what it reads and writes, its flags, its exit codes and one run. `lawcheck <command> --help` prints the usage of one command in the terminal.

The runs below come from one repository. Its `main` holds a `README.md`, this law, the rule file `.lawcheck/rules/no-console.mjs` that reports each `console.` call (`lawcheck docs script-rules`), `src/core/price.ts`, which writes nothing, and `src/cli/main.ts`, which calls `console.log`:

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

The work is on a branch made from `main`, where `src/core/report.ts` calls `console.log` on its line 2.

## Every command

- `--json` goes anywhere among the arguments, and the command prints one JSON document instead of text ([JSON documents](json.md)).
- A flag the command does not take, a flag given twice, a flag without its value, or a number with a character other than a digit is `usage`, exit 2.
- No command, or a command Lawcheck does not have, is `usage` too, and the message names the seven commands.
- On a Node, a git or a package manager Lawcheck does not run on, every command but `docs` and `doctor` stops with `unsupported-environment` ([Support](support.md)).
- A run stopped by `SIGTERM`, `SIGINT` or `SIGHUP` ends with `stopped`, exit 2. Output that cannot be written ends with `file-unwritable` on standard error, exit 2.
- Exit 2 means that the command reached no conclusion. The error names the next step ([Codes](codes.md)).

## init

```text
usage: lawcheck init [--json]
```

`init` starts a law in the current folder, which becomes the root. It writes `.lawcheck/law.yaml` with an empty law and a short example in comments, and `.lawcheck/.gitignore` with `.local/` and `config.local.yaml` ([Files](files.md)). It overwrites no file and writes no config. Run below the top of the git work tree, it starts a law that covers only the files below that folder, and says so in a note. It refuses with `already-initialized` when a law governs this folder from here or above, or when git lists a law below it. It takes no other argument.

Use it once per repository, at the root of the code you want checked. In a new repository:

```text
$ lawcheck init
```

```output
lawcheck: created .lawcheck/law.yaml and .lawcheck/.gitignore

Nothing is checked yet: the law has no types.
next: describe your first file type in .lawcheck/law.yaml  (lawcheck docs first-law shows how)
```

### --json

Prints `lawcheck-init/0` ([JSON documents](json.md)).

### Exit codes of init

| Code | Meaning |
|---|---|
| 0 | the law is started |
| 2 | no law was started: no git work tree, a law already governs here, or a file cannot be written |

## prime

```text
usage: lawcheck prime [--json]
```

`prime` prints what a coding agent reads at the start of a session: how to work with Lawcheck here, which steps are only the user's to take, what the agent may do unasked, and the law in short. It runs no rule, reads no use, calls no reviewer and writes nothing. The text stays within 8,000 characters: a large law is shortened in up to four steps, and the text says what it left out. With a `runner` other than `global`, its first line says how to start Lawcheck here. Without a law, it prints two lines that say so. With a law that is not valid, it prints the first part of the text, then the errors.

Use it in the instructions of an agent other than Claude Code. The Claude Code plugin runs it at the start of each session ([The Claude Code plugin](plugin.md)).

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

Prints `lawcheck-prime/0`, with the text and its length.

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

`check` gives each file its type, runs the script rules, reads the uses, applies the verdicts of reviewer rules and the waivers, and prints the findings. A plain check judges the files of the change against a base ([What a check judges](change.md)). Without `--review` it calls no reviewer: a file and a reviewer rule with no verdict and no cached failure give `not-reviewed`. It writes nothing, except what `--review` records ([Files](files.md)).

Use it after every change, in CI and in a git hook ([CI and git hooks](ci.md)).

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

Judges only the files named, changed or not: a file, a folder with every file below it, or a pattern ([The law file](law.md)). The check has no base, and its scope is `N named files`. Named files go with `--json` alone; with any other flag the command is `usage`.

### --full

Also judges the files outside the change and lists their findings as debt. Debt is always a warning, so it never fails the check.

### --base `<ref>`

The base of the change: a branch, a tag or a commit. Without the flag Lawcheck takes `LAWCHECK_BASE`, then `origin/HEAD`. With none of the three, a plain check counts every file as changed, and in a CI job, unless you pass `--full`, it stops with `base-unreachable`.

### --review

Asks the reviewer about each pair of a file and a reviewer rule that has no verdict and no cached failure, and records each pass in `.lawcheck/verdicts` ([Reviewer rules](reviewer-rules.md)). Before the first call it prints `lawcheck: N reviewer calls to <provider>` on standard error.

### --again

Goes only with `--review`. Asks again where a failure is cached in `.lawcheck/.local/failures/`. Without `--again`, a cached failure is reported again and costs no call.

### --max-calls `<n>`

Goes only with `--review`. The most requests this run sends. It replaces `reviewer.max_calls` for this run ([Settings](config.md)). A run that needs more stops with `too-many-reviews` before its first call.

### --json

Prints `lawcheck-check/0`, with every finding. The text output prints 50 findings and the count of the rest.

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

`explain` says why a file has the law it has: its type and the chain of types above it, the pattern that matched, what it may use, whether its uses are read, its rules with the state of each review, and its waivers. A file without a type gets the reason, such as: git ignores it, no type's paths match it, its content matches no type, it is binary or a symbolic link, or it belongs to another repository. It runs no rule and writes nothing. It takes exactly one subject.

Use it before you create a file, to see the law the file will get, and to find why a file has a type.

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

A file, a file that does not exist yet, a folder, or `.` for the current folder. For a new file, the first line ends with `(does not exist yet)`. A folder gets the count of its files of each type. On a file system that ignores case, the answer is for the spelling git lists.

### --type `<id>`

A type: its chain, `paths`, `content`, `may_use`, rules, subtypes, whether it reads waivers, and its files. An id the law does not have is `usage`, with the nearest id.

### --rule `<id>`

A rule: its kind, status, `why`, rule file and `context`, the types that list it, the files it binds, and for a reviewer rule how many of them have a verdict.

### --json

Prints `lawcheck-explain/0`, with every file. The text output lists 50 files.

### Exit codes of explain

| Code | Meaning |
|---|---|
| 0 | the answer is printed, for a file with a type overlap too |
| 2 | no answer: the law is broken, the subject is not one, or a folder, a type or a rule meets a type overlap |

## try

```text
usage: lawcheck try <rule> [<path or pattern>...] [--times <n>] [--dry-run] [--max-calls <n>] [--json]
```

`try` runs one rule on the files you choose, with no base. It records nothing: no verdict, no failure, nothing in the repository. The rule needs an entry in the law, and no type has to list it yet. The findings carry the severity of the rule's `status`, and the file's waivers apply.

Use it while you write a rule, before a type lists it ([Script rules](script-rules.md)).

```text
$ lawcheck try no-console src/cli/main.ts
```

```output
lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 1 file

src/cli/main.ts:1  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
```

### `<rule>`

The id of a rule of the law. A code of Lawcheck, such as `forbidden-use`, is `usage`, since `check` judges it.

### `<path or pattern>...`

The files to run the rule on, read from the current folder: a file, a folder with every file below it, or a pattern. Binary files are left out, and a target that selects nothing is `usage`. A script rule without targets takes the files it binds. A reviewer rule takes files one by one, needs at least one, and refuses a folder or a pattern.

### --times `<n>`

Goes only with a reviewer rule. Asks about each file `n` times, at least once. The first line counts the answers that fail and pass, and each file gets a line per answer, such as `src/core/refund.ts  answer 2 of 3: fail`.

### --dry-run

Goes only with a reviewer rule. Prints the calls it would make and the size of each prompt, and makes none. It does not go with `--max-calls`.

### --max-calls `<n>`

Goes only with a reviewer rule. The most requests this run sends, in place of `reviewer.max_calls`.

### --json

Prints `lawcheck-try/0`, with every answer.

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

`docs` prints these pages in the terminal. Without a topic it lists the topics under their sections. It needs no law, no git and no network. A link to another page prints as the command that prints it, such as `Codes (lawcheck docs codes)`.

Use it on a machine without a browser, or to give an agent one page.

### `<topic>`

The id of one page. More than one word is `usage`. An unknown id is `usage`, with the nearest id:

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

Prints `lawcheck-docs/0`: the list, or one page as it is written.

### Exit codes of docs

| Code | Meaning |
|---|---|
| 0 | the list or the page is printed |
| 2 | no such topic, or more than one |

## doctor

```text
usage: lawcheck doctor [--base <ref>] [--reviewer] [--json]
```

`doctor` says what is wrong with this setup, with one next step for each problem. It writes nothing, and it works without a law and outside git. It opens no connection unless you pass `--reviewer`; with `ollama` and reviewer rules it asks the server for its version without the flag. On an environment Lawcheck refuses, it starts with the same refusal as every other command, and still runs its nine checks below it.

Use it after you install Lawcheck, after you change `.lawcheck/config.yaml`, and before you report a bug.

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

The `node` line names the Node that runs Lawcheck. Three of the six files have no type: `README.md` and the two under `.lawcheck/`. The nine checks, in this order:

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

Each check is `ok`, `note`, `fail` or `skip`. A check is `skip`, with `needs <check>`, when a check it needs did not pass. A `note` or `fail` line is followed by its `next:` line.

### --base `<ref>`

The base for the `base` and `law-change` checks. Without the flag, `LAWCHECK_BASE`, then `origin/HEAD`, as for `check`.

### --reviewer

Sends the reviewer one small test request, which asks for a pass. The `reviewer` check fails when no reviewer is set, when the reviewer cannot be called, or when its answer is no pass.

### --json

Prints `lawcheck-doctor/0`.

### Exit codes of doctor

| Code | Meaning |
|---|---|
| 0 | no check failed; notes are allowed |
| 2 | a check failed |

`doctor` never exits 1.

## --version

`lawcheck --version` prints the version of the installed package, and exits 0. It works only as the one argument:

```output
0.1.0-alpha.2
```

## --help

`lawcheck --help` prints one line for each command, and exits 0. `lawcheck <command> --help` prints that command's usage, its flags and, for `check` and `try`, its exit codes. `--help` works only as the one argument, or as the one argument after a command. `lawcheck --help` prints:

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
