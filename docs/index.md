# Lawcheck

Lawcheck checks your code against the architecture and rules you write down, and tells your coding agent which line breaks which rule.

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

The run exits 1. The [finding](concepts.md#finding) gives the file and the line, the code `forbidden-use` and the list in force.

## Where it checks

- [Claude Code](claude-code.md): the plugin checks each file the agent edits. Before the agent ends its turn, the plugin sends it back, up to three times, while the files of the turn break the law.
- [Any other agent](other-agents.md): one line in its instructions file has it run `lawcheck prime`, which prints the law and the commands that check it.
- [CI](ci.md): `lawcheck check --base origin/main` judges the change with no key and no network.

## Try it

```text
npm install --global lawcheck@alpha
lawcheck docs quick-start
```

Lawcheck is an alpha. It needs Node 24 or later and git 2.34 or later. Code leaves your machine only when you ask a model to judge a rule written in prose.

## Read next

- [Quick start](quick-start.md): five steps from a new repository to the first finding, with no model and no key.
- [Concepts](concepts.md): the twelve words these pages use, each with one example.
- [Lawcheck and the tools you already use](other-tools.md): a rules file, an architecture linter and a review bot, and the job each one does.

## Limits

- After three returns, the plugin lets the agent finish and tells you that the check still fails ([The Claude Code plugin](plugin.md#three-returns-at-most)).
- A pull request can edit the law that judges it. `check` names what the change does to that law ([What a check judges](change.md#the-limits-of-a-plain-check)), and the job of [CI and git hooks](ci.md#a-change-to-the-law) checks the change a second time with the law of the base.
- Lawcheck reads the uses written out in the code. An `import()` of a variable, `importlib.import_module` and reflection stay unread ([Languages and uses](languages.md#the-languages-whose-uses-are-read)).
