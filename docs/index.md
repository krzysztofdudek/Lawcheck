# Lawcheck

You write the architecture and the rules. Lawcheck tells your coding agent which line breaks which rule.

Lawcheck reads the [law](concepts.md#law) of your repository from `.lawcheck/law.yaml`: the types of your files, which types each type may use, and the rules each type keeps. `lawcheck check` judges the files of your change against that law and prints each line that breaks it, with the rule and its reason. A coding agent reads the law with `lawcheck prime`, and in Claude Code the Lawcheck plugin sends the agent back while the files of its turn break the law.

## A law and a finding

This law keeps the core of a shop apart from its commands. Files of `core` may use only files of `core`:

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

The run exits 1. In CI that fails the job, and in Claude Code the plugin hands the finding to the agent.

## The documentation

- [Install](install.md): the requirements, a global install or one per project, and the check that the setup works.
- [The first type and the first rule](first-law.md): a guide from `lawcheck init` to a law with one type and one script rule.
- [The commands](commands.md): the reference of every command, what it reads and writes, and its exit codes.

Each page here also prints in the terminal. `lawcheck docs` lists the pages, and `lawcheck docs install` prints one.
