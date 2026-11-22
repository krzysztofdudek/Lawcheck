# Concepts

These pages use twelve words, each with one meaning. Each word has a heading here, a short definition and one example.

## Law

The law is what you write down about your repository. It names the types of its files, the types each type may use, and the rules each type keeps. The law is the file `.lawcheck/law.yaml`, with one file per rule in `.lawcheck/rules/`. You commit the law with the code.

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

A type is one kind of file. The patterns of its `paths` say which files it takes. An optional `content` expression keeps only the files whose text matches it. A type can hold subtypes. Lawcheck tests a file against a subtype only after the file matched its parent. A file gets the deepest type that matches it. Lawcheck never judges a file that has no type.

Example: under the law above, `src/core/receipt.ts` has the type `core`. `lawcheck explain src/core/receipt.ts` shows it.

## Rule

A rule is one requirement with an id and a `why`. A type lists the rules its files keep. Lawcheck prints the `why` beside each finding of the rule. The findings of a rule with `status: advisory` are warnings.

Example: the rule `no-console`, with `why: Only the command layer writes to the terminal.`

## Script rule

A script rule is a JavaScript module, `.lawcheck/rules/<id>.mjs`. Its function `check` receives the files and returns findings. A script rule needs no model and no key. It runs in a Node process of its own. That process may read only the root of the repository and Lawcheck's own folder.

Example: `.lawcheck/rules/no-console.mjs` returns `{ line: 1, message: 'writes to the terminal with console.log' }` for a file whose first line calls `console.log`.

## Reviewer rule

A reviewer rule is a Markdown file, `.lawcheck/rules/<id>.md`. It tells a language model what must hold in each file it binds. The model that judges the rule is the reviewer. `lawcheck check --review` sends the reviewer one file and one rule per call. The reviewer answers pass or fail.

Example: `.lawcheck/rules/clear-errors.md` says "Every error message a caller can see says what happened and what the caller can do next."

## Use

A use is a reference from one file to another file of the repository, such as an `import`. Lawcheck reads uses in TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C, C++, PHP and Ruby. The part of Lawcheck that reads the uses of one language is its reader. The `may_use` list of a type names the types its files may use. A use the list does not allow is the finding `forbidden-use`.

Example: `import { print } from "../cli/print.js";` in `src/core/receipt.ts` is a use of `src/cli/print.ts`.

## Finding

A finding is one place that breaks the law. It holds a file, a line, a rule or a code, a message and the `why`. In the [change](concepts.md#change), a finding of an enforced rule is an error. An error makes `lawcheck check` exit 1.

Example:

```output
src/core/receipt.ts:1  error[forbidden-use]  core may not use src/cli/print.ts, which has no type; its may_use is [core]
  why:  a type's may_use names every type its files may use
```

## Debt

Debt is what `lawcheck check --full` finds in the files outside the change. A finding of debt is a warning, whatever the status of its rule. Debt never changes the exit code.

Example: `debt (outside this change): 1 finding in 1 file`, after the findings of the change.

## Waiver

A waiver is a marker in a line that names one rule and a reason. It drops the findings of that rule on the line it covers. A waiver needs a reason. In a type with `waivers: false`, Lawcheck reads the marker as plain text.

Example: a comment at the end of a line that prints a warning. The comment names the rule `no-console` and the reason "the pricing team reads this warning until 2.0". [Waivers](waivers.md) shows the marker and the lines it covers.

## Verdict

A verdict is the answer of the reviewer, pass or fail, for one file and one reviewer rule. Lawcheck writes each pass as a line of `.lawcheck/verdicts`. You commit that file. A later check reads the pass and calls no model. The pass holds until one of these changes:

- the file;
- the text of the rule;
- the `why` of the rule;
- a file the rule lists in `context`, which the reviewer reads beside each file it judges.

Example: the pass of `clear-errors` for one file, as a key and the rule id:

```text
bec7eb69fcc74507cad562d7d51f13eb clear-errors
```

## Base

The base is the commit that a check compares your work with. Lawcheck takes it from the first of these places that names one:

1. the flag `--base`, with a branch, a tag or a commit;
2. the variable `LAWCHECK_BASE`;
3. `origin/HEAD`.

With no base, a check on your machine counts every file as changed. A plain check in a CI job with no base stops with `base-unreachable`.

Example: `lawcheck check --base main`.

## Change

The change is the set of files that differ from the merge base of `HEAD` and the base. A file belongs to the change when it is one of these:

- committed on the branch;
- staged;
- modified;
- new, and not ignored by git.

A plain `lawcheck check` judges the change alone. A file outside the change never fails a plain check.

Example: on a branch where you edited one file, the first line of `lawcheck check --base main` ends with `1 changed file (against main)`.

## Short answers

### The law and the code

The law sits in the repository beside the code. You change the law with the same commits and reviews as any other file. A check of a change that edits the law prints a note, such as `note: this change edits the law that judges it: takes the rule no-console off the type library`. `lawcheck prime` prints the law in short for a coding agent.

### A file and its type

Lawcheck gives a type to the files git lists. Lawcheck gives no type to symbolic links and binary files. Lawcheck tests a file against the root types first. It then tests the file against the subtypes of the type that matched, one level at a time. The deepest match is the type of the file. The rules of every type on the way down bind the file. If two types of one level match one file, every run stops with `type-overlap`. `lawcheck explain <path>` shows the type of a file. For a path with no file yet, it shows the type a new file there would get. [The law file](law.md) has every key.

### Debt and the exit code

A plain check judges the change. Its errors fail the run. `lawcheck check --full` judges every other file too. It lists what it finds there as debt, after the findings of the change. Debt has no effect on the exit code. In a repository that already breaks a new law, the old code is debt. The new law passes there. A rule can stay `advisory` until you fix its debt. [What a check judges](change.md) has the details.

### A script rule or a reviewer rule

A script rule fits what code can find in the text of a file: a call, a name, a line that matches a pattern. A reviewer rule fits a requirement a person would judge by reading, such as whether an error message says what to do next. A reviewer rule costs one model call for each file and rule. `lawcheck try <rule> <file> --dry-run` counts the calls and makes none. With the committed passes, CI checks the reviewer rules with no model and no key. [Script rules](script-rules.md) and [Reviewer rules](reviewer-rules.md) have the contracts.

### The Claude Code plugin

The plugin runs Lawcheck inside a Claude Code session. At the start it gives the agent the output of `lawcheck prime`. After each edit it checks the edited file. Before the agent ends its turn, the plugin checks the files of the turn. While they break the law, it sends the agent back, three times at most. [The Claude Code plugin](plugin.md) has every hook and setting.

Next: [Lawcheck and the tools you already use](other-tools.md)
