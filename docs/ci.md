# CI and git hooks

A pull request adds `console.log` to `src/core/`. The [law](concepts.md#law) forbids that call there. The job below fails on it with exit 1. The job needs the git history of the branch back to its merge base with the target branch. It needs no key. Lawcheck judges [reviewer rules](concepts.md#reviewer-rule) by the reviews committed in `.lawcheck/verdicts`.

## A CI job

### 1. Install Lawcheck in the project

Keep Lawcheck as a dev dependency of the project. Then every job and every hook runs the same version:

```text
$ npm install --save-dev lawcheck@alpha
```

Commit `package.json`, and the lockfile if the project has one. The jobs and hooks below start Lawcheck with `npx --no-install lawcheck`, which starts the installed copy and never downloads one. That command works with npm, pnpm, Yarn 1, Yarn 4 (`nodeLinker: node-modules` or `pnpm`) and Bun beside Node, and not with Yarn Plug'n'Play. The job needs Node 24 and git 2.34 or later. On an older Node or git, a command refuses in its first line ([Supported environments](support.md)).

### 2. Add the workflow

Write `.github/workflows/lawcheck.yml`. The workflow runs on pull requests, merge queues and pushes to `main`. Each run checks the change twice: with the law of the branch, then with the law of the [base](concepts.md#base). With the law below the top of the repository, give the step `working-directory: <the folder that holds .lawcheck>`.

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

The shell script of the step `Check the change` picks the base. Lawcheck uses the base that the script passes. For a push, the script picks the base this way:

| The push | The base the script passes |
|---|---|
| a push whose "before" commit is in the clone | that commit |
| a first push of a branch, whose "before" is all zeros | the parent of the last commit |
| a force-push that removed the "before" commit | the parent of the last commit, so a force-push is judged by its last commit |
| a root commit, which has no parent | none: the script runs the check with `--full` |

`persist-credentials: false` keeps the token of the job out of `.git/config`. A [script rule](concepts.md#script-rule) can read that file.

Exit 2 fails the job as well. Lawcheck exits 2 when the law or the setup is broken. A script that annotates the pull request can read the one JSON document that `--json` prints ([JSON documents](json.md)).

### 3. Install with pnpm or Yarn

The workflow runs `npm install`, which works with a lockfile and without one. `npm ci` fails in a project that has no lockfile. For pnpm or Yarn 1, replace the step `npm install` with one of the two lines below. For Yarn 4, the line is `yarn install --immutable`.

<!-- example: ci-install-pnpm -->
```sh
pnpm install --frozen-lockfile
```

<!-- example: ci-install-yarn -->
```sh
yarn install --frozen-lockfile
```

### 4. Keep cache folders out of the change

Lawcheck counts every file that git lists, untracked files included. A cache folder inside the project, such as `.npm/`, then counts as changed code. Add the folder to `.gitignore`, or add it to `.git/info/exclude` in the job:

```sh
echo .npm/ >> .git/info/exclude
```

### 5. Give the base on another CI service

A plain `lawcheck check` takes its base from `--base`, then from `LAWCHECK_BASE`, then from `origin/HEAD`. A CI checkout often has none of the three. In a CI job, the check then stops before it judges a file:

```text
$ lawcheck check
```

```output
lawcheck: ERROR  1 error

error[base-unreachable]  no base in this CI job: no --base, no LAWCHECK_BASE and no origin/HEAD, and a plain check without one would count every file as changed
  why:  without its base a change cannot be told from debt

next: pass --base origin/<the branch the change goes into> or set LAWCHECK_BASE, with the history fetched (fetch-depth: 0 in actions/checkout, GIT_DEPTH: 0 in GitLab CI, fetchDepth: 0 in Azure Pipelines); or judge every file with lawcheck check --full
```

Fetch the history with the setting that the `next:` line names for your CI service. Then pass the branch that the change goes into:

```text
$ lawcheck check --base origin/main
```

```output
lawcheck: FAIL  1 error in 1 changed file (against origin/main)

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

Lawcheck takes a run for a CI job when the variable `CI` is set. Without `CI`, a variable of a CI service marks the job, such as `GITHUB_ACTIONS`, `GITLAB_CI` or `TF_BUILD`. With `CI=false` or `CI=no`, Lawcheck takes the run for no CI job.

### 6. Give the base on GitLab CI

In a merge request pipeline, GitLab sets `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` to the branch that the merge request goes into. Such a job may fetch its own branch alone. The script below fetches the target branch first, then checks against it.

1. In `.gitlab-ci.yml`, give the job the variable `GIT_DEPTH: 0`. The runner then fetches the whole history.
2. Run the job in merge request pipelines: its `rules` hold `if: $CI_PIPELINE_SOURCE == "merge_request_event"`.
3. Give the job this script:

```sh
git fetch origin "+refs/heads/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME:refs/remotes/origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
npx --no-install lawcheck check --base "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
```

### 7. Give the base on Azure Pipelines

In a pull request build, Azure Pipelines sets `System.PullRequest.TargetBranch` to the branch that the pull request goes into. A script reads it as `SYSTEM_PULLREQUEST_TARGETBRANCH`. Its value is `refs/heads/main` for a repository that Azure hosts, and `main` for a GitHub repository.

1. In `azure-pipelines.yml`, give the step `checkout: self` the setting `fetchDepth: 0`. The checkout then fetches the whole history of every branch into `origin/`.
2. Give the job this script:

```sh
npx --no-install lawcheck check --base "origin/${SYSTEM_PULLREQUEST_TARGETBRANCH#refs/heads/}"
```

The part `#refs/heads/` drops that prefix from the value, when the value has it.

### 8. Run the job on macOS or Windows

The workflow of step 2 runs on Ubuntu. The script of its step `Check the change` is written for bash.

- On a macOS runner, GitHub runs a script step with bash. The workflow needs no change there.
- On a Windows runner, the default shell of a script step is not bash. Add `shell: bash` to the step `Check the change`. GitHub then runs the script with the bash of Git for Windows.

The tests of Lawcheck run this workflow on Linux alone. Lawcheck itself runs on macOS and Windows as well ([Supported environments](support.md)).

## Reviewer rules in CI

Without `--review`, the job of step 2 calls no reviewer and needs no key. It reads the [verdicts](concepts.md#verdict) committed in `.lawcheck/verdicts`. If that file holds no pass for a file that a reviewer rule judges, the job fails:

```output
lawcheck: FAIL  1 error in 1 changed file (against origin/main)

src/core/refund.ts  error[not-reviewed]  clear-errors has no verdict for this content
  why:  a reviewer rule says nothing about content it has not judged

next: lawcheck check --review --base origin/main  (1 reviewer call)
```

### 1. Record the reviews before you push

Run the review on a machine that has a reviewer set up ([Reviewers and keys](providers.md)):

```text
$ lawcheck check --review --base origin/main
```

```output
lawcheck: PASS  1 changed file (against origin/main), 1 reviewer call
```

### 2. Commit the verdicts

Commit `.lawcheck/verdicts` and `.lawcheck/.gitattributes` with the code. The job then passes and calls no reviewer. It counts the two files as changed files of the pull request:

```output
lawcheck: PASS  3 changed files (against origin/main)
```

[A law shared by a team](team.md) says how these files merge.

### 3. Record the reviews in a job instead

A CI job can record the reviews in place of a machine, since `check --review` runs in a job as it does on a machine. The run writes `.lawcheck/verdicts` and `.lawcheck/.gitattributes` in the checkout of the job. Lawcheck itself commits and pushes nothing. The job does both, in these steps:

1. Keep the key of the reviewer in a secret of the CI service. Lawcheck takes the key from the environment alone ([Reviewers and keys](providers.md)).
2. Give the key to the one step that runs the review. On GitHub, for the provider `anthropic`, the environment of the step sets `ANTHROPIC_API_KEY` from a repository secret of the same name.
3. In that step, run `npx --no-install lawcheck check --review --base "$base"`, with `base` set as in the workflow of step 2.
4. Commit `.lawcheck/verdicts` and `.lawcheck/.gitattributes`. Then push that commit to the branch of the pull request.

The job of step 2 cannot push. Its token may read the repository and not write to it. `persist-credentials: false` keeps that token out of the checkout as well. Run the review in a job of its own, whose permissions hold `contents: write`.

GitHub starts no workflow for a push made with the `GITHUB_TOKEN` of a job. The check of step 2 then does not run on the commit with the verdicts, until someone pushes again.

The step with the key runs the copy of Lawcheck that the change's own `package.json` and lockfile install. Lawcheck passes none of its variables to a script rule. A script rule cannot read the key from its environment.

On `pull_request`, GitHub gives the pull request of a fork no secrets. Record the reviews of such a pull request on a machine, as in step 1.

## A change to the law

A pull request can change the law that judges it, and then pass its own check. Say a pull request takes the [rule](concepts.md#rule) `no-console` off the [type](concepts.md#type) `library` and adds `console.log` to `src/core/total.ts`. The first check of the job prints:

```output
lawcheck: PASS  2 changed files (against origin/main)
note: the law changed in this change; lawcheck check --full --base origin/main shows what it finds in the rest of the code
note: this change edits the law that judges it: takes the rule no-console off the type library
```

The job of step 2 then checks again with the law of the base. That second check fails with exit 1 at `src/core/total.ts:2`. [What a check judges](change.md) lists every change of the law that the note names.

On `pull_request`, GitHub runs the workflow and the `package.json` of the pull request itself. In the second check, a rule of the base reads the pull request's copy of every file outside `.lawcheck/`. A pull request that edits those files can skip the second check, or change what a rule reads. Lawcheck does not guard these files. On GitHub, a code owner and a required review can guard them:

- `.lawcheck/`, since anyone who can push can write `.lawcheck/verdicts`;
- `.github/workflows/`;
- `package.json` and the lockfile;
- every file a rule imports or reads.

Keep a rule's helpers and settings under `.lawcheck/rules/`. The second check reads the base's copy of that folder.

A pull request that removes a rule and breaks that rule fails the second check. Merge the change of the law first, in a pull request of its own.

## Git hooks

The output below comes from a repository whose law gives `src/core/**` the script rule `no-console`. A hook checks the working tree against its merge base with `origin/main`, never the index. The index holds what `git add` staged for the next commit. Git can commit a staged file that breaks the law, while the working tree holds the clean text. Lawcheck has no flag for the index: `--staged` is not built. A hook never passes `--review`. A hook checks with the law of its own branch. It cannot catch a loosened law, such as a rule taken off a type in the same change.

### 1. Write the pre-commit hook

Write the file `.githooks/pre-commit`:

<!-- example: pre-commit-hook -->
```sh
#!/bin/sh
exec npx --no-install lawcheck check --base origin/main
```

### 2. Make it executable

```text
$ chmod +x .githooks/pre-commit
```

### 3. Make git read the folder

Git does not copy `.git/hooks` into a clone. Commit the folder `.githooks/`, then run this command in each clone:

```text
$ git config core.hooksPath .githooks
```

### 4. Commit a breach

On the branch that adds the hook, stage `src/core/total.ts` and commit it:

```text
$ git commit -m "Add the total"
```

```output
lawcheck: FAIL  1 error in 2 changed files (against origin/main)

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

The hook exits 1, and git makes no commit. A commit that keeps the law goes through.

### 5. Add the pre-push hook

Write `.githooks/pre-push`, and make it executable as in step 2. A push that only deletes a branch or sends a tag passes without a check. Any other push runs the check of the working tree, not of the commits pushed. A commit that breaks the law on another branch, which the push sends as well, gets past the hook.

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

A check runs the script rules of the [change](concepts.md#change) it judges. A stranger's pull request can bring its own. Each rule runs in a Node process that Lawcheck starts with `--permission`, where the rule cannot write a file or start a process. The rule can still read every file below the folder that holds `.lawcheck/`, `.env` included. It can open a network connection, and print what it read into the log of the job ([Script rules](script-rules.md) lists the rest).

Run the check only where you would run the tests of that change. On `pull_request`, GitHub gives the pull request of a fork no secrets. A plain `check` needs none. The event `pull_request_target` would run the script rules of the fork with the secrets of the repository.

## If it goes wrong

- `base-unreachable` says that the clone is shallow, or that the job did not fetch the base branch. A shallow clone holds the last commits alone. The `next:` line gives the `git fetch` command that brings the history.
- `no-git` in a container: another user owns the checkout. Git refuses to work in it. The `next:` line gives the `git config` command that adds the folder to `safe.directory`. The command quotes the path for `sh`.
- A warning shows in the log of a job that passed. A warning never fails a job.

Next: [A law shared by a team](team.md)
