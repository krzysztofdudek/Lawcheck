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

**The runner that cannot start.** A refusal covers what Lawcheck can see before it starts a runner. A runner of script rules that Node still cannot start is `runner-failed`, never `rule-crashed` (check slice, section 3).

## 4. Repository shapes

Every commit runs fifteen rows of the check slice's acceptance table (1 to 6, 12, 13, 20, 22, 28, 29, 31, 38 and 41) and the hook scenarios of the plugin slice in each of these shapes, each started from the root and from `src/core` below it:

- the law at the top of the work tree;
- the law in `pkg/` of a monorepo, with a `node_modules` above it at the top and a file outside the root changed;
- a linked worktree (`git worktree add`);
- a root path that holds a space and a letter outside ASCII;
- a root reached through a symbolic link (a junction on Windows).

Each row gives the output the check slice gives, byte for byte, in every shape and from both directories (invariant `I-shape-1`). The hooks report a breach written in the turn, after an edit and before finishing, give the primer at the session start, hand back a law broken in the turn under its header, and let a clean turn finish (invariant `I-shape-2`). A check before finishing whose snapshot git cannot take sends the notice of the plugin slice, section 8, step 12, with the reason `git could not list the files of this turn, because <what git said>`.

A rule in the monorepo shape that imports a package from the `node_modules` above the root does not load, and its message is `reads <path> outside the root and Lawcheck's folder, and a rule may read nothing else` (check slice, section 3); the same rule loads the same package from a `node_modules` below the root.

## 5. CI shapes

Built with `file://` remotes on every commit:

- a depth-1 clone of a branch: with no base, every file counts as changed outside CI, and in CI the check refuses with the next line of the check slice, section 4 (question 87);
- the same clone given `--base origin/main`, and the same with the base fetched at depth 1: `base-unreachable` names the shallow clone and the fetch that brings the history, and that fetch, run as written, gives the right result;
- a detached merge ref of a pull request, checked against its base: the change of the pull request;
- a push whose base ref is empty (`--base origin/`) and a push of a new branch, whose "before" is the commit of zeros: each message names the case;
- a cache folder inside the project, untracked and not ignored: its files count as changed and a type whose paths reach it judges them, until the job lists the folder in `.git/info/exclude`, as `docs/ci.md` says;
- a repository git sees as owned by another user: `no-git` with git's `safe.directory` command, and that command lets the check through. Every commit tests it with git's switch `GIT_TEST_ASSUME_DIFFERENT_OWNER`, and the nightly set with a real other user in a container.

## 6. Operating systems

Linux, macOS and Windows run every commit on Node 24, and Linux also on the newest Node. Some cases hold only where the system has them:

- On a file system that ignores case, a path that names a file git lists under another case, such as `SRC/core/price.ts` for `src/core/price.ts`, is explained as the file git lists: `explain` answers for `src/core/price.ts`, under that name. Elsewhere `SRC/core/price.ts` is a file that does not exist yet.
- Names written in NFC and in NFD are judged, and each finding names the file as git lists it; with `core.precomposeunicode`, git on macOS lists both in NFC.
- A checkout with `core.autocrlf=true` holds CRLF, and the reviewer gets the same prompt, keyed the same, as the LF checkout (reviewer slice, section 3).
- On Windows the installed tool starts by its bare name from PowerShell, `cmd` and Git Bash; on Linux and macOS from `sh`.

## 7. The nightly matrices

Both need the network and run in Docker from official images, each container mounting only one `mktemp -d` folder, read-only.

**The install matrix.** The packed tarball, the sample and the cell script `tests/environments/matrix/install-cell.sh`. Each cell installs the tarball by its package manager, then runs `--version`, `doctor`, `check --base main` on the sample with one added file that breaks `no-console` once, `try no-console` on that file, and `check --base main --json` through the runner command of `docs/config.md`, piped to a JSON parser. A supported cell prints the version, a passing `doctor`, exactly that one finding and a `lawcheck-check/0` document. A refused cell prints the version, and `doctor`, `check` and `try` refuse with the same first line, naming the cause, exit 2, no rule file blamed, and a `lawcheck-error/1` document.

| Image | npm | pnpm | Yarn 1 | Yarn 4, `node-modules` | Yarn 4, Plug'n'Play | Bun |
|---|---|---|---|---|---|---|
| `node:24` | pass | pass | pass | pass | refused | pass |
| `node:24-alpine` | pass | pass | pass | pass | refused | pass |
| `oven/bun` | | | | | | refused |
| `node:20` | refused | | | | | |
| `node:22` | refused | | | | | |

**The git matrix.** The check slice's acceptance tests, the tests whose names carry rows 1 to 45, run with the git of `ubuntu:22.04` (2.34), `debian:12` (2.39), `ubuntu:24.04` (2.43) and `debian:sid` (the newest a Debian image carries), on the Node 24 of the machine that starts them, as a user other than root.

## 8. Acceptance tests

| # | Do | See |
|---|---|---|
| 200 | S with D added, and on `PATH` a git that prints `git version 2.33.8` for `--version` and hands every other call to the real git: `check --base main`, `check ./src/core/discount.ts`, `try no-console src/core/discount.ts`, `doctor`, `explain src/core/price.ts`, `prime` and `init`, each also with `--json`; then `--version`, `--help`, `check --help`, `docs` and `docs config`. Then the same git printing `git version 2.34.1`: `check --base main` | section 3's refusal with `git 2.33.8 is older than 2.34, the oldest git Lawcheck runs with`, exit 2, nothing on standard error, each document `lawcheck-error/1` with `unsupported-environment`; the last five exit 0; then test 4's output, exit 1 |
| 201 | a copy of Lawcheck whose runner starts with the Node flag `--no-such-flag`: `check --base main` and `try no-console src/core/discount.ts` in S with D added. A copy whose `dist/runner.js` cannot be read: `check --base main` (skipped as root and on Windows). An untouched copy: `check --base main` | `lawcheck: ERROR  1 error`, one `error[runner-failed]  the runner of script rules did not start: ` ending with Node's `bad option: --no-such-flag`, then with `EACCES: permission denied, open '<the runner>'`; its why; the next line `reinstall Lawcheck, then run lawcheck check` (`try again` for `try`); no `rule-crashed` and no rule file; exit 2. Then test 4's first line, exit 1 |
| 202 | S on a file system that ignores case: `explain SRC/core/price.ts`, then `explain src/core/price.ts`. On one that tells case apart: `explain SRC/core/price.ts` | the block of the commands slice, section 6, for `src/core/price.ts`, twice, exit 0; then a first line `SRC/core/price.ts  (does not exist yet)`, exit 0 |
| 203 | S with `src/core/café.ts` written in NFC and `src/core/año.ts` written in NFD, each holding `console.log(1);` | one `error[no-console]` finding at line 1 of each, each placed at the name `git ls-files` prints; `--json` the same names |
| 204 | R with F committed on `work`, cloned with `-c core.autocrlf=true`: `check --review --base origin/main` against the fake reviewer | the checkout of F holds CRLF; one request, whose prompt is `PROMPT_F` of the reviewer slice; the failure cache holds the one file `<key of F>.json`; exit 1 |
| 205 | the tarball of `npm pack --ignore-scripts`, unpacked, with its dependencies from the checkout, installed with `npm install --global --prefix <folder> --offline`: from each shell of the system, with that folder's bin on `PATH`, `lawcheck --version` and, in S with D added, `lawcheck check --base main` | the version of `package.json`, exit 0; test 4's output, exit 1; from PowerShell, `cmd` and Git Bash on Windows, from `sh` elsewhere |
| 206 | nightly: the install matrix of section 7 (network) | each cell as section 7's table says |
| 207 | nightly: the git matrix of section 7 (network) | every test passes on each git, and none is refused |
| 208 | S with D committed on `work`; on `main` a merge of `work` kept as `refs/pull/1/merge`, then `main` reset; a clone fetches that ref and checks it out detached: `check --base origin/main` | test 4's output with `(against origin/main)`, exit 1 |
| 209 | a clone of that origin: `check --base origin/`; `check --base 0000000000000000000000000000000000000000`; `check --base origin/main` | the two messages of the check slice, section 4, for an empty branch name and the commit of zeros, exit 2, the second with its next line; then test 4's output with `(against origin/main)` |

### Invariants

| Id | Promise | Test |
|---|---|---|
| I-env-1 | Every command but `--version`, `--help`, `<command> --help` and `docs` refuses Node below 24, Bun as the runtime and Yarn's Plug'n'Play with the first line of section 3, exit 2 and nothing on standard error, and `doctor` prints what `check` prints (section 3). | tests/environments/refusal.test.ts |
| I-shape-1 | The rows of section 4 give the output of the check slice byte for byte in every repository shape, from the root and from a directory below it (section 4). | tests/environments/shapes.test.ts |
| I-shape-2 | The hooks give the plugin slice's outputs for a breach after an edit, a breach before finishing, a broken law, a clean turn and the session start in every repository shape (section 4). | tests/environments/hook-shapes.test.ts |
