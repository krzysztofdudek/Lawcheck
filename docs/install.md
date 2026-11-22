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

On an older Node, npm and pnpm install Lawcheck and print a warning. Lawcheck refuses to work on an older Node, on an older git, under Bun and from Plug'n'Play. In those setups, every command but `--version`, `--help`, `docs` and `doctor` stops with `unsupported-environment` and exit 2. The first line of the error names the cause. Its `next:` line names the fix. `lawcheck doctor` prints the same first line. Its nine checks follow below it.

## Install globally

```text
$ npm install --global lawcheck@alpha
```

The program `lawcheck` is then on your `PATH`. The runner is the setting that says how to start Lawcheck. Its default, `global`, fits this install. You set nothing more.

## Install in a project

Add Lawcheck as a development dependency. You then start it through the package manager:

| Package manager | Install | Start | `runner` |
|---|---|---|---|
| npm | `npm install --save-dev lawcheck@alpha` | `npx --no-install lawcheck` | `npx` |
| pnpm | `pnpm add --save-dev lawcheck@alpha` | `pnpm exec lawcheck` | `pnpm` |
| Yarn | `yarn add --dev lawcheck@alpha` | `yarn run lawcheck` | `yarn` |
| Bun | `bun add --dev lawcheck@alpha` | `bun x --no-install lawcheck` | `bun` |

With `--no-install`, npx runs the copy of the project. It downloads nothing. A plain `npx lawcheck` downloads a copy when the project has none.

## The runner setting

`lawcheck init` makes the folder `.lawcheck/`, as step 1 of [Quick start](quick-start.md) shows. After it, write the runner from the table into `.lawcheck/config.yaml`:

```yaml
runner: pnpm
```

The runner reaches three places:

- The Claude Code plugin starts Lawcheck with the command of the runner.
- `lawcheck prime` tells the agent to start Lawcheck the same way.
- `lawcheck doctor` fails its `config` check when the program of the runner is not on the `PATH`.

Without the line, the runner is `global`. Write the line on its own, at the top level of the file. [Settings](config.md#runner) has the exact form.

## Check the install

`lawcheck --version` prints the version you installed. This page describes `0.1.0-alpha.2`. In a project, start Lawcheck through the package manager, as in `pnpm exec lawcheck --version`.

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

The `node` and `git` lines say that Lawcheck runs here. The `node` line shows your own version of Node. The repository has no law until you run `lawcheck init`. `doctor` skips the checks that need the law. It exits 2. After `lawcheck init`, the first line starts with `lawcheck: PASS  9 checks`.

## Remove it

| Installed | Remove with |
|---|---|
| globally | `npm uninstall --global lawcheck` |
| with npm | `npm uninstall lawcheck` |
| with pnpm | `pnpm remove lawcheck` |
| with Yarn | `yarn remove lawcheck` |
| with Bun | `bun remove lawcheck` |

The law, its rules and the recorded [verdicts](concepts.md#verdict) are files in `.lawcheck/`, at the root of the repository. Delete that folder to remove them. In Claude Code, `claude plugin uninstall lawcheck@lawcheck-marketplace` removes the plugin.

Next: [Quick start](quick-start.md)
