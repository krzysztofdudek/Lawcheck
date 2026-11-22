# Quick start

Lawcheck checks your code against the architecture and rules you write down, and tells your coding agent which line breaks which rule. In five steps you write a law with one type and one `may_use` line, break it with one import, and `lawcheck check` names the line. You need no model and no key.

Before step 1, install Lawcheck as [Install](install.md) says. The steps start in a new repository with one file of the command layer, so that every output here is the one you get:

```text
$ git init shop
$ cd shop
```

Write `src/cli/print.ts`, in a new folder `src/cli/`:

```ts
export function print(text: string): void {
  console.log(text);
}
```

In your own repository, use your own folders in step 2 and an import that crosses them in step 4.

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

`may_use` names the types whose files a type's files may [use](concepts.md#use). Add the line `may_use: [core]` to `core`. The whole law is then:

```yaml
lawcheck: 0.1.0

types:
  core:
    about: Prices and orders, with no input or output.
    paths: ["src/core/**"]
    may_use: [core]
```

A file of `core` may now use other files of `core` and no other file of the repository. `src/cli/print.ts` has no type, so no list allows it.

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

The run exits 1. The [finding](concepts.md#finding) names the file and the line, the code `forbidden-use` and the list in force. A check judges the files that differ from a [base](concepts.md#base), such as `origin/HEAD` or the branch that `--base` names. The new repository has none, so the check counts all four of its files as changed: the two of `.lawcheck/` and the two of `src/`. To fix the line, move the printing out of the core, or give `src/cli/` a type and decide whether `core` may use it.

## Can go wrong

- `error[no-git]` from `lawcheck init`: the folder is no git work tree. Run `git init` there, or go to your repository.
- `error[law-invalid]` at a line of `.lawcheck/law.yaml`: the law has a mistake there, such as `may-use` for `may_use`. The message names the nearest known key.
- A first line that passes and ends with `1 unresolved use`: the import names no file of the repository, so Lawcheck counts the use and judges nothing. Fix the path.
- `warning[uses-not-read]`: Lawcheck does not read uses in the file's language. [Languages and uses](languages.md) lists the languages it reads.
