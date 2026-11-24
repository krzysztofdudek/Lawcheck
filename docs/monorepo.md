# A monorepo

A monorepo is one git repository that holds several packages. Each package can hold a [law](concepts.md#law) of its own. `lawcheck check` at the top of the repository then ends with `not-initialized`, which names the laws below it. You check each package from its own folder, against its own law and settings.

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

The folder that holds `.lawcheck/` is the root of the law. With this law, Lawcheck judges the files below `packages/api/` alone.

## 2. Describe the package

The paths of the law start at its root, here `packages/api/`. Put the [script rule](concepts.md#script-rule) `no-console` of [The first type and the first rule](first-law.md) in `packages/api/.lawcheck/rules/`. Then `packages/api/.lawcheck/law.yaml` reads:

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

Lawcheck looks for the law in the folder you run it from, then in each folder above it. It resolves a path you name against the folder you are in. Its output names each file by its path from the root of the law. In `packages/api/src`, where `total.ts` calls `console.log`, run:

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

A linked worktree is a second checkout that `git worktree add` makes. In a linked worktree, a check gives the same output as in the main checkout, from the top of the worktree and from a folder below it.

## 4. Run it from the top

The top of the repository has no law. A check there names the laws below it:

```text
$ lawcheck check
```

```output
lawcheck: ERROR  1 error

error[not-initialized]  no .lawcheck/law.yaml in this directory or any above it; the laws below it are in packages/api, packages/web
  why:  without a law there is nothing to check the code against

next: cd packages/api, where a law is, then run lawcheck check
```

Run the check once in each folder that the message names. In a CI job, give each law a step of its own, whose `working-directory` is the folder of that law ([CI and git hooks](ci.md)).

## 5. Give a package its own runner

Lawcheck reads the `.lawcheck/config.yaml` beside each law. For a package installed with pnpm, write the `runner` setting into `packages/web/.lawcheck/config.yaml`:

```yaml
runner: pnpm
```

The agent and the Claude Code plugin then start Lawcheck in that package with `pnpm exec lawcheck`. The first line of `lawcheck prime` in `packages/web` names that command:

```output
Lawcheck checks this repository's code against its law: the file types and the rules each type keeps. The law is .lawcheck/law.yaml; rule files are in .lawcheck/rules/. Start it here as: pnpm exec lawcheck
```

Each package can set its own `reviewer` in the same file ([Settings](config.md)).

## 6. Leave a nested repository to its own law

A submodule is a git repository that another repository holds in its tree. Lawcheck judges no file of a submodule, or of another repository inside the tree. Say you fixed `total.ts`. The folder `packages/api/src/vendor` is a repository of its own. The paths of the [type](concepts.md#type) `source` reach into that folder. In `packages/api`, run:

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

- `lawcheck init` at the top refuses with `already-initialized`, because a law below covers a part of the tree. `lawcheck init` never starts a law above or below another law.
- `lawcheck check ../../web/src/page.ts` ends with the code [`usage`](codes.md#usage), because the path lies outside the root of the law. Run the check in the folder of the other law.
- A rule ends in `rule-crashed`, with a message that says the rule fails to load. The package manager put the package that the rule imports in the `node_modules` at the top of the repository. That folder lies above the root of the law. A rule may read nothing outside the root and Lawcheck's own folder, the folder where the `lawcheck` package is installed. Install the package in a `node_modules` inside the package, as the `next:` line says ([Script rules](script-rules.md)).
- You start a Claude Code session at the top of the repository, where no law is. The check after an edit looks for the law from the folder of the edited file, so it finds the law of the package and runs. The check before the agent finishes looks for the law from the folder of the session. It finds no law there, and it does not run. Start the session in the folder of the package ([The Claude Code plugin](plugin.md)).

Next: [A finding you believe is wrong](false-alarm.md)
