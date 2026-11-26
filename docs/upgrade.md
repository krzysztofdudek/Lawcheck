# Upgrade Lawcheck

Lawcheck 0.1.0-alpha.6 reads two kinds of setting that 0.1.0-alpha.5 does not read: the file `.lawcheck/config.local.yaml`, and a variable for each key of the `reviewer` section, such as `LAWCHECK_REVIEWER_MODEL` ([On one machine](config.md#on-one-machine)). So a repository that passed on alpha.5 can stop alpha.6 with [`config-invalid`](codes.md#config-invalid), when git tracks a `.lawcheck/config.local.yaml` or when a variable holds a wrong value. [Changes in the results](#changes-in-the-results) lists these changes and the smaller ones.

If you upgrade from alpha.5, the upgrade is [Before you upgrade](#before-you-upgrade) and the first four steps. From 0.1.0-alpha.4, read also what alpha.5 changed: the second table of [Changes in the results](#changes-in-the-results), and each item of this page that starts with "From alpha.4". From 0.1.0-alpha.3 or 0.1.0-alpha.2, read also the note on a [script rule](concepts.md#script-rule) that uses the network. From alpha.2, the list of `lawcheck docs` grows from 12 pages to the 41 of this version, from alpha.4 it grows from 36, and from alpha.5 from 40. The text form of that list groups the pages under five section lines. A script that reads the list from alpha.2 meets those lines for the first time. If you upgrade from 0.1.0-alpha.1, read the whole page.

At the end of this guide, alpha.6 runs. `lawcheck check --full` has listed the findings that the new version adds. You have changed the law or the code so that the next change passes.

## Changes in the results

alpha.6 changes these results of alpha.5:

| In the repository | alpha.5 | alpha.6 |
|---|---|---|
| a `.lawcheck/config.local.yaml` that git tracks | a file Lawcheck does not read | [`config-invalid`](codes.md#config-invalid), and the run exits with code 2 |
| a `.lawcheck/config.local.yaml` that git ignores, with a `reviewer` section | a file Lawcheck does not read | the reviewer settings of that machine, over those of `.lawcheck/config.yaml` |
| a key outside the `reviewer` section of `.lawcheck/config.local.yaml`, such as `runner` | a file Lawcheck does not read | `config-invalid` |
| a variable of a `reviewer` key, such as `LAWCHECK_REVIEWER_PROVIDER` | a variable Lawcheck does not read | the value of that key on the machine, over both files; a wrong value is `config-invalid` |
| `import.meta.url` in a script rule | the address of the rule's file | the same address with `?rule=<id>` at its end |
| the note of `lawcheck check` on a `may_use` list that got wider | `changes may_use of the type core` | `widens may_use of the type core by cli`, or `widens may_use of the type core to any file` |
| the note of `lawcheck check` on a type whose waivers count again | `changes the waivers of the type core` | `reads waivers in the type core` |

`LAWCHECK_REVIEWER_KEY` and `LAWCHECK_REVIEWER_ENDPOINT` work as in alpha.5. `scope.law_changes` in `lawcheck check --json` holds the same words as the note.

From alpha.4, alpha.5 changed these results, and alpha.6 keeps them:

| In the repository | alpha.4 | alpha.5 |
|---|---|---|
| a use that could name several files, all of them forbidden by `may_use`, such as a C# partial class spread over two forbidden types | an unresolved use, and the check passes | a `forbidden-use` that names the files with their types |
| a waiver whose reason holds only invisible characters, such as a zero-width space | a waiver | [`waiver-without-reason`](codes.md#waiver-without-reason), and the finding under the waiver counts again |
| a rule whose id is `law-from-unreachable`, `law-from-packages` or `not-a-signer` | a rule | [`law-invalid`](codes.md#law-invalid), since the three ids are new codes of Lawcheck |
| a script rule whose background work throws after the rule's last result, such as a timer it unrefs | a pass or a fail, by how many other files the run judged | [`rule-crashed`](codes.md#rule-crashed) |
| a file edited in the same second as the last commit or `git add`, with its size unchanged | outside the change of a [plain check](concepts.md#plain-check) | inside the change |
| a plain check in a pull request job of GitHub Actions, GitLab CI or Azure Pipelines, with no `--base` and no `LAWCHECK_BASE` | the [base](concepts.md#base) is `origin/HEAD`, and a clone without one stops with `base-unreachable` | the base is the branch that the pull request goes into |

The first row of this table is the one that can fail a law that passed on alpha.4. In a repository where `cs/app/Ledger.cs` and `cs/infra/Ledger.cs` each hold a part of one C# class, and the `may_use` list of a third type allows neither of their types, alpha.5 reports a `forbidden-use` in a file of the third type that names the class. Its message names both files with their types, as `cs/app/Ledger.cs (app)` and `cs/infra/Ledger.cs (infra)`. alpha.4 passes the same file with `1 unresolved use` in its first line. A use with one allowed file among those it could name still passes in alpha.5.

From alpha.1, alpha.2 changed these results, and every later version keeps them:
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

Lawcheck judges those uses against the `may_use` list of the file's type. So a branch that passed on alpha.1 can fail on alpha.6 too, as in [A law that passed now fails](#a-law-that-passed-now-fails).

The release notes in the [Changelog](changelog.md) list every change in prose. alpha.3 judges the code as alpha.2 does. alpha.4 judges it as alpha.3 does, with one exception. A script rule that uses the network gets an error from the call ([Before you upgrade](#before-you-upgrade)).

## Files that need no edit

The law keeps its `lawcheck: 0.1.0` line. That line holds the version of the law's format. Lawcheck checks only the form of that version, and it does not compare the value with its own version ([The law file](law.md#lawcheck)). alpha.6 reads the law, the rules and `.lawcheck/config.yaml` as alpha.5 does, and it adds no key to them. alpha.2, alpha.3 and alpha.4 read the rules and `.lawcheck/config.yaml` as alpha.1 does. alpha.5 reads them as alpha.4 does, except a rule whose id is one of the three new codes.

From alpha.4, alpha.5 adds four keys to the law: `required`, `ignored` and `signers` at the top, and `companion` in a rule. Each one changes the results only in a law that uses it.

alpha.6 sends the [reviewer](concepts.md#reviewer-rule) the same prompt as alpha.5, byte for byte, and gives each pass the same line in `.lawcheck/verdicts`. alpha.5 sends the same prompt as alpha.4, and alpha.2, alpha.3 and alpha.4 send the same prompt as alpha.1. Every pass in the file stays valid ([Verdict](concepts.md#verdict)). The upgrade needs no new review. Under a law without `signers`, alpha.6 reads and writes the file as alpha.4 and alpha.5 do ([Signed passes](reviewer-rules.md#signed-passes)).

From alpha.4, alpha.5 reads the reviewer's answer in a new way. An answer that holds a fail and a pass is a fail. In alpha.4 the last object of the answer won, so a fail followed by a quoted pass counted as a pass. The new reading applies to the reviews you ask for after the upgrade ([The answer](reviewer-rules.md#the-answer)).

alpha.5 and alpha.6 keep a cache of what Java, Kotlin, C#, Ruby and Rust files declare in `.lawcheck/.local/readers/` ([The reader cache](languages.md#the-reader-cache)). The `.lawcheck/.gitignore` that `lawcheck init` wrote keeps `.lawcheck/.local/` out of git.

## Before you upgrade

- alpha.6 stops with `config-invalid` on a `.lawcheck/config.local.yaml` that git tracks, and the run exits with code 2. Take the file out of git with `git rm --cached .lawcheck/config.local.yaml`, or move its settings into `.lawcheck/config.yaml`.
- alpha.6 reads a `.lawcheck/config.local.yaml` that git ignores, and its `reviewer` section sets the reviewer of that machine. A key outside that section, such as `runner`, is `config-invalid`. On each machine that holds such a file, read it before you upgrade.
- alpha.6 reads a variable for each key of the `reviewer` section, such as `LAWCHECK_REVIEWER_PROVIDER` and `LAWCHECK_REVIEWER_MODEL`, and the variable wins over both files. A wrong value in one is `config-invalid`. Look for these variables on each machine and in each CI job before you upgrade ([Variables](config.md#variables)).
- A script that finds a wider `may_use` list in `scope.law_changes` of `lawcheck check --json` by the words `changes may_use` also looks for `widens may_use`.
- A script that finds a type whose waivers count again by the words `changes the waivers` also looks for `reads waivers`.
- A script rule that compares `import.meta.url` with a fixed text, or cuts a path out of it by hand, no longer finds what it looks for. Use `fileURLToPath(import.meta.url)`, `import.meta.dirname`, `import.meta.filename` or `new URL('./x', import.meta.url)`, which give the same paths as in alpha.5 ([The runner](script-rules.md#the-runner)).
- From alpha.4, a file that alpha.4 passed can hold a use that alpha.5 and alpha.6 forbid. A plain check fails on that file the first time a change touches it. Step 4, [List what the new version finds](#_4-list-what-the-new-version-finds), lists those files before a change touches them.
- From alpha.4, a rule whose id is `law-from-unreachable`, `law-from-packages` or `not-a-signer` stops the new version with `law-invalid`, and the run exits with code 2. Give such a rule another id, and its file the same name, before you upgrade.
- From alpha.4, install the new version on every machine, CI job and git hook that checks the repository before you add `required`, `ignored`, `signers` or a rule's `companion` to the law. alpha.4 stops with `law-invalid` on a law that uses one of them.
- From alpha.4, a script that reads `lawcheck check --json` no longer finds the waivers a change adds in `scope.law_changes`. It reads the items of `waivers` whose `added` is true ([JSON documents](json.md)).
- From alpha.4, a `check` or `try` that ends with exit 2 after it sent requests to a reviewer ends its first line with the count, such as `lawcheck: ERROR  1 error, 2 reviewer calls`. The document `lawcheck-error/1` gains `calls_made`. A program that checks the document against a schema that refuses unknown keys has to allow `calls_made`.
- From alpha.4, the workflow of `lawcheck docs ci` runs its second check with `--law-from`. Before you replace the lines of your alpha.4 workflow with the new one, read [A change to the law](ci.md#a-change-to-the-law): a rule of the base that imports a file outside `.lawcheck/rules/` stops that check with `rule-crashed`.
- From alpha.4, `lawcheck doctor` reads the uses of the files whose `may_use` list is in force, so it takes about as long as `lawcheck check --full`. A CI job that runs `doctor` on every push takes that time on every push ([Run doctor on a machine, not in the job](ci.md#_4-run-doctor-on-a-machine-not-in-the-job)).
- From alpha.3 or older, a script rule that uses the network gets an error from the call itself, on every version of Node. On Node 24, alpha.3 let the call through. On Node 25 and later, alpha.3 passed Node's refusal to the callback, the `error` event or the promise. A rule that does not catch the error at the call ends as `rule-crashed`. The check then exits with code 2. Keep the data the rule needs in a file of the repository, and let the rule read that file.
- From alpha.1, a file that alpha.1 passed can hold a use that every later version forbids. Step 4 lists those files as well.
- From alpha.1, the install grows by about 34 MB. The grammars of the languages take that space. A grammar is the file that describes the syntax of one language.
- CI and the git hooks run the version that the project's lockfile pins. Commit `package.json` and the lockfile with the upgrade. Then the CI job, the hooks and each machine's copy in the project run alpha.6.

## 1. Install the new version

Run the install line again. `@alpha` names the newest alpha:

| Installed | Upgrade with |
|---|---|
| globally | `npm install --global lawcheck@alpha` |
| with npm | `npm install --save-dev lawcheck@alpha` |
| with pnpm | `pnpm add --save-dev lawcheck@alpha` |
| with Yarn | `yarn add --dev lawcheck@alpha` |
| with Bun | `bun add --dev lawcheck@alpha` |

A machine can hold two copies of Lawcheck: the global one and the one in the project. An upgrade of one copy leaves the other as it is. The `runner` setting in `.lawcheck/config.yaml` decides which copy runs ([Install](install.md#the-runner-setting)).

## 2. Check the version

`lawcheck --version` prints the version that runs:

```output
0.1.0-alpha.6
```

In a project, start Lawcheck through the package manager, as in `pnpm exec lawcheck --version`.

## 3. Update the Claude Code plugin

If you do not use the Claude Code plugin, skip this step. The plugin of alpha.6 runs the same four hooks as the plugin of alpha.5. Its skill `/lawcheck:setup` follows the new steps of `lawcheck docs agent-setup`, which the [Changelog](changelog.md) lists.

From alpha.4, the plugin also adds the four things that alpha.5 brought ([The Claude Code plugin](plugin.md)):

- the skill `/lawcheck:setup`, which writes the first law of a repository with you;
- one message to you at the end of a turn in which the agent added a waiver, or changed or deleted a file of the law;
- one message to you in each session, when the law has a reviewer rule and `.lawcheck/config.yaml` sets no reviewer;
- the word `Lawcheck:` at the start of each of its messages, where alpha.4 started some with `lawcheck:`.

Install alpha.6 before you update the plugin ([Install the new version](#_1-install-the-new-version)). The skill follows the page `lawcheck docs agent-setup`, and alpha.4 has no such page. These two commands install the newest version of the plugin:

```text
claude plugin marketplace update lawcheck-marketplace
claude plugin update lawcheck@lawcheck-marketplace
```

Restart Claude Code. The plugin starts the Lawcheck that the `runner` setting names. After step 1, that Lawcheck is alpha.6.

The plugins for Codex and GitHub Copilot CLI run the same hooks as their plugins of alpha.5, and they hold the same skill as the Claude Code plugin. From alpha.4, they are new, so there is no older one to update ([Lawcheck in Codex](codex-cli.md), [Lawcheck in GitHub Copilot CLI](copilot-cli.md)).

## 4. List what the new version finds

The example below is a finding that alpha.2 added to alpha.1. A finding that alpha.6 adds to the version you ran before shows in the same list. The outputs come from a repository with the law of the example on [Lawcheck](index.md). The upgrade happens on a branch made from `main`. In that repository, `src/core/price.test.ts` mocks a file of the type `cli`:

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

alpha.1 prints `debt (outside this change): none` for the same repository. Without `--strict`, debt does not change the exit code. The run exits 0.

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

A plain `lawcheck check` judges the files that differ from the [base](concepts.md#base). An error anywhere in a changed file fails the run ([What a check judges](change.md#the-change)). A branch with the upgrade alone passes. The check fails on the first change that touches a file with a new finding. Take the law without the test type of [Give the tests a type of their own](#_5-give-the-tests-a-type-of-their-own). On a branch that adds a test to `src/core/price.test.ts`, `check` prints this:

```text
$ lawcheck check --base main
```

```output
lawcheck: FAIL  1 error in 1 changed file (against main)

src/core/price.test.ts:4  error[forbidden-use]  core may not use cli (src/cli/print.ts); its may_use is [core]
  why:  a type's may_use names every type its files may use

next: fix src/core/price.test.ts:4
```

The branch did not touch line 4. That line holds the `vi.mock` call. alpha.1 passes the same branch, because alpha.1 does not read `vi.mock`. The test type of [Give the tests a type of their own](#_5-give-the-tests-a-type-of-their-own) clears the finding.

## If it goes wrong

- `lawcheck --version` still prints the old version, such as `0.1.0-alpha.5`: the command started the other copy. Upgrade the copy that the `runner` setting names, or start Lawcheck with the command of that setting, as in `npx --no-install lawcheck --version`.
- CI reports fewer findings than your machine: the job runs the version of the committed lockfile. Commit `package.json` and the lockfile.
- Lawcheck reports a forbidden use in a file that the upgrade did not touch, in a form you do not expect. `lawcheck explain <path>` shows the file's type and its `may_use` ([The commands](commands.md#explain)).

Next: [I want to](i-want-to.md)
