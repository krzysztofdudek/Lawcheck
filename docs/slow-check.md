# A slow check

A check runs on every commit and every pull request, so a slow one costs time on each. These steps find the part of a run that takes the time, and put a bound on reviewer calls, the one part that can cost money.

The outputs below come from a repository that joins two other guides: the script rule `no-console` of [Bring a law into an existing repository](adopt-in-an-existing-repository.md), and the reviewer rule `clear-errors` with the Ollama reviewer of [Write a reviewer rule](write-a-reviewer-rule.md). Its law:

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

A branch made from `main` changes `src/core/price.ts` and `src/core/tax.ts`, and `tax.ts` imports `price.ts`. Put `time` before a command to see how long it takes; the shell prints its own lines after Lawcheck's output.

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

A plain check judges the files of the change, and `--full` every file of the law. It calls no reviewer: the `next:` line counts the calls a review would make.

## 2. Check one file

```text
$ lawcheck check src/core/tax.ts
```

```output
lawcheck: PASS  1 warning in 1 named file

src/core/tax.ts  warning[not-reviewed]  clear-errors has no verdict for this content
  why:  a reviewer rule says nothing about content it has not judged
```

A check of named files judges those files alone, needs no base and calls no reviewer. Compare its time with the time of step 1, then name a folder or a pattern to narrow the part that takes the time.

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

The line counts the files whose uses Lawcheck reads, by language: the files whose type, or a type above it, has `may_use`. A plain check reads the uses of the changed files among them, and `--full` of all of them. A large count that comes from generated or vendored code shrinks when you narrow the type's `paths`.

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

`max_calls` is the most requests one run sends, 100 by default; a request sent again counts. `parallel` is how many are in flight at once, 4 by default and 1 for the four programs. `timeout` is the seconds one call may take, 60 by default and 300 for `ollama` and the programs. `--max-calls` sets the cap for one run:

```text
$ lawcheck check --review --max-calls 1 --base main
```

```output
lawcheck: ERROR  1 error

error[too-many-reviews]  this run needs 2 reviewer calls and may send 1
  why:  reviewer.max_calls bounds what one run spends

next: 2 reviewer calls are needed and the limit is 1; raising reviewer.max_calls or --max-calls is the user's decision
```

A run that needs more calls than its cap sends none. `lawcheck try <rule> <file> --dry-run` prints the calls and the size of each prompt before any call ([Write a reviewer rule](write-a-reviewer-rule.md)).

## The limits of a run

Past each limit the run stops with exit 2, or the file gets a finding, and the code names what passed it ([Codes](codes.md)):

| Limit | Code |
|---|---|
| a script rule: 30 seconds to load, and 30 seconds for each call | `rule-crashed` |
| all script rules of a run: 600 seconds together | `rules-too-slow` |
| one step of a run, such as typing one file: 30 seconds | `step-too-slow` |
| a reviewer call: `reviewer.timeout` | `reviewer-unreachable` |
| a file over 512 KiB, for its uses | `uses-not-read` |
| one run: 1536 MiB of memory, or 85 percent of the machine's memory where that is less | `memory-too-large` |

## Can go wrong

- `step-too-slow` while typing a file: a `content` expression of the law takes too long on that file. Simplify the expression; a nested repetition such as `(\w+)*x` can run past the limit on one long line.
- `memory-too-large`: its `next:` line names what to narrow. For one large file it says to keep the file out of what git lists, with `git rm --cached` and a line in `.gitignore`; for a whole run, to narrow the types whose `may_use` is in force.
- `internal`: a fault of Lawcheck. Run the command again, and report it with the output of `lawcheck doctor` if it stays.
