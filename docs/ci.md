# CI and git hooks

`lawcheck check` needs the history back to the merge base of the branch and its base, and nothing else. It needs no key and no network: reviewer rules are judged from `.lawcheck/verdicts`, which the branch commits.

## Install it in the project

Keep Lawcheck as a dev dependency, so a job and a hook run the version the project pins:

```text
$ npm install --save-dev lawcheck@alpha
```

Commit `package.json`, and the lockfile where the project has one. Jobs and hooks start it with `npx --no-install lawcheck`, which never downloads a tool: a missing install is an error. That works with npm, pnpm and Yarn 1. Yarn Plug'n'Play is not supported (`lawcheck docs config`).

## A CI job

Fetch the whole history, name the base, and judge the change twice, with the branch's law and with the base's (see "A change to the law"). This one runs on a pull request, a merge queue and a push to `main`:

<!-- example: ci-workflow -->
```yaml
name: lawcheck
on:
  pull_request:
  merge_group:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm install
      - name: Check the change
        env:
          EVENT: ${{ github.event_name }}
          BASE_REF: ${{ github.base_ref }}
          MERGE_BASE: ${{ github.event.merge_group.base_sha }}
          BEFORE: ${{ github.event.before }}
        run: |
          case "$EVENT" in
            pull_request) base="origin/$BASE_REF" ;;
            merge_group) base="$MERGE_BASE" ;;
            *)
              base="$BEFORE"
              git rev-parse --verify --quiet "$base^{commit}" > /dev/null || base=$(git rev-parse --verify --quiet HEAD^ || true) ;;
          esac
          if [ -z "$base" ]; then
            npx --no-install lawcheck check --full
            exit
          fi
          npx --no-install lawcheck check --base "$base"
          if [ "$EVENT" != push ] && git cat-file -e "$base:.lawcheck/law.yaml" 2> /dev/null; then
            rm -rf .lawcheck/rules
            git ls-tree -r -z --name-only "$base" -- .lawcheck/law.yaml .lawcheck/rules | xargs -0 git checkout "$base" --
            npx --no-install lawcheck check --base "$base"
          fi
```

`npm install` works with and without a lockfile; `npm ci` fails without one. For pnpm and Yarn 1, replace that step with one of these, and give pnpm a step of its own that installs it, such as `pnpm/action-setup`:

<!-- example: ci-install-pnpm -->
```sh
pnpm install --frozen-lockfile
```

<!-- example: ci-install-yarn -->
```sh
yarn install --frozen-lockfile
```

`persist-credentials: false` keeps the job's token out of `.git/config`: a script rule can read every file under the root, and the checkout would leave the token there. A push with no earlier commit to compare, such as a first push, a force-push that removed the "before" commit or a root commit, falls back to the parent commit, then to `--full`.

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

Exit 1 fails the job on an error in the change. Exit 2 fails it on a broken law or setup; its output names what to fix. `--json` prints one document for a tool to read (`lawcheck docs json`). Warnings appear only in the log, and debt only with `--full`. Run `lawcheck doctor` on a developer's machine, not in the job: it asks for the reviewer's settings, which a job needs none of.

A file a reviewer rule binds that has no verdict is `not-reviewed`, an error. Run `lawcheck check --review` where a reviewer is set up, before you push, and commit `.lawcheck/verdicts`. A contributor with no reviewer leaves that to a maintainer, who runs it on the branch. A job shows a reviewer's findings only where `--review` ran; elsewhere it shows `not-reviewed`.

## A change to the law

In the open mode a pull request can change the law that judges it: take a rule off a type, or make a rule script return nothing, and the same pull request passes. `check` says so under its first line and in `--json`, and its exit code stays (`lawcheck docs change`). The job above catches it: after the check with the branch's law it checks again with the law of the base, taken from git into the working copy, so a pull request has to pass both.

- Protect `.lawcheck/` with a code owner or a required review as well: a change of the law, and of `.lawcheck/verdicts`, which anyone who can push can write, is then somebody's decision.
- A pull request that changes the law and breaks a rule it removes fails the second check. Make that change in two steps: the law first, the code after.
- On `pull_request`, a fork's pull request gets no secrets, and `check` needs none. Never run it on `pull_request_target`: that runs the fork's script rules with the repository's secrets.

## A git pre-commit hook

Lawcheck is a dev dependency, so no `lawcheck` is on the PATH; the hook starts it through `npx`. `.git/hooks/pre-commit`, made executable:

<!-- example: pre-commit-hook -->
```sh
#!/bin/sh
exec npx --no-install lawcheck check --base origin/main
```

The check judges the working tree against the merge base with `origin/main`, so files you changed and did not stage are judged too. A hook never passes `--review`: that would ask the reviewer on every commit. `.git/hooks` is not shared. To share hooks, commit them in a folder such as `.githooks` and run `git config core.hooksPath .githooks` in each clone.

A pre-push hook reads the refs git gives it, so a push that deletes a branch or sends a tag passes:

<!-- example: pre-push-hook -->
```sh
#!/bin/sh
while read -r local_ref local_sha remote_ref remote_sha; do
  case "$local_ref" in refs/heads/*) ;; *) continue ;; esac
  case "$local_sha" in *[!0]*) ;; *) continue ;; esac
  npx --no-install lawcheck check --base origin/main || exit 1
done
```

## Where a check may run

A check runs the repository's script rules. Each is code of the repository, run with the rights of whoever runs the check: it can read any file the user can and open network connections (`lawcheck docs script-rules`). Run `lawcheck check` only where you would run that change's tests, such as a CI job that already runs them.
