# What a check judges

A law written for code that already breaks it would turn every build red on the first day. `lawcheck check` judges the files of the [change](concepts.md#change). Old code fails nothing until someone changes it.

## The base

Lawcheck compares the change with a [base](concepts.md#base). It takes the first of these three that you give:

1. `--base <ref>` on the command line;
2. the variable `LAWCHECK_BASE`, when it is not empty;
3. `origin/HEAD`, where the clone has it.

```text
$ lawcheck check --base main
```

A ref is a name that git resolves to a commit, such as a branch, a tag or a commit hash.

Lawcheck stops with `base-unreachable` and exit 2 in four cases:

- the base names no commit;
- the base shares no history with `HEAD`;
- the repository has no commit yet;
- the base is the commit of zeros, which a push of a new branch names as the commit before it.

A shallow clone holds part of the history. In a shallow clone, or in a clone that did not fetch the base's branch, the message names the `git fetch` command that brings the base.

Without any base, a check on a machine counts every file as changed. Its first line says so. In a CI job a plain check with no base is `base-unreachable` instead. Without a base, the check cannot tell the change from [debt](concepts.md#debt). The message names `--base`, `LAWCHECK_BASE` and `--full` (`lawcheck docs ci`).

## The change

Lawcheck takes the merge base of `HEAD` and the base. The merge base is the newest commit that both histories hold. The change is every file of the working tree that differs from the merge base:

- a file committed on this branch, staged, modified, or new and not ignored, is in the change;
- a deleted file is not;
- a renamed file counts as changed under its new path;
- a change of mode alone counts;
- an edit of a file marked `assume-unchanged` or `skip-worktree` counts. `git diff` does not show such an edit.

A rule judges the changed files it binds. Lawcheck judges a changed file whole. An error on a line you did not touch fails the run.

Lawcheck runs git with settings that start no program the repository names: no `core.fsmonitor` program, no hook, no external diff, no `textconv` and no filter. Settings you pass to git yourself, through `GIT_CONFIG_PARAMETERS` or `git -c` in an alias, take effect. A program that such a setting names can run.

Git reads some files through a filter, such as the files of Git LFS. Lawcheck compares such a file as its bytes on disk. If the file's time no longer matches git's index, the file can count as changed.

## --full and debt

```text
$ lawcheck check --full --base main
```

`--full` judges every other file as well. Its findings in those files are debt. A finding of debt is a warning, whatever the rule's status. Debt never changes the exit code.

Lawcheck prints the debt block after the findings of the change. The block has its own count of findings, files, waivers and unresolved uses. In `--json` each finding of debt has `debt: true`.

## The limits of a plain check

A plain check judges the files that differ from the base. Three kinds of change can alter a judgment without changing the file judged:

- a change of the law: `.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a rule file;
- a file whose new text gives it another type: the judgment of each file that uses it can change;
- a file that the language readers consult, such as `tsconfig.json`, `package.json`, `go.mod`, `Cargo.toml`, `composer.json` or a C# project file.

Each of these passes a plain check. Lawcheck judges the files they affect the next time those files change. A plain check judges the change, so a file outside the change never turns a build red.

To judge every file after such a change, run `lawcheck check --full`. Lawcheck lists what it finds outside the change as debt. Debt blocks nothing. `check` and `doctor` say so when the change touches the law.

`check` prints these lines when the change touches the law: `.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a file in `.lawcheck/rules/`. It prints the first line only without `--full`:

```text
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
note: this change edits the law that judges it: takes the rule no-console off the type library
```

The second line says what the change does to the law that judges it. A pull request can change that law. It can take a rule off a type, or make a rule script return nothing. Then the same pull request passes its own check. The line names each change that Lawcheck finds when it compares the law with the base:

- a type or a rule added or removed;
- a rule made advisory or enforced, taken off a type or put on one;
- a changed `why`, `context`, `about`, `paths`, `content`, `may_use` or `waivers`;
- a waiver the change adds;
- a file of `.lawcheck/rules/`, or `.lawcheck/config.yaml`, added, removed or changed. The line names such a file by its path and not by what it does.

The line shows five items and counts the rest. `--json` lists all of them in `scope.law_changes`. The line never changes the exit code. `lawcheck docs ci` gives a job that checks the change a second time with the law of the base.

`lawcheck doctor` reports the same in its `law-change` check. No line reports the other two kinds of change.

## Files you name

`lawcheck check <path or pattern>...` judges the files you name, changed or not, and no others. This form needs no base. It runs in a repository with no commit, and in CI. Lawcheck reads a path or a pattern from the current folder. A folder selects its files at any depth. A target that selects nothing, such as a missing file, a file git ignores or a binary file, adds nothing. A target outside the root is `usage`. Write a file whose name starts with `-` with `./` before it, as in `./-x.ts`.

This form reports no debt and no note of a law change. It takes no flag but `--json`. Here `not-reviewed` and `too-large-to-review` are warnings. A missing review never makes this form exit 1. The Claude Code plugin checks files this way (`lawcheck docs plugin`).

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | nothing blocks; warnings are advisory |
| 1 | an error: the code breaks the law |
| 2 | no conclusion: Lawcheck, the law or the setup is broken, and the output names what to fix |

A finding of an `enforced` rule in the change is an error. A finding of an `advisory` rule, and every finding of debt, is a warning. A failing run ends with one `next:` line that says what to do.

Next: [JSON documents](json.md)
