# Lawcheck

Architecture checks for coding agents. Lawcheck checks code against your written architecture and names the file and line that break it, so drift stops in 12 languages, in Claude Code hooks and CI. It is for people who build with coding agents and want the layers they drew to hold, such as a page component that must not call the database. It works for one developer and for a team: you commit the architecture and the rules in `.lawcheck/`, so each developer checks against the same law.

I build software with coding agents, and I read their code only where a mistake could cost a lot or could not be undone. In the code I do not read, an agent imports a handler into the business logic or calls the database past the persistence layer, and the tests pass. A rule in `CLAUDE.md` does not stop it: on 2026-11-24, the issue tracker of Claude Code held 297 issues that match [the query "ignores CLAUDE.md" is:issue created:<=2026-11-24](https://github.com/anthropics/claude-code/issues?q=%22ignores+CLAUDE.md%22+is%3Aissue+created%3A%3C%3D2026-11-24), and [60 of them](https://github.com/anthropics/claude-code/issues?q=%22ignores+CLAUDE.md%22+is%3Aissue+created%3A2026-06-01..2026-11-24) were opened in June 2026 or later. Remove the date from the query to see the count today.

The law is a file in the repository. It names the kinds of files, which kind may use which, and the rules each kind follows:

```yaml
lawcheck: 0.1.0

types:
  api:
    about: The HTTP handlers.
    paths: ["src/api/**"]
  core:
    about: The business logic.
    paths: ["src/core/**"]
    may_use: [core]
```

An import of a handler into the business logic fails the check:

```text
$ lawcheck check src/core/discount.ts
lawcheck: FAIL  1 error in 1 named file

src/core/discount.ts:1  error[forbidden-use]  core may not use api (src/api/orders.ts); its may_use is [core]
  why:  a type's may_use names every type its files may use

next: fix src/core/discount.ts:1
```

A rules file is advice the agent reads, and nothing in the session checks the code against it. Lawcheck checks the files. In Claude Code and Codex, the Lawcheck plugin runs this check after each edit and before the agent ends its turn, and sends the agent back, up to three times, while the files of its turn break the law. Any other agent gets the law from `lawcheck prime`, through one line in its instructions file. A CI job checks the same law and needs no key and no network. An architecture test or the layer rule of a linter works in one language or one ecosystem, and one law covers the uses of twelve languages.

## Try it

Lawcheck is an alpha under the MIT license. It needs Node 24 or later and git 2.34 or later. Lawcheck sends code only to a model you ask to judge a rule written in prose. A script rule is your repository's own code, and it can read every file under the root. It cannot open a network connection. The quick start takes a git repository, a new one or yours, to its first finding in five steps, with no model and no key. Its first step is `lawcheck init` at the root of that repository:

```text
npm install --global lawcheck@alpha
lawcheck docs quick-start
```

## Your coding agent

In Claude Code, install the plugin:

```text
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

The plugin gives the agent the law when a session starts. Its hooks run Lawcheck and your repository's rule scripts, so install the plugin where you would run the repository's tests. With a `runner` other than `global`, the hooks start the program your package manager finds through the repository's own files, such as `yarnPath` in `.yarnrc.yml` or a committed `node_modules/.bin/lawcheck`. `lawcheck docs plugin` says what each hook does.

In Codex, the same plugin installs with `codex plugin marketplace add krzysztofdudek/Lawcheck` and `codex plugin add lawcheck@lawcheck-marketplace`. Codex runs its hooks only after you trust them in `/hooks`. Its check after an edit sees the files of `apply_patch`, and a file the agent writes through the shell waits for the check before the agent finishes. `lawcheck docs codex-cli` has the steps.

Any other agent gets one line in its instructions file:

```text
Run `lawcheck prime` at the start of every session and follow it.
```

That agent checks only when it follows the line, and nothing sends it back. A project that starts Lawcheck through its package manager writes that command in the line, such as `pnpm exec lawcheck prime`. `lawcheck prime` also tells the agent which changes to the law it may make alone and which need your word.

## In CI

`lawcheck check --base origin/main` judges the files a branch changes. The branch commits the verdicts of the rules written in prose, so the job calls no model. `lawcheck docs ci` has the whole job.

## One law holds uses, rules, debt and waivers

- Uses. Lawcheck reads imports and other uses in twelve languages: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C, C++, PHP and Ruby. Each use that `may_use` does not allow is a finding. Lawcheck counts a use it cannot resolve and never reports it as a finding.
- Script rules. A rule is a JavaScript module that gets one file at a time and returns findings, each with its line when it has one.
- Reviewer rules. A model judges a rule written in prose, one file at a time. Lawcheck records each pass, so it does not send an unchanged file again. You pick one of nine providers, among them a local Ollama and the `claude`, `codex`, `gemini` and `copilot` programs with their own sign-in.
- Debt. `check` judges the files a change touches. `--full` lists the older breaches as debt. Debt is a warning and does not fail the run, unless you pass `--strict`.
- Waivers. `lawcheck-waive <rule> -- <reason>` drops one rule on one line, and the reason stays in the code.

## Limits

- After three returns the plugin lets the agent finish and tells you that the check still fails.
- A pull request can edit the law that judges it. `check` names what the change does to that law, and the job in `lawcheck docs ci` checks the change a second time with the law of the base.
- Lawcheck reads the uses written out in the code. An `import()` of a variable, `importlib.import_module` and reflection stay unread (`lawcheck docs languages`).

## More

The documentation is at https://docs.lawcheck.dev and in the terminal: `lawcheck docs`. Lawcheck's own law is in [.lawcheck/](.lawcheck): 10 rules over 20 types, and `npm test` checks the code against it. [The contributing guide](CONTRIBUTING.md) says how to report a bug, and [the security policy](SECURITY.md) how to report a vulnerability privately.
