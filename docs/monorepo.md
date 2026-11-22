# A monorepo

In a monorepo, `lawcheck check` at the top ends with `not-initialized` and names the [laws](concepts.md#law) below it. You check each package that holds a law from its own folder, against its own law and settings.

The outputs below come from a git repository whose `main` holds `packages/api/src/price.ts` and `packages/web/src/page.ts`. The work is on a branch made from `main`.

## 1. Start a law in one package

In `packages/api`:

```text
$ lawcheck init
```

```output
lawcheck: created .lawcheck/law.yaml and .lawcheck/.gitignore
note: the law covers only the files below packages/api/

Nothing is checked yet: the law has no types.
next: describe your first file type in .lawcheck/law.yaml  (lawcheck docs first-law shows how)
```

The folder that holds `.lawcheck/` is the root of the law. The law judges only the files below it.

## 2. Describe the package

The paths of the law start at its root, here `packages/api/`. With the [script rule](concepts.md#script-rule) `no-console` of [The first type and the first rule](first-law.md) in `packages/api/.lawcheck/rules/`, `packages/api/.lawcheck/law.yaml` reads:

```yaml
lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.

types:
  source:
    about: The code of the API.
    paths: ["src/**/*.ts"]
    rules: [no-console]
```

## 3. Check from a folder inside the package

Lawcheck finds the law in the folder you run it from or in one above it. Lawcheck reads a path you name from the folder you are in, and its output names files from the root of the law. In `packages/api/src`, where `total.ts` calls `console.log`:

```text
$ lawcheck check total.ts
```

```output
lawcheck: FAIL  1 error in 1 named file

src/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/total.ts:2
```

`lawcheck check --base main` in the same folder judges every changed file of the package.

## 4. Run it from the top

The top of the repository has no law, and Lawcheck names the ones below:

```text
$ lawcheck check
```

```output
lawcheck: ERROR  1 error

error[not-initialized]  no .lawcheck/law.yaml in this directory or any above it; the laws below it are in packages/api, packages/web
  why:  without a law there is nothing to check the code against

next: cd packages/api, where a law is, then run lawcheck check
```

Run the check once in each folder the message names. A CI job does the same with one step per law, each with `working-directory` set to its folder ([CI and git hooks](ci.md)).

## 5. Give a package its own runner

Each law reads the `.lawcheck/config.yaml` beside it. A package installed with pnpm sets `runner` in `packages/web/.lawcheck/config.yaml`:

```yaml
runner: pnpm
```

The agent and the Claude Code plugin then start Lawcheck there with `pnpm exec lawcheck`. The first line of `lawcheck prime` in `packages/web` names it:

```output
Lawcheck checks this repository's code against its law: the file types and the rules each type keeps. The law is .lawcheck/law.yaml; rule files are in .lawcheck/rules/. Start it here as: pnpm exec lawcheck
```

Each package also sets its own `reviewer` in the same file ([Settings](config.md)).

## 6. Leave a nested repository to its own law

Lawcheck does not look into a submodule or another repository inside the tree. With `total.ts` fixed, and a repository of its own in `packages/api/src/vendor`, the paths of the [type](concepts.md#type) `source` reach into it. In `packages/api`:

```text
$ lawcheck check --full
```

```output
lawcheck: PASS  5 files (no base: every file counts as changed)
note: the paths of a type reach into src/vendor (a repository of its own); Lawcheck does not look into another repository, so no file there is judged

debt (outside this change): none
```

To judge the files of `src/vendor`, start a law in that repository.

## If it goes wrong

- `lawcheck init` at the top refuses with `already-initialized`, because a law below already governs a part of the tree. One folder and the folders below it have one law.
- `lawcheck check ../../web/src/page.ts` ends with `usage`: the path lies outside the root of the law. Run the check in the folder of the other law.
- A rule ends in `rule-crashed`, and the message says it fails to load because it reads a file in a `node_modules` above the package. The package manager put the package the rule imports in the `node_modules` at the top, and a rule reads nothing above its root. Install the package in a `node_modules` of the package, as the `next:` line says ([Script rules](script-rules.md)).
- A Claude Code session started at the top of the repository finds no law there. The check after an edit looks for the law from the edited file and still runs. The check before the agent finishes looks for the law from the session's folder, finds none, and does not run. Start the session in the package folder ([The Claude Code plugin](plugin.md)).
