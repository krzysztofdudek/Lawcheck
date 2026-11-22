# Questions

## Package managers

Lawcheck installs with npm, pnpm, Yarn 1, Yarn 4 with `nodeLinker: node-modules` or `nodeLinker: pnpm`, and Bun with Node 24 on the `PATH`. Under Yarn Plug'n'Play, a Lawcheck installed in the project stops with `unsupported-environment`. Set `runner` in `.lawcheck/config.yaml` to your package manager. The plugin and `lawcheck prime` then start Lawcheck through it. [Supported environments](support.md#package-managers) gives the command that starts Lawcheck under each package manager.

## Windows and macOS

Lawcheck runs on Linux, macOS and Windows, with Node 24 or later and git 2.34 or later. On every push the tests run on the newest Windows and macOS runners of GitHub Actions, beside Linux. [Supported environments](support.md#node-git-and-the-systems) says what the tests run on each system.

## Code that leaves the machine

A plain `lawcheck check` opens no connection and starts no reviewer program. Only `check --review`, `lawcheck try` on a reviewer rule and `lawcheck doctor --reviewer` send a prompt to the reviewer you set. Each call sends one prompt with one judged file, the rule and the files of the rule's `context`. [Reviewers and keys](providers.md#text-that-leaves-the-machine) says where each provider sends it.

## A key in CI

A CI job needs no key. A plain check reads the passes recorded in `.lawcheck/verdicts` and calls no reviewer. Run `lawcheck check --review` on a machine with a reviewer, then commit that file. Without a recorded pass, a changed file under an enforced reviewer rule gets the error `not-reviewed`. [Reviewer rules](reviewer-rules.md#verdicts) says what a pass holds.

## A script rule that reads other files

Lawcheck calls a [script rule](concepts.md#script-rule) once for each file it binds. The argument `files` holds that one file. `repo.filesOf(typeId)` gives the paths of every file of a type. The rule may read any file under the root with `node:fs`. [Script rules](script-rules.md#the-argument-of-check) lists what the rule receives.

## A reviewer rule that needs another file

The reviewer judges one file per call and sees nothing else of the repository. Name the other files in the rule's `context` in the law. The reviewer then gets them with every file it judges. After a change to a context file, each file of the rule needs a new review. [The law file](law.md#context) gives the form.

## Old code that breaks the law

A plain `lawcheck check` judges the files that differ from the base. Old code fails nothing until a change touches it. `lawcheck check --full` lists the findings in the rest of the code as [debt](concepts.md#debt). A finding of debt is a warning. Debt never changes the exit code. [What a check judges](change.md#full-and-debt) shows the output.

## A new model for the reviewer

A change of provider or model keeps every recorded pass. The key of a pass holds no provider and no model. A change of the judged file needs a new review. So does a change of the rule's text, its `why` or its context files. [Reviewer rules](reviewer-rules.md#verdicts) lists every part of the key.

## The cost of a review

`lawcheck try <rule> <file> --dry-run` prints the calls a review would make and the size of each prompt. It makes no call. `reviewer.max_calls` caps the requests of one run. A run that needs more requests sends none and stops with `too-many-reviews`. [Reviewer rules](reviewer-rules.md#asking-the-reviewer) shows the flags.

## Submodules and nested repositories

Lawcheck does not look into a submodule, or into a separate repository inside this one. It prints a note when a type's paths reach into one. Give that repository a law of its own and run Lawcheck there. [A monorepo](monorepo.md#_6-leave-a-nested-repository-to-its-own-law) shows the note.

## Generated and vendored files

A file git ignores has no type. Lawcheck never judges a file with no type. Add the folder to `.gitignore`, or keep it out of the type with a `!` pattern in its `paths`. [The law file](law.md#patterns) gives the syntax of a pattern.

## Another coding agent

Add one line to the agent's instructions file: Run `lawcheck prime` at the start of every session and follow it. The agent then checks its work when it follows the text that `lawcheck prime` prints. No hook checks a file after an edit. [Other coding agents](other-agents.md#_1-add-one-line-to-the-instructions-file) shows what the agent reads and what it skips.

## The pages in the terminal

`lawcheck docs` lists the pages that ship with the version you installed. `lawcheck docs <topic>` prints one page. The command needs no law, no git and no network. [The commands](commands.md#docs) gives the flags.

Next: [Changelog](changelog.md)
