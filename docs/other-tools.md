# Lawcheck and the tools you already use

Your repository already has an `AGENTS.md`, an ESLint rule for its layers, or a bot that reviews pull requests, and you want to know whether Lawcheck replaces it, adds to it, or does not fit.

Lawcheck checks your code against a [law](concepts.md#law) you write in `.lawcheck/law.yaml`. The law names the [types](concepts.md#type) of your files, which types each type may [use](concepts.md#use), and the [rules](concepts.md#rule) each type keeps. In Claude Code, the Lawcheck plugin gives the agent the law when a session starts, checks each file the agent edits, and checks the files of its turn before the turn ends. A CI job checks the same law before the merge, with no key and no network.

## `CLAUDE.md` and `AGENTS.md`

A rules file is prose that the agent reads at the start of a session. You can write anything there: the command that runs the tests, the branch to start from, the form of a commit message. `AGENTS.md` is an open format that Codex, Gemini CLI and Copilot read, and Claude Code reads it from version 2.1.277 in a repository with no `CLAUDE.md`.

A rules file holds rules about how the agent works, such as "run the tests before you finish". Lawcheck cannot hold those, because it judges files.

The agent reads the rules file, and nothing in the session checks the code against it. On 2026-11-22 the issue tracker of Claude Code held 297 reports with the words "ignores CLAUDE.md", 60 of them opened since June 2026.

You write the rules about files as a law, and `lawcheck check` judges the code against it. It prints each [finding](concepts.md#finding) with its file, its line and the rule it breaks, and exits 1 while the code breaks the law. `lawcheck prime` prints the law for the agent, with the changes to the law the agent may make alone and the ones that need your word.

Lawcheck works through the rules file too. For an agent other than Claude Code, one line in its instructions file tells it to run `lawcheck prime` at the start of every session, and Lawcheck ships no hook for that agent ([Other coding agents](other-agents.md)). In Claude Code, the plugin hands the agent the output of `lawcheck prime` when a session starts, resumes, is cleared or is compacted, so `CLAUDE.md` needs no line for Lawcheck.

| Your case | Use |
|---|---|
| Your rules say how the agent works: commands, branches, messages | the rules file alone |
| Your rules are about files: which layer may import which, what a file of one kind must hold | Lawcheck, with the law in `.lawcheck/` |
| Your repository has both kinds | both: the rules file keeps the rules about the work, and the law keeps the rules about files |

## An architecture tool for one language

ArchUnit writes architecture rules as tests in Java, and ArchUnitNET and NetArchTest do the same in .NET. `eslint-plugin-boundaries` checks the boundaries between layers inside ESLint. `dependency-cruiser` checks the dependency rules of a configuration file in JavaScript and TypeScript, and draws graphs of the dependencies. Nx checks the boundaries between the projects of a monorepo with its rule `enforce-module-boundaries`. `import-linter` checks contracts between layers in Python, `deptrac` checks layers in PHP, and `packwerk` checks packages in Rails.

Each of these tools knows one language or one ecosystem. Between them, they check cycles, modules that nothing uses, names and annotations, and Lawcheck's law has no key for any of these. A [script rule](concepts.md#script-rule) can find them in the text of the files, and you write that rule yourself. ArchUnit (`FreezingArchRule`) and `packwerk` keep a file of the breaches that were there before the rule.

These tools run in the test suite, the linter or a CI job. Inside an agent's turn they run through a hook you write.

Lawcheck reads the uses of twelve languages: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C, C++, PHP and Ruby. A repository with a backend in Go and a front end in TypeScript keeps one law, where the tools above need one tool and one configuration per language. Every finding has the same form in every language.

- Lawcheck counts a use its readers cannot resolve to one file, and never reports it as a finding ([Languages and uses](languages.md)).
- The same law holds [reviewer rules](concepts.md#reviewer-rule), for a requirement a person would judge by reading.
- A plain check judges the [change](concepts.md#change). `lawcheck check --full` lists the breaches outside it as [debt](concepts.md#debt), and debt never changes the exit code, so a law can start in a repository that already breaks it.

Lawcheck reads the uses written out in the code. An `import()` of a variable, `importlib.import_module` and reflection stay unread. In Java, Kotlin, C#, Ruby and Rust, a check of one file also reads the declarations of every file of its language in the repository, and such a run costs most in Java. Lawcheck runs on Node 24 or later, so a Java or Python build adds Node to its CI image ([Supported environments](support.md)).

| Your case | Use |
|---|---|
| One language, and the tool already holds your layers in the test suite or the linter | that tool; add Lawcheck for reviewer rules, or for the check inside the agent's turn in Claude Code |
| Two or more languages under one set of layers | Lawcheck: one law and one form of finding for all of them |
| A cycle rule, a naming rule or another rule the tool checks in its language, in a repository that Lawcheck checks | both: the tool keeps that rule, and the law keeps `may_use` and the rules of the other languages |
| Many breaches already in the code | either: Lawcheck judges the change and lists the rest as debt, and ArchUnit and `packwerk` keep a file of the older breaches |

## A review bot at the pull request

CodeRabbit reviews each pull request with a model, and runs pre-merge checks that you write in prose in `.coderabbit/`, each with the mode off, warning or error. Qodo and Greptile review pull requests with rules in prose, and Qodo imports `AGENTS.md` and draws rules from the history of earlier pull requests. Cursor Bugbot learns rules from review comments. Copilot code review reads the instructions of the repository. Claude Code Review runs several agents on a pull request, and never approves or blocks it. Continue runs Markdown checks from `.continue/checks` as a status of the pull request. The services among them charge per person, per review or in credits.

A review bot reads the whole pull request, and comments on the change as a whole, with your rules or without them. Lawcheck's reviewer sees one file and one rule per call, with the context files the rule names, and nothing else of the repository. A requirement that spans the files of a change, such as a new handler that comes with its test, is outside what a reviewer rule sees.

Lawcheck checks before the pull request exists: in Claude Code, after each edit and before the agent ends its turn. Uses and script rules need no model, and a second check of the same code prints the same output.

A reviewer rule needs a model. `lawcheck check --review` asks the reviewer once per file and rule, and records each pass as a [verdict](concepts.md#verdict) in `.lawcheck/verdicts`, which you commit. A later check reads that pass, and Lawcheck sends the file again only after the file, the rule, its `why` or its context changes. CI reads the committed verdicts, calls no model and needs no key. A changed file with no recorded pass of an enforced reviewer rule is `not-reviewed`, an error that fails the job, so someone runs `lawcheck check --review` before the push ([CI and git hooks](ci.md)).

Code leaves your machine only when you ask a model to judge a reviewer rule, with `--review` or `lawcheck try`. It goes to the one of nine providers you name, and `ollama` sends it to a server on your own machine by default ([Reviewers and keys](providers.md)). Lawcheck needs no account, and its licence is MIT. A check tells you when a change edits the law that judges it.

Lawcheck writes no annotation into the pull request. A CI job shows its findings in the log, and `--json` prints them as one document.

| Your case | Use |
|---|---|
| You want comments on the whole change, including on what no rule names | a review bot |
| A rule must hold in every file of a kind, and the agent must hear it before it opens a pull request | Lawcheck |
| Your code may not go to a hosted model | Lawcheck with uses and script rules, which send nothing, and reviewer rules through `ollama` on a machine you run |
| You want both of the above | both: the bot reviews the pull request, and Lawcheck holds the law at each edit and in CI |

## A hook you wrote in Claude Code

A Claude Code hook runs a script on an event of the session. Exit 2 from a hook blocks the action and hands the hook's message to the agent. A hook of your own can run any program, such as your linter or your tests, on any event Claude Code has. `PreToolUse` comes before a tool runs, so a hook there can stop an edit before it is written.

Your hook goes further than Lawcheck in two places. The plugin checks a file after the edit is written, and a script rule cannot start a program such as your linter. A hook that runs your linter checks what the linter knows: no `may_use` across languages and no reviewer rules.

The Lawcheck plugin adds the law to the session ([The Claude Code plugin](plugin.md)):

- When a session starts, the agent gets the output of `lawcheck prime`.
- After each `Write`, `Edit` or `NotebookEdit`, the plugin checks the edited file, and the agent gets the output when the file breaks the law.
- Before the agent ends its turn, the plugin checks the files of the turn: the files that changed since the prompt, and the files of commits made during the turn. While they break the law, it sends the agent back, at most three times and never twice in a row with the same output. After that it lets the agent finish and tells you that the check still fails.
- Each check has a deadline five seconds shorter than the time Claude Code gives the hook, and past it the plugin ends Lawcheck and its child processes.

A hook of your own can run `lawcheck check <file>` too. Lawcheck exits 1 when the file breaks the law and 2 when the law or the setup is broken. Claude Code blocks on exit 2 of a hook, so your hook turns Lawcheck's exit 1 into exit 2, and decides for itself what Lawcheck's exit 2 means. The plugin's two checks each have a setting, `check_after_edit` and `check_before_stop`, so you can turn off the one your own hook already does.

Cursor, Copilot, Codex and Gemini CLI have hooks on similar events, where exit 2 blocks as well. Lawcheck has a plugin for Claude Code alone, so in those agents a hook you write runs `lawcheck check`. Without such a hook the agent checks only when it follows its instructions file, and a CI job catches what it skips.

| Your case | Use |
|---|---|
| Your hook runs the linter and the tests, and the linter already holds your layers | your hook |
| You want the law checked inside the turn, on the files of the turn, with at most three returns | the Lawcheck plugin |
| Your hook runs the tests, and the law holds your layers | both: your hook runs the tests, and the plugin checks the law |
| You work in another agent that has hooks | a hook you write that runs `lawcheck check`, and the same check in CI |

Next: [I want to](i-want-to.md)
