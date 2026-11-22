# CI and git hooks

A pull request adds `console.log` to `src/core/`. The [law](concepts.md#law) forbids that call there. The job below fails on that call with exit 1. The job needs the git history of the branch back to its merge base with the target branch. It needs no API key, because Lawcheck judges [reviewer rules](concepts.md#reviewer-rule) by the reviews committed in `.lawcheck/verdicts`.

## A CI job

### 1. Install Lawcheck in the project

Keep Lawcheck as a dev dependency of the project. Then every job and every hook runs the same version:

```text
$ npm install --save-dev lawcheck@alpha
```

Commit `package.json`, and the lockfile if the project has one. The jobs and hooks below start Lawcheck with `npx --no-install lawcheck`. That command starts the copy that `npm install` put in `node_modules`, and it downloads none. It works with npm, pnpm, Yarn 1, Yarn 4 (`nodeLinker: node-modules` or `pnpm`) and Bun beside Node, and not with Yarn Plug'n'Play. The job needs Node 24 and git 2.34 or later. On an older Node or git, a command refuses in its first line with `unsupported-environment` ([Supported environments](support.md)).

### 2. Add the workflow

Write `.github/workflows/lawcheck.yml`. The workflow runs on pull requests, merge queues and pushes to `main`. Each run checks the change twice: with the law of the branch, then with the law of the [base](concepts.md#base). When the law sits below the top of the repository, give the step `Check the change` the line `working-directory: <the folder that holds .lawcheck>`.

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

The shell script of the step `Check the change` picks the base and passes it to Lawcheck with `--base`. For a pull request, the base is the target branch under `origin/`. For a merge queue, it is the commit that the queue builds on. For a push, the script picks the base this way:

| The push | The base the script passes |
|---|---|
| a push whose "before" commit is in the clone | that commit |
| a first push of a branch, whose "before" is all zeros | the parent of the last commit |
| a force-push that removed the "before" commit | the parent of the last commit, so a force-push is judged by its last commit |
| a root commit, which has no parent | none: the script runs the check with `--full` |

`persist-credentials: false` keeps the token of the job out of `.git/config`. A [script rule](concepts.md#script-rule) can read that file, so without the setting a rule of the pull request could read the token.

Lawcheck exits with code 2 when it cannot judge the change, as with a law that is not valid (`law-invalid`) or a folder outside git (`no-git`). Exit 2 fails the job the same way as exit 1. With `--json`, Lawcheck prints one JSON document, which a script that annotates the pull request can read ([JSON documents](json.md)).

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

Lawcheck counts every file that git lists, untracked files included. The files of a folder that the job creates therefore count as changed code, unless git ignores the folder. The common case is `node_modules/`. After `npm install` in a project whose `.gitignore` does not name it, the check counts each of its files as a changed file. A cache folder such as `.npm/` counts the same way. Add such a folder to `.gitignore`, or add it to `.git/info/exclude` in the job:

```sh
echo .npm/ >> .git/info/exclude
```

For `node_modules/`, add the line to `.gitignore` and commit it, so every clone and every job leaves the folder out:

```sh
echo node_modules/ >> .gitignore
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

Lawcheck treats a run as a CI job when the variable `CI` is set. Without `CI`, a variable of a CI service, such as `GITHUB_ACTIONS`, `GITLAB_CI` or `TF_BUILD`, marks the run as a job. With `CI=false` or `CI=no`, Lawcheck treats the run as no CI job.

### 6. Give the base on GitLab CI

In a merge request pipeline, GitLab sets `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` to the branch that the merge request goes into. GitLab may fetch the job's own branch alone. The script below fetches the target branch first, then checks against it.

1. In `.gitlab-ci.yml`, give the job the variable `GIT_DEPTH: 0`. GitLab then fetches the whole history into the job.
2. Run the job in merge request pipelines. For that, its `rules` hold `if: $CI_PIPELINE_SOURCE == "merge_request_event"`.
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

The part `#refs/heads/` makes the shell remove that prefix from the value, when the value starts with it.

### 8. Run the job on macOS or Windows

The workflow of step 2 runs on Ubuntu. Its step `Check the change` holds a script for bash.

- On macOS, GitHub runs a script step with bash. The workflow needs no change there.
- On Windows, the default shell of a script step is not bash. Add `shell: bash` to the step `Check the change`. GitHub then runs the script with the bash of Git for Windows.

Lawcheck's tests run this workflow on Linux alone. Lawcheck itself runs on Linux, macOS and Windows ([Supported environments](support.md)).

## Reviewer rules in CI

Without `--review`, the job of step 2 calls no reviewer and needs no API key. It reads the [verdicts](concepts.md#verdict) committed in `.lawcheck/verdicts`. If that file holds no pass for a file that a reviewer rule binds, the check reports `not-reviewed`, and the job fails:

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

Commit `.lawcheck/verdicts` and `.lawcheck/.gitattributes` with the code. The job then passes without a reviewer call. The check counts the two files as changed files of the pull request:

```output
lawcheck: PASS  3 changed files (against origin/main)
```

[A law shared by a team](team.md) says how these files merge.

### 3. Record the reviews in a job instead

`lawcheck check --review` runs in a CI job the same way as on your machine. In a job, it writes `.lawcheck/verdicts` and `.lawcheck/.gitattributes` in the checkout. Lawcheck commits and pushes nothing, so the job does both itself, in the four steps below:

1. Keep the reviewer's API key in a secret of the CI service. Lawcheck reads the key from an environment variable alone ([Reviewers and keys](providers.md)).
2. Give the key to the one step that runs the review. On GitHub, for the provider `anthropic`, the environment of the step sets `ANTHROPIC_API_KEY` from a repository secret of the same name.
3. In that step, run `npx --no-install lawcheck check --review --base "$base"`, with `base` set as in the workflow of step 2.
4. Commit `.lawcheck/verdicts` and `.lawcheck/.gitattributes`. Then push that commit to the branch of the pull request.

The job of step 2 cannot push. Its permissions hold `contents: read`, so its token can read the repository and cannot write to it. `persist-credentials: false` keeps that token out of the checkout. Run the review in a job of its own, whose permissions hold `contents: write`.

GitHub starts no workflow for a push made with the `GITHUB_TOKEN` of a job. The check of step 2 then does not run on the commit with the verdicts, until you push again.

The step with the key runs the copy of Lawcheck that the change's own `package.json` and lockfile install. A pull request can therefore change the program that receives the key. Lawcheck itself passes none of its variables to a script rule, so a script rule cannot read the key from `process.env`.

On `pull_request`, GitHub gives the pull request of a fork no secrets. Record the reviews of such a pull request on a machine, as in step 1.

## A change to the law

A pull request can change the law that judges it. Its first check then passes. Say a pull request takes the [rule](concepts.md#rule) `no-console` off the [type](concepts.md#type) `library` and adds `console.log` to `src/core/total.ts`. The first check of the job prints:

```output
lawcheck: PASS  2 changed files (against origin/main)
note: the law changed in this change; lawcheck check --full --base origin/main shows what it finds in the rest of the code
note: this change edits the law that judges it: takes the rule no-console off the type library
```

The job of step 2 then checks again with the law of the base. That second check fails with exit 1 at `src/core/total.ts:2`. [What a check judges](change.md) lists every change of the law that the note names.

On `pull_request`, GitHub runs the workflow file of the pull request itself. The install step then reads the pull request's own `package.json`. In the second check, a rule of the base reads the pull request's copy of every file outside `.lawcheck/`. A pull request that edits those files can skip the second check, or change what a rule reads. Lawcheck guards none of these files. On GitHub, a required review by a code owner can guard these paths:

- `.lawcheck/`, since a person with push access can write a pass into `.lawcheck/verdicts`;
- `.github/workflows/`;
- `package.json` and the lockfile;
- every file a rule imports or reads.

Keep a rule's helpers and settings under `.lawcheck/rules/`. The second check reads the base's copy of that folder.

A pull request that removes a rule and adds code that the rule forbids fails the second check. Merge the change of the law first, in a pull request of its own.

## Git hooks

The output below comes from a repository whose law gives `src/core/**` the script rule `no-console`. A hook checks the working tree against its merge base with `origin/main`, never the index. The index holds what `git add` staged for the next commit. Git can commit a staged file that breaks the law while the working tree holds the clean text. Lawcheck has no flag for the index: `--staged` is not built.

A hook never passes `--review`. It checks with the law of its own branch, so it cannot catch a loosened law, such as a rule that the same change takes off a type.

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

The hook exits with code 1, and git makes no commit. A commit with no error goes through.

### 5. Add the pre-push hook

Write `.githooks/pre-push`, and make it executable as in step 2. The hook skips each tag that the push sends and each branch that it deletes. For any other push, it runs the check of the working tree, not of the commits pushed. A push may send commits of another branch too. A finding in those commits gets past the hook.

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

A check runs the script rules that its checkout holds. A pull request from a stranger can add rules of its own. Lawcheck starts each rule in a Node process with `--permission`, where the rule cannot write a file or start a process. The rule can still read every file below the folder that holds `.lawcheck/`, `.env` included. On Node 24, it can open a network connection. Node 25 and later refuse that connection under `--permission`. A rule can print what it read into the log of the job ([Script rules](script-rules.md) lists the rest).

Run the check only where you would run the tests of that change. On `pull_request`, GitHub gives the pull request of a fork no secrets. A plain `lawcheck check` needs no secret. The event `pull_request_target` would run the script rules of the fork with the secrets of the repository.

## If it goes wrong

- `base-unreachable` says that the job did not fetch the base branch, or that the clone is shallow. A shallow clone holds only the last commits, without the merge base. The `next:` line gives the `git fetch` command that fetches the history.
- In a container, `no-git` means that another user owns the checkout. Git refuses to work in such a folder. The `next:` line gives the `git config` command that adds the folder to the git setting `safe.directory`. The command quotes the path for `sh`.
- The log of a job that passed shows a warning. A warning leaves the exit code at 0, so the job passes.

Next: [A law shared by a team](team.md)
