# Lawcheck and the tools you already use

Your repository has an `AGENTS.md`, an ESLint rule for its layers, or a bot that reviews pull requests. This page says where Lawcheck replaces that tool, where it adds to it, and where it does not fit.

Lawcheck checks your code against a [law](concepts.md#law) you write in `.lawcheck/law.yaml`. The law names the [types](concepts.md#type) of your files, which types each type may [use](concepts.md#use), and the [rules](concepts.md#rule) each type keeps. In Claude Code, the Lawcheck plugin does three things:

- It gives the agent the law when a session starts.
- It checks each file the agent edits.
- It checks the files of the turn before the turn ends.

A CI job checks the same law before the merge. It needs no key and no network.

## `CLAUDE.md` and `AGENTS.md`

A rules file is prose that the agent reads at the start of a session. You can write anything there: the command that runs the tests, the branch to start from, the form of a commit message. `AGENTS.md` is an open format that Codex, Gemini CLI and Copilot read. Claude Code reads it from version 2.1.277, in a repository with no `CLAUDE.md`.

A rules file holds rules about how the agent works, such as "run the tests before you finish". Lawcheck judges files. The law has no place for a rule about the work.

The agent reads the rules file. Claude Code does not check the code against it. On 2026-11-22, the issue tracker of Claude Code held 297 reports with the words "ignores CLAUDE.md". The tracker received 60 of them since June 2026.

You write the rules about files as a law. `lawcheck check` judges the code against the law. It prints each [finding](concepts.md#finding) with its file, its line and the rule it breaks. It exits 1 while the code breaks the law. `lawcheck prime` prints the law for the agent. Its text says which changes to the law the agent may make alone, and which need your word.

Lawcheck works through the rules file too. For an agent other than Claude Code, one line in its instructions file tells it to run `lawcheck prime` at the start of every session. Lawcheck ships no hook for that agent ([Other coding agents](other-agents.md)). In Claude Code, the plugin hands the agent the output of `lawcheck prime` on four events: the start of a session, a resume, a clear and a compaction. `CLAUDE.md` then needs no line for Lawcheck.

| Your case | Use |
|---|---|
| Your rules say how the agent works: commands, branches, messages | the rules file alone |
| Your rules are about files: which layer may import which, what a file of one kind must hold | Lawcheck, with the law in `.lawcheck/` |
| Your repository has both kinds | both: the rules file keeps the rules about the work, and the law keeps the rules about files |

## An architecture tool for one language

These tools check architecture in one language or one ecosystem:

- With ArchUnit, you write architecture rules as tests in Java. ArchUnitNET and NetArchTest do the same in .NET.
- `eslint-plugin-boundaries` checks the boundaries between layers inside ESLint.
- `dependency-cruiser` checks the dependency rules of a configuration file in JavaScript and TypeScript. It draws graphs of the dependencies too.
- Nx checks the boundaries between the projects of a monorepo with its rule `enforce-module-boundaries`.
- `import-linter` checks contracts between layers in Python.
- `deptrac` checks layers in PHP.
- `packwerk` checks packages in Rails.

Between them, these tools check cycles, modules that no file uses, names and annotations. The law of Lawcheck has no key for any of these. A [script rule](concepts.md#script-rule) can find them in the text of the files. You write that rule yourself. ArchUnit (`FreezingArchRule`) and `packwerk` keep a file of the breaches that existed before the rule.

A linter holds a simple rule about the text of one file. The ESLint rule `no-console`, set for the files of one folder, keeps `console.log` out of that layer. If each of your rules is of that kind, your linter holds them all. You may need no Lawcheck.

These tools run in the test suite, the linter or a CI job. Inside an agent's turn they run through a hook you write.

Lawcheck reads the [uses](concepts.md#use) of twelve languages: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C, C++, PHP and Ruby. A repository with a backend in Go and a front end in TypeScript keeps one law. The tools above need one tool and one configuration per language. A finding has the same form in every language.

Lawcheck reads no uses in any other language, such as Swift. A type with a `may_use` list that holds files of such a language gets the warning [`uses-not-read`](languages.md#uses-not-read). A script rule or a reviewer rule still judges the text of those files. With Harmonize, you write architecture rules for Swift as tests. Semgrep and `ast-grep` match patterns of syntax in many languages, with no model of the dependencies between files.

- A reader is the part of Lawcheck that reads the uses of one language. Lawcheck counts a use that its readers cannot resolve to one file. Such a use never becomes a finding ([Languages and uses](languages.md)).
- The same law holds [reviewer rules](concepts.md#reviewer-rule), for a requirement a person would judge by reading.
- A plain check judges the [change](concepts.md#change). `lawcheck check --full` lists the breaches outside it as [debt](concepts.md#debt). Debt never changes the exit code. A law can therefore start in a repository that already breaks it.

Lawcheck reads the uses written out in the code. It does not read an `import()` of a variable, `importlib.import_module` or reflection. In Java, Kotlin, C#, Ruby and Rust, a check of one file reads the declarations of every file of its language in the repository. Such a run costs the most in Java. Lawcheck runs on Node 24 or later. A Java or Python build adds Node to its CI image ([Supported environments](support.md)).

| Your case | Use |
|---|---|
| One language, and the tool already holds your layers in the test suite or the linter | that tool; add Lawcheck for reviewer rules, or for the check inside the agent's turn in Claude Code |
| Two or more languages under one set of layers | Lawcheck: one law and one form of finding for all of them |
| A cycle rule, a naming rule or another rule the tool checks in its language, in a repository that Lawcheck checks | both: the tool keeps that rule, and the law keeps `may_use` and the rules of the other languages |
| Your code is in a language Lawcheck does not read, such as Swift | a tool of that language, such as Harmonize for Swift, or Semgrep and `ast-grep` for patterns of syntax |
| Each rule is about the text of one file, such as no `console.log` in one layer | your linter |
| Many breaches already in the code | either: Lawcheck judges the change and lists the rest as debt, and ArchUnit and `packwerk` keep a file of the older breaches |

## A review bot at the pull request

- CodeRabbit reviews each pull request with a model. It runs pre-merge checks that you write in prose in `.coderabbit/`. Each check has the mode off, warning or error.
- Qodo and Greptile review pull requests with rules in prose. Qodo imports `AGENTS.md`. It draws rules from the history of earlier pull requests.
- Cursor Bugbot learns rules from review comments.
- Copilot code review reads the instructions of the repository.
- Claude Code Review runs several agents on a pull request. It never approves or blocks the pull request.
- Continue runs Markdown checks from `.continue/checks` as a status of the pull request.

The services among them charge per person, per review or in credits.

A review bot reads the whole pull request. It comments on the change as a whole, with your rules or without them. The reviewer of Lawcheck sees one file and one rule per call. It sees the files the rule lists in `context` as well. It sees no other file of the repository. A reviewer rule cannot judge a requirement that spans the files of a change, such as a new handler that comes with its test.

Lawcheck checks before the pull request exists. In Claude Code, it checks after each edit and before the agent ends its turn. Uses and script rules need no model. A second check of the same code prints the same output.

A reviewer rule needs a model. `lawcheck check --review` asks the reviewer once per file and rule. It records each pass as a [verdict](concepts.md#verdict) in `.lawcheck/verdicts`. You commit that file. A later check reads the pass. Lawcheck sends the file again only after the file, the rule, its `why` or its `context` changes. CI reads the committed verdicts. It needs no model and no key. A changed file with no recorded pass of an enforced reviewer rule gets the error `not-reviewed`. That error fails the job. You run `lawcheck check --review` before the push ([CI and git hooks](ci.md)).

Lawcheck sends code only to a model you ask to judge a reviewer rule, with `--review` or `lawcheck try`. The code goes to the one of nine providers you name. The provider `ollama` sends it to a server on your own machine by default ([Reviewers and keys](providers.md)). A script rule is code of your own repository. It can read every file under the root of the repository and open a network connection ([Script rules](script-rules.md)). Lawcheck needs no account. Its licence is MIT. A check tells you when a change edits the law that judges it.

Lawcheck writes no annotation into the pull request. A CI job shows its findings in the log. `--json` prints them as one document.

| Your case | Use |
|---|---|
| You want comments on the whole change, including on what no rule names | a review bot |
| A rule must hold in every file of a kind, and the agent must hear it before it opens a pull request | Lawcheck |
| Your code may not go to a hosted model | Lawcheck with uses and script rules, which send nothing, and reviewer rules through `ollama` on a machine you run |
| You want both of the above | both: the bot reviews the pull request, and Lawcheck holds the law at each edit and in CI |

## A hook you wrote in Claude Code

A Claude Code hook runs a script on an event of the session. Exit 2 from a hook blocks the action. Claude Code then hands the message of the hook to the agent. A hook of your own can run any program on any event Claude Code has, such as your linter or your tests. The event `PreToolUse` comes before a tool runs. A hook there can stop an edit before Claude Code writes it.

Your hook goes further than Lawcheck in two places. The plugin checks a file after Claude Code writes the edit. A script rule cannot start a program, such as your linter. A hook that runs your linter checks what the linter knows. It checks no `may_use` across languages and no reviewer rules.

The Lawcheck plugin adds the law to the session ([The Claude Code plugin](plugin.md)):

- When a session starts, the agent gets the output of `lawcheck prime`.
- After each `Write`, `Edit` or `NotebookEdit`, the plugin checks the edited file. The agent gets the output when the file breaks the law.
- Before the agent ends its turn, the plugin checks the files of the turn. These are the files that changed since the prompt, and the files of the commits of the turn. While they break the law, the plugin sends the agent back, three times at most. It never sends the agent back twice in a row with the same output. Then the plugin lets the agent finish. It tells you that the check still fails.
- Each check has a deadline five seconds shorter than the time Claude Code gives the hook. Past the deadline, the plugin ends Lawcheck and its child processes.

A hook of your own can run `lawcheck check <file>` too. Lawcheck exits 1 when the file breaks the law. It exits 2 when the law or the setup has an error. Claude Code blocks on exit 2 of a hook. Your hook turns the exit 1 of Lawcheck into exit 2. You decide in the hook what the exit 2 of Lawcheck means. Each of the two checks of the plugin has a setting: `check_after_edit` and `check_before_stop`. You can turn off the one that your own hook does.

Cursor, Copilot, Codex and Gemini CLI have hooks on similar events. In them, exit 2 blocks as well. Lawcheck has a plugin for Claude Code alone. In those agents, a hook you write runs `lawcheck check`. Without such a hook, the agent checks only when it follows its instructions file. A CI job catches what the agent skips.

In such an agent, you may want the check inside the agent and nowhere else. If the linter of each language already knows your rules, a hook of that agent that runs those linters fits better than Lawcheck.

| Your case | Use |
|---|---|
| Your hook runs the linter and the tests, and the linter already holds your layers | your hook |
| You want the law checked inside the turn, on the files of the turn, with at most three returns | the Lawcheck plugin |
| Your hook runs the tests, and the law holds your layers | both: your hook runs the tests, and the plugin checks the law |
| You work in another agent that has hooks, and the law holds your rules | a hook you write that runs `lawcheck check`, and the same check in CI |
| You work in another agent that has hooks, you want the check only inside it, and a linter of each language knows your rules | a hook of that agent that runs those linters |

Next: [I want to](i-want-to.md)
