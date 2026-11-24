# A slow check

A check in a git hook runs on each commit. In CI, it runs on each pull request. A check that takes two minutes costs two minutes every time. These steps find the slow part. Reviewer calls are the one part of a run that can cost money. You limit them in [Bound the reviewer](#_5-bound-the-reviewer).

The outputs below come from a repository built from two other guides. The [script rule](concepts.md#script-rule) `no-console` comes from [Bring a law into an existing repository](adopt-in-an-existing-repository.md). The [reviewer rule](concepts.md#reviewer-rule) `clear-errors` and the Ollama reviewer come from [Write a reviewer rule](write-a-reviewer-rule.md). The repository's [law](concepts.md#law):

```yaml
lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.
  clear-errors:
    why: An error a caller sees says what happened and what to do next.

types:
  library:
    about: Code the commands call.
    paths: ["src/core/**"]
    rules: [no-console, clear-errors]
    may_use: [library]
  command:
    about: The command layer.
    paths: ["src/cli/**"]
```

A branch made from `main` changes `src/core/price.ts` and `src/core/tax.ts`. The file `src/core/tax.ts` imports `src/core/price.ts`.

To see how long a command takes, put `time` before it, as in `time lawcheck check --base main`. The shell then prints the time after the output of Lawcheck.

## 1. See what the run judges

```text
$ lawcheck check --base main
```

```output
lawcheck: FAIL  2 errors in 2 changed files (against main)

src/core/price.ts  error[not-reviewed]  clear-errors has no verdict for this content
  why:  a reviewer rule says nothing about content it has not judged
src/core/tax.ts  error[not-reviewed]  clear-errors has no verdict for this content

next: lawcheck check --review --base main  (2 reviewer calls)
```

A [plain check](concepts.md#plain-check) judges the files of the [change](concepts.md#change) against a [base](concepts.md#base). The first line of the output names that base. When the first line ends in `(no base: every file counts as changed)`, the run judges every file ([Give the check its base](#_6-give-the-check-its-base)). With `--full`, a check judges every file that has a [type](concepts.md#type). A check without `--review` calls no reviewer. Its `next:` line counts the calls that a review would make.

## 2. Check one file

```text
$ lawcheck check src/core/tax.ts
```

```output
lawcheck: PASS  1 warning in 1 named file

src/core/tax.ts  warning[not-reviewed]  clear-errors has no verdict for this content
  why:  a reviewer rule says nothing about content it has not judged
```

A check that names files judges those files alone. It takes no base and calls no reviewer. Compare its time with the time of the run in [See what the run judges](#_1-see-what-the-run-judges). Then name a folder or a pattern, to find the folder whose files take the time.

## 3. Run each script rule alone

```text
$ lawcheck try no-console
```

```output
lawcheck: try no-console (script rule, enforced)  nothing found in 2 files
```

`lawcheck try` with no file runs one script rule alone, on every file whose type, or a type above it, lists the rule. Run `lawcheck try` for each script rule of the law, and compare the times.

## 4. See which files are read for uses

```text
$ lawcheck doctor --base main
```

Find its `readers` line:

```output
ok  readers  uses are read in 2 files: typescript 2; the 13 grammars load
```

A [use](concepts.md#use) is an import, or another reference from one file to another. The `readers` line counts the files whose uses Lawcheck reads, by language. Lawcheck reads the uses of a file whose type, or a type above it, has `may_use` ([Forbid one layer to use another](forbid-a-use.md)). A plain check reads the uses of the changed files among them. With `--full`, it reads the uses of all of them.

In Java, Kotlin, C#, Ruby and Rust, the first check also parses every file of the language, to learn what each file declares. Later checks parse again only the files that changed ([The reader cache](languages.md#the-reader-cache)).

A large count may come from generated code, or from code copied in from another project. To leave that code out, narrow the `paths` of the type that takes it.

## 5. Bound the reviewer

Set the limits in `.lawcheck/config.yaml`:

```yaml
reviewer:
  provider: ollama
  model: your-model-id
  max_calls: 20
  parallel: 2
  timeout: 120
```

The three keys set these limits:

- `max_calls: 20`: a run that needs more than 20 calls sends none. A call that Lawcheck sends again, after a failure or after an answer with no verdict, counts as one more;
- `parallel: 2`: Lawcheck sends at most two calls at once;
- `timeout: 120`: one call has two minutes.

Without these keys, Lawcheck takes the defaults:

- a run sends at most 100 calls, 4 at a time;
- a call has 60 seconds, or 300 seconds with `ollama`;
- with `claude-code`, `codex`, `gemini-cli` or `copilot-cli`, a call has 300 seconds. Lawcheck makes one call at a time to these programs.

`--max-calls <n>` replaces `max_calls` for one run. This change needs 2 calls, so `--max-calls 1` shows the refusal:

```text
$ lawcheck check --review --max-calls 1 --base main
```

```output
lawcheck: ERROR  1 error

error[too-many-reviews]  this run needs 2 reviewer calls and may send 1
  why:  reviewer.max_calls bounds what one run spends

next: 2 reviewer calls are needed and the limit is 1; raising reviewer.max_calls or --max-calls is the user's decision
```

The run stops with [`too-many-reviews`](codes.md#too-many-reviews) and sends nothing. To count the calls before you spend any, run `lawcheck try <rule> <file> --dry-run`. It prints the calls and the size of each prompt, and makes no call ([Write a reviewer rule](write-a-reviewer-rule.md)).

## 6. Give the check its base

A [check of the change](concepts.md#check-of-the-change) takes its base from the first of these that names one: `--base`, `LAWCHECK_BASE`, the variables of a CI service ([CI and git hooks](ci.md#_5-give-the-base-on-another-ci-service)), `origin/HEAD`. With none of them, a check on your machine counts every file as changed. It then runs every rule on every file that has a type.

A review is one file judged against one reviewer rule. With `--review`, a check with no base asks the reviewer about each review that has no pass and no cached failure. With `--again`, it also asks about each review that has a cached failure.

This repository has no remote and no `origin/HEAD`:

```text
$ lawcheck check
```

```output
lawcheck: FAIL  2 errors in 9 files (no base: every file counts as changed)

src/core/price.ts  error[not-reviewed]  clear-errors has no verdict for this content
  why:  a reviewer rule says nothing about content it has not judged
src/core/tax.ts  error[not-reviewed]  clear-errors has no verdict for this content

next: lawcheck check --review  (2 reviewer calls)
```

The run counts all 9 files that git lists as changed. The run in [See what the run judges](#_1-see-what-the-run-judges) counted 2. `lawcheck doctor` without `--base` prints a note in its `base` line:

```text
$ lawcheck doctor
```

```output
note  base  no base: no --base, LAWCHECK_BASE or origin/HEAD, so a plain check counts every file as changed
  next: pass --base <branch>, or set LAWCHECK_BASE
```

Pass `--base` with the branch you started from, as the steps above do, or set `LAWCHECK_BASE`.

## The limits of a run

A run that goes over one of the limits below stops with exit 2. A file over 512 KiB is the one exception. It gets the [finding](concepts.md#finding) `uses-not-read`, and the run goes on. The table gives the code that the run prints for each limit:

| Limit | Code |
|---|---|
| a script rule: 30 seconds to load, and 30 seconds for each call | [`rule-crashed`](codes.md#rule-crashed) |
| all script rules of a run: 600 seconds together | [`rules-too-slow`](codes.md#rules-too-slow) |
| one step of a run, such as typing one file: 30 seconds | [`step-too-slow`](codes.md#step-too-slow) |
| a reviewer call: its `timeout` | [`reviewer-unreachable`](codes.md#reviewer-unreachable) |
| a file over 512 KiB, for its uses | [`uses-not-read`](codes.md#uses-not-read) |
| one run: 1536 MiB of memory, or 85 percent of the machine's memory where that is less | [`memory-too-large`](codes.md#memory-too-large) |

## If it goes wrong

- `step-too-slow` can come while Lawcheck gives a file its [type](concepts.md#type). A `content` expression of the law then takes too long on that file. Take `^(a|a)+$`: each `a` can match either branch. On a line of 80 `a` and a `!`, the expression tries every way to match, and the run goes over the limit. Write `^a+$` instead. It matches the same lines, with one way to match each `a`.
- The `next:` line of `memory-too-large` names the step that went past the limit. The fix depends on that step:
  - for a file whose uses Lawcheck reads, leave the file out of the types whose `may_use` is in force;
  - for a file that Lawcheck reads only for the names it declares, keep it out of the files git lists: run `git rm --cached` on it, and add a line to `.gitignore`;
  - for a whole run, narrow the `paths` of the types whose `may_use` is in force, or run Lawcheck on a machine with more memory.
- [`internal`](codes.md#internal) is a fault of Lawcheck. Run the command again, and report the error if it comes back.

Next: [The commands](commands.md)
