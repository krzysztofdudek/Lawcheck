# Upgrade Lawcheck

Lawcheck 0.1.0-alpha.3 judges the code as 0.1.0-alpha.2 does, and `lawcheck docs` lists 36 pages in place of 12. Its text list groups the pages under five section lines, so a script that reads that list meets lines it did not see before. From alpha.2, the first three steps are the whole upgrade. From 0.1.0-alpha.1, read the whole page.

Lawcheck finds the [uses](concepts.md#use) of each file through a parsing library named Runes. Lawcheck 0.1.0-alpha.2 depends on Runes 1.2.0. alpha.2 finds uses that 0.1.0-alpha.1 missed, such as a `vi.mock` of a file of another layer. Lawcheck judges those uses against `may_use`. A branch that passed on alpha.1 can then fail on alpha.3, at a line that the branch did not touch.

At the end of this guide, alpha.3 runs. `lawcheck check --full` has listed its new findings. You have changed the law or the code so that the next change passes.

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

The release note of alpha.2 says the same in prose ([Changelog](changelog.md)). alpha.3 gives the same results.

## Files that need no edit

The law keeps its `lawcheck: 0.1.0` line, since Lawcheck checks the form of that version and never compares it with its own ([The law file](law.md#lawcheck)). alpha.2 and alpha.3 read the rules and `.lawcheck/config.yaml` as alpha.1 does.

alpha.2 and alpha.3 send the reviewer the same prompt as alpha.1. The upgrade needs no new review, since every pass in `.lawcheck/verdicts` stays valid.

## Before you upgrade

- From alpha.1, a file that alpha.1 passed can hold a use that alpha.2 and alpha.3 forbid. A [plain check](concepts.md#plain-check) fails on it the first time a change touches that file. You list those files before a change does in [List what the new version finds](#_4-list-what-the-new-version-finds).
- From alpha.1, the install grows by about 34 MB. A grammar is the file that describes the syntax of one language, and the grammars that Runes 1.2.0 ships take that space.
- CI and the git hooks run the version that the project's lockfile pins. Commit `package.json` and the lockfile with the upgrade. Then the CI job, the hooks and each machine's copy in the project run alpha.3.

## 1. Install the new version

Run the install line again. `@alpha` names the newest alpha:

| Installed | Upgrade with |
|---|---|
| globally | `npm install --global lawcheck@alpha` |
| with npm | `npm install --save-dev lawcheck@alpha` |
| with pnpm | `pnpm add --save-dev lawcheck@alpha` |
| with Yarn | `yarn add --dev lawcheck@alpha` |
| with Bun | `bun add --dev lawcheck@alpha` |

An upgrade of one copy leaves the other copy as it is. The `runner` setting in `.lawcheck/config.yaml` decides which of the two runs ([Install](install.md#the-runner-setting)).

## 2. Check the version

`lawcheck --version` prints the version that runs:

```output
0.1.0-alpha.3
```

In a project, start Lawcheck through the package manager, as in `pnpm exec lawcheck --version`.

## 3. Update the Claude Code plugin

Without the plugin, skip this step. The plugins of alpha.2 and alpha.3 run the same hooks as the plugin of alpha.1. These two commands install its newest version:

```text
claude plugin marketplace update lawcheck-marketplace
claude plugin update lawcheck@lawcheck-marketplace
```

Restart Claude Code. The plugin starts the Lawcheck that the `runner` setting names. After you install the new version ([Install the new version](#_1-install-the-new-version)), that Lawcheck is alpha.3.

## 4. List what the new version finds

The outputs below come from a repository with the law of [Lawcheck](index.md). The upgrade happens on a branch made from `main`. In that repository, `src/core/price.test.ts` mocks a file of the type `cli`:

```ts
import { expect, test, vi } from 'vitest';
import { total } from './price.js';

vi.mock('../cli/print.js');

test('total', () => {
  expect(total([1, 2])).toBe(3);
});
```

With `--full`, Lawcheck judges every file. It lists the findings outside the change as [debt](concepts.md#debt):

```text
$ lawcheck check --full --base main
```

```output
lawcheck: PASS  nothing changed against main

debt (outside this change): 1 finding in 1 file
src/core/price.test.ts:4  warning[forbidden-use]  core may not use cli (src/cli/print.ts); its may_use is [core]
  why:  a type's may_use names every type its files may use
```

alpha.1 prints `debt (outside this change): none` for the same repository. Debt never changes the exit code. The run exits 0.

## 5. Give the tests a type of their own

The finding is a use the law forbids. You can clear it in one of three ways:

- change the code;
- waive the line ([Waivers](waivers.md));
- change the law.

In this repository, the tests of `core` may mock the files of the type `cli`. The law below gives the tests a subtype of `core` with a `may_use` list of its own:

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

A file takes the deepest type that matches it. A test file of `src/core/` matches both `core` and its subtype `core-test`. Its type is `core-test`. The `may_use` of `core-test` is the list that Lawcheck applies to its files ([The law file](law.md#may-use)).

## 6. Check the whole code again

```text
$ lawcheck check --full --base main
```

```output
lawcheck: PASS  1 changed file (against main)
note: this change edits the law that judges it: adds the type core-test

debt (outside this change): none
```

The note names the change of the law. The person who reviews the pull request sees it in the output of the check.

## A law that passed now fails

A plain `lawcheck check` judges the files that differ from the base. An error anywhere in a changed file fails the run ([What a check judges](change.md#the-change)). A branch with the upgrade alone passes. The check fails on the first change that touches a file with a new finding. Without the test type of [Give the tests a type of their own](#_5-give-the-tests-a-type-of-their-own), `check` prints this on a branch that adds a test to `src/core/price.test.ts`:

```text
$ lawcheck check --base main
```

```output
lawcheck: FAIL  1 error in 1 changed file (against main)

src/core/price.test.ts:4  error[forbidden-use]  core may not use cli (src/cli/print.ts); its may_use is [core]
  why:  a type's may_use names every type its files may use

next: fix src/core/price.test.ts:4
```

The branch did not touch line 4. That line holds the `vi.mock` call. alpha.1 passes the same branch, because it does not read `vi.mock`. You fix it with the test type of [Give the tests a type of their own](#_5-give-the-tests-a-type-of-their-own).

## If it goes wrong

- `lawcheck --version` still prints the old version, such as `0.1.0-alpha.2`: the command started the other copy. Upgrade the copy that the `runner` setting names, or start Lawcheck with the command of that setting, as in `npx --no-install lawcheck --version`.
- CI reports fewer findings than your machine: the job runs the version of the committed lockfile. Commit `package.json` and the lockfile.
- Lawcheck reports a forbidden use in a file that the upgrade did not touch, in a form you do not expect. `lawcheck explain <path>` shows the file's type and its `may_use` ([The commands](commands.md#explain)).

Next: [I want to](i-want-to.md)
