# Lawcheck: the environments it runs in

Where Lawcheck runs, what it refuses, and the shapes of repository and CI checkout it is tested in. The other slices say what each command does; this file says where that holds.

## 1. Scope

In: the runtimes, package managers and git versions Lawcheck supports (ruling T-2 A, question 73), the refusal of every other one, the runner that cannot start, the repository shapes and CI checkouts every commit is tested in, the cases that need macOS or Windows, and the nightly matrices of installs and git versions.

Out: the network. A test that needs it says so in its name and runs only in the nightly set.

## 2. What Lawcheck supports

| Part | Supported | Refused |
|---|---|---|
| Node | 24 and newer | 20, 22 and every version below 24 |
| the runtime | Node | Bun as the runtime; Bun beside Node is supported, since `bun x` then starts Lawcheck on Node through its first line |
| the install | npm, pnpm, Yarn 1, Yarn 4 with `nodeLinker: node-modules`, Bun beside Node | Yarn's Plug'n'Play, which keeps packages inside zip archives that the runner of script rules cannot open |
| git | 2.34 and newer, the git of `ubuntu:22.04`; the nightly git matrix runs the check slice's tests on it | every version below 2.34 |
| the system | Linux, macOS and Windows, on every commit | |

## 3. The refusal

Every command but `lawcheck --version`, `lawcheck --help`, `lawcheck <command> --help` and `docs` first looks at where it runs, in this order, and stops at the first that fails:

| The check | The message | The next line |
|---|---|---|
| `process.versions.bun` is set | `this run is on Bun <version>, and Lawcheck runs on Node 24 or later` | `install Node 24 or later beside Bun, so that bun x starts Lawcheck on Node, then run lawcheck check` |
| the major version of `process.versions.node` is below 24 | `Node <version> is older than 24, the oldest Node Lawcheck runs on` | `install Node 24 or later, then run lawcheck check` |
| `process.versions.pnp` is set, or Lawcheck's folder lies below a folder whose name ends in `.zip` | `Lawcheck is installed by Yarn Plug'n'Play, inside an archive that the runner of script rules cannot open` | `set nodeLinker: node-modules in .yarnrc.yml and run yarn install, then run lawcheck check` |
| `git --version` names a version below 2.34 | `git <version> is older than 2.34, the oldest git Lawcheck runs with` | `install git 2.34 or later, then run lawcheck check` |

A git that does not start, or prints no version, is left to the command, which names it as `no-git`. A failed check is the error `unsupported-environment`, exit 2, without a place. Its message is the first line of the output, in place of the count of errors, so the cause is the first thing a reader or an agent sees; the rest is the error grammar of the check slice, section 6. On Node 20:

```
lawcheck: ERROR  Node 20.20.2 is older than 24, the oldest Node Lawcheck runs on

error[unsupported-environment]  Node 20.20.2 is older than 24, the oldest Node Lawcheck runs on
  why:  Lawcheck answers only where its rules and readers are known to run

next: install Node 24 or later, then run lawcheck check
```

The next line names the command that ran, as every next line does (`then run lawcheck doctor again`). With `--json` the refusal is a `lawcheck-error/1` document with this one error. `doctor` refuses as `check` does, so the two agree. No refusal names a rule file, and none is `rule-crashed`.

npm and pnpm install Lawcheck on an older Node with a warning about the `engines` range, and Yarn 1 and npm with `engine-strict` refuse it. The refusal above is what a user meets after an install that only warned.

## 8. Acceptance tests

| # | Do | See |
|---|---|---|
| 200 | S with D added, and on `PATH` a git that prints `git version 2.33.8` for `--version` and hands every other call to the real git: `check --base main`, `check ./src/core/discount.ts`, `try no-console src/core/discount.ts`, `doctor`, `explain src/core/price.ts`, `prime` and `init`, each also with `--json`; then `--version`, `--help`, `check --help`, `docs` and `docs config`. Then the same git printing `git version 2.34.1`: `check --base main` | section 3's refusal with `git 2.33.8 is older than 2.34, the oldest git Lawcheck runs with`, exit 2, nothing on standard error, each document `lawcheck-error/1` with `unsupported-environment`; the last five exit 0; then test 4's output, exit 1 |

### Invariants

| Id | Promise | Test |
|---|---|---|
| I-env-1 | Every command but `--version`, `--help`, `<command> --help` and `docs` refuses Node below 24, Bun as the runtime and Yarn's Plug'n'Play with the first line of section 3, exit 2 and nothing on standard error, and `doctor` prints what `check` prints (section 3). | tests/environments/refusal.test.ts |
