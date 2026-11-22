# Install

Lawcheck is one program, `lawcheck`, published on npm as an alpha. Install it once on your machine, or as a development dependency of one project, then check the setup with `lawcheck doctor`.

## Requirements

| Needs | Version |
|---|---|
| Node | 24 or later |
| git | 2.34 or later |
| System | Linux, macOS or Windows |

Lawcheck installs with npm, pnpm, Yarn 1, Yarn 4 with `nodeLinker: node-modules` or `nodeLinker: pnpm`, and Bun beside Node. It does not run under Yarn Plug'n'Play, under Bun without Node, or with `--permission` in `NODE_OPTIONS`.

npm and pnpm install Lawcheck on an older Node and print a warning. On an older Node or git, under Bun or from Plug'n'Play, every command but `--version`, `--help`, `docs` and `doctor` stops with `unsupported-environment` and exit 2. Its first line names the cause, and its `next:` line the fix. `lawcheck doctor` prints the same first line and runs its nine checks below it.

## Install globally

```text
$ npm install --global lawcheck@alpha
```

The program is then `lawcheck` on your `PATH`. That is the default runner, `global`, so you set nothing more.

## Install in a project

Add Lawcheck as a development dependency, and start it through the package manager:

| Package manager | Install | Start | `runner` |
|---|---|---|---|
| npm | `npm install --save-dev lawcheck@alpha` | `npx --no-install lawcheck` | `npx` |
| pnpm | `pnpm add --save-dev lawcheck@alpha` | `pnpm exec lawcheck` | `pnpm` |
| Yarn | `yarn add --dev lawcheck@alpha` | `yarn run lawcheck` | `yarn` |
| Bun | `bun add --dev lawcheck@alpha` | `bun x --no-install lawcheck` | `bun` |

With `--no-install`, npx runs the copy the project installed and downloads nothing. A plain `npx lawcheck` downloads a copy when the project has none.

## The runner setting

After `lawcheck init`, which [Quick start](quick-start.md) runs in its first step, write the runner of the table in `.lawcheck/config.yaml`:

```yaml
runner: pnpm
```

The Claude Code plugin starts Lawcheck with the command of the runner, `lawcheck prime` tells the agent to start it that way, and `lawcheck doctor` fails its `config` check when that program is not on the `PATH`. Without the line the runner is `global`. Write it on a line of its own at the top level; [Settings](config.md#runner) has the exact form.

## Check the install

`lawcheck --version` prints the version you installed. This page describes `0.1.0-alpha.2`. In a project, put the start command first, as in `pnpm exec lawcheck --version`.

`lawcheck doctor` checks the setup and writes nothing. In a git repository that has no law yet, it prints:

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

The `node` and `git` lines say that Lawcheck runs here, and the `node` line shows your own version. The law is missing until `lawcheck init`, so `doctor` skips the checks that need it and exits 2. After `lawcheck init`, the first line starts with `lawcheck: PASS  9 checks`.

## Remove it

| Installed | Remove with |
|---|---|
| globally | `npm uninstall --global lawcheck` |
| with npm | `npm uninstall lawcheck` |
| with pnpm | `pnpm remove lawcheck` |
| with Yarn | `yarn remove lawcheck` |
| with Bun | `bun remove lawcheck` |

The law, its rules and the recorded verdicts are files in `.lawcheck/` at the root of the repository; delete that folder to remove them. In Claude Code, `claude plugin uninstall lawcheck@lawcheck-marketplace` removes the plugin.
