# Lawcheck

Lawcheck checks your code against the architecture and rules you write down, and tells your coding agent which line breaks which rule. It is for a developer or a small team that writes most of its code through a coding agent, in a repository whose layers or modules matter.

I build software with coding agents, and I read their code only where a mistake could cost a lot or could not be undone. The agents repeat patterns well. After a few dozen sessions the structure drifts: a component lands where the pages live, a call goes to the database past the persistence layer, and an instruction from the rules file is gone ten messages later. The tests pass, because they check what the code does.

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

A rules file is advice the agent reads, and nothing in the session checks the code against it. Lawcheck checks the files. In Claude Code, the Lawcheck plugin runs this check after each edit and before the agent ends its turn, and sends the agent back, up to three times, while the files of its turn break the law. Any other agent gets the law from `lawcheck prime`, through one line in its instructions file. A CI job checks the same law and needs no key and no network. An architecture test or the layer rule of a linter works in one language or one ecosystem, and one law covers the uses of twelve languages.

## Try it

Lawcheck is an alpha under the MIT license. It needs Node 24 or later and git 2.34 or later. Lawcheck sends code only to a model you ask to judge a rule written in prose. A script rule is your repository's own code, and it can read every file under the root. On Node 24 it can open a network connection. Node 25 and later refuse that connection, because Lawcheck starts the rule with Node's permission model on. The quick start takes a git repository, a new one or yours, to its first finding in five steps, with no model and no key. Its first step is `lawcheck init` at the root of that repository:

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

Any other agent gets one line in its instructions file:

```text
Run `lawcheck prime` at the start of every session and follow it.
```

That agent checks only when it follows the line, and nothing sends it back. A project that starts Lawcheck through its package manager writes that command in the line, such as `pnpm exec lawcheck prime`. `lawcheck prime` also tells the agent which changes to the law it may make alone and which need your word.

## In CI

`lawcheck check --base origin/main` judges the files a branch changes. The branch commits the verdicts of the rules written in prose, so the job calls no model. `lawcheck docs ci` has the whole job.

## What one law holds

- Uses. Lawcheck reads imports and other uses in twelve languages: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C, C++, PHP and Ruby. Each use that `may_use` does not allow is a finding. A use Lawcheck cannot resolve is counted, and never a finding.
- Script rules. A rule is a JavaScript module that gets one file at a time and returns findings, each with its line when it has one.
- Reviewer rules. A model judges a rule written in prose, one file at a time. Lawcheck records each pass, so an unchanged file is not sent again. You pick one of nine providers, among them a local Ollama and the `claude`, `codex`, `gemini` and `copilot` programs with their own sign-in.
- Debt. `check` judges the files a change touches. `--full` lists the older breaches as debt. Debt is a warning and never fails the run.
- Waivers. `lawcheck-waive <rule> -- <reason>` drops one rule on one line, and the reason stays in the code.

## Limits

- After three returns the plugin lets the agent finish and tells you that the check still fails.
- A pull request can edit the law that judges it. `check` names what the change does to that law, and the job in `lawcheck docs ci` checks the change a second time with the law of the base.
- Lawcheck reads the uses written out in the code. An `import()` of a variable, `importlib.import_module` and reflection stay unread (`lawcheck docs languages`).

## More

The documentation is at https://krzysztofdudek.github.io/Lawcheck/ and in the terminal: `lawcheck docs`. Lawcheck's own law is in [.lawcheck/](.lawcheck): 10 rules over 19 types, and `npm test` checks the code against it. [The contributing guide](CONTRIBUTING.md) says how to report a bug, and [the security policy](SECURITY.md) how to report a vulnerability privately.
