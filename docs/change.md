# What a check judges

A law written for code that already breaks it would fail every build on the first day. `lawcheck check` judges the files of the [change](concepts.md#change). Old code fails nothing until someone changes it.

## The base

Lawcheck compares the change with a [base](concepts.md#base). A ref is a name that git resolves to a commit, such as a branch, a tag or a commit hash. Lawcheck takes the base from the first of these four that you give:

1. `--base <ref>` on the command line;
2. the variable `LAWCHECK_BASE`, when it is not empty;
3. in a CI job, the variable that the service sets for the target branch of a pull request, or for the commit before a push: `GITHUB_BASE_REF` in GitHub Actions, `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` and `CI_COMMIT_BEFORE_SHA` in GitLab CI, `SYSTEM_PULLREQUEST_TARGETBRANCH` in Azure Pipelines ([CI and git hooks](ci.md#_5-give-the-base-on-another-ci-service));
4. `origin/HEAD`, where the clone has it.

```text
$ lawcheck check --base main
```

Lawcheck stops with `base-unreachable` and exit 2 in four cases:

- the base names no commit;
- the base shares no history with `HEAD`;
- the repository has no commit yet;
- the base is a commit id of forty zeros, which CI gives as the commit before the push of a new branch.

A shallow clone holds part of the history. In a shallow clone, or in a clone that did not fetch the base's branch, the message names the `git fetch` command that fetches the base.

With no base, a check on a machine counts every file as changed. Its first line says so. In a CI job, a plain check with no base stops with `base-unreachable`, because without a base it cannot tell the change from [debt](concepts.md#debt). The `next:` line of that error names `--base`, `LAWCHECK_BASE` and `--full` (`lawcheck docs ci`). The history of the base still has to be in the clone: a shallow clone ends as `base-unreachable`, and the `next:` line names the `git fetch` that fixes it.

## The change

The merge base of two commits is the newest commit that both histories hold. Lawcheck finds the merge base of `HEAD` and the base. The change is every file of the working tree that differs from that merge base:

- a file committed on this branch, staged, modified, or new and not ignored, is in the change;
- a deleted file is not;
- a renamed file counts as changed under its new path;
- a change of mode alone counts;
- an edit of a file that you marked `assume-unchanged` or `skip-worktree` in git counts. `git diff` does not show such an edit.

Lawcheck judges each changed file against the rules that bind it. A rule binds a file when the file's type, or a type above it, lists the rule. Lawcheck judges the whole file. An error on a line you did not touch fails the run too.

The git settings of a repository can name programs that git starts while it reads the files. Lawcheck runs git with these programs turned off:

- a `core.fsmonitor` program, which watches the work tree for changes;
- the hooks that git runs at an event such as a commit;
- an external diff program;
- a `textconv` program, which turns a file into text for `git diff`;
- a filter, which changes a file on its way into or out of git.

Settings you pass to git yourself, through `GIT_CONFIG_PARAMETERS` or `git -c` in an alias, take effect. If one of your own settings names a program, git can start that program.

Git reads some files through a filter, such as the files of Git LFS. Lawcheck compares such a file as its bytes on disk. If the file's time no longer matches git's index, the file can count as changed.

## --full and debt

```text
$ lawcheck check --full --base main
```

With `--full`, Lawcheck judges every other file as well. The findings in those other files are debt. Without `--strict`, debt never changes the exit code, because each of its findings is a warning, whatever the status of its rule.

Lawcheck prints the debt block after the findings of the change. The block has its own count of findings, files, waivers and unresolved uses. In `--json` each finding of debt has `debt: true`.

With `--strict`, Lawcheck judges every file as `--full` does, and a finding of debt is an error exactly when the same finding inside the change would be one. A finding of an `enforced` rule in an old file is then an error, and the run exits 1. A finding of an `advisory` rule stays a warning, and so does a finding that is a warning in the change, such as `waiver-unused`. The first line of a run that fails only on debt counts it apart: `lawcheck: FAIL  3 changed files (against main), 2 errors in debt`. Use `--strict` where a team has paid its debt and wants the branch red until the next breach is cleaned up.

## The limits of a plain check

A [plain check](concepts.md#plain-check) calls no reviewer. It judges only the files that differ from the base. Three kinds of change can alter a judgment without changing the file judged:

- a change of the law: `.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a rule file;
- a file whose new text gives it another type: the judgment of each file that uses it can change;
- a file that the language readers consult, such as `tsconfig.json`, `package.json`, `go.mod`, `Cargo.toml`, `composer.json` or a C# project file.

Each of these passes a plain check. Lawcheck judges the files they affect the next time those files change. Only a file in the change fails a plain check with exit 1. A file outside the change can still stop one with exit 2, for example with [type-overlap](codes.md#type-overlap), [file-unreadable](codes.md#file-unreadable), [file-too-large](codes.md#file-too-large), [text-too-large](codes.md#text-too-large), [parser-failed](codes.md#parser-failed) or [link-outside-root](codes.md#link-outside-root).

To judge every file after such a change, run `lawcheck check --full`. Lawcheck lists what it finds outside the change as debt. Debt blocks nothing. `check` and `doctor` say when the change touches the law.

`check` prints these lines when the change touches the law: `.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a file in `.lawcheck/rules/`. It prints the first line only without `--full`:

```text
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
note: this change edits the law that judges it: takes the rule no-console off the type library
```

The second line says what the change does to the law that judges it. A pull request can change that law. It can take a rule off a type, or make a rule script return nothing. Then the same pull request passes its own check. The line names each change that Lawcheck finds when it compares the law with the base:

- a type or a rule added or removed;
- a rule made advisory or enforced, taken off a type or put on one;
- a changed `why`, `context`, `about`, `paths`, `content`, `may_use` or `waivers`;
- a changed `required` or `ignored`;
- a type moved under another parent, or to the top of `types`;
- a waiver the change adds;
- a file of `.lawcheck/rules/`, or `.lawcheck/config.yaml`, added, removed or changed. The line names such a file by its path and not by what it does.

The line shows five items and the count of the rest. In `--json`, `scope.law_changes` lists every item. The line never changes the exit code of the run, whatever it lists. `lawcheck docs ci` gives a job that checks the change a second time with the law of the base.

`lawcheck doctor` reports the same in its `law-change` check. No line of `check` or `doctor` reports the other two kinds of change.

## Files you name

`lawcheck check <path or pattern>...` judges the files you name, changed or not, and no others. This form needs no base. It runs in CI, and in a repository with no commit.

Lawcheck reads each path and pattern from the folder you run it in. A folder selects its files at any depth. A path that selects nothing, such as a missing file, a file git ignores or a binary file, adds nothing to the run. The root is the folder that holds `.lawcheck/`. A path outside the root stops the run with the error [`usage`](codes.md#usage). Write a file whose name starts with `-` with `./` before it, as in `./-x.ts`.

This form prints neither debt nor the note of a law change. It takes one flag, `--json`. A missing review never makes this form exit 1, because `not-reviewed` and `too-large-to-review` are warnings in it. The Claude Code plugin checks files this way (`lawcheck docs plugin`).

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | nothing blocks; warnings are advisory |
| 1 | an error: the code breaks the law |
| 2 | no conclusion: Lawcheck, the law or the setup is broken, and the output names what to fix |

Lawcheck reports a finding of an `enforced` rule in the change as an error. An error makes the run exit 1. Two kinds of finding are warnings: a finding of an `advisory` rule, and each finding of debt, unless you pass `--strict`. A failing run ends with one `next:` line that says what to do next.

Next: [JSON documents](json.md)
