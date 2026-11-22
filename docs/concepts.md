# Concepts

The pages use twelve words, each with one meaning. Each word has a heading here, two sentences and one example.

## Law

The law is what you write down about your repository: the types of its files, which types each may use, and the rules each type keeps. It is the file `.lawcheck/law.yaml` with one file per rule in `.lawcheck/rules/`, and you commit it with the code.

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

A type is one kind of file, given by the patterns of its `paths` and an optional `content` expression. A file gets the deepest type that matches it, and Lawcheck never judges a file that has no type.

Example: under the law above, `src/core/receipt.ts` has the type `core`, and `lawcheck explain src/core/receipt.ts` shows it.

## Rule

A rule is one requirement with an id and a `why`, and a type lists the rules its files keep. Lawcheck prints the `why` beside each finding of the rule, and a rule with `status: advisory` only warns.

Example: the rule `no-console`, with `why: Only the command layer writes to the terminal.`

## Script rule

A script rule is a JavaScript module, `.lawcheck/rules/<id>.mjs`, whose function `check` receives the files and returns findings. It needs no model and no key, and it runs in a Node process of its own that may read only the root and Lawcheck's own folder.

Example: `.lawcheck/rules/no-console.mjs` returns `{ line: 1, message: 'writes to the terminal with console.log' }` for a file whose first line calls `console.log`.

## Reviewer rule

A reviewer rule is a Markdown file, `.lawcheck/rules/<id>.md`, that tells a language model what must hold in each file it binds. `lawcheck check --review` sends the model one file and one rule per call, and the model answers pass or fail.

Example: `.lawcheck/rules/clear-errors.md` says "Every error message a caller can see says what happened and what the caller can do next."

## Use

A use is a reference from one file to another file of the repository, such as an `import`, and Lawcheck reads uses in TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C, C++, PHP and Ruby. A type's `may_use` names the types its files may use, and a use the list does not allow is the finding `forbidden-use`.

Example: `import { print } from "../cli/print.js";` in `src/core/receipt.ts` is a use of `src/cli/print.ts`.

## Finding

A finding is one place that breaks the law: a file, a line, a rule or a code, a message and the why. In the change, a finding of an enforced rule is an error, and an error makes `lawcheck check` exit 1.

Example:

```output
src/core/receipt.ts:1  error[forbidden-use]  core may not use src/cli/print.ts, which has no type; its may_use is [core]
  why:  a type's may_use names every type its files may use
```

## Debt

Debt is what `lawcheck check --full` finds in the files outside the change. A finding of debt is a warning whatever the rule's status, so debt never changes the exit code.

Example: `debt (outside this change): 1 finding in 1 file`, after the findings of the change.

## Waiver

A waiver is a marker in a line that names one rule and a reason, and it drops that rule's findings on the line it covers. The reason is required, and in a type with `waivers: false` the marker is plain text.

Example: a comment at the end of a line that prints a warning, naming the rule `no-console` and the reason "the pricing team reads this warning until 2.0". [Waivers](waivers.md) shows the marker and what it covers.

## Verdict

A verdict is the answer of the reviewer, pass or fail, for one file and one reviewer rule. A pass becomes a line of `.lawcheck/verdicts`, which you commit, so a later check reads it and calls no model until the file, the rule's text, its `why` or its context changes.

Example: the pass of `clear-errors` for one file, as a key and the rule id:

```text
bec7eb69fcc74507cad562d7d51f13eb clear-errors
```

## Base

The base is the commit that a check compares your work with: `--base <ref>`, else the variable `LAWCHECK_BASE`, else `origin/HEAD`. With no base, a check on your machine counts every file as changed, and a plain check in a CI job stops with `base-unreachable`.

Example: `lawcheck check --base main`.

## Change

The change is every file that differs from the merge base of `HEAD` and the base: committed on the branch, staged, modified, or new and not ignored by git. A plain `lawcheck check` judges only the change, so a file nobody touched never fails it.

Example: on a branch where you edited one file, the first line of `lawcheck check --base main` ends with `1 changed file (against main)`.

## Short answers

### The law and the code

The law sits in the repository beside the code, so a change of the law goes through the same commits and reviews as any other change. The check of a change that edits the law prints a note that says so, such as `note: this change edits the law that judges it: takes the rule no-console off the type library`. `lawcheck prime` prints the law in short for a coding agent.

### A file and its type

Lawcheck types the files git lists, without symbolic links and binary files. It tests the root types, then the subtypes of the one that matched, and the deepest match is the file's type; the rules of every type on the way down bind the file. Two types of one level that match one file stop every run with `type-overlap`. `lawcheck explain <path>` shows the type of a file, and the type a new file at that path would get. [The law file](law.md) has every key.

### Debt and the exit code

A plain check judges the change, and its errors fail the run. `lawcheck check --full` also judges every other file, and lists what it finds there as debt, after the findings of the change and with no effect on the exit code. So a new law passes in a repository that already breaks it, and a rule can start `advisory` until its debt is paid. [What a check judges](change.md) has the details.

### A script rule or a reviewer rule

A script rule fits what code can find in the text of a file: a call, a name, a line that matches a pattern. A reviewer rule fits a requirement a person would judge by reading, such as whether an error message says what to do next. A reviewer rule costs one model call for each file and rule, `lawcheck try <rule> <file> --dry-run` counts the calls and makes none, and the committed passes let CI check with no model and no key. [Script rules](script-rules.md) and [Reviewer rules](reviewer-rules.md) have the contracts.

### The Claude Code plugin

The plugin runs Lawcheck inside a Claude Code session. At the start it gives the agent the output of `lawcheck prime`. After each edit it checks the edited file. Before the agent ends its turn, it checks the files of the turn and sends the agent back, at most three times, while they break the law. [The Claude Code plugin](plugin.md) has every hook and setting.
