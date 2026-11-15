# CI and git hooks

`lawcheck check` needs the history back to the merge base of the branch and its base, and nothing else. It needs no key and no network: reviewer rules are judged from `.lawcheck/verdicts`, which the branch commits.

## A CI job

Fetch enough history for the merge base, and name the base. Here Lawcheck is one of the project's dev dependencies:

```yaml
name: lawcheck
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npx lawcheck check --base origin/${{ github.base_ref }}
```

Always name the base in CI. Without `--base`, Lawcheck takes `LAWCHECK_BASE`, then `origin/HEAD`, and a CI checkout often has neither. In a CI job a plain check that finds no base ends with `base-unreachable` and says so, instead of judging every file as changed. Lawcheck knows a CI job by the variable `CI`, or, without it, by the variable of a CI service, such as `GITHUB_ACTIONS`, `GITLAB_CI` or `TF_BUILD`; `CI=false` or `CI=no` turns that off. `lawcheck check --full` judges every file and needs no base.

A shallow clone (`fetch-depth: 1`) has no merge base, and the run ends with `base-unreachable`. Its message says that the clone is shallow, and its next line gives the `git fetch --unshallow` that brings the history. A clone that fetched one branch says so too, with the `git fetch` that brings the base.

Every file git lists counts, untracked ones included, unless git ignores it. A cache folder inside the project, such as `.npm/` for a GitLab cache, then counts as changed code. Add the folder to `.gitignore`, or to `.git/info/exclude` in the job:

```sh
echo .npm/ >> .git/info/exclude
```

A job whose checkout belongs to another user than the one it runs as, as in a container, makes git refuse the repository. The check ends with `no-git`, and its next line gives the command that tells git to trust the folder, `git config --global --add safe.directory <path>`, quoted for `sh`, the shell of a Linux job.

The same job as commands:

```text
$ lawcheck check --base origin/main
$ lawcheck check --base origin/main --json
```

Exit 1 fails the job on an error in the change. Exit 2 fails it on a broken law or setup; its output names what to fix. `--json` prints one document for a tool to read (`lawcheck docs json`).

A file a reviewer rule binds that has no verdict is `not-reviewed`, an error. Run `lawcheck check --review` where a reviewer is set up, before you push, and commit `.lawcheck/verdicts`.

## A git pre-commit hook

`.git/hooks/pre-commit`, made executable:

```sh
#!/bin/sh
exec lawcheck check --base main
```

The check judges the working tree against the merge base with `main`, so files you changed and did not stage are judged too.

## Where a check may run

A check runs the repository's script rules. Each is code of the repository, run with the rights of whoever runs the check: it can read any file the user can and open network connections (`lawcheck docs script-rules`). Run `lawcheck check` only where you would run that change's tests, such as a CI job that already runs them.
