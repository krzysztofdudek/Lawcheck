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

A base that names no commit, or shares no history with `HEAD`, is `base-unreachable`, exit 2. Without any base, every file counts as changed, and the first line says so.

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

A plain check judges only the files that differ from the base. Three kinds of change can alter a judgment without changing the file judged: a change of the law (`.lawcheck/law.yaml` or a rule file); a file whose new text moves it to another type, which changes the judgment of every file that uses it; and a file the language readers consult, such as `tsconfig.json`, `package.json`, `go.mod`, `Cargo.toml`, `composer.json` or a C# project file. Each passes a plain check, and the files it affects are judged the next time they change. This is deliberate: the default judges the change, and code nobody touched never turns a build red. To judge everything after such a change, run `lawcheck check --full`; what it finds outside the change is listed as debt and blocks nothing. When the change touches the law, `check` and `doctor` say so.

The line `check` prints when the change touches the law:

```text
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
```

`lawcheck doctor` reports the same in its `law-change` check. No line reports the other two kinds.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | nothing blocks; warnings are advisory |
| 1 | an error: the code breaks the law |
| 2 | no conclusion: Lawcheck, the law or the setup is broken, and the output names what to fix |

A finding of an `enforced` rule in the change is an error. A finding of an `advisory` rule, and every finding of debt, is a warning. A failing run ends with one `next:` line that says what to do.
