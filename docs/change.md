# What a check judges

`lawcheck check` judges the files of a change against the law. This page says what the change is and what the exit codes mean.

## The base

The change is measured against a base, the first of these that is set:

1. `--base <ref>` on the command line;
2. the variable `LAWCHECK_BASE`, when it is not empty;
3. `origin/HEAD`, where the clone has it.

```text
$ lawcheck check --base main
```

A base that names no commit, or shares no history with `HEAD`, is `base-unreachable`, exit 2. Without any base, a check on a machine counts every file as changed, and the first line says so. In a CI job a plain check with no base is `base-unreachable` instead: it names `--base`, `LAWCHECK_BASE` and `--full`, since it could not tell the change from debt (`lawcheck docs ci`).

## The change

Lawcheck takes the merge base of `HEAD` and the base, and the change is every file that differs from it in the working tree:

- a file committed on this branch, staged, modified, or new and not ignored, is in the change;
- a deleted file is not;
- a renamed file is changed under its new path;
- a change of mode alone counts.
- an edit of a file marked `assume-unchanged` or `skip-worktree` counts, though `git diff` does not show it.

A rule judges the changed files it binds. The change counts per file: an error on a line you did not touch still fails the run.

## --full and debt

```text
$ lawcheck check --full --base main
```

`--full` also judges every other file. What it finds there is debt: a warning, whatever the rule's status, with no effect on the exit code. The debt block comes after the findings of the change.

## What a plain check leaves out

A plain check judges only the files that differ from the base. Three kinds of change can alter a judgment without changing the file judged: a change of the law (`.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a rule file); a file whose new text moves it to another type, which changes the judgment of every file that uses it; and a file the language readers consult, such as `tsconfig.json`, `package.json`, `go.mod`, `Cargo.toml`, `composer.json` or a C# project file. Each passes a plain check, and the files it affects are judged the next time they change. This is deliberate: the default judges the change, and code nobody touched never turns a build red. To judge everything after such a change, run `lawcheck check --full`; what it finds outside the change is listed as debt and blocks nothing. When the change touches the law, `check` and `doctor` say so.

The lines `check` prints when the change touches the law (`.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a file in `.lawcheck/rules/`), the first one only without `--full`:

```text
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
note: this change edits the law that judges it: takes the rule no-console off the type library
```

The second line says what the change does to the law that judges it. A pull request can change that law: take a rule off a type, or make a rule script return nothing, and the same pull request passes its own check. The line names what Lawcheck can tell by comparing with the base: types and rules added or removed, a rule made advisory or enforced, a rule taken off or put on a type, a changed `why`, `context`, `about`, `paths`, `content` or `may_use` (the `why` of a reviewer rule is part of what the reviewer is told), a waiver the change adds, and each file of `.lawcheck/rules/` and `.lawcheck/config.yaml` added, removed or changed. A rule script is named by its file, not by what it now does. It shows five items and counts the rest, and `--json` lists all of them in `scope.law_changes`. It never changes the exit code; `lawcheck docs ci` gives a job that checks the change a second time with the law of the base.

`lawcheck doctor` reports the same in its `law-change` check. No line reports the other two kinds.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | nothing blocks; warnings are advisory |
| 1 | an error: the code breaks the law |
| 2 | no conclusion: Lawcheck, the law or the setup is broken, and the output names what to fix |

A finding of an `enforced` rule in the change is an error. A finding of an `advisory` rule, and every finding of debt, is a warning. A failing run ends with one `next:` line that says what to do.
