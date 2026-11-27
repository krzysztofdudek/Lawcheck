# Lawcheck

Write your architecture rules once, and stop reading your agent's code to enforce them. Lawcheck holds your coding agent to your rules while it writes, before it ends its turn, and in CI. The structure stays as you agreed, so what is left for you to check is behaviour, and your tests do that. One [law](concepts.md#law) reads imports and other uses in 12 languages. It is free and open source under the MIT license, and it runs on your machine. It calls an AI model only for a [rule written in prose](concepts.md#reviewer-rule), and only when you run `lawcheck check --review`, through a provider you pick and pay for, or a local Ollama.

A rule in `CLAUDE.md` or `AGENTS.md` is read by the agent, and Claude Code does not check the code against it. Your linter holds a rule for one language and runs in CI; inside the agent's work it runs only through a hook you write; the Lawcheck plugin is such a hook, ready-made. The Lawcheck plugin checks while the agent works, and CI checks the same law ([Lawcheck and the tools you already use](other-tools.md)).

## A law and a finding

This [law](concepts.md#law) keeps the core of a shop apart from its commands. Files of the [type](concepts.md#type) `core` may use only files of `core`:

```yaml
lawcheck: 0.1.0

types:
  core:
    about: Prices and orders, with no input or output.
    paths: ["src/core/**"]
    may_use: [core]
  cli:
    about: The commands, which read input and print.
    paths: ["src/cli/**"]
```

On a branch made from `main`, a new file `src/core/receipt.ts` imports `print` from `../cli/print.js`. The check names that line:

```text
$ lawcheck check --base main
```

```output
lawcheck: FAIL  1 error in 1 changed file (against main)

src/core/receipt.ts:1  error[forbidden-use]  core may not use cli (src/cli/print.ts); its may_use is [core]
  why:  a type's may_use names every type its files may use

next: fix src/core/receipt.ts:1
```

The run exits 1. The [finding](concepts.md#finding) gives the file, the line, the code `forbidden-use` and the `may_use` list of `core`.

## A rule and a finding

A rule holds what an import cannot say, such as a core that never reads the clock. This script rule is `.lawcheck/rules/no-clock.mjs`. It returns a finding for each line that reads the clock:

```js
export function check({ files: [file] }) {
  const findings = [];
  file.lines.forEach((text, i) => {
    if (/\bDate\.now\(|\bnew Date\(\)/.test(text)) {
      findings.push({ line: i + 1, message: 'reads the clock' });
    }
  });
  return findings;
}
```

The law names the rule and gives it to `core`:

```yaml
lawcheck: 0.1.0

rules:
  no-clock:
    why: Prices and orders take the time as an argument.

types:
  core:
    about: Prices and orders, with no input or output.
    paths: ["src/core/**"]
    may_use: [core]
    rules: [no-clock]
  cli:
    about: The commands, which read input and print.
    paths: ["src/cli/**"]
```

Now the new `src/core/receipt.ts` also prints the time it reads with `new Date()`, on line 4. The same check names both lines:

```output
lawcheck: FAIL  2 errors in 1 changed file (against main)

src/core/receipt.ts:1  error[forbidden-use]  core may not use cli (src/cli/print.ts); its may_use is [core]
  why:  a type's may_use names every type its files may use
src/core/receipt.ts:4  error[no-clock]  reads the clock
  why:  Prices and orders take the time as an argument.

next: fix src/core/receipt.ts:1
```

A [reviewer rule](reviewer-rules.md) is written in prose, such as "each error a caller sees says what to do next". A model you pick judges it, one file at a time, when you run `lawcheck check --review`. The plugin's hooks never ask the model. A check without `--review` reads the verdicts already recorded, and reports a file with none as `not-reviewed`.

<div id="where-it-checks"></div>

## Lawcheck in your agent and in CI

- [Claude Code](claude-code.md): the plugin checks each file the agent edits with `Write`, `Edit` or `NotebookEdit`. Before the agent finishes its answer to your prompt, the plugin checks every file the agent changed for that prompt. While those files break the law, the plugin sends the agent back to work, up to three times.
- [Codex](codex-cli.md): the same plugin checks each file the agent writes with `apply_patch`, and sends the agent back the same way before it finishes.
- [GitHub Copilot CLI](copilot-cli.md): the plugin checks each file the agent writes with `create` or `edit`. Before the agent finishes, it checks every file that changed in its turn, and sends the agent back the same way. The plugin asks the agent to tell you its messages.
- [Any other agent](other-agents.md): one line in its instructions file tells the agent to run `lawcheck prime`. That command prints the law and the commands that check it. Nothing sends that agent back.
- [CI](ci.md): `lawcheck check --base origin/main` judges the files of the pull request. It needs no key and no network, unless you set the job up to review rules written in prose.

## Try it

```text
npm install --global lawcheck@alpha
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
lawcheck init
```

Start a new agent session after you install the plugin, so the agent gets the law. `lawcheck init` creates an empty law. In your own repository, type `/lawcheck:setup` and the agent describes your folders as types ([Let a coding agent write the first law](agent-setup.md)). To practise on a new repository by hand, `lawcheck docs quick-start` takes you to a first finding. Codex and Copilot CLI install the same plugin with their own two commands ([Codex](codex-cli.md), [GitHub Copilot CLI](copilot-cli.md)).

The quick start ends on a rule about which layer may import which. For a first rule about the text of a file, such as no `console.log` in one folder, read [The first type and the first rule](first-law.md) or run `lawcheck docs first-law`.

Lawcheck is an alpha. It needs Node 24 or later and git 2.34 or later.

Lawcheck sends code to a model only when you ask the model to judge a rule written in prose. A [script rule](concepts.md#script-rule) is code of your own repository. When Lawcheck runs one, the rule can read any file under the [root](concepts.md#law) of the law. A script rule cannot open a network connection.

## Read next

- [Quick start](quick-start.md) takes a new repository to its first finding in five steps. You need no model and no key.
- [Let a coding agent write the first law](agent-setup.md) has your agent describe your repository as types and ask you before it forbids a use that the code already makes.
- [The first type and the first rule](first-law.md) writes a [script rule](concepts.md#script-rule) and shows the check that fails on its first finding.
- [Concepts](concepts.md) defines the fourteen words these pages use, each with one example.
- [Lawcheck and the tools you already use](other-tools.md) compares Lawcheck with a rules file, an architecture linter, a review bot and a hook of your own.

## Limits

- After it has sent the agent back three times, the plugin lets the agent finish. The plugin tells you that the check still fails ([The Claude Code plugin](plugin.md#three-returns-at-most)).
- A pull request can edit the law that judges it. `check` prints what the pull request does to that law ([What a check judges](change.md#the-limits-of-a-plain-check)). The CI job of [CI and git hooks](ci.md#the-law-that-judges-a-change) can check it with the law of the [base](concepts.md#base). The law that judges a change in CI is your team's choice.
- Lawcheck reads the forms of [use](concepts.md#use) that [Languages and uses](languages.md#the-languages-whose-uses-are-read) lists for each language. It does not read an `import()` of a variable, `importlib.import_module`, or a class that the code finds by its name at run time. It misses other forms too, such as a Java call written by its full name with no import. It neither judges nor counts a use that it does not read ([Forms the readers miss](languages.md#forms-the-readers-miss)).

Next: [Install](install.md)
