# Codes

Each code that Lawcheck prints has a heading of its own on this page. Under it stand four parts: what the code means, its typical cause, the step that clears it and an example. If a run stops with `error[type-overlap]`, you find the step under `## type-overlap`.

The table below gives each code one of two kinds, exit 2 or finding. With a code of the kind exit 2, Lawcheck stops the run before it gives a PASS or a FAIL. Lawcheck then exits with code 2. Its output ends on one `next:` line that says what to fix. When the run had sent requests to a reviewer before it stopped on a reviewer's failure, a bad answer or too many findings, the first line ends with their count, as in `lawcheck: ERROR  1 error, 2 reviewer calls`, and with `--json` the document says it in `calls_made`. A request that Lawcheck sends again counts as one more. An error that stops the run before its first request names no count, and neither does `file-unwritable`.

A code of the kind finding names a [finding](concepts.md#finding) in the report of `check`. The report opens with the PASS or FAIL of the run. Each finding below it starts a line of its own.

Lawcheck prints a `why:` line under the first error or finding of each code. Its text depends on the code:

- for a rule of the law, it is the rule's own `why`;
- for a built-in code, it is the Why column of the table below.

Two words recur below. The root is the folder that holds `.lawcheck/`. A rule binds a file when the file's type, or a type above it, lists the rule.

| Code | Kind | When | Why |
|---|---|---|---|
| `usage` | exit 2 | the command line breaks its usage line | the tool does only what its usage line says |
| `unsupported-environment` | exit 2 | Lawcheck runs where it is not supported; the first line names the cause | Lawcheck answers only where its rules and readers are known to run |
| `not-initialized` | exit 2 | no `.lawcheck/law.yaml` here or above | without a law there is nothing to check the code against |
| `already-initialized` | exit 2 | `init` finds a law here, above or below | a second law would split one repository's rules between two files |
| `no-git` | exit 2 | git cannot give the files and the change here | the files and the change come from git |
| `law-invalid` | exit 2 | Lawcheck cannot read or parse the law, or the law breaks its rules | a misspelled key changes the law without a word |
| `config-invalid` | exit 2 | `.lawcheck/config.yaml` holds an unknown key or a wrong value | a misspelled setting changes the reviewer without a word |
| `rule-missing-file` | exit 2 | a rule has neither its `.mjs` nor its `.md` file | a rule without its file would never be checked |
| `rule-file-without-entry` | exit 2 | a file in `.lawcheck/rules/` outside `lib/` is no rule of the law, or a rule has both files | a rule file that the law does not name never runs |
| `file-unreadable` | exit 2 | Lawcheck cannot read a file it must read | a file that cannot be read cannot be typed or judged |
| `file-too-large` | exit 2 | one file passes its limit | a run holds every file it reads as text in memory, so one file may hold only so much |
| `text-too-large` | exit 2 | the files a run reads hold more than 128 MiB of text | a run holds the text it reads in memory, so all of it may hold only so much |
| `file-unwritable` | exit 2 | Lawcheck cannot write a file or folder it must write | what Lawcheck cannot write is lost, so the run cannot say it is done |
| `type-overlap` | exit 2 | two types of one level match one file | a file has one type, so the rules that bind it are never in doubt |
| `base-unreachable` | exit 2 | the base names no commit, shares no history with `HEAD`, or the repository has no commit; or a CI job has no base | without its base a change cannot be told from debt |
| `law-from-unreachable` | exit 2 | `--law-from` names no commit here, or a commit with no `.lawcheck/law.yaml` at the place of the root | a change judged by the law of a commit needs that law |
| `law-from-packages` | exit 2 | under `--law-from`, git lists a file in `.lawcheck/node_modules` or `.lawcheck/.local` | a change judged by the law of a commit cannot supply the code that law runs |
| `link-outside-root` | exit 2 | a script rule or a companion is to run, and a link git tracks leads outside the work tree | a script rule reads nothing outside the work tree, and a link that leads out of it would let it |
| `path-unsupported` | exit 2 | a script rule or a companion is to run, and the path of the root or of Lawcheck holds a `*` or a backslash | a script rule reads nothing outside the root and Lawcheck's folder, and the runner can keep that only on such a path |
| `runner-failed` | exit 2 | the process that runs script rules does not start | a runner that does not start says nothing about the rules |
| `rule-crashed` | exit 2 | a script rule does not load, throws, returns no list of findings, returns a message over 4,096 characters, or passes 30 seconds; or a reviewer rule's companion fails the same way or returns a path that is no file to send | a broken rule says nothing about the code |
| `too-many-findings` | exit 2 | a run's findings pass 200,000, or 16,777,216 characters of message | a run holds every finding in memory, so it may hold only so many |
| `rules-too-slow` | exit 2 | the script rules and companions of a run take over 600 seconds | a run that never ends gives no answer |
| `parser-failed` | exit 2 | Lawcheck cannot load a grammar, or a reader fails on a file | a file whose uses were not read is not taken to use nothing |
| `reviewer-not-configured` | exit 2 | a run asks for reviews, and the config names no provider | reviewer rules need a reviewer to judge them |
| `too-many-reviews` | exit 2 | a run needs more reviewer calls than `--max-calls` or `reviewer.max_calls` allows | reviewer.max_calls bounds what one run spends |
| `reviewer-unreachable` | exit 2 | Lawcheck cannot call the reviewer, or a request fails | without the reviewer's answer a reviewer rule says nothing |
| `reviewer-bad-answer` | exit 2 | the reviewer's answer is no verdict twice, or once when the run has no call left to ask again | an answer that is no verdict cannot be recorded |
| `not-a-signer` | exit 2 | a run asks for reviews, the law names signers, and `LAWCHECK_SIGNING_KEY` holds no key of one of them | a pass counts only with the signature of a signer the law names |
| `memory-too-large` | exit 2 | the run passes its memory | a run past its memory would be ended by the system |
| `step-too-slow` | exit 2 | one step of a run takes more than 30 seconds | a step that never ends gives no answer, so one step of a run has a limit of time |
| `stopped` | exit 2 | SIGINT, SIGTERM or SIGHUP ended the run | a run stopped before its end says nothing about the code |
| `internal` | exit 2 | any other failure, a fault of Lawcheck included | a fault of Lawcheck says nothing about the code |
| `not-reviewed` | finding | a reviewer rule has no verdict for a file's content | a reviewer rule says nothing about content it has not judged |
| `too-large-to-review` | finding | a prompt would pass `reviewer.max_chars`; under `try` it ends the run with exit 2 | the reviewer is never sent more than reviewer.max_chars characters |
| `forbidden-use` | finding | a file uses a file its `may_use` list does not allow | a type's may_use names every type its files may use |
| `uses-not-read` | finding | Lawcheck reads no uses from a file whose `may_use` list is in force | a restriction that cannot be checked is not shown as kept |
| `untyped-file` | finding | a text file under `required` has no type | a file that no type takes is judged by no rule, so a folder under required may hold none |
| `waiver-unknown-rule` | finding | a waiver names no rule of the law | a waiver that names no rule of the law waives nothing |
| `waiver-without-reason` | finding | a waiver has no reason after `--` | a waiver without a reason cannot be weighed later |
| `waiver-unused` | finding | a waiver drops no finding; a waiver of a reviewer rule never gets it | a waiver that drops nothing would hide the next finding on its line |

A finding of a rule of the law carries the rule's id as its code. Lawcheck refuses a law with `law-invalid` if a rule id is a code of the table above.

Each Example below is the standard output of a test of Lawcheck's own suite. The test runs in a sample repository that the suite builds. This page leaves out standard error, where Lawcheck prints lines such as the count of reviewer calls.

Two paths of the examples differ from machine to machine. The page writes each in a fixed form:

- `/home/you/projects` for the temporary folder of the test;
- `/usr/local/bin/node` for the node that runs the test.

## usage

**Meaning**

The usage line of a command is the form that `lawcheck <command> --help` prints. Here the command line does not fit that form. Lawcheck runs nothing.

**Typical cause**

The command line holds one of these:

- a flag the command does not have;
- a flag given twice, or a flag without its value;
- a path outside the root;
- a rule, type or topic that does not exist.

**Fix**

Type the command as its usage line shows it. The `next:` line names the `--help` command that prints the usage line, such as `lawcheck docs --help`.

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

Lawcheck refuses to run in this environment. The first line of the output names the cause.

**Typical cause**

The cause is one of these five:

- Node is older than 24;
- the run is on Bun;
- Yarn's Plug'n'Play serves Lawcheck from a zip archive;
- git is older than 2.34;
- `NODE_OPTIONS` holds `--permission`.

**Fix**

The `next:` line gives the step for the cause:

- Node older than 24: install Node 24 or later.
- Bun: start Lawcheck as `bun x --no-install lawcheck`, without `--bun`, so that Lawcheck runs on the `node` of the `PATH`. With no `node` there, install Node 24 beside Bun.
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

The cause is one of these:

- the repository has no `.lawcheck/law.yaml` yet;
- you run Lawcheck in a folder above the one that holds `.lawcheck/`, such as the top of a monorepo with one law per package.

If you run Lawcheck in a folder above the one that holds `.lawcheck/`, the message names up to three folders below the folder you ran Lawcheck in. Each of them holds a law.

**Fix**

For a repository with no law, run `lawcheck init` in the top folder of the code to check. If the message names folders below, run your command again in the folder whose law you mean. The `next:` line names the first of those folders.

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

`init` finds a law in this folder, in a folder above it or in a folder below it. It writes nothing.

**Typical cause**

You run `lawcheck init` a second time, or in a package of a repository whose root has a law.

**Fix**

Edit the law that is there, instead of writing a second one. `lawcheck doctor` shows the law that governs this folder.

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

Lawcheck takes the files and the [change](concepts.md#change) from git. Here git cannot give them. The message holds the line that git printed, if git printed one.

**Typical cause**

The cause is one of these:

- the folder is outside any git work tree;
- git is not on the `PATH`;
- the repository is damaged;
- git refuses the repository because another user owns it.

**Fix**

Run Lawcheck inside a git work tree, with git on the `PATH`. For a repository another user owns, run the `git config --global --add safe.directory` command of the `next:` line. For a repository that git cannot read, such as one with a corrupt `.git/index`, repair it until `git status` works there.

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

Lawcheck cannot use `.lawcheck/law.yaml`: it cannot read or parse the file, or the file breaks the form that `lawcheck docs law` describes. For a fault on one line, the error names that line, as in `.lawcheck/law.yaml:2`.

**Typical cause**

The law holds one of these:

- a misspelled key, such as rulez for `rules`;
- a wrong value or id;
- a name in a type's `rules` or `may_use` that the law does not have;
- a pattern or `content` expression that does not parse;
- a file named in a rule's `context` that git does not list;
- a place that is no file where the law belongs, such as a folder named `.lawcheck/law.yaml`, or a symbolic link to nothing.

**Fix**

Edit the law at the line the error names. `lawcheck docs law` lists every key. When `.lawcheck/law.yaml` is no file, move what stands there away and put the law in a file of that name.

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

Lawcheck cannot use `.lawcheck/config.yaml`. For a fault on one line, the error names that line, as in `.lawcheck/config.yaml:1`.

**Typical cause**

The config holds one of these:

- an unknown key, such as bogus;
- a wrong value;
- a reviewer provider that Lawcheck cannot set up from the settings.

**Fix**

Edit the config at the line the error names. `lawcheck docs config` lists every key.

**Example**

```text
$ lawcheck check --base main
lawcheck: ERROR  1 error

.lawcheck/config.yaml:1  error[config-invalid]  unknown key 'bogus' at the top of the config
  why:  a misspelled setting changes the reviewer without a word

next: ask the user to fix .lawcheck/config.yaml, then run lawcheck check
```

## rule-missing-file

**Meaning**

A rule of the law has neither its script `.lawcheck/rules/<id>.mjs` nor its prompt `.lawcheck/rules/<id>.md`. Lawcheck reports the same code for a `.md` file that holds whitespace and nothing else.

**Typical cause**

The cause is one of these:

- you add a rule to the law before you write its file;
- you delete or rename the file of a rule, and the rule stays in the law;
- the file of a rule is a symbolic link, which Lawcheck does not follow, and the message names it.

**Fix**

Write `.lawcheck/rules/<id>.mjs` for a [script rule](concepts.md#script-rule), or `.lawcheck/rules/<id>.md` for a [reviewer rule](concepts.md#reviewer-rule). You can take the rule out of the law instead. Where the message names a symbolic link, replace the link with the file it leads to.

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

A file in `.lawcheck/rules/`, outside `lib/`, belongs to no rule of the law. Lawcheck reports the same code for a rule that has both a `.mjs` and a `.md` file.

**Typical cause**

The cause is one of these:

- you write a rule file and forget its entry under `rules:`;
- you keep a shared module beside the rules;
- you turn a script rule into a reviewer rule and keep its `.mjs` file.

**Fix**

The step depends on the cause:

- for a new rule file, add its rule under `rules:` in the law;
- for a shared module, move it to `.lawcheck/rules/lib/`;
- for a rule with both files, delete the file of the kind you no longer use.

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

Lawcheck cannot read a file that it must read. The message gives the reason, such as the system's error code `EACCES`.

**Typical cause**

The file is one of these:

- a file you have no read permission on;
- a path that is no regular file, such as a folder or a named pipe;
- a `.lawcheck/verdicts` over 16 MiB.

**Fix**

Give yourself read permission on the file, or put a regular file at the path.

`.lawcheck/verdicts` holds one line for each [pass](concepts.md#verdict) of the reviewer. Each line holds a hash and a rule id, so you cannot tell by hand which file a line belongs to. For a `.lawcheck/verdicts` over 16 MiB, the message gives three counts:

- the passes that the file holds;
- the passes that the files of this tree need;
- the reviewer calls that a review of every file of the law would take.

The user decides how to make room, as the `next:` line says. `lawcheck prime` tells a coding agent to edit `.lawcheck/verdicts` only on the user's word.

One way is to delete `.lawcheck/verdicts`. A review of every file of the law takes as many reviewer calls as the third of the three counts above. The passes of that review fill a new file. If the passes that the files of this tree need are close to the passes that the old file holds, the new file is about as large as the old one. In that case, deleting the file frees little room. You can narrow the `paths` of the types that list the reviewer rules. Then fewer files need a pass.

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

One file goes over the limit of what Lawcheck reads from it. The limits are:

- 16 MiB and 1,048,576 lines for a file read as text;
- 1 MiB each for the law and the config;
- 10,000 rules and 1,000 types for the law.

**Typical cause**

A type's `paths` match a generated file, a bundle or a data dump.

**Fix**

Add a pattern that starts with `!` to the type's `paths`, such as `"!src/core/edge.ts"`. You can make the file smaller instead. For a law or a config over 1 MiB, shorten that file.

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

The files one run reads hold more than 128 MiB of text together. The error names the file that went over the limit.

**Typical cause**

The types match large files whose text adds up to more than 128 MiB, such as a folder of generated code or test data.

**Fix**

Add `!` patterns to the `paths` of the types, so the files they match hold at most 128 MiB of text.

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

Lawcheck cannot write a file or a folder that it must write. The error names that file or folder.

**Typical cause**

The cause is one of these:

- a file stands where Lawcheck makes a folder, such as a file named `.lawcheck`;
- a folder stands where Lawcheck writes a file, such as `.lawcheck/.gitignore`;
- the folder is read-only;
- the disk is full;
- `.lawcheck/verdicts` would grow past 16 MiB;
- a write to standard output fails, such as a write to a file on a full disk.

A program that reads the output can close the pipe before Lawcheck has written all of it. Lawcheck gives no error in that case. It exits with the code that the run would give with the pipe open.

**Fix**

The step depends on the cause:

- move a file that stands where Lawcheck makes a folder;
- give yourself write permission on the file or the folder that the error names;
- free space on a full disk.

For a full `.lawcheck/verdicts`, the message gives the same three counts as for [file-unreadable](codes.md#file-unreadable). That section says what the counts mean and what deleting the file costs. The user decides how to make room.

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

Two types at the same level of the law's `types` match the same file. Lawcheck stops before it judges any file, because a file has at most one type.

**Typical cause**

A new type's `paths` cover files an older type takes, such as `src/core/**` beside `src/**`.

**Fix**

Run `lawcheck explain <path>` on the file that the error names. It shows both types. Then take one of these steps:

- add a `!` pattern to the `paths` of one of them, so that it leaves the file out;
- move one type under the other as a subtype, with a `content` expression that matches its own files by their text ([Types for a project](types-for-a-project.md#_14-give-the-tests-beside-the-code-a-type-by-their-text)).

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

Lawcheck cannot reach the [base](concepts.md#base) that it compares the change with. Without the base, it cannot tell new findings from [debt](concepts.md#debt).

**Typical cause**

The cause is one of these:

- a `--base` or `LAWCHECK_BASE` that names no commit here;
- a base that shares no history with `HEAD`;
- a repository with no commit yet;
- a shallow clone whose history stops before the base;
- a clone that did not fetch the branch;
- the forty zeros that git gives as the base of the push of a new branch;
- a base that ends with `/`, as `origin/` does when the variable after the slash is empty;
- a CI job with no base at all.

**Fix**

The step depends on the cause:

- for a base that names no commit here, or ends with `/`, run the command again with a `--base` that names a branch or a commit here, such as `--base origin/main`;
- in a shallow clone, or in a clone without the branch, run the `git fetch` command of the `next:` line;
- in GitHub Actions, set `fetch-depth: 0` in `actions/checkout` to fetch the whole history;
- for the push of a new branch, pass `--base` with the branch that the new one came from;
- in a CI job with no base, pass `--base` with the branch the change goes into, or set `LAWCHECK_BASE`; GitHub Actions, GitLab CI and Azure Pipelines set a variable for a pull request that Lawcheck reads, so a job on a pull request needs neither ([CI and git hooks](ci.md#_5-give-the-base-on-another-ci-service));
- in a repository with no commit, make the first commit, or name the files to check, as in `lawcheck check src/`.

**Example**

```text
$ lawcheck check --base nope
lawcheck: ERROR  1 error

error[base-unreachable]  the base 'nope' names no commit here
  why:  without its base a change cannot be told from debt

next: pass --base with a branch or a commit that exists here
```

## law-from-unreachable

**Meaning**

`check --law-from` cannot read the law of the commit it names, so it cannot judge the change by that law.

**Typical cause**

The cause is one of these:

- a ref that names no commit here, as in a clone that did not fetch that branch;
- a commit from before the law, which holds no `.lawcheck/law.yaml`;
- a law that sits in another folder at that commit than in the work tree.

**Fix**

Pass `--law-from` with a commit that holds the law, such as the base of the change. In a clone without the branch, fetch it first. The workflow of `lawcheck docs ci` checks with the law of the base only when the base holds `.lawcheck/law.yaml`, so the pull request that adds the law passes.

**Example**

```text
$ lawcheck check --base main --law-from nope
lawcheck: ERROR  1 error

error[law-from-unreachable]  the ref 'nope' that --law-from names is no commit here
  why:  a change judged by the law of a commit needs that law

next: pass --law-from with a commit here that holds .lawcheck/law.yaml, such as the base of the change
```

## law-from-packages

**Meaning**

`check --law-from` loads the script rules of the commit it names from a copy in `.lawcheck/.local/`. A package that such a rule imports by name comes from the `node_modules` folders above that copy, `.lawcheck/.local/node_modules` and `.lawcheck/node_modules` among them. A file in either folder that git lists comes from the change, so the change could hand the rule its own package. Lawcheck runs no rule and names the first such file of each folder.

**Typical cause**

The cause is one of these:

- a pull request that commits a package in `.lawcheck/node_modules`, where a rule finds it before the one the install step put in `node_modules`;
- a project that installs the packages of its rules in `.lawcheck/` and whose `.gitignore` does not name `node_modules/`;
- a file added with `git add -f` in `.lawcheck/.local/`, which holds Lawcheck's own files.

**Fix**

Take the folder out of git with `git rm -r --cached <folder>`, which keeps the files on disk, and name it in `.gitignore`. Install the packages of the rules in the `node_modules` of the project.

**Example**

```text
$ lawcheck check --base main --law-from main
lawcheck: ERROR  1 error

.lawcheck/node_modules/callpkg/index.js  error[law-from-packages]  git lists this file in .lawcheck/node_modules, and a package that a rule of 'main' imports cannot come from the change
  why:  a change judged by the law of a commit cannot supply the code that law runs

next: take .lawcheck/node_modules out of git, such as with git rm -r --cached .lawcheck/node_modules, and name it in .gitignore
```

## link-outside-root

**Meaning**

A script rule, or the companion of a reviewer rule, is about to run. A symbolic link that git tracks leads outside the git work tree and outside Lawcheck's folder. A rule could read outside the repository through that link, so Lawcheck runs no rule.

**Typical cause**

The repository holds a committed symbolic link to a shared folder beside it, or to a folder in your home.

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

A script rule, or the companion of a reviewer rule, is about to run. The path of the repository or of Lawcheck holds a `*`, or a backslash outside Windows. The rule runner is the Node process that runs the script rules. On such a path, the rule runner cannot keep a rule from reading outside the root.

**Typical cause**

A folder in the path of the repository or of the Lawcheck installation has a `*` in its name, such as `zone*`.

**Fix**

Put the repository, or Lawcheck, on a path with no `*` and no backslash.

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

The rule runner is the Node process that runs the script rules of a run. Here it did not start. The message holds the line that Node printed.

**Typical cause**

The installation of Lawcheck is damaged, or Node refuses the options that the rule runner starts with.

**Fix**

Install Lawcheck again, such as with `npm install --save-dev lawcheck@alpha`.

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

A script rule failed to give its findings, or the companion of a reviewer rule failed to give its paths. Lawcheck stops the run. The error names the file of the rule or of the companion, the judged file and the cause.

**Typical cause**

The rule does one of these:

- it does not load;
- it throws;
- it returns something other than a list of findings;
- it returns a message over 4,096 characters;
- it takes more than 30 seconds on one file.

A rule that imports a package installed above the root does not load.

A companion crashes in the same cases. It also crashes when it returns a path that names no file git lists, or a binary file ([Files for each judged file](reviewer-rules.md#files-for-each-judged-file)).

**Fix**

Run `lawcheck try <rule> <path>` with the rule and the file that the error names. Edit `.lawcheck/rules/<rule>.mjs` until `try` ends without an error. For a package above the root, install the package in a `node_modules` folder below the root, as the `next:` line says. For a companion, edit its module in `.lawcheck/rules/lib/`, or add the file it names, until `lawcheck try <rule> <path> --dry-run` ends without an error; the dry run calls no reviewer.

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

A rule reports every line of a file, or a type that matches generated code lists the rule.

**Fix**

Edit the rule so it returns one finding for each line that breaks it, or narrow the `paths` of the types that list it.

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

The script rules of one run, with the companions of its reviewer rules, took more than 600 seconds together. Lawcheck stops them. The error names each rule or companion that had not finished, with the file it was on.

Lawcheck runs as many rules at once as the machine has processors. On a machine with fewer processors than rules, the error says "had not started" for the later rules. The Example comes from a machine of three processors or more.

**Typical cause**

A rule takes seconds on each file, such as a rule that starts a program for every file. The rule binds hundreds of files.

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

Lawcheck could not read the [uses](concepts.md#use) of a file. It cannot check the file against the `may_use` list of its type.

**Typical cause**

A reader is the part of Lawcheck that parses one language and reports the uses of a file ([Languages and uses](languages.md)). A grammar is the file that tells a reader the syntax of one language. Lawcheck gives this code in two cases:

- a grammar file of Lawcheck's installation is damaged or missing;
- a reader fails on one file.

**Fix**

For a damaged or missing grammar, install Lawcheck again, such as with `npm install --save-dev lawcheck@alpha`. A new install does not help a reader that fails on one file. Report that failure at https://github.com/krzysztofdudek/Lawcheck/issues with the file's language.

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

You asked for reviews, such as with `check --review`. `.lawcheck/config.yaml` names no reviewer provider.

**Typical cause**

You run `check --review` in a repository whose `.lawcheck/config.yaml` has no provider in its `reviewer` section.

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

The limit of calls is the most reviewer calls that one run may send. `reviewer.max_calls` in `.lawcheck/config.yaml` sets it, with 100 as the default. For one run, `--max-calls` replaces that value with a number of its own, higher or lower. This run needs more calls than its limit, so Lawcheck sends none of them.

**Typical cause**

A change needs one call for each pair of a changed file and a reviewer rule that binds it. A pair needs no call if Lawcheck holds its answer from an earlier review. Here the count of these calls is over the limit of calls.

**Fix**

Each of these steps clears it:

- give `reviewer.max_calls` a higher value in `.lawcheck/config.yaml`;
- pass `--max-calls` with a number at least as high as the calls the run needs;
- name fewer paths to `check`.

A run with a higher limit can send more calls, so the first two steps are the user's decision, as the `next:` line says.

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

The cause is one of these:

- no API key in the environment;
- no endpoint for `openai-compatible`;
- a program provider whose program is not on the `PATH`;
- an HTTP error;
- a timeout;
- no network.

**Fix**

Add what the message names to the environment, such as `LAWCHECK_REVIEWER_ENDPOINT` or the provider's API key. Then run the same command again. A `check` that ran into this error keeps the answers it got before the error, so its next run sends only the calls still missing. Each run of `try` makes every call again, because `try` records no answer.

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

Lawcheck asked the reviewer for a [verdict](concepts.md#verdict) on one file and one rule. No answer held a verdict that Lawcheck can record.

**Typical cause**

The model answers in prose, where Lawcheck asks for a JSON object with a verdict. Lawcheck gives the code in two cases:

- the model answers in prose twice;
- the model answers in prose once, and the run has no call left under `--max-calls` or `reviewer.max_calls` to ask again.

**Fix**

Run the same command again. The next run of `check` sends only the calls that the last run left without an answer. If the same file fails again, set a stronger `model` in the `reviewer` section of `.lawcheck/config.yaml`. If the run had no call left, the user can raise `reviewer.max_calls`, or pass `--max-calls` with a number above the calls the run needs ([too-many-reviews](codes.md#too-many-reviews)).

**Example**

```text
$ lawcheck check --review --base main
lawcheck: ERROR  1 error, 2 reviewer calls

src/core/refund.ts  error[reviewer-bad-answer]  clear-errors: the answer is no verdict twice (the answer holds no JSON object with a verdict; then the answer holds no JSON object with a verdict)
  why:  an answer that is no verdict cannot be recorded

next: run the same command again; what was answered is kept, so it asks only the rest
```

## not-a-signer

**Meaning**

The law names signers, so a pass counts only when one of them signed it ([Signed passes](reviewer-rules.md#signed-passes)). This run asks the reviewer, and it holds no signing key of a signer of the law. Lawcheck sends no call, since no pass that it recorded would count.

**Typical cause**

The cause is one of these:

- `LAWCHECK_SIGNING_KEY` is not set on this machine or in this job;
- `LAWCHECK_SIGNING_KEY` holds something other than a key of 43 characters of base64url;
- the key belongs to no signer of the law, and the message names its public key.

**Fix**

Set `LAWCHECK_SIGNING_KEY` to your signing key, then run the same command again. A key whose public key the law does not name needs its signer in `signers` first, and who signs is the user's decision.

**Example**

```text
$ lawcheck check --review --base main
lawcheck: ERROR  1 error

error[not-a-signer]  the law names signers and LAWCHECK_SIGNING_KEY is not set, so this run could record no pass that counts
  why:  a pass counts only with the signature of a signer the law names

next: ask the user to set LAWCHECK_SIGNING_KEY to the signing key of a signer that .lawcheck/law.yaml names, then run lawcheck check --review --base main
```

## memory-too-large

**Meaning**

The run went over the memory it may hold. Lawcheck ended the run before the system could end it.

**Typical cause**

The cause is one of these:

- one file adds more than 384 MiB of memory while Lawcheck reads it;
- the run holds more than 1,536 MiB;
- the run holds more than 85 percent of the machine's memory, on a machine where that share is below 1,536 MiB;
- the system has less than 128 MiB of memory left.

**Fix**

The `next:` line names the step for the case. A type with a `may_use` list on it, or on a type above it, is a type whose files Lawcheck reads for their uses ([`may_use`](law.md#may-use)).

Lawcheck also reads for their uses the files of a script rule that calls `uses()`, and of a reviewer rule whose companion calls it ([The uses](script-rules.md#the-uses)). The error then names that rule, and the `next:` line names the types whose files the rule judges, or says to keep the rule from calling `uses()` on the file. A rule that calls `tree()` makes Lawcheck read the tree of the file, and the error names the rule and `tree()` the same way. A law with no `may_use` list can end this way too. Lawcheck reads the uses of a file once per run, for the rule that asks first. When two rules call `uses()` on the same file, the error names the one whose request came first, and two runs of the same check can name different rules. After you keep one rule from that file, the next run names the other.

- For one file that Lawcheck reads for its uses, leave the file out of every such type with a `!` pattern.
- For one file that Lawcheck reads only for the names it declares, as in the Example, keep the file out of the files that git lists. In Java, Kotlin, C#, Ruby and Rust, Lawcheck reads those names from every file that git lists, with a type or without one ([Languages and uses](languages.md)). Run `git rm --cached` on the file and add a line for it to `.gitignore`.
- For a whole run over its memory, narrow the `paths` of those types, or run Lawcheck on a machine with more memory.
- For a system short of memory, free memory on the machine.

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

One step of the run did not end within 30 seconds. Lawcheck counts two kinds of work as a step: giving one file its type, and one call of git. The error names the step.

**Typical cause**

A pattern backtracks when matching it on a line takes a number of tries that grows with the length of the line. Lawcheck gives this code in two cases:

- a type's `content` pattern backtracks on a long line, such as `^(a|a)+$`;
- git does not answer.

**Fix**

For a pattern, rewrite the `content` pattern that backtracks on the file that the error names. For git, the error names the git command that hung. Run that command by hand to see what it waits for.

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

A signal ended the run: SIGINT, SIGTERM or SIGHUP.

**Typical cause**

The cause is one of these:

- you end the run from its terminal;
- CI cancels the job;
- the program that started Lawcheck ends it at its own timeout.

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

Lawcheck has a fault, such as an exception it does not catch.

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

A reviewer rule has no verdict for the current content of a file. A `check` without `--review` calls no model. It reports the file as not reviewed.

**Typical cause**

You changed a file that a reviewer rule binds, or the rule's prompt, its `why` or a file of its `context`. After that change, the review is missing for one of these reasons:

- `check --review` did not run;
- the review ran, and the commit holds the old `.lawcheck/verdicts`;
- the law names signers, and the line of the review carries no signature of one of them. The message then says `has a pass for this content that no signer of the law signed`.

**Fix**

Run the command of the `next:` line, such as `lawcheck check --review --base main`, then commit `.lawcheck/verdicts`.

**Example**

```text
$ lawcheck check --base main
lawcheck: FAIL  1 error in 1 changed file (against main), 1 waiver
note: this change adds 1 waiver: clear-errors at src/core/refund.ts:3

src/core/refund.ts  error[not-reviewed]  clear-errors has no verdict for this content
  why:  a reviewer rule says nothing about content it has not judged

next: lawcheck check --review --base main  (1 reviewer call)
```

## too-large-to-review

**Meaning**

The prompt for a file would hold more characters than `reviewer.max_chars`. Lawcheck does not send that prompt. Under `try`, Lawcheck ends the run on this code with exit 2.

**Typical cause**

A reviewer rule binds a large file, or the rule's `context` files fill most of the prompt.

**Fix**

Each of these steps clears it:

- leave the file out of the type with a `!` pattern;
- split the file;
- give `reviewer.max_chars` a higher value in `.lawcheck/config.yaml`.

The third step edits `.lawcheck/config.yaml`. `lawcheck prime` leaves that edit to the user's word.

**Example**

```text
$ lawcheck check --base main
lawcheck: FAIL  1 error in 1 changed file (against main), 1 waiver
note: this change adds 1 waiver: clear-errors at src/core/refund.ts:3

src/core/refund.ts  error[too-large-to-review]  the prompt for clear-errors holds 2127 characters; reviewer.max_chars is 2126
  why:  the reviewer is never sent more than reviewer.max_chars characters

next: fix src/core/refund.ts
```

## forbidden-use

**Meaning**

A file uses a file of a type that its own type's `may_use` list does not name. The message names the type the list comes from. That type can be a parent type. A use that could name several files is a `forbidden-use` when the list forbids every one of them. Its message names up to three of those files with their types and counts the rest.

**Typical cause**

An import crosses a layer, such as code in `src/core/` that imports from `src/cli/`.

**Fix**

Edit the code so that the use goes in the allowed direction. If the law should allow the use, add the used type to `may_use`. A wider `may_use` is the user's decision.

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

A file falls under the `may_use` list of its own type, or of the nearest type above it that has one ([`may_use`](law.md#may-use)). Lawcheck cannot read the uses of some files under such a list, so it cannot check the list for them. It reports those files in one of three ways:

- for files with no reader, a warning at the type's line of the law;
- for a changed file over 512 KiB, an error at the file;
- for such a file in debt, a warning at the file.

**Typical cause**

The cause is one of these:

- a type's `paths` take files in a language that Lawcheck has no reader for, such as `.json` files;
- a file is over 512 KiB.

**Fix**

Leave the files out of the type with a `!` pattern, such as `"!src/**/*.json"`, or make the large file smaller. `lawcheck docs languages` lists what Lawcheck reads.

**Example**

```text
$ lawcheck check --base main
lawcheck: PASS  1 warning in 1 changed file (against main)

.lawcheck/law.yaml:17  warning[uses-not-read]  1 file of type library is not read for uses: 1 .json
  why:  a restriction that cannot be checked is not shown as kept
```

## untyped-file

**Meaning**

A pattern of `required` in the law matches a text file, and no type takes the file ([`required`](law.md#required)). No rule judges such a file. The message names the pattern of `required`. The finding has no line, and its `type` in JSON is an empty string.

**Typical cause**

The cause is one of these:

- an agent creates a folder beside the folders that types take, such as `src/gen/` beside `src/core/`;
- a file has an extension that the type's `paths` leave out, such as a `.js` file where the type takes `src/**/*.ts`;
- a file matches a type's `paths`, but its text does not match the type's `content`.

**Fix**

Move the file where a type's `paths` take it, or add a type for it. `lawcheck explain <path>` says why the file has no type. A pattern of `ignored` leaves the file out of the law, and adding one is the user's decision.

**Example**

```text
$ lawcheck check --base main
lawcheck: FAIL  1 error in 1 changed file (against main)

src/gen/helpers.js  error[untyped-file]  the file lies under required (src/**) and no type of the law takes it
  why:  a file that no type takes is judged by no rule, so a folder under required may hold none

next: give src/gen/helpers.js a type: move it where a type's paths take it, or add a type for it to .lawcheck/law.yaml
```

## waiver-unknown-rule

**Meaning**

A [waiver](concepts.md#waiver) names no rule of the law. It waives nothing.

**Typical cause**

The cause is one of these:

- a misspelled rule id;
- a rule you took out of the law while its waivers stayed in the code;
- a marker that runs on into the next word, with no space before the id.

**Fix**

Write a rule id of the law after the marker, or delete the waiver. `lawcheck docs waivers` shows the form.

**Example**

```text
$ lawcheck check --base main
lawcheck: FAIL  1 error in 1 changed file (against main)

src/core/shipping.ts:1  error[waiver-unknown-rule]  the waiver names 'no-such', which is no rule of the law
  why:  a waiver that names no rule of the law waives nothing

next: fix src/core/shipping.ts:1
```

## waiver-without-reason

**Meaning**

A waiver has no reason after `--`. It waives nothing.

**Typical cause**

The waiver ends with its rule id, with no `--` and no reason after it.

**Fix**

Add `--` and the reason after the rule id. `lawcheck docs waivers` shows the form.

**Example**

```text
$ lawcheck check --base main
lawcheck: FAIL  1 error in 1 changed file (against main)

src/core/shipping.ts:1  error[waiver-without-reason]  the waiver of 'no-console' gives no reason after --
  why:  a waiver without a reason cannot be weighed later

next: fix src/core/shipping.ts:1
```

## waiver-unused

**Meaning**

A waiver drops no finding on the line it covers. Lawcheck reports such a waiver with a warning of this code. A waiver of a reviewer rule never gets the code, because Lawcheck cannot tell from a recorded pass what the waiver dropped.

**Typical cause**

You fixed the line and kept the waiver, or the waiver stands on a line the rule does not report.

**Fix**

Remove the waiver from the line.

**Example**

```text
$ lawcheck check --base main
lawcheck: PASS  1 warning in 1 changed file (against main), 1 waiver
note: this change adds 1 waiver: no-console at src/core/shipping.ts:1

src/core/shipping.ts:1  warning[waiver-unused]  the waiver of 'no-console' drops no finding
  why:  a waiver that drops nothing would hide the next finding on its line
```

## Notes

A note is a line that starts with `note:`, under the first line of `check` or `init`. It carries no code and changes no exit code.

`doctor` prints no such line. In its report, `note` is the state of a check. A `next:` line below such a check gives its step, as below a failed check.

| Text | When | Fix |
|---|---|---|
| `note: the law changed in this change; lawcheck check --full ...` | a `check` with no path and no `--full`, against a base, judges a change that edits `.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a file of `.lawcheck/rules/` | run the `check --full` command of the note to see what the new law finds in the rest of the code |
| `note: this change edits the law that judges it: ...` | a `check` against a base, with or without `--full`, judges a change that edits the law; the note lists what it changes in the law, such as types, rules, `may_use` and the patterns of `required` and `ignored` | read the list before you accept the change |
| `note: this change edits its own law, and the law of <ref> judged it: ...` | a `check --law-from <ref>` against a base judges a change that edits the law; it stands in place of the two notes above | read the list before you accept the change, since the law of the change did not judge it |
| `note: this change adds <n> waivers: ...` | a `check` against a base, where a changed file holds a waiver that it did not hold at the base | read each waiver and its reason before you accept the change |
| `note: the paths of a type reach into ...` | the paths of a type reach into a submodule or a repository of its own, and Lawcheck judges no file there | run Lawcheck in that repository with its own law |
| `note: <path> lies in ...` | a path named to `check` lies in a submodule or a repository of its own | run Lawcheck in that repository |
| `note: the law covers only the files below ...` | `init` runs in a folder below the top of the git work tree | run `init` at the top if the law should cover the whole repository |

## Escapes in the output

The output holds text from outside Lawcheck:

- a file name;
- a rule message or a reviewer message;
- the base;
- the ids of the law, its `about` texts and its patterns;
- config values;
- the text that git, a reviewer endpoint or a reviewer program prints.

A control sequence is a run of characters that a terminal reads as a command, such as a change of color or a move of the cursor. Text from outside Lawcheck can hold control sequences, or any other character. Lawcheck writes the characters of the table below as escapes, so each finding or error stays on one line. The output then carries no control sequence to a terminal or a CI log.

| Character | Written as |
|---|---|
| a line feed inside such text | `\n` |
| a carriage return | `\r` |
| a tab | `\t` |
| any other character below U+0020, and U+007F | `\x` and two hexadecimal digits, such as `\x1b` |
| U+0080 to U+009F, U+2028, U+2029, and every format character of Unicode (category Cf, such as a zero-width space or a mark that changes the direction of text) except the joiners U+200C and U+200D | `\u` and four hexadecimal digits for each UTF-16 unit, such as `\u202e` |
| a line that GitHub Actions or Azure Pipelines would read as a command | its first character as `\x3a` or `\x23` |

Lawcheck writes every character outside the table as it is. A backslash stays a backslash.

In `--json`, Lawcheck keeps the text of a string as it is, with one exception. It writes these characters as JSON escapes: those below U+0020, U+007F to U+009F, U+2028, U+2029 and the format characters. The printed document holds none of them raw. A program that parses the document gets the text unchanged ([JSON documents](json.md)).

A script rule can print to standard output or standard error. Lawcheck writes that text to its own standard error, through the same escapes.

Next: [Questions](questions.md)
