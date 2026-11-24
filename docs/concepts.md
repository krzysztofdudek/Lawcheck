# Concepts

These pages use fourteen words, each with one meaning. Each word has a heading here, a short definition and one example.

## Law

The law is what you write down about your repository. It names the types of its files, the types each type may use, and the rules each type keeps. The law lives in `.lawcheck/law.yaml`, with one file per rule in `.lawcheck/rules/`. You commit it with the code. The folder that holds `.lawcheck/` is the root of the law.

Example: the law of [Quick start](quick-start.md).

```yaml
lawcheck: 0.1.0

types:
  core:
    about: Prices and orders, with no input or output.
    paths: ["src/core/**"]
    may_use: [core]
```

## Type

A type is one kind of file. The patterns of its `paths` say which files it takes. An optional `content` expression narrows them to the files whose text matches that expression. A type can hold subtypes. The type that holds a subtype is its parent. Lawcheck tests a subtype on a file only after the file matched its parent. A file gets the deepest type that matches it. No rule judges a file that has no type. A law can name folders where every file needs a type ([`required`](law.md#required)).

Example: under the law above, `src/core/receipt.ts` has the type `core`. `lawcheck explain src/core/receipt.ts` shows it.

## Rule

A rule is one requirement. It has an id, and its `why` gives the reason for it. A type lists the rules its files keep. A rule binds the files of each type that lists it, and the files of that type's subtypes. Lawcheck judges those files against the rule. Lawcheck prints the `why` beside each [finding](#finding). A rule is `enforced` unless its entry in the law says `status: advisory`. The findings of an advisory rule are warnings.

Example: the rule `no-console`, with `why: Only the command layer writes to the terminal.`

## Script rule

A script rule is a JavaScript module, `.lawcheck/rules/<id>.mjs`. Its function `check` receives the files and returns their findings. It needs no model and no key. Lawcheck runs it in a Node process of its own. That process is the rule runner. The rule runner may read files in two places: below the root of the law, and in Lawcheck's own folder. Lawcheck's own folder is the folder where the `lawcheck` package is installed. The rule runner may read no other file.

Example: `.lawcheck/rules/no-console.mjs` returns `{ line: 1, message: 'writes to the terminal with console.log' }` for a file whose first line calls `console.log`.

## Reviewer rule

A reviewer rule is a Markdown file, `.lawcheck/rules/<id>.md`. It tells a language model what must hold in each file the rule binds. The model that judges the rule is the reviewer. `lawcheck check --review` sends the reviewer one file and one rule per call. The reviewer answers pass or fail.

Example: `.lawcheck/rules/clear-errors.md` says "Every error message a caller can see says what happened and what the caller can do next."

## Use

A use is a reference from one file to another file of the repository, such as an `import`. Lawcheck reads uses in TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C, C++, PHP and Ruby. The part of Lawcheck that reads the uses of one language is the reader of that language. The `may_use` list of a type names the types its files may use. Lawcheck reports each use outside the list as the finding `forbidden-use`.

Example: `import { print } from "../cli/print.js";` in `src/core/receipt.ts` is a use of `src/cli/print.ts`.

## Finding

A finding is one place that breaks the law. It holds a file, a line, a rule or a code, a message and the `why`. In the [change](concepts.md#change), a finding of an enforced rule is an error. An error makes `lawcheck check` exit 1.

Example:

```output
src/core/receipt.ts:1  error[forbidden-use]  core may not use src/cli/print.ts, which has no type; its may_use is [core]
  why:  a type's may_use names every type its files may use
```

## Debt

Debt is what `lawcheck check --full` finds in the files outside the change. A finding of debt is a warning, whatever the status of its rule. Debt never changes the exit code, unless you pass `--strict`.

Example: `debt (outside this change): 1 finding in 1 file`, after the findings of the change.

## Waiver

A waiver is a marker in a line that names one rule and a reason. It drops the findings of that rule on the line it covers. A waiver needs a reason. In a type with `waivers: false`, Lawcheck reads the marker as plain text.

Example: a comment at the end of a line that prints a warning. The comment names the rule `no-console` and the reason "the pricing team reads this warning until 2.0". [Waivers](waivers.md) shows the marker and the lines it covers.

## Verdict

A verdict is the answer of the reviewer, pass or fail, for one file and one reviewer rule. Lawcheck writes each pass as a line of `.lawcheck/verdicts`. You commit that file. A later check reads the pass and calls no model for that file and rule. A reviewer rule can list more files in its `context` key. The reviewer reads those files beside each file it judges. The pass holds until one of these changes:

- the file;
- the text of the rule;
- the `why` of the rule;
- a file of the rule's `context`.

Example: the pass of `clear-errors` for one file, as a key and the rule id:

```text
bec7eb69fcc74507cad562d7d51f13eb clear-errors
```

## Base

The base is the commit that a check compares your work with. Lawcheck takes it from the first of these places that names one:

1. the flag `--base`, with a branch, a tag or a commit;
2. the variable `LAWCHECK_BASE`;
3. in a CI job, the variable of the service that names the target branch of a pull request or the commit before a push;
4. `origin/HEAD`.

With no base, a check on your machine counts every file as changed. In a CI job with no base, `lawcheck check` stops with `base-unreachable`. A run that names a path or passes `--full` does not stop.

Example: `lawcheck check --base main`.

## Change

The change is the set of files that differ from the merge base of `HEAD` and the base. A file belongs to the change when it is one of these:

- committed on the branch;
- staged;
- modified;
- new, and not ignored by git.

Example: on a branch where you edited one file, the first line of `lawcheck check --base main` ends with `1 changed file (against main)`.

## Check of the change

A check of the change is a run of `lawcheck check` that names no path and does not use `--full`. It takes a [base](#base) and judges the files of the [change](#change). `lawcheck check --base main` and `lawcheck check --review --base main` are both checks of the change. A [plain check](#plain-check) is a check of the change that does not use `--review`.

## Plain check

A plain check is a run of `lawcheck check` that judges the change alone. It reads the passes in `.lawcheck/verdicts`. It calls no reviewer. Only a file in the change fails a plain check with exit 1. A file outside the change can still stop the run with exit 2, for example with [type-overlap](codes.md#type-overlap), [file-unreadable](codes.md#file-unreadable), [file-too-large](codes.md#file-too-large), [text-too-large](codes.md#text-too-large), [parser-failed](codes.md#parser-failed) or [link-outside-root](codes.md#link-outside-root).

A run is not a plain check when:

- it names a path;
- it uses `--full`;
- it uses `--review`.

Example: `lawcheck check --base main` is a plain check. `lawcheck check --full --base main` is not.

## Short answers

### The law and the code

The law sits in the repository beside the code. You change the law with the same commits and reviews as any other file. A check of a change that edits the law prints a note, such as `note: this change edits the law that judges it: takes the rule no-console off the type library`. `lawcheck prime` prints the law in short for a coding agent.

### A file and its type

Lawcheck gives a type to each file git lists, except symbolic links and binary files. The top-level types sit directly under `types:` in the law. Lawcheck tests each file against them first. Then it goes down through the subtypes of the type that matched, one level at a time, until no subtype matches. The deepest match is the type of the file. The rules of every type on the way down bind it. If two types of one level match one file, every run stops with `type-overlap`. `lawcheck explain <path>` shows the type of a file. For a path with no file yet, it shows the type a new file there would get. [The law file](law.md) has every key.

### Debt and the exit code

A plain check judges the change. Each error it finds there fails the run with exit 1. With `--full`, `lawcheck check` judges every other file too. It lists what it finds outside the change as debt, below the findings of the change. Debt does not change the exit code, unless you pass `--strict`: with it, a finding of an `enforced` rule in an old file fails the run. Without it, a new law passes in a repository whose old code already breaks it. A rule can stay `advisory` until you fix its debt. [What a check judges](change.md) has the details.

### A script rule or a reviewer rule

A script rule fits what code can find in the text of a file: a call, a name, a line that matches a pattern. A reviewer rule fits a requirement a person would judge by reading, such as whether an error message says what to do next. A reviewer rule costs one model call for each file and rule. `lawcheck try <rule> <file> --dry-run` counts the calls and makes none. With the committed passes, CI checks the reviewer rules with no model and no key. [Script rules](script-rules.md) and [Reviewer rules](reviewer-rules.md) have the contracts.

### The Claude Code plugin

The plugin runs Lawcheck inside a Claude Code session at three moments:

- at the start of the session, it gives the agent the output of `lawcheck prime`;
- after each edit, it checks the edited file;
- when the agent is about to finish its answer to your prompt, it checks the files the agent changed for that prompt. While they break the law, it sends the agent back, three times at most.

[The Claude Code plugin](plugin.md) has every hook and setting.

Next: [Lawcheck and the tools you already use](other-tools.md)
