# CI and git hooks

A CI job can run `lawcheck check` on each pull request. A git hook can run it on each commit or push ([Git hooks](#git-hooks)). For example, a pull request adds `console.log` to `src/core/`, where the [law](concepts.md#law) forbids that call. The job below fails on that call with exit 1.

The job needs the git history of the branch back to its merge base with the target branch. It needs no API key, because Lawcheck judges [reviewer rules](concepts.md#reviewer-rule) by the reviews committed in `.lawcheck/verdicts`.

## A CI job

### 1. Install Lawcheck in the project

Keep Lawcheck as a dev dependency of the project. Then every job and every hook runs the same version:

```text
$ npm install --save-dev lawcheck@alpha
```

Commit `package.json`, and the lockfile if the project has one. The jobs and hooks below start Lawcheck with `npx --no-install lawcheck`. It starts the copy that `npm install` put in `node_modules`. It downloads nothing.

`npx --no-install lawcheck` works with npm, pnpm, Yarn 1, Yarn 4 (`nodeLinker: node-modules` or `pnpm`) and Bun beside Node, and not with Yarn Plug'n'Play. The job needs Node 24 and git 2.34 or later. On an older Node or git, a command refuses in its first line with `unsupported-environment` ([Supported environments](support.md)).

### 2. Add the workflow

Write `.github/workflows/lawcheck.yml`. The workflow runs on pull requests, merge queues and pushes to `main`. Each run checks the change twice: with the law of the branch, then with the law of the [base](concepts.md#base). When the law sits below the top of the repository, give the workflow step `Check the change` the line `working-directory: <the folder that holds .lawcheck>`.

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

The script of the step `Check the change` picks the base and passes it with `--base`. On a pull request, `lawcheck check` without `--base` would take the target branch from `GITHUB_BASE_REF` ([Give the base on another CI service](#_5-give-the-base-on-another-ci-service)). A merge queue and a push set no `GITHUB_BASE_REF`. The second check needs the base commit too. For a pull request, the base is the target branch under `origin/`. For a merge queue, it is the commit that the queue builds on. For a push, the script picks the base this way:

| The push | The base the script passes |
|---|---|
| a push whose "before" commit is in the clone | that commit |
| a first push of a branch, whose "before" is all zeros | the parent of the last commit |
| a force-push that removed the "before" commit | the parent of the last commit, so a force-push is judged by its last commit |
| a root commit, which has no parent | none: the script runs the check with `--full` |

`persist-credentials: false` keeps the token of the job out of `.git/config`. A [script rule](concepts.md#script-rule) can read that file. Without the setting, a rule that the pull request adds could read the token.

Lawcheck exits with code 2 when it cannot judge the change, as with a law that is not valid (`law-invalid`) or a folder outside git (`no-git`). Exit 2 fails the job the same way as exit 1.

A team with no [debt](concepts.md#debt) left can add `--strict` to the two `lawcheck check` lines of the script ([`--strict`](commands.md#strict)). A finding of an `enforced` rule in an old file then fails the job too. The branch stays at zero debt.

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

A check counts each new file that git does not ignore as a changed file. A job that creates a folder in the checkout therefore adds its files to the change, unless git ignores the folder.

The common case is `node_modules/`, when `.gitignore` does not name it: after `npm install` the check counts each file in it as changed. A cache folder such as `.npm/` counts the same way. Add such a folder to `.gitignore`, or add it to `.git/info/exclude` in the job:

```sh
echo .npm/ >> .git/info/exclude
```

For `node_modules/`, add the line to `.gitignore` and commit it, so every clone and every job leaves the folder out:

```sh
echo node_modules/ >> .gitignore
```

### 5. Give the base on another CI service

A [check of the change](concepts.md#check-of-the-change) takes its base from `--base`, then from `LAWCHECK_BASE`, then from the variables of the CI service below, then from `origin/HEAD`. Lawcheck reads them only when the service's own variable, such as `GITHUB_ACTIONS`, is set. With `CI` set to `false`, `no`, `0` or `off`, it reads none. The base is `origin/` and the branch name. For Azure Pipelines, Lawcheck first removes the prefix `refs/heads/`.

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

Lawcheck treats a run as a CI job when the variable `CI` is set. Without `CI`, Lawcheck treats the run as a job when a variable of a CI service is set, such as `GITHUB_ACTIONS`, `GITLAB_CI` or `TF_BUILD`. With `CI=false` or `CI=no`, Lawcheck treats the run as no CI job, even when such a variable is set.

### 6. Give the base on GitLab CI

In a merge request pipeline, GitLab sets `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` to the branch that the merge request goes into. GitLab may fetch only the job's own branch. The script below therefore fetches the target branch first. Lawcheck finds the base in the variable, so the check needs no flag.

1. In `.gitlab-ci.yml`, give the job the variable `GIT_DEPTH: 0`. GitLab then fetches the whole history into the job.
2. Run the job in merge request pipelines. Give its `rules` the condition `if: $CI_PIPELINE_SOURCE == "merge_request_event"`.
3. Give the job this script:

```sh
git fetch origin "+refs/heads/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME:refs/remotes/origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
npx --no-install lawcheck check
```

### 7. Give the base on Azure Pipelines

In a pull request build, Azure Pipelines sets `System.PullRequest.TargetBranch` to the branch that the pull request goes into. A script reads it as `SYSTEM_PULLREQUEST_TARGETBRANCH`. Its value is `refs/heads/main` for a repository that Azure hosts, and `main` for a GitHub repository. Lawcheck reads the variable and removes the prefix itself, so the check needs no flag.

1. In `azure-pipelines.yml`, give the step `checkout: self` the setting `fetchDepth: 0`. The checkout then fetches the whole history of every branch into `origin/`.
2. Give the job this script:

```sh
npx --no-install lawcheck check
```

Azure sets the variable only when a branch policy runs the build for the pull request. A build with no such policy has no base, and Lawcheck stops with `base-unreachable`.

### 8. Run the job on macOS or Windows

The workflow `.github/workflows/lawcheck.yml` runs on Ubuntu ([Add the workflow](#_2-add-the-workflow)). Its step `Check the change` holds a script for bash.

- On macOS, GitHub runs a script step with bash. The workflow needs no change there.
- On Windows, the default shell of a script step is not bash. Add `shell: bash` to the step `Check the change`. GitHub then runs the script with the bash of Git for Windows.

Lawcheck itself runs on Linux, macOS and Windows.

## Reviewer rules in CI

Without `--review`, the job you set up in [Add the workflow](#_2-add-the-workflow) calls no reviewer and needs no API key. It reads the [verdicts](concepts.md#verdict) committed in `.lawcheck/verdicts`. A file that the change leaves alone is not asked about. Lawcheck asks for a pass only for a changed file that a reviewer rule [binds](change.md#the-change). A pull request that touches no such file never fails for a missing review. When `.lawcheck/verdicts` holds no pass for such a file, the check reports `not-reviewed`, and the job fails:

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

The job of [Add the workflow](#_2-add-the-workflow) cannot push. Its permissions hold `contents: read`. Its token can read the repository and cannot write to it. `persist-credentials: false` keeps the token out of the checkout. Run the review in a job of its own, whose permissions hold `contents: write`.

GitHub starts no workflow for a push that a job makes with its `GITHUB_TOKEN`. The job of [Add the workflow](#_2-add-the-workflow) therefore skips the commit with the verdicts and runs again on your next push.

The step with the key runs the copy of Lawcheck that the change's own `package.json` and lockfile install. A pull request can therefore change the program that receives the key. Lawcheck passes none of its environment variables to a script rule, so the key is not in the rule's `process.env`.

A pull request of a fork has no secret for that step: see [Pull requests from a fork](#pull-requests-from-a-fork).

### 4. Run doctor on a machine, not in the job

`lawcheck doctor` checks that Lawcheck can call the reviewer: the key of the provider, and for `openai-compatible` the address in `LAWCHECK_REVIEWER_ENDPOINT`. The job of [Add the workflow](#_2-add-the-workflow) reads the committed verdicts and holds neither. In that job `lawcheck check` passes, and `lawcheck doctor` fails with exit 2:

<!-- example: doctor-in-ci -->
```output
fail  reviewer  1 reviewer rule; openai-compatible cannot be called: openai-compatible needs the address of its endpoint in LAWCHECK_REVIEWER_ENDPOINT
  next: set LAWCHECK_REVIEWER_ENDPOINT to the base address of the server, such as http://localhost:8000/v1, then run lawcheck doctor
```

Run `doctor` on your machine after you install Lawcheck and after you change `.lawcheck/config.yaml` ([doctor](commands.md#doctor)). Put it in a job only when that job holds the key and the address, as the job of step 3 does.

## Pull requests from a fork

On `pull_request`, GitHub runs the workflow for a pull request of a fork with a read-only token and no secrets. The job of [Add the workflow](#_2-add-the-workflow) needs no secret, because `lawcheck check` reads the committed verdicts. The job therefore runs for a fork as for a branch of the repository.

Keep the workflow on `pull_request`. The event `pull_request_target` runs in the base repository with its secrets. A job on that event that checks out the fork runs the script rules of the fork with those secrets ([Where a check may run](#where-a-check-may-run)).

### A contributor with no reviewer

When the change touches a file that a reviewer rule binds, the job fails with `not-reviewed`. A contributor without the key of the provider cannot record the review: `lawcheck check --review` needs it. The contributor can leave the pull request failing and say so. A maintainer then records the reviews:

1. Fetch the branch and read the change, `package.json` and the lockfile included. The check of step 2 gives the reviewer's key and `LAWCHECK_SIGNING_KEY` to the Lawcheck that those two files install.
2. On a machine where you would run the tests of the pull request, run `lawcheck check --review --base origin/main`. The check runs the script rules of the fork.
3. Commit `.lawcheck/verdicts` and `.lawcheck/.gitattributes`, and push the commit to the contributor's branch. GitHub allows that when the contributor lets maintainers edit the pull request.

A contributor who has the key records the reviews as [Record the reviews before you push](#_1-record-the-reviews-before-you-push) shows.

### The job trusts the verdicts

`.lawcheck/verdicts` is a file of the pull request. Under a law without `signers`, each line is a pass for the file and rule it names, whoever wrote it and whether a reviewer was asked. A contributor can record the reviews with a reviewer of their own, and the job passes. CI therefore trusts the author of the pull request on reviews, as it does on `.lawcheck/` ([A change to the law](#a-change-to-the-law)).

To stop trusting the author on reviews, name signers in the law ([Signed passes](reviewer-rules.md#signed-passes)). The job then counts only the passes a signer signed. Its second check reads the base's law, so a pull request that adds a signer or drops `signers` fails that check. A maintainer who is a signer records the reviews of a fork as [A contributor with no reviewer](#a-contributor-with-no-reviewer) says. A job that records reviews needs a signing key as a secret and a signer of its own. Anyone who can push a branch can make that job sign a pass.

## Findings in the pull request

A job that passes prints its warnings in its log, and nowhere else. A warning leaves the exit code at 0, so GitHub and GitLab show nothing on the pull request.

A plain check prints no debt either. Its text names no finding of a file outside the change, and `summary.debt` of its JSON is 0. With `--full` or `--strict`, `findings` holds the debt with `debt: true`.

`--json` gives every finding with its file and line ([JSON documents](json.md)). A short script turns that document into what the service shows on the changed lines.

### 1. Annotate on GitHub

Save this script as `.github/lawcheck-annotations.mjs`. It prints one workflow command for each finding: `error` for a finding that blocks, `warning` for the other findings of the change, and `notice` for debt. It also prints the `next:` line, because `--json` replaces the text output that holds it. GitHub places an annotation by its path from the top of the repository. The JSON gives each path from the folder that holds `.lawcheck`. The script asks git for that folder, so the annotations land on the right lines when the law sits below the top.

<!-- example: annotations-script -->
```js
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const data = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const property = (text) => data(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
const folder = execFileSync('git', ['rev-parse', '--show-prefix'], { encoding: 'utf8' }).replace(/\n$/, '');

const document = JSON.parse(readFileSync(0, 'utf8'));
for (const item of document.findings ?? document.errors ?? []) {
  const level = item.blocking === false ? (item.debt ? 'notice' : 'warning') : 'error';
  const properties = [`title=${property(item.code)}`];
  if (item.file) properties.push(`file=${property(folder + item.file)}`);
  if (item.line) properties.push(`line=${item.line}`);
  console.log(`::${level} ${properties.join(',')}::${data(item.message)}`);
}
if (document.next) console.log(`next: ${document.next.text}`);
```

In the script of the step `Check the change`, define this function first. Then replace each `npx --no-install lawcheck check` line with a call of it: `check_and_annotate --base "$base"`, and `check_and_annotate --full` for the root commit.

<!-- example: annotations-step -->
```sh
check_and_annotate() {
  report=$(mktemp)
  status=0
  npx --no-install lawcheck check "$@" --json > "$report" || status=$?
  node "$GITHUB_WORKSPACE/.github/lawcheck-annotations.mjs" < "$report"
  return "$status"
}
```

The function writes the JSON outside the checkout, so the report is not a changed file. A check that ends with exit 2 prints `lawcheck-error/1`, and the script annotates its errors too. GitHub limits the annotations it shows for a step and for a job. The log keeps every line.

### 2. Report code quality on GitLab

Save this script as `scripts/lawcheck-code-quality.mjs`. It writes the format of a GitLab code quality report: one entry for each finding, with a fingerprint that GitLab needs to tell findings apart. A finding for the whole file gets line 1. The script names each file from the top of the repository, as the script for GitHub does.

<!-- example: code-quality-script -->
```js
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const folder = execFileSync('git', ['rev-parse', '--show-prefix'], { encoding: 'utf8' }).replace(/\n$/, '');
const document = JSON.parse(readFileSync(0, 'utf8'));
const report = (document.findings ?? []).map((finding) => ({
  description: `${finding.code}: ${finding.message}`,
  check_name: finding.code,
  fingerprint: createHash('sha256').update(JSON.stringify([finding.code, finding.file, finding.line ?? null, finding.message])).digest('hex'),
  severity: finding.blocking ? 'critical' : finding.debt ? 'info' : 'minor',
  location: { path: folder + finding.file, lines: { begin: finding.line ?? 1 } },
}));
console.log(JSON.stringify(report, null, 2));
```

The job below extends the job of [Give the base on GitLab CI](#_6-give-the-base-on-gitlab-ci). It keeps the exit code of the check, so the job still fails on an error. It keeps the report as an artifact after an error too. A check that ends with exit 2 has no findings, so the report is an empty list.

<!-- example: gitlab-code-quality-job -->
```yaml
lawcheck-quality:
  variables:
    GIT_DEPTH: "0"
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - git fetch origin "+refs/heads/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME:refs/remotes/origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"
    - report=$(mktemp)
    - status=0
    - npx --no-install lawcheck check --json > "$report" || status=$?
    - node scripts/lawcheck-code-quality.mjs < "$report" > gl-code-quality-report.json
    - exit "$status"
  artifacts:
    when: always
    reports:
      codequality: gl-code-quality-report.json
```

### 3. Show the findings in GitHub code scanning

In [the workflow](#_2-add-the-workflow), add `security-events: write` to `permissions`. Add `--sarif "$RUNNER_TEMP/lawcheck.sarif"` to the check with `--full`, and `--full --sarif "$RUNNER_TEMP/lawcheck.sarif"` to the first check with `--base "$base"`. Code scanning closes every alert that an upload lacks. With `--full`, the SARIF file holds the findings of every file. Then add this step ([SARIF 2.1.0](json.md#sarif-2-1-0)):

<!-- example: sarif-upload -->
```yaml
- name: Upload to code scanning
  if: ${{ !cancelled() }}
  uses: github/codeql-action/upload-sarif@v4
  with:
    sarif_file: ${{ runner.temp }}/lawcheck.sarif
    category: lawcheck
```

The upload step runs after exit 1 too. After exit 2, Lawcheck writes no file and the step fails. A private repository needs GitHub Code Security and `actions: read`.

## A change to the law

A pull request can change the law that judges it. The first check of the job judges with that changed law. For example, a pull request takes the rule `no-console` off the [type](concepts.md#type) `library` and adds `console.log` to `src/core/total.ts`. The first check passes and prints:

```output
lawcheck: PASS  2 changed files (against origin/main)
note: the law changed in this change; lawcheck check --full --base origin/main shows what it finds in the rest of the code
note: this change edits the law that judges it: takes the rule no-console off the type library
```

The job of [Add the workflow](#_2-add-the-workflow) then checks again with `--law-from "$base"`. It judges the pull request by the base's law ([`--law-from`](commands.md#law-from-ref)). That second check fails with exit 1 at `src/core/total.ts:2`. [What a check judges](change.md) lists every change of the law that the note names.

On `pull_request`, GitHub runs the pull request's own workflow file. The install step reads the pull request's `package.json`. In the second check, a rule of the base judges the pull request's copy of each file outside the base's law. A pull request that edits those files can skip the second check, or change what a rule reads.

Lawcheck guards none of those files. Under `--law-from`, the check of the base's law is not a security boundary on its own. Lawcheck covers only in part a file system that folds names, such as the older one of macOS. The same holds for Windows, which drops trailing dots and spaces. `.lawcheck/` needs a code owner. On GitHub, a required review by a code owner can guard these paths:

- `.lawcheck/`, since a person with push access can change `.lawcheck/config.yaml` and, under a law without `signers`, write a pass into `.lawcheck/verdicts`;
- `.github/workflows/`;
- `package.json` and the lockfile;
- every file a rule imports or reads.

Keep a rule's helpers and settings under `.lawcheck/rules/`, and import them: the second check loads the base's copy. A file a rule reads by its path, and a package from `node_modules`, come from the pull request. One in `.lawcheck/node_modules` or `.lawcheck/.local` stops the second check with `law-from-packages`.

A pull request that removes a rule and adds code that the rule forbids fails the second check. Merge the change of the law first, in its own pull request.

## Git hooks

A git hook is a script that git runs before a commit or a push. The hooks below run `lawcheck check`. When the check fails, the hook stops the commit or the push. The outputs below come from a repository whose law gives `src/core/**` the script rule `no-console`.

A hook checks the working tree against its merge base with `origin/main`, never the index. The index holds what `git add` staged for the next commit. Git can commit a staged file that breaks the law while the working tree holds the clean text. The hook lets that commit through. Lawcheck has no flag for the index: `--staged` is not built.

A hook never passes `--review`. It checks with the law of its own branch. To catch a loosened law, such as a rule taken off a type, add a second line with `--law-from origin/main`.

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

Make it executable with `chmod +x .githooks/pre-push`.

## Where a check may run

A check runs the script rules that its checkout holds. A pull request from a stranger can add rules of its own. Lawcheck starts each rule in a Node process with `--permission`. In that process, the rule cannot write a file, start a process or open a network connection. It can still do these things:

- read each file below the folder that holds `.lawcheck/`, `.env` included;
- print what it read into the log of the job.

[Script rules](script-rules.md) says what else the process allows and refuses.

The script rules that a pull request holds are code of the pull request. Run its check only on a machine where you would run its tests.

A pull request of a fork runs the same script rules ([Pull requests from a fork](#pull-requests-from-a-fork)).

## If it goes wrong

- Lawcheck prints `base-unreachable` when the job did not fetch the base branch, or when the clone is shallow. A shallow clone holds only the last commits, without the merge base. The `next:` line gives the `git fetch` command for the history.
  Lawcheck writes that command for a POSIX shell. It quotes a remote or branch name that holds a character the shell reads, such as `;` or `$`. For a name that git refuses as a branch name, or that holds a line break, the `next:` line names no branch. It gives `git fetch --unshallow` on a shallow clone, and no command on a full one.
- In a container, `no-git` means that another user owns the checkout. Git refuses to work in such a folder. The `next:` line gives the `git config` command that adds it to the git setting `safe.directory`, with the path quoted for `sh`.

Next: [A law shared by a team](team.md)
