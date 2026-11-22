# Questions

## Package managers

Lawcheck installs with npm, pnpm, Yarn 1, Yarn 4 with `nodeLinker: node-modules` or `nodeLinker: pnpm`, and Bun with Node 24 on the `PATH`. Under Yarn Plug'n'Play, a Lawcheck installed in the project stops with `unsupported-environment`. Set `runner` in `.lawcheck/config.yaml` to your package manager, and the plugin and `lawcheck prime` start Lawcheck through it. [Supported environments](support.md#package-managers) gives the start command of each.

## Windows and macOS

Lawcheck runs on Linux, macOS and Windows, with Node 24 or later and git 2.34 or later. On every push the tests run on the newest Windows and macOS runners of GitHub Actions, beside Linux. [Supported environments](support.md#node-git-and-the-systems) says what the tests run on each system.

## Code that leaves the machine

A plain `lawcheck check` opens no connection and starts no reviewer program. Only `check --review`, `lawcheck try` on a reviewer rule and `lawcheck doctor --reviewer` send a prompt to the reviewer you set. Each call sends one prompt with one judged file, the rule and the rule's context files. [Reviewers and keys](providers.md#text-that-leaves-the-machine) says where each provider sends it.

## A key in CI

A CI job needs no key. A plain check reads the passes recorded in `.lawcheck/verdicts` and calls nobody, so you run `lawcheck check --review` where a reviewer is set up and commit that file. A file of the change that an enforced reviewer rule binds, with no pass recorded, is `not-reviewed`, an error. [Reviewer rules](reviewer-rules.md#verdicts) says what a pass holds.

## A script rule that reads other files

Lawcheck calls a script rule once for each file it binds, and `files` holds that one file. `repo.filesOf(typeId)` gives the paths of every file of a type, and the rule may read any file under the root with `node:fs`. [Script rules](script-rules.md#the-argument-of-check) lists what the rule receives.

## A reviewer rule that needs another file

The reviewer judges one file per call and sees nothing else of the repository. Name the other files in the rule's `context` in the law, and the reviewer gets them with every file it judges. After a change to a context file, every file of the rule waits for a new review. [The law file](law.md#context) gives the form.

## Old code that breaks the law

A plain `lawcheck check` judges only the files that differ from the base, so old code fails nothing until a change touches it. `lawcheck check --full` lists the findings in the rest of the code as debt. Debt is a warning and never changes the exit code. [What a check judges](change.md#full-and-debt) shows the output.

## A new model for the reviewer

A change of provider or model keeps every recorded pass, since neither is part of the key of a pass. A change of the judged file, the rule's text, its `why` or its context files asks for a new review. [Reviewer rules](reviewer-rules.md#verdicts) lists every part of the key.

## The cost of a review

`lawcheck try <rule> <file> --dry-run` prints the calls a review would make and the size of each prompt, and makes no call. `reviewer.max_calls` caps the requests of one run, and a run that needs more makes none and stops with `too-many-reviews`. [Reviewer rules](reviewer-rules.md#asking-the-reviewer) shows the flags.

## Submodules and nested repositories

Lawcheck does not look into a submodule, or into a repository of its own inside this one, and prints a note when a type's paths reach into one. Give that repository a law of its own and run Lawcheck there. [A monorepo](monorepo.md#_6-leave-a-nested-repository-to-its-own-law) shows the note.

## Generated and vendored files

A file git ignores has no type, and Lawcheck never judges a file with no type. Add the folder to `.gitignore`, or keep it out of the type with a `!` pattern in its `paths`. [The law file](law.md#patterns) gives the syntax of a pattern.

## Another coding agent

Add one line to the agent's instructions file: Run `lawcheck prime` at the start of every session and follow it. The agent then checks when it follows the primer, and nothing checks a file after an edit. [Other coding agents](other-agents.md#_1-add-one-line-to-the-instructions-file) shows what the agent reads and what it skips.

## The pages in the terminal

`lawcheck docs` lists the pages that ship with the version you installed, and `lawcheck docs <topic>` prints one. It needs no law, no git and no network. [The commands](commands.md#docs) gives the flags.

Next: [Changelog](changelog.md)
