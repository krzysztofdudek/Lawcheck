# Lawcheck

You write down the architecture and the rules of your repository. Lawcheck checks your code against them. It tells your coding agent which line breaks which rule.

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

## Where it checks

- [Claude Code](claude-code.md): the plugin checks each file the agent edits. It checks the files of the turn before the agent ends it. While those files break the law, the plugin sends the agent back to work, up to three times.
- [Any other agent](other-agents.md): one line in its instructions file tells the agent to run `lawcheck prime`. That command prints the law and the commands that check it.
- [CI](ci.md): `lawcheck check --base origin/main` judges the files of the pull request. It needs no key and no network.

## Try it

```text
npm install --global lawcheck@alpha
lawcheck docs quick-start
```

Lawcheck is an alpha. It needs Node 24 or later and git 2.34 or later. Lawcheck sends code only to a model you ask to judge a rule written in prose. A [script rule](concepts.md#script-rule) is code of your own repository. It can read every file under the root of the repository and open a network connection.

## Read next

- [Quick start](quick-start.md) takes a new repository to its first finding in five steps. You need no model and no key.
- [The first type and the first rule](first-law.md) writes a [script rule](concepts.md#script-rule) and shows the check that fails on its first finding.
- [Concepts](concepts.md) defines the twelve words these pages use, each with one example.
- [Lawcheck and the tools you already use](other-tools.md) compares Lawcheck with a rules file, an architecture linter, a review bot and a hook of your own.

## Limits

- After the third return, the plugin lets the agent finish. The plugin tells you that the check still fails ([The Claude Code plugin](plugin.md#three-returns-at-most)).
- A pull request can edit the law that judges it. `check` prints what the pull request does to that law ([What a check judges](change.md#the-limits-of-a-plain-check)). The CI job of [CI and git hooks](ci.md#a-change-to-the-law) checks the pull request a second time, with the law of the [base](concepts.md#base).
- Lawcheck reads the [uses](concepts.md#use) written out in the code. It does not read an `import()` of a variable, `importlib.import_module` or reflection ([Languages and uses](languages.md#the-languages-whose-uses-are-read)).

Next: [Install](install.md)
