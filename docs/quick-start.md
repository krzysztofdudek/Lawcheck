# Quick start

Lawcheck checks code against your written architecture and names the file and line that break it, so you catch drift in Claude Code hooks and CI. It reads the uses of 12 languages. In five steps you write a [law](concepts.md#law) with one type and one `may_use` line. Then you break the law with one import, and `lawcheck check` names the line. You need no model and no key.

Install Lawcheck from npm. It needs Node 24 or later and git 2.34 or later:

```text
$ npm install --global lawcheck@alpha
```

`lawcheck --version` then prints the version you installed. To install Lawcheck in one project, or with pnpm, Yarn or Bun, read [Install](install.md).

Start in a new repository. In a new repository, each output you get matches the output on this page:

```text
$ git init shop
$ cd shop
```

The command layer is the code that prints. Write the file of the command layer, `src/cli/print.ts`, in a new folder `src/cli/`:

```ts
export function print(text: string): void {
  console.log(text);
}
```

In your own repository, use your own folders in [Describe one type](#_2-describe-one-type). In [Write a file that breaks it](#_4-write-a-file-that-breaks-it), write an import from one of those folders into the other.

## 1. Start the law

```text
$ lawcheck init
```

```output
lawcheck: created .lawcheck/law.yaml and .lawcheck/.gitignore

Nothing is checked yet: the law has no types.
next: describe your first file type in .lawcheck/law.yaml  (lawcheck docs first-law shows how)
```

## 2. Describe one type

Replace the text of `.lawcheck/law.yaml` with one [type](concepts.md#type), `core`, for the files below `src/core/`:

```yaml
lawcheck: 0.1.0

types:
  core:
    about: Prices and orders, with no input or output.
    paths: ["src/core/**"]
```

## 3. Add one may_use line

The `may_use` list of a type names other types. The files of the type may [use](concepts.md#use) the files of the types on the list. Add the line `may_use: [core]` to `core`. The whole law is then:

```yaml
lawcheck: 0.1.0

types:
  core:
    about: Prices and orders, with no input or output.
    paths: ["src/core/**"]
    may_use: [core]
```

With this line, a file of `core` may use other files of `core` and no other file of the repository. `src/cli/print.ts` has no type, so no `may_use` list can allow a use of it.

This page ends on a rule about which layer may import which. For a first rule about the text of a file, such as no `console.log` in one folder, read [The first type and the first rule](first-law.md).

## 4. Write a file that breaks it

Write `src/core/receipt.ts`, in a new folder `src/core/`. The file prints through the command layer:

```ts
import { print } from "../cli/print.js";

export function receipt(sum: number): void {
  print(`total: ${sum}`);
}
```

## 5. Check

```text
$ lawcheck check
```

```output
lawcheck: FAIL  1 error in 4 files (no base: every file counts as changed)

src/core/receipt.ts:1  error[forbidden-use]  core may not use src/cli/print.ts, which has no type; its may_use is [core]
  why:  a type's may_use names every type its files may use

next: fix src/core/receipt.ts:1
```

The run exits 1. The [finding](concepts.md#finding) names the file, the line, the code `forbidden-use` and the `may_use` list of `core`.

A check judges the files that differ from a [base](concepts.md#base). The base is a commit, such as `origin/HEAD` or the branch that `--base` names. The new repository has no base. The check then counts all four of its files as changed: the two of `.lawcheck/` and the two of `src/`.

You can fix the line in two ways:

- move the printing out of `src/core/receipt.ts`;
- give `src/cli/` a type of its own, then decide in the law whether `core` may use that type.

In your own repository, your coding agent can write the first law for you: tell it "Run `lawcheck docs agent-setup` and follow it." ([Let a coding agent write the first law](agent-setup.md)).

## Can go wrong

- `lawcheck init` prints `error[no-git]`: the folder is no git work tree. Run `git init` there, or go to your repository.
- Lawcheck prints `error[law-invalid]` at a line of `.lawcheck/law.yaml`: the law has a mistake there, such as `may-use` for `may_use`. The message names the nearest known key.
- The first line says PASS and ends with `1 unresolved use`: the import names no file of the repository. Lawcheck counts such a use and does not judge it. Fix the path.
- The check prints `warning[uses-not-read]`: Lawcheck does not read uses in the language of the file. [Languages and uses](languages.md) lists the languages it reads.

Next: [Concepts](concepts.md)
