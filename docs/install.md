# Install

Lawcheck is one program, `lawcheck`. You install its alpha from npm, once on your machine or as a development dependency of one project. Then `lawcheck doctor` checks the setup.

## Requirements

| Needs | Version |
|---|---|
| Node | 24 or later |
| git | 2.34 or later |
| System | Linux, macOS or Windows |

You can install Lawcheck with:

- npm;
- pnpm;
- Yarn 1;
- Yarn 4 with `nodeLinker: node-modules` or `nodeLinker: pnpm`;
- Bun, with Node installed beside it.

Lawcheck does not run in three setups:

- under Yarn Plug'n'Play;
- under Bun without Node;
- with `--permission` in `NODE_OPTIONS`.

On a Node older than 24, npm and pnpm install Lawcheck and print a warning. Lawcheck itself refuses to work in four setups:

- on an older Node;
- on an older git;
- under Bun;
- from Plug'n'Play.

In those setups, every command but `--version`, `--help`, `docs` and `doctor` stops with `unsupported-environment` and exit 2. The first line of the error names the cause. Its `next:` line names the fix. `lawcheck doctor` prints the same first line, with its nine checks below it.

## Install globally

```text
$ npm install --global lawcheck@alpha
```

The program `lawcheck` is then on your `PATH`. The `runner` setting in `.lawcheck/config.yaml` says how to start Lawcheck. You leave it out, since its default, `global`, fits this install.

## Install in a project

Add Lawcheck as a development dependency. You then start it through the package manager:

| Package manager | Install | Start | `runner` |
|---|---|---|---|
| npm | `npm install --save-dev lawcheck@alpha` | `npx --no-install lawcheck` | `npx` |
| pnpm | `pnpm add --save-dev lawcheck@alpha` | `pnpm exec lawcheck` | `pnpm` |
| Yarn | `yarn add --dev lawcheck@alpha` | `yarn run lawcheck` | `yarn` |
| Bun | `bun add --dev lawcheck@alpha` | `bun x --no-install lawcheck` | `bun` |

With `--no-install`, npx runs the copy installed in the project. It downloads nothing. A plain `npx lawcheck` downloads a copy when the project has none.

## The runner setting

`lawcheck init` makes the folder `.lawcheck/`, as the quick start shows in [Start the law](quick-start.md#_1-start-the-law). After it, write the value of `runner` from the table into `.lawcheck/config.yaml`:

```yaml
runner: pnpm
```

Three parts of Lawcheck read the `runner` setting:

- The Claude Code plugin starts Lawcheck with the command that the setting names.
- `lawcheck prime` tells the agent to start Lawcheck the same way.
- `lawcheck doctor` fails its `config` check when the program that the setting names is not on the `PATH`.

Without the line, the `runner` setting is `global`. Write the line on its own, at the top level of the file. [Settings](config.md#runner) has the exact form.

## Check the install

`lawcheck --version` prints the version you installed. This page describes `0.1.0-alpha.3`. In a project, start Lawcheck through the package manager, as in `pnpm exec lawcheck --version`.

`lawcheck doctor` checks the setup. It writes nothing. In a git repository with no law yet, it prints:

```text
$ lawcheck doctor
```

```output
lawcheck: FAIL  9 checks, 1 problem

ok  node  Node 24.22.3; Lawcheck needs 24 or later
ok  git  a git work tree
fail  law  no .lawcheck/law.yaml in this directory or any above it
  next: lawcheck init  (only when the user wants a law here)
skip  config  needs law
skip  types  needs law
skip  base  needs law
skip  law-change  needs base
skip  readers  needs types
skip  reviewer  needs law
```

The `node` and `git` lines say that Lawcheck can run on this machine. The `node` line shows your own version. With no law in the repository, `doctor` skips the six checks below the `law` line. It exits 2. After `lawcheck init`, the first line starts with `lawcheck: PASS  9 checks`.

## Remove it

| Installed | Remove with |
|---|---|
| globally | `npm uninstall --global lawcheck` |
| with npm | `npm uninstall lawcheck` |
| with pnpm | `pnpm remove lawcheck` |
| with Yarn | `yarn remove lawcheck` |
| with Bun | `bun remove lawcheck` |

The law, its rules and the recorded [verdicts](concepts.md#verdict) are files in `.lawcheck/`, at the [root](concepts.md#law) of the law. Delete that folder to remove them. In Claude Code, `claude plugin uninstall lawcheck@lawcheck-marketplace` removes the plugin.

Next: [Quick start](quick-start.md)
