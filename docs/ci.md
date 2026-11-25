# CI and git hooks

A CI job can run `lawcheck check` on each pull request. A git hook can run it on each commit or push ([Git hooks](#git-hooks)). For example, a pull request adds `console.log` to `src/core/`, where the [law](concepts.md#law) forbids that call. The job below fails on that call with exit 1.

The job needs the git history of the branch back to its merge base with the target branch. It needs no API key.

CI judges only the change on purpose, so a pull request shows findings only about what it changes. `--full` is a deliberate audit of the whole code.

## A CI job

### 1. Install Lawcheck in the project

Keep Lawcheck as a dev dependency of the project. Then every job and every hook runs the same version:

```text
$ npm install --save-dev lawcheck@alpha
```

Commit `package.json` and any lockfile. The jobs and hooks below start Lawcheck with `npx --no-install lawcheck`. It starts the copy that `npm install` put in `node_modules` and downloads nothing.

`npx --no-install lawcheck` works with npm, pnpm, Yarn 1, Yarn 4 (`nodeLinker: node-modules` or `pnpm`) and Bun beside Node, and not with Yarn Plug'n'Play. The job needs Node 24 and git 2.34 or later. On an older Node or git, a command refuses in its first line with `unsupported-environment` ([Supported environments](support.md)).

### 2. Add the workflow

Write `.github/workflows/lawcheck.yml`. The workflow runs on pull requests, merge queues and pushes to `main`. As written, it checks the change twice: with the law of the branch, then with the law of the [base](concepts.md#base). Your team [chooses whether to keep both](#the-law-that-judges-a-change). When the law sits below the top of the repository, give the workflow step `Check the change` the line `working-directory: <the folder that holds .lawcheck>`.

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
            npx --no-install lawcheck check --base "$base" --law-from "$base"
          fi
```

The step `Check the change` passes the base with `--base`, since a merge queue and a push set no `GITHUB_BASE_REF`. For a pull request, the base is the target branch under `origin/`. For a merge queue, it is the commit that the queue builds on. For a push, the script picks the base this way:

| The push | The base the script passes |
|---|---|
| a push whose "before" commit is in the clone | that commit |
| a first push of a branch, whose "before" is all zeros | the parent of the last commit |
| a force-push that removed the "before" commit | the parent of the last commit, so a force-push is judged by its last commit |
| a root commit, which has no parent | none: the script runs the check with `--full` |

`persist-credentials: false` keeps the token of the job out of `.git/config`. A [script rule](concepts.md#script-rule) can read that file. Without the setting, a rule that the pull request adds could read the token.

Lawcheck exits with code 2 when it cannot judge the change, as with `law-invalid` or `no-git`. Exit 2 fails the job too.

A team with no [debt](concepts.md#debt) left can add `--strict` to each `lawcheck check` line with `--base` ([`--strict`](commands.md#strict)). A finding of an `enforced` rule in an old file then fails the job too. The branch stays at zero debt.

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

A check counts each new file that git does not ignore as a changed file. After `npm install`, that includes each file in `node_modules/` when `.gitignore` does not name it. A cache folder such as `.npm/` counts the same way. Add such a folder to `.gitignore`, or to `.git/info/exclude` in the job:

```sh
echo .npm/ >> .git/info/exclude
```

For `node_modules/`, add the line to `.gitignore` and commit it, so every clone and every job leaves the folder out:

```sh
echo node_modules/ >> .gitignore
```

### 5. Give the base on another CI service

`--base` chooses which files are the change, and `--law-from` [which law judges them](#the-law-that-judges-a-change). `--law-from` has no default: without it, the law in the checkout judges. `--base` has one: without the flag, a [check of the change](concepts.md#check-of-the-change) takes its base from `LAWCHECK_BASE`, then from the variables of the CI service below, then from `origin/HEAD`. Lawcheck reads those variables only when the service's own variable, such as `GITHUB_ACTIONS`, is set. With `CI` set to `false`, `no`, `0`, `off` or an empty value, it reads none. The base is `origin/` and the branch name. For Azure Pipelines, Lawcheck first removes the prefix `refs/heads/`.

| CI service | Variable | What it holds |
|---|---|---|
| GitHub Actions | `GITHUB_BASE_REF` | the branch that a pull request goes into |
| GitLab CI | `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` | the branch that a merge request goes into |
| GitLab CI | `CI_COMMIT_BEFORE_SHA` | the commit before a push to a branch; Lawcheck skips the value of all zeros that GitLab sets for a new branch and in a merge request pipeline |
| Azure Pipelines | `SYSTEM_PULLREQUEST_TARGETBRANCH` | the branch that a pull request goes into |

GitHub Actions and Azure Pipelines set no variable for the commit before a push. On another service, or on a push in those two, no variable gives the base. Without `--base`, `LAWCHECK_BASE` or `origin/HEAD` either, Lawcheck stops before it judges a file:

```text
$ lawcheck check
```

```output
lawcheck: ERROR  1 error

error[base-unreachable]  no base in this CI job: no --base, no LAWCHECK_BASE, no variable of the CI service for a pull request or push, and no origin/HEAD, and a check of the change without one would count every file as changed
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

Lawcheck treats a run as a CI job when `CI` is set to anything but `false`, `no`, `0`, `off` or an empty value, in any letter case. Without `CI`, a variable of a CI service, such as `GITHUB_ACTIONS` or `TF_BUILD`, marks the job. With `CI` at one of those values, no such variable counts.

### 6. Give the base on GitLab CI

GitLab may fetch only the job's own branch, so the script below fetches the target branch first. In a merge request pipeline, Lawcheck finds the base in `CI_MERGE_REQUEST_TARGET_BRANCH_NAME`, so the check needs no flag.

1. In `.gitlab-ci.yml`, set the variable `GIT_DEPTH: 0`, so GitLab fetches the whole history.
2. Run the job in merge request pipelines. Give its `rules` the condition `if: $CI_PIPELINE_SOURCE == "merge_request_event"`.
3. Give the job this script:

```sh
git fetch origin "+refs/heads/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME:refs/remotes/origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
npx --no-install lawcheck check
```

### 7. Give the base on Azure Pipelines

In a pull request build, `SYSTEM_PULLREQUEST_TARGETBRANCH` holds the target branch, as `refs/heads/main` for a repository that Azure hosts and as `main` for a GitHub one. Lawcheck reads both, so the check needs no flag.

1. In `azure-pipelines.yml`, give the step `checkout: self` the setting `fetchDepth: 0`, so it fetches the whole history of every branch into `origin/`.
2. Give the job this script:

```sh
npx --no-install lawcheck check
```

Azure sets the variable only when a branch policy runs the build for the pull request. A build with no such policy has no base, and Lawcheck stops with `base-unreachable`.

### 8. Run the job on macOS or Windows

The workflow runs on Ubuntu. On macOS too, GitHub runs its step `Check the change` with bash. On Windows, whose default shell is not bash, add `shell: bash` to that step. GitHub then uses the bash of Git for Windows. Lawcheck itself runs on Linux, macOS and Windows.

## Reviewer rules in CI

Without `--review`, the workflow's job calls no reviewer and needs no API key. It reads the [verdicts](concepts.md#verdict) committed in `.lawcheck/verdicts`. A file that the change leaves alone is not asked about. Lawcheck asks for a pass only for a changed file that a reviewer rule [binds](change.md#the-change). When `.lawcheck/verdicts` holds no pass for such a file, the check reports `not-reviewed`, and the job fails:

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

`lawcheck check --review` runs in a CI job as on your machine and writes `.lawcheck/verdicts` and `.lawcheck/.gitattributes` in the checkout. Lawcheck commits and pushes nothing. Set the job up to do both, in four parts:

1. Keep the reviewer's API key in a secret of the CI service. Lawcheck reads the key from an environment variable alone.
2. Give the key to the one workflow step that runs the review. On GitHub, for the provider `anthropic`, the environment of the step sets `ANTHROPIC_API_KEY` from a repository secret of the same name.
3. In that workflow step, run `npx --no-install lawcheck check --review --base "$base"`. Set `base` the way the step `Check the change` of [Add the workflow](#_2-add-the-workflow) sets it.
4. Commit `.lawcheck/verdicts` and `.lawcheck/.gitattributes`. Then push that commit to the branch of the pull request.

The workflow's job cannot push: its permissions hold `contents: read`. Run the review in a job of its own, whose permissions hold `contents: write`.

GitHub starts no workflow for a push that a job makes with its `GITHUB_TOKEN`. The workflow's job therefore skips the commit with the verdicts and runs again on your next push.

The step with the key runs the copy of Lawcheck that the change's own `package.json` and lockfile install. A pull request can therefore change the program that receives the key. Lawcheck passes none of its environment variables to a script rule, so the key is not in the rule's `process.env`.

A pull request of a fork has no secret for that step: see [Pull requests from a fork](#pull-requests-from-a-fork).

### 4. Run doctor on a machine, not in the job

`lawcheck doctor` checks that Lawcheck can call the reviewer: the key of the provider, and for `openai-compatible` the address in `LAWCHECK_REVIEWER_ENDPOINT`. The workflow's job reads the committed verdicts and holds neither. In that job `lawcheck check` passes, and `lawcheck doctor` fails with exit 2:

<!-- example: doctor-in-ci -->
```output
fail  reviewer  1 reviewer rule; openai-compatible cannot be called: openai-compatible needs the address of its endpoint in LAWCHECK_REVIEWER_ENDPOINT
  next: set LAWCHECK_REVIEWER_ENDPOINT to the base address of the server, such as http://localhost:8000/v1, then run lawcheck doctor
```

Run `doctor` on your machine after you install Lawcheck or change `.lawcheck/config.yaml` ([doctor](commands.md#doctor)). Put it in a job only when that job holds the key and the address, as the job of step 3 does.

## Pull requests from a fork

On `pull_request`, GitHub runs the workflow for a pull request of a fork with a read-only token and no secrets. The workflow's job needs no secret, because `lawcheck check` reads the committed verdicts, so it runs for a fork as for a branch of the repository.

Keep the workflow on `pull_request`. The event `pull_request_target` runs in the base repository with its secrets. A job on that event that checks out the fork runs the script rules of the fork with those secrets ([Where a check may run](#where-a-check-may-run)).

### A contributor with no reviewer

When the change touches a file that a reviewer rule binds, the job fails with `not-reviewed`. A contributor without the key of the provider cannot record the review: `lawcheck check --review` needs it. The contributor can leave the pull request failing and say so. A maintainer then records the reviews:

1. Fetch the branch and read the change, `package.json` and the lockfile included. The check of step 2 gives the reviewer's key and `LAWCHECK_SIGNING_KEY` to the Lawcheck that those two files install.
2. On a machine where you would run the tests of the pull request, run `lawcheck check --review --base origin/main`. The check runs the script rules of the fork.
3. Commit `.lawcheck/verdicts` and `.lawcheck/.gitattributes`, and push the commit to the contributor's branch. GitHub allows that when the contributor lets maintainers edit the pull request.

A contributor who has the key records the reviews as [Record the reviews before you push](#_1-record-the-reviews-before-you-push) shows.

### The job trusts the verdicts

`.lawcheck/verdicts` is a file of the pull request. Under a law without `signers`, each line is a pass for the file and rule it names, whoever wrote it and whether a reviewer was asked. CI therefore trusts the author of the pull request on reviews, as it does on `.lawcheck/` ([A change to the law](#a-change-to-the-law)).

To stop trusting the author on reviews, name signers in the law ([Signed passes](reviewer-rules.md#signed-passes)). The job then counts only the passes a signer signed. A check with the base's law reads the base's signers, so a pull request that adds a signer or drops `signers` makes none of its own passes count there ([the choice](#the-law-that-judges-a-change)). A maintainer who is a signer records the reviews of a fork as [A contributor with no reviewer](#a-contributor-with-no-reviewer) says. A job that records reviews needs a signing key as a secret and a signer of its own. Anyone who can push a branch can make that job sign a pass.

## Findings in the pull request

The job prints its findings in its log. [Findings in the pull request](ci-findings.md) has the scripts that show them on the changed lines: annotations on GitHub, a code quality report on GitLab, and GitHub code scanning.

## A change to the law

A pull request can change the law that judges it. For example, one takes the rule `no-console` off the [type](concepts.md#type) `library` and adds `console.log` to `src/core/total.ts`. A check by its own law passes and prints:

```output
lawcheck: PASS  2 changed files (against origin/main)
note: the law changed in this change; lawcheck check --full --base origin/main shows what it finds in the rest of the code
note: this change edits the law that judges it: takes the rule no-console off the type library
```

With `--law-from "$base"`, the base's law judges the change, and the check fails with exit 1 at `src/core/total.ts:2` ([`--law-from`](commands.md#law-from-ref)). [What a check judges](change.md) lists every change of the law that the note names.

### The law that judges a change

Your team chooses one of three. A coding agent that writes this job asks you which first. The last five lines of the step `Check the change` run both checks. For one law alone, replace them with its lines. A root commit still runs with `--full`.

**The change's own law** catches code that breaks the law as the change leaves it, a new rule included. It catches a broken law file, and a broken rule file once the check runs it. It misses a change that loosens the law and breaks the old one: that passes, with a note. A change can also add its own signer, whose passes then count.

<!-- example: ci-law-own -->
```sh
npx --no-install lawcheck check --base "$base"
```

**The base's law** catches both of those misses. It misses a change that adds or tightens a rule and breaks it, on its push to `main` too: the rule judges later changes. It also passes a change that breaks the law file or a rule file. Once a broken law file is merged, every later check by the base's law exits 2, the check of the fix too. The pull request that adds the law has no base law, so these lines check it by its own:

<!-- example: ci-law-base -->
```sh
if git cat-file -e "$base:./.lawcheck/law.yaml" 2> /dev/null; then
  npx --no-install lawcheck check --base "$base" --law-from "$base"
else
  npx --no-install lawcheck check --base "$base"
fi
```

**Both laws**, the workflow as written, fail when either check fails, so each catches what the other misses. They cost a second run.

With a check by the base's law, merge a change that loosens the law first, in its own pull request.

### What no choice guards

On `pull_request`, GitHub runs the pull request's own workflow file. The install step reads the pull request's `package.json`. Under `--law-from`, a rule of the base judges the pull request's copy of each file outside the base's law. A pull request that edits those files can skip that check, or change what a rule reads.

Lawcheck guards none of those files. Under `--law-from`, the check of the base's law is not a security boundary on its own. Lawcheck covers only in part a file system that folds names, such as the older one of macOS. The same holds for Windows, which drops trailing dots and spaces. `.lawcheck/` needs a code owner. On GitHub, a required review by a code owner can guard these paths:

- `.lawcheck/`, since a person with push access can change `.lawcheck/config.yaml` and, under a law without `signers`, write a pass into `.lawcheck/verdicts`;
- `.github/workflows/`;
- `package.json` and the lockfile;
- every file a rule imports or reads.

Keep a rule's helpers and settings under `.lawcheck/rules/`, and import them: under `--law-from`, Lawcheck loads the base's copy. A file a rule reads by its path, and a package from `node_modules`, come from the pull request. One in `.lawcheck/node_modules` or `.lawcheck/.local` stops that check with `law-from-packages`.

## Git hooks

The hooks below run `lawcheck check`. A failed check stops the commit or the push. The outputs below come from a repository whose law gives `src/core/**` the script rule `no-console`.

A hook checks the working tree against its merge base with `origin/main`, never the index. The index holds what `git add` staged for the next commit. Git can commit a staged file that breaks the law while the working tree holds the clean text. The hook lets that commit through. Lawcheck has no flag for the index, and refuses `--staged`.

A hook never passes `--review`. It checks with the law of its own branch. To catch a loosened law, such as a rule taken off a type, add a second line with `--law-from origin/main`.

### 1. Write the pre-commit hook

Write the file `.githooks/pre-commit`:

<!-- example: pre-commit-hook -->
```sh
#!/bin/sh
set -e
npx --no-install lawcheck check --base origin/main
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

Git makes no commit when the hook exits with code 1. A commit with no error goes through.

### 5. Add the pre-push hook

The pre-push hook skips each tag that the push sends and each branch that it deletes. For any other push, it runs the check of the working tree, not of the commits pushed. A push can send the commits of a branch other than the one checked out. The hook does not see a finding in those commits.

Write `.githooks/pre-push`:

<!-- example: pre-push-hook -->
```sh
#!/bin/sh
while read -r local_ref local_sha remote_ref remote_sha; do
  case "$local_ref" in refs/tags/*) continue ;; esac
  case "$local_sha" in *[!0]*) ;; *) continue ;; esac
  npx --no-install lawcheck check --base origin/main || exit 1
done
```

Then run `chmod +x .githooks/pre-push`.

## Where a check may run

A check runs the script rules that its checkout holds. A pull request from a stranger can add rules of its own. Lawcheck starts each rule in a Node process with `--permission`. In that process, the rule cannot write a file, start a process or open a network connection. It can still do these things:

- read each file below the folder that holds `.lawcheck/`, `.env` included;
- print what it read into the log of the job.

[Script rules](script-rules.md) says what else the process allows and refuses.

The script rules that a pull request holds are code of the pull request. Run its check only on a machine where you would run its tests.

## If it goes wrong

- Lawcheck prints `base-unreachable` when the job did not fetch the base branch, or when the clone is shallow and so lacks the merge base. The `next:` line gives the `git fetch` command for the history.
  Lawcheck writes that command for a POSIX shell. It quotes a remote or branch name that holds a character the shell reads, such as `;` or `$`. For a name that git refuses as a branch name, or that holds a line break, the `next:` line names no branch. It gives `git fetch --unshallow` on a shallow clone, and no command on a full one.
- In a container, `no-git` means that another user owns the checkout. Git refuses to work in such a folder. The `next:` line gives the `git config` command that adds it to the git setting `safe.directory`, with the path quoted for `sh`.

Next: [Findings in the pull request](ci-findings.md)
