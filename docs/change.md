# What a check judges

`lawcheck check` judges the files of the [change](concepts.md#change). Old code fails nothing until someone changes it. A law that old code breaks therefore fails no build on the day you add it.

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

With no base, a check on a machine counts every file as changed. The first line of its output says so. In a CI job, a [check of the change](concepts.md#check-of-the-change) with no base stops with `base-unreachable`, with `--review` too. Without a base, the check cannot tell the change from [debt](concepts.md#debt). The `next:` line of that error names `--base`, `LAWCHECK_BASE` and `--full` (`lawcheck docs ci`).

The history of the base has to be in the clone as well. A check in a shallow clone ends as `base-unreachable`. Its `next:` line names the `git fetch` that fixes it.

## The change

The merge base of two commits is the newest commit that both histories hold. Lawcheck finds the merge base of `HEAD` and the base. The change is every file of the working tree that differs from that merge base:

- a file committed on this branch, staged, modified, or new and not ignored, is in the change;
- a deleted file is not;
- a renamed file counts as changed under its new path;
- a change of mode alone counts;
- an edit of a file that you marked `assume-unchanged` or `skip-worktree` in git counts. `git diff` does not show such an edit.

Lawcheck judges each changed file against the rules that bind it. A rule binds a file when the file's type lists the rule, or when a type that the file's type sits under lists it. Lawcheck judges the whole file. An error on a line you did not touch fails the run too.

The git settings of a repository can name programs that git starts while it reads the files. Lawcheck runs git with these programs turned off:

- a `core.fsmonitor` program, which watches the work tree for changes;
- the hooks that git runs at an event such as a commit;
- an external diff program;
- a `textconv` program, which turns a file into text for `git diff`;
- a filter, which changes a file on its way into or out of git.

Settings you pass to git yourself, through `GIT_CONFIG_PARAMETERS` or `git -c` in an alias, take effect. If one of your own settings names a program, git can start that program.

Git reads some files through a filter, such as the files of Git LFS. Lawcheck compares such a file as its bytes on disk. For such a file, git stores other bytes than the ones on disk. So Lawcheck counts the file as changed when its time or size differs from what git's index records. The index is git's staging area. An edit of such a file that keeps its size is in the change when git compares times below the second. Git can also compare whole seconds only. Then an edit that keeps the size, in the same second as git last wrote that file to the index, is not in the change.

## --full and debt

```text
$ lawcheck check --full --base main
```

`--full` is a deliberate audit of the whole code, which you run on purpose. [The CI job](ci.md#_2-add-the-workflow) judges only the change on purpose, so that people see findings only about what they change.

With `--full`, Lawcheck judges every file outside the change as well. The findings in those files are debt. Each finding of debt is a warning, whatever the status of its rule. So without `--strict`, debt never changes the exit code.

Lawcheck prints the debt block after the findings of the change. The block has its own count of findings, files, waivers and unresolved uses. In `--json` each finding of debt has `debt: true`.

With `--strict`, Lawcheck judges every file as `--full` does. A finding of debt is then an error when the same finding inside the change would be one. A finding of an `enforced` rule in an old file is an error. The run then exits 1. A finding of an `advisory` rule stays a warning. So does a finding that is a warning in the change, such as `waiver-unused`. A run can fail only on debt. Its first line then counts the errors in debt apart from the change: `lawcheck: FAIL  3 changed files (against main), 2 errors in debt`. Use `--strict` where a team has paid its debt. Each new breach then turns the branch red until someone fixes it.

## The limits of a plain check

A [plain check](concepts.md#plain-check) calls no reviewer. It judges only the files that differ from the base. Three kinds of change can alter a judgment without changing the file judged:

- a change of the law: `.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a rule file;
- a file whose new text gives it another type: the judgment of each file that uses it can change;
- a file that the language readers consult, such as `tsconfig.json`, `package.json`, `go.mod`, `Cargo.toml`, `composer.json` or a C# project file.

Each of these passes a plain check. Lawcheck judges the files they affect the next time those files change. Only a file in the change fails a plain check with exit 1. A file outside the change can still stop one with exit 2, for example with [type-overlap](codes.md#type-overlap), [file-unreadable](codes.md#file-unreadable), [file-too-large](codes.md#file-too-large), [text-too-large](codes.md#text-too-large), [parser-failed](codes.md#parser-failed) or [link-outside-root](codes.md#link-outside-root).

To judge every file after such a change, run `lawcheck check --full`. Lawcheck lists what it finds outside the change as debt. Debt blocks nothing. `check` and `doctor` say when the change touches the law.

`check` prints two notes when the change touches the law: `.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a file in `.lawcheck/rules/`. This page calls them the law-change notes. `check` prints the first one only without `--full`:

```text
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
note: this change edits the law that judges it: takes the rule no-console off the type library
```

The second note says what the change does to the law that judges it. A pull request can change that law. It can take a rule off a type, or make a script rule return nothing. Such a pull request then passes its own check. The note names each change that Lawcheck finds when it compares the law with the base:

- a type or a rule added or removed;
- a rule made advisory or enforced, taken off a type or put on one;
- a changed `why`, `context`, `about`, `paths`, `content`, `may_use` or `waivers`;
- a `may_use` list that lets a type use more, such as `widens may_use of the type library by command`, or `widens may_use of the type library to any file` when no list is left in force;
- a type whose waivers Lawcheck reads again, such as `reads waivers in the type library`;
- a pattern added to `required` or `ignored`, or taken off one, such as `adds src/gen/** to ignored`;
- a signer added or removed, or the key of a signer changed, such as `adds the signer mallory`;
- a type moved under another parent, or to the top of `types`;
- a file of `.lawcheck/rules/`, or `.lawcheck/config.yaml`, added, removed or changed. The note names such a file by its path and not by what it does.

The note shows five items and the count of the rest. When a change has more than five, the note first shows the items whose words say that the law got looser:

- a rule or a type removed;
- a rule made advisory or taken off a type;
- a `may_use` list widened, and waivers read again in a type;
- a pattern added to `ignored` or taken off `required`, and a pattern that starts with `!` added to `required` or taken off `ignored`;
- a signer added or removed, or the key of a signer changed.

Next come the items that may loosen the law, since their words don't say which way the change went:

- a changed `paths` or `content` of a type;
- a type moved;
- a file of `.lawcheck/rules/` changed or removed;
- a `.lawcheck/law.yaml` that changed where Lawcheck can't read one of its two versions.

A type added comes after them, since a type under another can have its own `may_use` or `waivers`. Every other item comes last. That includes `changes may_use of the type library` and `changes the waivers of the type library`, which Lawcheck writes only for a change that lets the type use or waive nothing more.

In `--json`, `scope.law_changes` lists every item. The note never changes the exit code of the run, whatever it lists. `lawcheck docs ci` gives a job that checks the change a second time with the law of the base.

## The law of the base

`lawcheck check --base main --law-from main` judges the change by the law of `main` ([`--law-from`](commands.md#law-from-ref)). That law is the `.lawcheck/law.yaml`, `.lawcheck/config.yaml` and `.lawcheck/rules/` of `main`. Lawcheck reads them from git. Lawcheck still judges the files of the work tree. The change is the same as without the flag. A change that takes a rule off a type and breaks that rule fails this check with exit 1. The JSON document and the exit codes are those of any check. When the change edits the law, `check` leaves out the first law-change note. The second note names the commit whose law judged the change:

```text
note: this change edits its own law, and the law of main judged it: takes the rule no-console off the type library
```

`lawcheck doctor` reports the change of the law in its `law-change` check. No line of `check` or `doctor` reports the other two kinds of change of [The limits of a plain check](#the-limits-of-a-plain-check): a file that gets another type, and a file that the readers consult.

## Waivers a change adds

A change can also pass its own check by adding a [waiver](concepts.md#waiver) on the line it breaks. `check` prints a note about the waivers that the change adds, under the first line:

```text
note: this change adds 1 waiver: no-console at src/core/shipping.ts:1
```

To find the added waivers, Lawcheck reads each changed file at the merge base of `HEAD` and the base. The law-change notes compare the law with that same commit. Lawcheck compares the waivers of the file at the merge base with those of the file in the work tree, by rule and by reason. The note does not name a waiver that the merge base already holds, even when the change moves it to another line. A file that the change moves to a new path has no waivers at that path in the merge base. So each of its waivers counts as added. The note shows five waivers and the count of the rest. In `--json`, each item of `waivers` has `added` ([JSON documents](json.md)). The note never changes the exit code.

Lawcheck names only the waivers it counts: those with a known rule and a reason, in a file whose type reads waivers. A marker in a file that no type takes waives nothing. The note leaves such a marker out. When a change puts a file under `ignored` to hide it from the law, the second law-change note names the pattern.

## Files you name

`lawcheck check <path or pattern>...` judges the files you name, changed or not, and no others. This form needs no base. It runs in CI, and in a repository with no commit.

Lawcheck reads each path and pattern relative to the folder you run it in. A folder selects its files at any depth. A path that selects nothing, such as a missing file, a file that git does not track and `.gitignore` names or a binary file, adds nothing to the run. The root is the folder that holds `.lawcheck/`. A path outside the root stops the run with the error [`usage`](codes.md#usage). Write a file whose name starts with `-` with `./` before it, as in `./-x.ts`.

This form prints no debt, no law-change note and no note of added waivers. It takes one flag, `--json`. In this form, `not-reviewed` and `too-large-to-review` are warnings. So a missing review never makes this form exit 1. The Claude Code plugin checks files this way (`lawcheck docs plugin`).

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | nothing blocks; warnings are advisory |
| 1 | an error: the code breaks the law |
| 2 | no conclusion: Lawcheck, the law or the setup is broken, and the output names what to fix |

Lawcheck reports a finding of an `enforced` rule in the change as an error. An error makes the run exit 1. Two kinds of finding are warnings: a finding of an `advisory` rule, and each finding of debt, unless you pass `--strict`. A failing run ends with one `next:` line that says what to do next.

Next: [JSON documents](json.md)
