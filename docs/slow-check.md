# A slow check

A check in a git hook runs on each commit, and a check in CI on each pull request. A check that takes two minutes costs two minutes on each of them. These steps find the part of a run that takes the time. Reviewer calls are the one part that can cost money, and step 5 puts a bound on them.

The outputs below come from a repository that joins two other guides: the [script rule](concepts.md#script-rule) `no-console` of [Bring a law into an existing repository](adopt-in-an-existing-repository.md), and the [reviewer rule](concepts.md#reviewer-rule) `clear-errors` with the Ollama reviewer of [Write a reviewer rule](write-a-reviewer-rule.md). Its [law](concepts.md#law):

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

A branch made from `main` changes `src/core/price.ts` and `src/core/tax.ts`, and `src/core/tax.ts` imports `src/core/price.ts`. Put `time` before a command to see how long it takes. The shell prints its own lines after Lawcheck's output.

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

A plain check judges the files of the [change](concepts.md#change), and `--full` every file that has a [type](concepts.md#type). It calls no reviewer: the `next:` line counts the calls a review would make.

## 2. Check one file

```text
$ lawcheck check src/core/tax.ts
```

```output
lawcheck: PASS  1 warning in 1 named file

src/core/tax.ts  warning[not-reviewed]  clear-errors has no verdict for this content
  why:  a reviewer rule says nothing about content it has not judged
```

A check of named files judges those files alone, needs no [base](concepts.md#base) and calls no reviewer. Compare its time with the time of step 1, then name a folder or a pattern to narrow the part that takes the time.

## 3. Run each script rule alone

```text
$ lawcheck try no-console
```

```output
lawcheck: try no-console (script rule, enforced)  nothing found in 2 files
```

`try` with no file runs one script rule on every file it binds, with no other rule. Run it for each script rule of the law and compare the times.

## 4. See which files are read for uses

```text
$ lawcheck doctor --base main
```

Its `readers` line:

```output
ok  readers  uses are read in 2 files: typescript 2; the 13 grammars load
```

The line counts the files whose [uses](concepts.md#use) Lawcheck reads, by language. These are the files whose type, or a type above it, has `may_use` ([Forbid one layer to use another](forbid-a-use.md)). A plain check reads the uses of the changed files among them, and `--full` of all of them. A large count that comes from generated or vendored code shrinks when you narrow the type's `paths`.

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

With `max_calls: 20`, a run that needs more than 20 calls sends none. A call that Lawcheck sends again, after a failure or an answer with no verdict, counts too. With `parallel: 2` Lawcheck sends at most two calls at once, and `timeout: 120` gives one call two minutes. Without these keys, a run may send 100 calls, 4 at a time, and each call has 60 seconds. With `ollama` a call has 300 seconds. With `claude-code`, `codex`, `gemini-cli` or `copilot-cli`, a call has 300 seconds and Lawcheck makes one call at a time.

`--max-calls` sets the cap for one run. This change needs 2 calls, and the cap is 1:

```text
$ lawcheck check --review --max-calls 1 --base main
```

```output
lawcheck: ERROR  1 error

error[too-many-reviews]  this run needs 2 reviewer calls and may send 1
  why:  reviewer.max_calls bounds what one run spends

next: 2 reviewer calls are needed and the limit is 1; raising reviewer.max_calls or --max-calls is the user's decision
```

The run stops with [`too-many-reviews`](codes.md#too-many-reviews) and sends nothing. `lawcheck try <rule> <file> --dry-run` prints the calls and the size of each prompt before any call ([Write a reviewer rule](write-a-reviewer-rule.md)).

## The limits of a run

Past a limit, the run stops with exit 2, or the file gets a [finding](concepts.md#finding). The code says which limit the run passed:

| Limit | Code |
|---|---|
| a script rule: 30 seconds to load, and 30 seconds for each call | [`rule-crashed`](codes.md#rule-crashed) |
| all script rules of a run: 600 seconds together | [`rules-too-slow`](codes.md#rules-too-slow) |
| one step of a run, such as typing one file: 30 seconds | [`step-too-slow`](codes.md#step-too-slow) |
| a reviewer call: its `timeout` | [`reviewer-unreachable`](codes.md#reviewer-unreachable) |
| a file over 512 KiB, for its uses | [`uses-not-read`](codes.md#uses-not-read) |
| one run: 1536 MiB of memory, or 85 percent of the machine's memory where that is less | [`memory-too-large`](codes.md#memory-too-large) |

## If it goes wrong

- `step-too-slow` while typing a file: a `content` expression of the law takes too long on that file. In `^(a|a)+$` each `a` can match either branch, and on a line of 80 `a` and a `!` the run passes the limit. `^a+$` matches the same lines with one way for each `a`.
- `memory-too-large`: its `next:` line names the step. For a file whose uses Lawcheck reads, leave the file out of the types whose `may_use` is in force. For a file Lawcheck reads only for what it declares, keep it out of the files git lists, with `git rm --cached` and a line in `.gitignore`. For a whole run, narrow those types, or run Lawcheck on a machine with more memory.
- [`internal`](codes.md#internal): a fault of Lawcheck. Run the command again, and report the error if it stays.

Next: [The commands](commands.md)
