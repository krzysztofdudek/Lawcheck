# Questions

## Package managers

Lawcheck installs with npm, pnpm, Yarn 1, Yarn 4 with `nodeLinker: node-modules` or `nodeLinker: pnpm`, and Bun with Node 24 on the `PATH`. Under Yarn Plug'n'Play, a Lawcheck installed in the project stops with `unsupported-environment`. In `.lawcheck/config.yaml`, set the `runner` setting to the package manager of your project. The Claude Code plugin then starts Lawcheck through it. `lawcheck prime` names that command to the agent. [Supported environments](support.md#package-managers) gives the command that starts Lawcheck under each package manager.

## Windows and macOS

Lawcheck runs on Linux, macOS and Windows, with Node 24 or later and git 2.34 or later. On every push, Lawcheck's tests run on Linux and on the newest Windows and macOS machines of GitHub Actions. [Supported environments](support.md#node-git-and-the-systems) says what the tests run on each system.

## Code that leaves the machine

A [plain `lawcheck check`](concepts.md#plain-check) opens no connection and starts no reviewer program. Only `check --review`, `lawcheck try` on a reviewer rule and `lawcheck doctor --reviewer` send a prompt to the reviewer you set. Each call sends one prompt with one judged file, the rule and the files of the rule's `context`. [Reviewers and keys](providers.md#text-that-leaves-the-machine) says where each provider sends it.

## A key in CI

A CI job needs no key. A plain check calls no reviewer. It reads the passes in `.lawcheck/verdicts`, where each pass is the reviewer's [verdict](concepts.md#verdict) of pass for one file and one rule. Run `lawcheck check --review` on a machine with a reviewer, then commit that file. For a changed file with no recorded pass of an enforced reviewer rule, Lawcheck reports the error `not-reviewed`. [Reviewer rules](reviewer-rules.md#verdicts) says what a pass holds.

## A script rule that reads other files

Lawcheck calls a [script rule](concepts.md#script-rule) once for each file it binds: each file whose type, or a type above it, lists the rule. The argument `files` holds that one file. `repo.filesOf(typeId)` gives the paths of every file of a type. With `node:fs`, the rule may read any file below the folder that holds `.lawcheck/`. [Script rules](script-rules.md#the-argument-of-check) lists what the rule receives.

## A reviewer rule that needs another file

The reviewer sees one file per call and nothing else of the repository. To give it other files, name them in the rule's `context` in the law. The reviewer then gets them beside every file it judges. After a change to a context file, each file that the rule binds needs a new review. [The law file](law.md#context) gives the form.

## Old code that breaks the law

A plain `lawcheck check` judges the files that differ from the base. Old code fails nothing until a change touches it. `lawcheck check --full` lists the findings in the rest of the code as [debt](concepts.md#debt). A finding of debt is a warning, which does not change the exit code unless you pass `--strict`. [What a check judges](change.md#full-and-debt) shows the output.

## A new model for the reviewer

Lawcheck keeps every recorded pass when you change the provider or the model, because the key of a pass holds neither. A file needs a new review when one of these changes:

- the judged file;
- the rule's text or its `why`;
- a context file of the rule.

[Reviewer rules](reviewer-rules.md#verdicts) lists every part of the key.

## The cost of a review

`lawcheck try <rule> <file> --dry-run` prints the calls a review would make and the size of each prompt. It makes no call. `reviewer.max_calls` caps the requests of one run. A run that needs more requests sends none and stops with `too-many-reviews`. [Reviewer rules](reviewer-rules.md#asking-the-reviewer) shows the flags.

## Submodules and nested repositories

A submodule is a repository that git keeps inside another one at a fixed commit. Lawcheck does not look into a submodule, or into a separate repository inside this one. It prints a note when a type's paths reach into one. Give that repository a law of its own and run Lawcheck there. [A monorepo](monorepo.md#_6-leave-a-nested-repository-to-its-own-law) shows the note.

## Generated and vendored files

Lawcheck never judges a file that git ignores, because such a file has no type. Add the folder to `.gitignore`, or keep it out of the type with a `!` pattern in its `paths`. [The law file](law.md#patterns) gives the syntax of a pattern.

## Another coding agent

Add one line to the agent's instructions file: Run `lawcheck prime` at the start of every session and follow it. The text that `lawcheck prime` prints tells the agent to run `lawcheck check` after each change of code. With another agent, no hook checks a file after an edit. [Other coding agents](other-agents.md#_1-add-one-line-to-the-instructions-file) shows what the agent reads and what it skips.

## The pages in the terminal

`lawcheck docs` lists the pages that ship with the version you installed. `lawcheck docs <topic>` prints one page. It works without a law, git or a network, because it reads the pages inside the installed package. [The commands](commands.md#docs) gives the flags.

Next: [Changelog](changelog.md)
