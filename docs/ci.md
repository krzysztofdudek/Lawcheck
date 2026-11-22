# CI and git hooks

`lawcheck check` needs the history back to the merge base of the branch and its base, and nothing else. It needs no key and no network: reviewer rules are judged from `.lawcheck/verdicts`, which the branch commits.

## Install it in the project

Keep Lawcheck as a dev dependency, so jobs and hooks run the pinned version:

```text
$ npm install --save-dev lawcheck@alpha
```

Commit `package.json` and the lockfile, if any. Jobs and hooks start it with `npx --no-install lawcheck`, which never downloads a tool. That works with npm, pnpm, Yarn 1, Yarn 4 (`nodeLinker: node-modules` or `pnpm`) and Bun beside Node, not with Yarn Plug'n'Play. The job needs Node 24 and git 2.34 or later, or a command refuses in its first line (`lawcheck docs config`).

## A CI job

Fetch the whole history, name the base, and judge the change twice, by the branch's law and the base's (see "A change to the law"). This runs on a pull request, a merge queue and a push to `main`. With the law below the top of the repository, give the step `working-directory: <the folder that holds .lawcheck>`:

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
          if git cat-file -e "$base:./.lawcheck/law.yaml" 2> /dev/null; then
            echo "Checking again with the law of $base"
            rm -rf .lawcheck/rules
            git ls-tree -r -z --name-only "$base" -- .lawcheck/law.yaml .lawcheck/rules | xargs -0 git checkout "$base" --
            npx --no-install lawcheck check --base "$base"
          fi
```

`npm install` works with and without a lockfile; `npm ci` fails without one. For pnpm (set up by `pnpm/action-setup`) or Yarn 1, replace that step (Yarn 4 takes `yarn install --immutable`):

<!-- example: ci-install-pnpm -->
```sh
pnpm install --frozen-lockfile
```

<!-- example: ci-install-yarn -->
```sh
yarn install --frozen-lockfile
```

`persist-credentials: false` keeps the job's token out of `.git/config`, which a script rule can read. A push with no earlier commit to compare (a first push, a force-push that removed the "before" commit, a root commit) falls back to the parent commit, then to `--full`: a force-push is judged by its last commit.

Always name the base in CI. Without `--base`, Lawcheck takes `LAWCHECK_BASE`, then `origin/HEAD`, and a CI checkout often has neither. In a CI job a plain check that finds no base ends with `base-unreachable`, not with every file judged as changed. Lawcheck knows a CI job by `CI`, or, without it, by the variable of a CI service, such as `GITHUB_ACTIONS`, `GITLAB_CI` or `TF_BUILD`; `CI=false` or `CI=no` turns that off. `lawcheck check --full` judges every file and needs no base.

A shallow clone (`fetch-depth: 1`) has no merge base: the run ends with `base-unreachable`, says the clone is shallow, and its next line gives the `git fetch --unshallow` that brings the history. A clone that fetched one branch says so, with the `git fetch` that brings the base.

Every file git lists counts, untracked ones included, unless git ignores it. A cache folder inside the project, such as `.npm/`, counts as changed code. Add it to `.gitignore`, or to `.git/info/exclude` in the job:

```sh
echo .npm/ >> .git/info/exclude
```

A checkout owned by another user than the job's, as in a container, makes git refuse the repository. The check ends with `no-git`, and its next line gives the command that trusts the folder, `git config --global --add safe.directory <path>`, quoted for `sh`.

Exit 1 fails the job on an error in the change; exit 2, on a broken law or setup, and the output names the fix. `--json` prints one document (`lawcheck docs json`). Warnings appear only in the log, and debt only with `--full`. Run `doctor` on a developer's machine, not in the job.

A file a reviewer rule binds that has no verdict is `not-reviewed`, an error. Run `lawcheck check --review` where a reviewer is set up, before you push, and commit `.lawcheck/verdicts`. A contributor with no reviewer leaves that to a maintainer. A job shows a reviewer's findings only where `--review` ran.

## A change to the law

In the open mode a pull request can change the law that judges it, and pass. `check` says so under its first line and in `--json`, and its exit code stays (`lawcheck docs change`). The job above then checks a second time with the law of the base, taken from git into the working copy; the log says so.

That holds less than it seems. On `pull_request` GitHub runs the pull request's own workflow, `package.json` and lockfile, and a rule of the base reads the pull request's copy of any file outside `.lawcheck/`. A pull request that edits them can skip the second check, point `lawcheck` at another program, or change what a rule reads. Protect with a code owner and a required review: `.lawcheck/`, which holds `.lawcheck/verdicts` that anyone who can push can write, `.github/workflows/`, `package.json`, the lockfile, and every file a rule imports or reads. Keep a rule's helpers and settings under `.lawcheck/rules/`, where the second check reads the base's copy.

- A pull request that changes the law and breaks a rule it removes fails the second check: change the law first.
- A fork's pull request on `pull_request` gets no secrets, and `check` needs none. Never use `pull_request_target`: it runs the fork's script rules with the repository's secrets.

## Git hooks

The hooks start Lawcheck through `npx`, as a dev dependency. A hook judges the working tree against the merge base with `origin/main`, never the index: a breach that is staged while the tree holds the clean text is committed (`--staged` is not built). A hook never passes `--review` and cannot catch a loosened law. `.git/hooks` is not shared: commit hooks in `.githooks` and run `git config core.hooksPath .githooks` in each clone.

`.git/hooks/pre-commit`, made executable:

<!-- example: pre-commit-hook -->
```sh
#!/bin/sh
exec npx --no-install lawcheck check --base origin/main
```

`.git/hooks/pre-push`: a push that only deletes a ref or sends a tag passes. Any other push, `HEAD` included, runs the same check of the working tree, not of the commits pushed: another branch is refused while the tree holds a breach, and a breach committed elsewhere is not seen.

<!-- example: pre-push-hook -->
```sh
#!/bin/sh
while read -r local_ref local_sha remote_ref remote_sha; do
  case "$local_ref" in refs/tags/*) continue ;; esac
  case "$local_sha" in *[!0]*) ;; *) continue ;; esac
  npx --no-install lawcheck check --base origin/main || exit 1
done
```

## Where a check may run

A check runs the repository's script rules. Each is code of the repository, run with the rights of whoever runs the check: it can read any file the user can and open network connections (`lawcheck docs script-rules`). Run `lawcheck check` only where you would run that change's tests, such as a CI job that runs them.
