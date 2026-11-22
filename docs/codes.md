# Codes

A run stopped with `error[type-overlap]`, or a finding came back as `warning[uses-not-read]`, and you need the step that clears it. Each code Lawcheck prints has a heading of its own on this page, so `law-invalid` is under `## law-invalid`.

A finding is a line of `check`'s report and comes with its rule's `why`, or with the fixed why below for a built-in code. An exit-2 code stops the run before any conclusion, and its output ends with one `next:` line that says what to fix. Lawcheck prints the `why:` line once for each code, under its first error or finding.

| Code | Kind | When | Why |
|---|---|---|---|
| `usage` | exit 2 | the arguments break the command's usage line | the tool does only what its usage line says |
| `unsupported-environment` | exit 2 | Lawcheck runs where it is not supported: Node older than 24, a run on Bun, Yarn's Plug'n'Play, git older than 2.34, or `--permission` in `NODE_OPTIONS`; the first line names the cause | Lawcheck answers only where its rules and readers are known to run |
| `not-initialized` | exit 2 | no `.lawcheck/law.yaml` here or above | without a law there is nothing to check the code against |
| `already-initialized` | exit 2 | `init` finds a law here, above or below | a second law would split one repository's rules between two files |
| `no-git` | exit 2 | git cannot be started, refuses the repository, or the root is outside a git work tree; for a repository owned by another user the next line gives git's `safe.directory` command | the files and the change come from git |
| `law-invalid` | exit 2 | the law cannot be read, does not parse, or breaks its rules: a key, a value, an id, a pattern, an expression | a misspelled key changes the law without a word |
| `config-invalid` | exit 2 | `.lawcheck/config.yaml` holds an unknown key or a wrong value | a misspelled setting changes the reviewer without a word |
| `rule-missing-file` | exit 2 | a rule has neither its `.mjs` nor its `.md` file | a rule without its file would never be checked |
| `rule-file-without-entry` | exit 2 | a file in `.lawcheck/rules/` outside `lib/` is no rule of the law, or a rule has both files | a rule file that the law does not name never runs |
| `file-unreadable` | exit 2 | a file that must be read cannot be | a file that cannot be read cannot be typed or judged |
| `file-too-large` | exit 2 | a file passes its limit: 16 MiB or 1,048,576 lines as text, 1 MiB for the config; the law 1 MiB, 10,000 rules, 1,000 types | a run holds every file it reads as text in memory, so one file may hold only so much |
| `text-too-large` | exit 2 | the files a run reads hold more than 128 MiB of text | a run holds the text it reads in memory, so all of it may hold only so much |
| `file-unwritable` | exit 2 | a file or folder the tool must write cannot be written | what Lawcheck cannot write is lost, so the run cannot say it is done |
| `type-overlap` | exit 2 | two types of one level match one file | a file has one type, so the rules that bind it are never in doubt |
| `base-unreachable` | exit 2 | the base names no commit, or shares no history with `HEAD`, or a CI job has no base; in a shallow clone the next line gives the fetch that brings the history | without its base a change cannot be told from debt |
| `link-outside-root` | exit 2 | a script rule is to run, and a link git tracks under the root or in a submodule leads outside the git work tree and Lawcheck's folder | a script rule reads nothing outside the work tree, and a link that leads out of it would let it |
| `path-unsupported` | exit 2 | a script rule is to run, and the path of the root or of Lawcheck holds a `*` or, outside Windows, a backslash, where the runner cannot keep the rule inside the root | a script rule reads nothing outside the root and Lawcheck's folder, and the runner can keep that only on such a path |
| `runner-failed` | exit 2 | the process that runs script rules ends before it starts, and the message gives the line Node printed | a runner that does not start says nothing about the rules |
| `rule-crashed` | exit 2 | a script rule does not load, throws, returns no list of findings, returns a message over 4,096 characters, or passes 30 seconds | a broken rule says nothing about the code |
| `too-many-findings` | exit 2 | a run's findings pass 200,000, or 16,777,216 characters of message | a run holds every finding in memory, so it may hold only so many |
| `rules-too-slow` | exit 2 | the script rules of a run take over 600 seconds | a run that never ends gives no answer |
| `parser-failed` | exit 2 | a grammar cannot be loaded, or a reader fails on a file | a file whose uses were not read is not taken to use nothing |
| `reviewer-not-configured` | exit 2 | reviews are to be asked and no provider is set | reviewer rules need a reviewer to judge them |
| `too-many-reviews` | exit 2 | a run needs more reviewer calls than its cap | reviewer.max_calls bounds what one run spends |
| `reviewer-unreachable` | exit 2 | the reviewer cannot be called, or a request fails | without the reviewer's answer a reviewer rule says nothing |
| `reviewer-bad-answer` | exit 2 | the reviewer's answer is no verdict twice | an answer that is no verdict cannot be recorded |
| `memory-too-large` | exit 2 | the run passes its memory | a run past its memory would be ended by the system |
| `step-too-slow` | exit 2 | one step of a run, such as typing one file, takes more than 30 seconds | a step that never ends gives no answer, so one step of a run has a limit of time |
| `stopped` | exit 2 | SIGINT, SIGTERM or SIGHUP ended the run | a run stopped before its end says nothing about the code |
| `internal` | exit 2 | any other failure, a fault of Lawcheck included | a fault of Lawcheck says nothing about the code |
| `not-reviewed` | finding | a reviewer rule has no verdict for a file's content | a reviewer rule says nothing about content it has not judged |
| `too-large-to-review` | finding | a prompt would exceed `reviewer.max_chars`; under `try` it ends the run with exit 2 | the reviewer is never sent more than reviewer.max_chars characters |
| `forbidden-use` | finding | a file uses a file its `may_use` list does not allow | a type's may_use names every type its files may use |
| `uses-not-read` | finding | a type with a list in force has no reader, or a file is over 512 KiB for its uses | a restriction that cannot be checked is not shown as kept |
| `waiver-unknown-rule` | finding | a waiver names no rule of the law | a waiver that names no rule of the law waives nothing |
| `waiver-without-reason` | finding | a waiver has no reason after `--` | a waiver without a reason cannot be weighed later |
| `waiver-unused` | finding | a counted waiver drops no finding | a waiver that drops nothing would hide the next finding on its line |

A finding of a rule of the law carries the rule's id as its code, and the rule's own `why`. A rule id may not equal any code above.

Each example below is the output of a test of Lawcheck's suite, run on the sample repository the suite builds. A path under `/home/you/projects` stands for the temporary folder of that test, and `/usr/local/bin/node` for the node that runs it.

## usage

**Meaning**

The command line breaks the usage line of its command, and Lawcheck runs nothing.

**Typical cause**

A flag the command does not have, a flag given twice or without its value, or the name of a rule, a type or a topic that does not exist.

**Fix**

Run the command the `next:` line names, such as `lawcheck docs --help`, and type the command again as its usage line shows it.

**Example**

```text
$ lawcheck docs codez
lawcheck: ERROR  1 error

error[usage]  there is no topic 'codez' (did you mean 'codes'?); lawcheck docs lists them
  why:  the tool does only what its usage line says

next: run lawcheck docs as its usage line says: lawcheck docs --help
```

## unsupported-environment

**Meaning**

Lawcheck refuses to run on this machine. The first line of the output names the cause.

**Typical cause**

Node older than 24, a run on Bun, a Lawcheck that Yarn's Plug'n'Play serves from a zip archive, git older than 2.34, or `--permission` in `NODE_OPTIONS`.

**Fix**

Each cause has its own step, and the `next:` line names it:

- Node older than 24: install Node 24 or later.
- Bun: start Lawcheck as `bun x --no-install lawcheck`, without `--bun`, so it runs on the `node` of the `PATH`. With no `node` there, install Node 24 beside Bun.
- Plug'n'Play: set `nodeLinker: node-modules` in `.yarnrc.yml` and run `yarn install`.
- git older than 2.34: install git 2.34 or later.
- `--permission`: start Lawcheck with `NODE_OPTIONS` free of `--permission`.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  Node 20.20.2 is older than 24, the oldest Node Lawcheck runs on

error[unsupported-environment]  Node 20.20.2 is older than 24, the oldest Node Lawcheck runs on
  why:  Lawcheck answers only where its rules and readers are known to run

next: install Node 24 or later, then run lawcheck check
```

## not-initialized

**Meaning**

Lawcheck finds no `.lawcheck/law.yaml` in the folder it runs in or in any folder above it.

**Typical cause**

The repository has no law yet, or you run Lawcheck in a folder outside the one that holds `.lawcheck/`.

**Fix**

Run `lawcheck init` at the root of the code to check, or run the command again from inside the folder that holds `.lawcheck/`.

**Example**

```text
$ lawcheck check
lawcheck: ERROR  1 error

error[not-initialized]  no .lawcheck/law.yaml in this directory or any above it
  why:  without a law there is nothing to check the code against

next: write .lawcheck/law.yaml at the root of the code to check, then run lawcheck check
```

## already-initialized

**Meaning**

`init` finds a law in this folder, in a folder above it or in one below it, and writes nothing.

**Typical cause**

You run `lawcheck init` a second time, or in a package of a repository whose root already has a law.

**Fix**

Run `lawcheck doctor` to see the law that governs this folder, and edit that law in place of a second one.

**Example**

```text
$ lawcheck init
lawcheck: ERROR  1 error

.lawcheck/law.yaml  error[already-initialized]  a law already governs this directory
  why:  a second law would split one repository's rules between two files

next: lawcheck doctor  (shows how the law here stands)
```

## no-git

**Meaning**

Lawcheck takes the files and the change from git, and git cannot give them here. The message names the cause, with the line git printed where git printed one.

**Typical cause**

The folder is no git work tree, git is not on the `PATH`, the repository is damaged, or another user owns it and git refuses it.

**Fix**

Run the command inside a git work tree, with git on the `PATH`. For a repository another user owns, run the `git config --global --add safe.directory` command that the `next:` line gives.

**Example**

```text
$ lawcheck check
lawcheck: ERROR  1 error

error[no-git]  git does not see a work tree here: fatal: not a git repository (or any of the parent directories): .git
  why:  the files and the change come from git

next: run lawcheck check inside a git work tree, with git on the PATH
```

## law-invalid

**Meaning**

Lawcheck cannot use `.lawcheck/law.yaml`. The error names the line of the law where it has one.

**Typical cause**

A misspelled key, such as rulez for `rules`, a wrong value, a bad rule or type id, a type that lists a rule the law does not have, or a pattern or `content` expression that does not parse.

**Fix**

Edit `.lawcheck/law.yaml` at the line the error names, then run the command again. `lawcheck docs law` lists every key.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

.lawcheck/law.yaml:2  error[law-invalid]  unknown key 'rulez' at the top of the law (did you mean 'rules'?)
  why:  a misspelled key changes the law without a word

next: fix .lawcheck/law.yaml, then run lawcheck check
```

## config-invalid

**Meaning**

Lawcheck cannot use `.lawcheck/config.yaml`. The error names the line where it has one.

**Typical cause**

An unknown key, such as bogus, a wrong value, or a reviewer provider that Lawcheck cannot set up from the settings.

**Fix**

Edit `.lawcheck/config.yaml` at the line the error names, then run the command again. `lawcheck docs config` lists every key.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

.lawcheck/config.yaml:1  error[config-invalid]  unknown key 'bogus' at the top of the config
  why:  a misspelled setting changes the reviewer without a word

next: fix .lawcheck/config.yaml, then run lawcheck check
```

## rule-missing-file

**Meaning**

A rule of the law has neither its script `.lawcheck/rules/<id>.mjs` nor its prompt `.lawcheck/rules/<id>.md`, or its `.md` file holds only whitespace.

**Typical cause**

You add a rule to the law before you write its file, or you rename or delete the file and leave the rule in the law.

**Fix**

Write `.lawcheck/rules/<id>.mjs` for a script rule or `.lawcheck/rules/<id>.md` for a reviewer rule, or take the rule out of `.lawcheck/law.yaml`.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

.lawcheck/law.yaml:6  error[rule-missing-file]  the rule 'no-todo' has neither .lawcheck/rules/no-todo.mjs nor .lawcheck/rules/no-todo.md
  why:  a rule without its file would never be checked

next: ask the user to write the rule files the law names or to take their rules out of the law, then run lawcheck check
```

## rule-file-without-entry

**Meaning**

A file in `.lawcheck/rules/`, outside `lib/`, belongs to no rule of the law, or one rule has both a `.mjs` and a `.md` file.

**Typical cause**

You write a rule file and forget its entry under `rules:` in the law, you keep a shared module next to the rules, or a reviewer rule keeps the script it replaced.

**Fix**

Add the rule to `rules:` in `.lawcheck/law.yaml`, move a shared module to `.lawcheck/rules/lib/`, or delete one of the two files of a rule.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

.lawcheck/rules/extra.mjs  error[rule-file-without-entry]  the file is no rule of the law and lies outside .lawcheck/rules/lib/
  why:  a rule file that the law does not name never runs

next: add a rule for .lawcheck/rules/extra.mjs to the law, or move the file to .lawcheck/rules/lib/, then run lawcheck check
```

## file-unreadable

**Meaning**

Lawcheck must read a file and the system refuses. The message gives the reason, such as the error code `EACCES`.

**Typical cause**

The file has no read permission for you, or the path is no regular file, such as a folder or a named pipe.

**Fix**

Give yourself read permission on the file, or replace the path with a regular file.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

src/core/price.ts  error[file-unreadable]  the file cannot be read (EACCES)
  why:  a file that cannot be read cannot be typed or judged

next: make src/core/price.ts readable, then run lawcheck check
```

## file-too-large

**Meaning**

One file passes the limit of what Lawcheck reads from it. A file read as text may hold 16 MiB and 1,048,576 lines. The law and the config may each hold 1 MiB, and the law 10,000 rules and 1,000 types.

**Typical cause**

A type's paths match a generated file, a bundle or a data dump.

**Fix**

Add a pattern that starts with `!` to the type's `paths` in `.lawcheck/law.yaml`, such as `"!src/core/edge.ts"`, or make the file smaller.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

src/core/edge.ts  error[file-too-large]  the file holds 16,777,217 bytes, more than the 16 MiB a file read as text may hold
  why:  a run holds every file it reads as text in memory, so one file may hold only so much

next: leave src/core/edge.ts out of the types with a pattern that starts with ! in .lawcheck/law.yaml, or make it smaller than 16 MiB, then run lawcheck check
```

## text-too-large

**Meaning**

The files one run reads hold more than 128 MiB of text together. The error names the file that passed the limit.

**Typical cause**

The types match many large files, such as a folder of generated code or test data.

**Fix**

Add `!` patterns to the `paths` of the types in `.lawcheck/law.yaml`, so the files they match hold at most 128 MiB of text.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

src/core/big/t9.ts  error[text-too-large]  the text of the files read in this run reaches 141,557,827 bytes with this file, more than the 128 MiB one run may read
  why:  a run holds the text it reads in memory, so all of it may hold only so much

next: narrow the paths of the types in .lawcheck/law.yaml, so that the files they match hold at most 128 MiB of text, then run lawcheck check
```

## file-unwritable

**Meaning**

Lawcheck must write a file or a folder and cannot. The error names it.

**Typical cause**

A file stands where Lawcheck makes a folder, such as a file named `.lawcheck`, the folder is read-only, the disk is full, the verdicts file would pass 16 MiB, or standard output is closed.

**Fix**

Edit the place the error names: move the file that stands there, or give yourself write permission on it, then run the command again.

**Example**

```text
$ lawcheck init
lawcheck: ERROR  1 error

.lawcheck  error[file-unwritable]  it is a file, so the folder .lawcheck cannot be made
  why:  what Lawcheck cannot write is lost, so the run cannot say it is done

next: move .lawcheck out of the way, then run lawcheck init again
```

## type-overlap

**Meaning**

Two types of one level match the same file. A file has one type, so Lawcheck stops before it judges anything.

**Typical cause**

A new type's `paths` cover files an older type already takes, such as `src/core/**` beside `src/**`.

**Fix**

Run `lawcheck explain <path>` on the file the error names. Then add a `!` pattern to the `paths` of one of the two types, or narrow its `content`, in `.lawcheck/law.yaml`.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  2 errors

src/core/price.ts  error[type-overlap]  the file matches the types 'source' and 'core' of one level
  why:  a file has one type, so the rules that bind it are never in doubt
src/core/tax.ts  error[type-overlap]  the file matches the types 'source' and 'core' of one level

next: narrow the paths or content of the types that overlap in .lawcheck/law.yaml, then run lawcheck check
```

## base-unreachable

**Meaning**

Lawcheck cannot reach the base it compares the change with, so it cannot tell new findings from debt.

**Typical cause**

A `--base` or `LAWCHECK_BASE` that names no branch here, a shallow clone in CI, a base of forty zeros from the push of a new branch, a base that ends with `/` because the variable after it was empty, or a CI job with no base at all.

**Fix**

Run the command again with a `--base` that names a branch or commit here, such as `--base origin/main`. In a shallow clone, run the `git fetch` command the `next:` line gives, or set `fetch-depth: 0` in `actions/checkout`.

**Example**

```text
$ lawcheck check --base nope
lawcheck: ERROR  1 error

error[base-unreachable]  the base 'nope' names no commit here
  why:  without its base a change cannot be told from debt

next: pass --base with a branch or a commit that exists here
```

## link-outside-root

**Meaning**

A script rule is about to run, and a link that git tracks leads outside the git work tree and Lawcheck's folder. A script rule could read files outside the repository through it, so Lawcheck runs no rule.

**Typical cause**

A committed link to a shared folder beside the repository, or to a folder of your home.

**Fix**

Run `git rm` on the link, or point it at a place inside the work tree.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

outside  error[link-outside-root]  the link leads to /home/you/projects/beside, outside the git work tree and Lawcheck's folder, and a script rule could read through it
  why:  a script rule reads nothing outside the work tree, and a link that leads out of it would let it

next: remove the link outside, or let it lead inside the work tree, then run lawcheck check
```

## path-unsupported

**Meaning**

A script rule is about to run, and the path of the repository or of Lawcheck holds a `*`, or a backslash outside Windows. On such a path the runner of script rules cannot keep a rule inside the root.

**Typical cause**

A folder named with a `*`, such as `zone*`, somewhere in the path of the repository or of the Lawcheck installation.

**Fix**

Give the repository and Lawcheck's folder paths with no `*` and no backslash, then run the command again.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

error[path-unsupported]  the root /home/you/projects/zone*/s holds a *, which the runner of script rules reads as a wildcard, so a rule could read the folders beside it
  why:  a script rule reads nothing outside the root and Lawcheck's folder, and the runner can keep that only on such a path

next: move the repository, or Lawcheck itself, to a path with no * or backslash, then run lawcheck check; Lawcheck grants a rule read access to its own folder for the readers it ships, so that path must be as plain as the root
```

## runner-failed

**Meaning**

The Node process that runs the script rules ended before it started. The message holds the line Node printed.

**Typical cause**

A damaged installation of Lawcheck, or a Node that refuses the options the runner starts with.

**Fix**

Install Lawcheck again, such as with `npm install --save-dev lawcheck`, then run the command again.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

error[runner-failed]  the runner of script rules did not start: /usr/local/bin/node: bad option: --no-such-flag
  why:  a runner that does not start says nothing about the rules

next: reinstall Lawcheck, then run lawcheck check
```

## rule-crashed

**Meaning**

A script rule broke, so it says nothing about the code. The error names the rule's file, the file it judged and the cause.

**Typical cause**

The rule throws, does not load, returns something other than a list of findings, returns a message over 4,096 characters, or takes more than 30 seconds on one file. A rule that imports a package from above the root fails to load too.

**Fix**

Run `lawcheck try <rule> <path>` with the rule and the file the error names, and fix `.lawcheck/rules/<rule>.mjs` until `try` ends without an error.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

.lawcheck/rules/no-console.mjs  error[rule-crashed]  throws on src/core/discount.ts: broken
  why:  a broken rule says nothing about the code

next: fix .lawcheck/rules/no-console.mjs, then run lawcheck check
```

## too-many-findings

**Meaning**

The rules of one run returned more than 200,000 findings, or more than 16,777,216 characters of message in all.

**Typical cause**

A rule that reports every line of a file, or a rule listed by a type that matches generated code.

**Fix**

Edit the rule so it returns one finding for each real breach, or narrow the `paths` of the types that list it.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

.lawcheck/rules/no-console.mjs  error[too-many-findings]  returns 200,001 findings with 200,001 characters of message in this run; the rules of a run may return 200,000 findings with 16,777,216 characters of message in all, and they returned 200,001 with 200,001
  why:  a run holds every finding in memory, so it may hold only so many

next: make the rules return fewer findings, or narrow the types that list them, then run lawcheck check
```

## rules-too-slow

**Meaning**

The script rules of one run took more than 600 seconds together. Lawcheck stops them and names each rule that had not finished.

**Typical cause**

A rule that takes many seconds on each file, such as one that starts a program for every file, on a type with hundreds of files.

**Fix**

Edit the rules the error names so each file takes less time, or narrow the `paths` of the types that list them.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  3 errors

.lawcheck/rules/slow-a.mjs  error[rules-too-slow]  had not finished on src/core/f21.ts when the script rules of this run passed the 600 seconds they may take together
  why:  a run that never ends gives no answer
.lawcheck/rules/slow-b.mjs  error[rules-too-slow]  had not finished on src/core/f21.ts when the script rules of this run passed the 600 seconds they may take together
.lawcheck/rules/slow-c.mjs  error[rules-too-slow]  had not finished on src/core/f21.ts when the script rules of this run passed the 600 seconds they may take together

next: make the slow rules faster, or narrow the types that list them, then run lawcheck check
```

## parser-failed

**Meaning**

Lawcheck could not read the uses of a file, so it cannot judge the file's `may_use`.

**Typical cause**

A grammar file of Lawcheck's installation is damaged or missing, or a reader fails on one file.

**Fix**

Install Lawcheck again, such as with `npm install --save-dev lawcheck`, then run the command again.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

error[parser-failed]  the grammar of typescript cannot be loaded: byte length of Uint32Array should be a multiple of 4
  why:  a file whose uses were not read is not taken to use nothing

next: reinstall Lawcheck; a grammar it ships cannot be loaded
```

## reviewer-not-configured

**Meaning**

You asked for reviews, and `.lawcheck/config.yaml` names no reviewer.

**Typical cause**

`check --review` in a repository whose `.lawcheck/config.yaml` has no provider in its `reviewer` section.

**Fix**

Write a `provider` and a `model` in the `reviewer` section of `.lawcheck/config.yaml`. `lawcheck docs providers` lists the providers.

**Example**

```text
$ lawcheck check --review --base main
lawcheck: ERROR  1 error

error[reviewer-not-configured]  no reviewer.provider is set in .lawcheck/config.yaml
  why:  reviewer rules need a reviewer to judge them

next: ask the user to set reviewer.provider and reviewer.model in .lawcheck/config.yaml, then run lawcheck check --review --base main
```

## too-many-reviews

**Meaning**

The run needs more reviewer calls than its cap allows, so Lawcheck sends none.

**Typical cause**

A change that touches many files under reviewer rules, against the default cap of `reviewer.max_calls` or a lower `--max-calls`.

**Fix**

Give `reviewer.max_calls` a higher value in `.lawcheck/config.yaml`, pass a higher `--max-calls`, or name fewer paths to `check`.

**Example**

```text
$ lawcheck check --review --base main --max-calls 0
lawcheck: ERROR  1 error

error[too-many-reviews]  this run needs 1 reviewer calls and may send 0
  why:  reviewer.max_calls bounds what one run spends

next: 1 reviewer calls are needed and the limit is 0; raising reviewer.max_calls or --max-calls is the user's decision
```

## reviewer-unreachable

**Meaning**

Lawcheck could not call the reviewer, or the reviewer answered a request with an error.

**Typical cause**

No key in the environment, no endpoint for `openai-compatible`, a program provider whose program is not on the `PATH`, an HTTP error, a timeout, or no network.

**Fix**

Add what the message names to the environment, such as `LAWCHECK_REVIEWER_ENDPOINT` or the provider's key, then run the same command again. `check` keeps every answer it already has and asks only the rest, and `try` keeps none.

**Example**

```text
$ lawcheck check --review --base main
lawcheck: ERROR  1 error

error[reviewer-unreachable]  openai-compatible cannot be called: openai-compatible needs the address of its endpoint in LAWCHECK_REVIEWER_ENDPOINT
  why:  without the reviewer's answer a reviewer rule says nothing

next: set LAWCHECK_REVIEWER_ENDPOINT to the base address of the server, such as http://localhost:8000/v1, then run lawcheck check --review --base main
```

## reviewer-bad-answer

**Meaning**

The reviewer answered twice, and neither answer held a verdict Lawcheck can record.

**Typical cause**

A model that answers in prose where Lawcheck asks for a JSON object with a verdict.

**Fix**

Run the same command again. `check` keeps every answer it already has and asks only the rest. If the same file fails again, set a stronger `model` in the `reviewer` section of `.lawcheck/config.yaml`.

**Example**

```text
$ lawcheck check --review --base main
lawcheck: ERROR  1 error

src/core/refund.ts  error[reviewer-bad-answer]  clear-errors: the answer is no verdict twice (the answer holds no JSON object with a verdict; then the answer holds no JSON object with a verdict)
  why:  an answer that is no verdict cannot be recorded

next: run the same command again; what was answered is kept, so it asks only the rest
```

## memory-too-large

**Meaning**

The run passed the memory it may hold, and Lawcheck ended it before the system did.

**Typical cause**

One file that adds more than 384 MiB of memory while Lawcheck reads it, a run past 1,536 MiB, or past 85 percent of the machine's memory where that is less, or a system with less than 128 MiB left.

**Fix**

Run the step of the `next:` line. For one large file, keep it out of the files git lists with `git rm --cached` and a line in `.gitignore`, or leave it out of the types whose `may_use` is in force.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

cs/gen/Big.cs  error[memory-too-large]  the run grew by more than the 384 MiB of memory one file may add while reading what cs/gen/Big.cs declares
  why:  a run past its memory would be ended by the system

next: keep cs/gen/Big.cs out of the files git lists here (git rm --cached, and a line in .gitignore), since Lawcheck reads it for what it declares, then run lawcheck check again
```

## step-too-slow

**Meaning**

One step of the run, such as typing one file or one call of git, took more than 30 seconds without an end. The error names the step.

**Typical cause**

A `content` pattern of a type that backtracks on a long line, such as `^(a|a)+$`, or a git that does not answer.

**Fix**

Edit the `content` pattern the step names so it cannot backtrack, or fix the program that hangs, then run the command again.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

error[step-too-slow]  one step of the run took more than 30 seconds without an end: typing slow/a.ts
  why:  a step that never ends gives no answer, so one step of a run has a limit of time

next: make the step named faster, such as a type's content pattern that backtracks, then run lawcheck check again
```

## stopped

**Meaning**

A signal ended the run before its end: SIGINT, SIGTERM or SIGHUP.

**Typical cause**

You end the run from its terminal, CI cancels the job, or the program that started Lawcheck ends it at its own timeout.

**Fix**

Run the command again and let it end.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

error[stopped]  stopped by SIGTERM
  why:  a run stopped before its end says nothing about the code

next: run lawcheck check again and let it end
```

## internal

**Meaning**

Lawcheck failed in a way no other code names.

**Typical cause**

A fault in Lawcheck, such as an exception it does not catch.

**Fix**

Run the command again. If the error stays, report it at https://github.com/krzysztofdudek/Lawcheck/issues with the command and its output.

**Example**

```text
$ lawcheck check
lawcheck: ERROR  1 error

error[internal]  the handler broke
  why:  a fault of Lawcheck says nothing about the code

next: run lawcheck check again, and report the error if it stays
```

## not-reviewed

**Meaning**

A reviewer rule has no verdict for the content a file has now. A plain `check` calls no model, so it reports the file as not reviewed.

**Typical cause**

You changed a file that a reviewer rule judges, and nobody ran `check --review` since, or nobody committed `.lawcheck/verdicts` after the review.

**Fix**

Run the command of the `next:` line, such as `lawcheck check --review --base main`, then commit `.lawcheck/verdicts`.

**Example**

```text
$ lawcheck check --base main
lawcheck: FAIL  1 error in 1 changed file (against main), 1 waiver

src/core/refund.ts  error[not-reviewed]  clear-errors has no verdict for this content
  why:  a reviewer rule says nothing about content it has not judged

next: lawcheck check --review --base main  (1 reviewer call)
```

## too-large-to-review

**Meaning**

The prompt for a file would hold more characters than `reviewer.max_chars`, so Lawcheck never sends it. Under `try` this code ends the run with exit 2.

**Typical cause**

A large file under a reviewer rule, or a rule whose `context` files fill most of the prompt.

**Fix**

Leave the file out of the type with a `!` pattern, split it, or give `reviewer.max_chars` a higher value in `.lawcheck/config.yaml`.

**Example**

```text
$ lawcheck check --base main
lawcheck: FAIL  1 error in 2 changed files (against main), 1 waiver
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
note: this change edits the law that judges it: changes .lawcheck/config.yaml; adds a waiver of clear-errors in src/core/refund.ts

src/core/refund.ts  error[too-large-to-review]  the prompt for clear-errors holds 2127 characters; reviewer.max_chars is 2126
  why:  the reviewer is never sent more than reviewer.max_chars characters

next: fix src/core/refund.ts
```

## forbidden-use

**Meaning**

A file uses a file of a type that its own type's `may_use` list does not name.

**Typical cause**

An import that crosses a layer, such as code in `src/core/` that imports from `src/cli/`.

**Fix**

Edit the code so the use goes in the allowed direction, or add the used type to `may_use` in `.lawcheck/law.yaml` when the law should allow it.

**Example**

```text
$ lawcheck check --base main
lawcheck: FAIL  1 error in 1 changed file (against main)

src/core/report.ts:2  error[forbidden-use]  library may not use command (src/cli/main.ts); it takes may_use [library] from source
  why:  a type's may_use names every type its files may use

next: fix src/core/report.ts:2
```

## uses-not-read

**Meaning**

A type has a `may_use` list in force, and Lawcheck reads no uses from some of its files, so the list does not hold for them. The finding is a warning.

**Typical cause**

A type whose `paths` take files in a language Lawcheck has no reader for, such as `.json`, or a file over 512 KiB.

**Fix**

Leave the files out of the type with a `!` pattern, such as `"!src/**/*.json"`. `lawcheck docs languages` lists what Lawcheck reads.

**Example**

```text
$ lawcheck check --base main
lawcheck: PASS  1 warning in 2 changed files (against main)
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
note: this change edits the law that judges it: changes the paths of the type source

.lawcheck/law.yaml:17  warning[uses-not-read]  1 file of type library is not read for uses: 1 .json
  why:  a restriction that cannot be checked is not shown as kept
```

## waiver-unknown-rule

**Meaning**

A waiver names no rule of the law, so it waives nothing.

**Typical cause**

A misspelled rule id, a rule taken out of the law while its waivers stayed, or a marker that runs on into the next word with no space before the id.

**Fix**

Write a rule id of the law after the marker, or delete the waiver. `lawcheck docs waivers` shows the form.

**Example**

```text
$ lawcheck check --base main
lawcheck: FAIL  2 errors, 1 warning in 1 changed file (against main), 1 waiver

src/core/discount.ts:2  error[waiver-unknown-rule]  the waiver names 'no-such', which is no rule of the law
  why:  a waiver that names no rule of the law waives nothing
src/core/discount.ts:3  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
src/core/discount.ts:4  warning[no-todo]  TODO without an issue number
  why:  A TODO without an issue number gets forgotten.

next: fix src/core/discount.ts:2
```

## waiver-without-reason

**Meaning**

A waiver has no reason after `--`, so Lawcheck does not take it.

**Typical cause**

A waiver that ends with its rule id, with no `--` and no reason after it.

**Fix**

Add `--` and the reason after the rule id. `lawcheck docs waivers` shows the form.

**Example**

```text
$ lawcheck check --base main
lawcheck: FAIL  2 errors, 1 warning in 1 changed file (against main), 1 waiver

src/core/discount.ts:2  error[waiver-without-reason]  the waiver of 'no-console' gives no reason after --
  why:  a waiver without a reason cannot be weighed later
src/core/discount.ts:3  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
src/core/discount.ts:4  warning[no-todo]  TODO without an issue number
  why:  A TODO without an issue number gets forgotten.

next: fix src/core/discount.ts:2
```

## waiver-unused

**Meaning**

A waiver drops no finding on the line it covers. The finding is a warning.

**Typical cause**

You fixed the line and kept the waiver, or the waiver stands on a line the rule never reports.

**Fix**

Edit the line and take the waiver out.

**Example**

```text
$ lawcheck check --base main
lawcheck: FAIL  1 error, 2 warnings in 1 changed file (against main), 2 waivers

src/core/discount.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
src/core/discount.ts:3  warning[no-todo]  TODO without an issue number
  why:  A TODO without an issue number gets forgotten.
src/core/discount.ts:7  warning[waiver-unused]  the waiver of 'no-console' drops no finding
  why:  a waiver that drops nothing would hide the next finding on its line

next: fix src/core/discount.ts:2
```

## Notes

A note is a line that starts with `note:` under the first line of `check` or `init`. It changes no exit code and carries no code. `doctor` marks a check of its report with `note` instead, and the `next:` line under it gives the step.

| Text | When | Fix |
|---|---|---|
| `note: the law changed in this change; lawcheck check --full ...` | a plain `check` judges a change that edits `.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a file of `.lawcheck/rules/` | run the `check --full` command of the note to see what the new law finds in the rest of the code |
| `note: this change edits the law that judges it: ...` | the same change; the note lists what it changes in the law, such as types, rules, `may_use` and the waivers it adds | read the list before you accept the change |
| `note: the paths of a type reach into ...` | the paths of a type reach into a submodule or a repository of its own, and Lawcheck judges no file there | run Lawcheck in that repository with its own law |
| `note: <path> lies in ...` | a path named to `check` lies in a submodule or a repository of its own | run Lawcheck in that repository |
| `note: the law covers only the files below ...` | `init` runs in a folder below the top of the git work tree | run `init` at the top if the law should cover the whole repository |

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
