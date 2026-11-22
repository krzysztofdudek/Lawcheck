# Upgrade Lawcheck

Lawcheck 0.1.0-alpha.2 reads the code with Runes 1.2.0 and finds uses that 0.1.0-alpha.1 missed, such as a `vi.mock` of a file of another layer. It judges them against `may_use`, so a branch that passed on alpha.1 can fail on alpha.2 at a line nobody touched. You end with alpha.2 installed, the new findings listed, and the law or the code changed so that the next change passes.

## Changes in the results

| In the code | alpha.2 |
|---|---|
| a Python package under a folder that `pyproject.toml` or `setup.cfg` names | a use of its files |
| a Rust `mod` with `#[path]` | a use of the file it names |
| a Rust path to a path dependency, written without `use` | a use of that crate |
| a Go module wired with a relative `replace` | a use of that module |
| a Vite, webpack or Babel alias, in the forms [Languages and uses](languages.md#forms-the-readers-miss) lists | a use of the file the alias reaches |
| `vi.mock` and `jest.mock` with a literal path | a use of the mocked file |
| a relative `<script src>` in a Vue or Svelte file | a use of the script file |
| a Ruby `require` of a file in the repository | a use of that file |
| C# | uses in more forms |
| a script inside an HTML comment of a Vue or Svelte file | no use, where alpha.1 found one |
| a C# name that the file declares as a value | no use, where alpha.1 found one |
| a name imported from a relative Python module, `from .m import x` | a use of the module's file, where alpha.1 counted an unresolved use |
| a C or C++ system header, a Ruby constant the repository does not declare, a Java or Kotlin member type inherited from a library | outside the repository, where alpha.1 counted an unresolved use |
| an alias the readers cannot follow | an unresolved use, where alpha.1 dropped it |

The release note of alpha.2 says the same in prose ([Changelog](changelog.md)).

## Files that need no edit

The law keeps its `lawcheck: 0.1.0` line: Lawcheck checks the form of that version and does not compare it with its own ([The law file](law.md#lawcheck)). The rules and `.lawcheck/config.yaml` read the same. alpha.2 sends the reviewer the same prompt as alpha.1, so every pass in `.lawcheck/verdicts` still counts and the reviewer judges no file again.

## Before you upgrade

- A file that alpha.1 passed can hold a use that alpha.2 forbids. A plain check fails on it the first time a change touches that file. Step 4 lists those files before a change does.
- The install takes about 34 MB more disk, because Runes now ships its grammars.
- CI and the git hooks run the version that the project's lockfile pins. Commit `package.json` and the lockfile with the upgrade, so the job, the hooks and each machine's copy in the project run alpha.2.

## 1. Install the new version

Run the install line again. `@alpha` names the newest alpha:

| Installed | Upgrade with |
|---|---|
| globally | `npm install --global lawcheck@alpha` |
| with npm | `npm install --save-dev lawcheck@alpha` |
| with pnpm | `pnpm add --save-dev lawcheck@alpha` |
| with Yarn | `yarn add --dev lawcheck@alpha` |
| with Bun | `bun add --dev lawcheck@alpha` |

A global install does not change the copy a project installed, and the project's install does not change the global one. The runner in `.lawcheck/config.yaml` says which of the two runs ([Install](install.md#the-runner-setting)).

## 2. Check the version

`lawcheck --version` prints the version that runs:

```output
0.1.0-alpha.2
```

In a project, put the start command first, as in `pnpm exec lawcheck --version`.

## 3. Update the Claude Code plugin

Without the plugin, skip this step. The plugin of alpha.2 runs the same hooks as the plugin of alpha.1. To take its newest version:

```text
claude plugin marketplace update lawcheck-marketplace
claude plugin update lawcheck@lawcheck-marketplace
```

Restart Claude Code. The plugin starts the Lawcheck that the runner names, so it runs alpha.2 once step 1 is done.

## 4. List what the new version finds

The outputs below come from a repository with the law of [Lawcheck](index.md), on a branch made from `main` for the upgrade. Its `src/core/price.test.ts` mocks a file of the type `cli`:

```ts
import { expect, test, vi } from 'vitest';
import { total } from './price.js';

vi.mock('../cli/print.js');

test('total', () => {
  expect(total([1, 2])).toBe(3);
});
```

`--full` judges every file, and lists the findings outside the change as debt:

```text
$ lawcheck check --full --base main
```

```output
lawcheck: PASS  nothing changed against main

debt (outside this change): 1 finding in 1 file
src/core/price.test.ts:4  warning[forbidden-use]  core may not use cli (src/cli/print.ts); its may_use is [core]
  why:  a type's may_use names every type its files may use
```

alpha.1 prints `debt (outside this change): none` for the same repository. Debt never changes the exit code, so the run exits 0.

## 5. Give the tests a type of their own

The finding is a use the law forbids. Change the code, waive the line ([Waivers](waivers.md)), or change the law. Here the tests of `core` may mock the commands, so they get a subtype with a list of their own:

```yaml
lawcheck: 0.1.0

types:
  core:
    about: Prices and orders, with no input or output.
    paths: ["src/core/**"]
    may_use: [core]
    types:
      core-test:
        about: The tests of the core, which may mock the commands.
        paths: ["src/core/**/*.test.ts"]
        may_use: [core, cli]
  cli:
    about: The commands, which read input and print.
    paths: ["src/cli/**"]
```

The deepest type that matches a file is its type, and the `may_use` of `core-test` is the list in force for its files ([The law file](law.md#may-use)).

## 6. Check the whole code again

```text
$ lawcheck check --full --base main
```

```output
lawcheck: PASS  1 changed file (against main)
note: this change edits the law that judges it: adds the type core-test

debt (outside this change): none
```

The note names the change of the law, so the reviewer of the pull request sees it.

## A law that passed now fails

A plain `lawcheck check` judges the files that differ from the base, and an error anywhere in a changed file fails the run ([What a check judges](change.md#the-change)). So the upgrade itself passes, and the first change that touches a file with a new finding fails. Without step 5, a branch that adds a test to `src/core/price.test.ts` prints:

```text
$ lawcheck check --base main
```

```output
lawcheck: FAIL  1 error in 1 changed file (against main)

src/core/price.test.ts:4  error[forbidden-use]  core may not use cli (src/cli/print.ts); its may_use is [core]
  why:  a type's may_use names every type its files may use

next: fix src/core/price.test.ts:4
```

The branch did not touch line 4, which holds the `vi.mock` call. alpha.1 passes the same branch, because it does not read `vi.mock`. Step 5 is the fix.

## If it goes wrong

- `lawcheck --version` still prints `0.1.0-alpha.1`: the command started the other copy. Upgrade the copy the runner names, or start it through the runner, as in `npx --no-install lawcheck --version`.
- CI finds less than your machine: the job runs the version of the committed lockfile. Commit `package.json` and the lockfile.
- A forbidden use appears in a file the upgrade did not touch, in a form you do not expect: `lawcheck explain <path>` shows the file's type and its `may_use` ([The commands](commands.md#explain)).

Next: [I want to](i-want-to.md)
