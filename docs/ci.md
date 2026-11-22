# CI and git hooks

A pull request adds `console.log` to `src/core/`, where the law forbids it, and the job below fails with exit 1. It needs the history back to the merge base, and no key: Lawcheck judges reviewer rules from the committed `.lawcheck/verdicts`.

## A CI job

### 1. Install Lawcheck in the project

Keep Lawcheck as a dev dependency, so jobs and hooks run one version:

```text
$ npm install --save-dev lawcheck@alpha
```

Commit `package.json` and the lockfile, if any. Jobs and hooks start it with `npx --no-install lawcheck`, which never downloads a tool. That works with npm, pnpm, Yarn 1, Yarn 4 (`nodeLinker: node-modules` or `pnpm`) and Bun beside Node, not with Yarn Plug'n'Play. The job needs Node 24 and git 2.34 or later, or a command refuses in its first line ([Settings](config.md)).

### 2. Add the workflow

Write `.github/workflows/lawcheck.yml`. It judges a pull request, a merge queue and a push to `main` by the branch's law and again by the base's. With the law below the top of the repository, give the step `working-directory: <the folder that holds .lawcheck>`.

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

The workflow's shell picks the base; Lawcheck takes the one it is given. A push with no earlier commit to compare (a first push, a force-push that removed the "before" commit, a root commit) falls back to the parent commit, then to `--full`: a force-push is judged by its last commit. `persist-credentials: false` keeps the job's token out of `.git/config`, which a script rule can read.

Exit 2 fails the job too, on a broken law or setup. `--json` prints one document for a script that annotates the pull request ([JSON documents](json.md)).

### 3. Install with pnpm or Yarn

`npm install` works with and without a lockfile; `npm ci` fails without one. For pnpm or Yarn 1, replace that step (Yarn 4 takes `yarn install --immutable`):

<!-- example: ci-install-pnpm -->
```sh
pnpm install --frozen-lockfile
```

<!-- example: ci-install-yarn -->
```sh
yarn install --frozen-lockfile
```

### 4. Keep cache folders out of the change

Every file git lists counts, untracked ones included. A cache folder inside the project, such as `.npm/`, counts as changed code. Add it to `.gitignore`, or to `.git/info/exclude` in the job:

```sh
echo .npm/ >> .git/info/exclude
```

### 5. Give the base on another CI service

A plain `lawcheck check` takes `--base`, then `LAWCHECK_BASE`, then `origin/HEAD`, and a CI checkout often has none of them. In a CI job the check then stops before it judges a file:

```text
$ lawcheck check
```

```output
lawcheck: ERROR  1 error

error[base-unreachable]  no base in this CI job: no --base, no LAWCHECK_BASE and no origin/HEAD, and a plain check without one would count every file as changed
  why:  without its base a change cannot be told from debt

next: pass --base origin/<the branch the change goes into> or set LAWCHECK_BASE, with the history fetched (fetch-depth: 0 in actions/checkout, GIT_DEPTH: 0 in GitLab CI, fetchDepth: 0 in Azure Pipelines); or judge every file with lawcheck check --full
```

Set the history setting the `next:` line names for your service, and pass the branch the change goes into:

```text
$ lawcheck check --base origin/main
```

```output
lawcheck: FAIL  1 error in 1 changed file (against origin/main)

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

Lawcheck knows a CI job by `CI`, or by a variable such as `GITHUB_ACTIONS`, `GITLAB_CI` or `TF_BUILD`; `CI=false` or `CI=no` turns that off.

## Reviewer rules in CI

The job of step 2 passes no `--review`, so it calls no reviewer and needs no key. It reads the passes committed in `.lawcheck/verdicts`. A file of a reviewer rule with no pass there fails the job:

```output
lawcheck: FAIL  1 error in 1 changed file (against origin/main)

src/core/refund.ts  error[not-reviewed]  clear-errors has no verdict for this content
  why:  a reviewer rule says nothing about content it has not judged

next: lawcheck check --review --base origin/main  (1 reviewer call)
```

### 1. Record the reviews before you push

On a machine with a reviewer ([Reviewers and keys](providers.md)):

```text
$ lawcheck check --review --base origin/main
```

```output
lawcheck: PASS  1 changed file (against origin/main), 1 reviewer call
```

### 2. Commit the verdicts

Commit `.lawcheck/verdicts` and `.lawcheck/.gitattributes` with the code. The job then passes, and calls no reviewer. It counts those two files as changed files of the pull request:

```output
lawcheck: PASS  3 changed files (against origin/main)
```

[A law shared by a team](team.md) says how these files merge.

## A change to the law

A pull request can change the law that judges it, and pass. On a pull request that takes the rule `no-console` off the type `library` and adds `console.log` to `src/core/total.ts`, the first check of the job prints:

```output
lawcheck: PASS  2 changed files (against origin/main)
note: the law changed in this change; lawcheck check --full --base origin/main shows what it finds in the rest of the code
note: this change edits the law that judges it: takes the rule no-console off the type library
```

The job of step 2 then checks again with the law of the base, and that check fails with exit 1 at `src/core/total.ts:2`. [What a check judges](change.md) lists every change of the law the note names.

On `pull_request` GitHub runs the pull request's own workflow and `package.json`, and a rule of the base reads the pull request's copy of any file outside `.lawcheck/`. A pull request that edits them can skip the second check or change what a rule reads. Lawcheck does not guard these files. On GitHub, a code owner and a required review guard `.lawcheck/` (anyone who can push can write `.lawcheck/verdicts`), `.github/workflows/`, `package.json`, the lockfile, and every file a rule imports or reads. Keep a rule's helpers and settings under `.lawcheck/rules/`, where the second check reads the base's copy.

A pull request that removes a rule and breaks it fails the second check, so land the change of the law first.

## Git hooks

The output below comes from a repository whose law gives `src/core/**` the script rule `no-console`. A hook judges the working tree against the merge base with `origin/main`, never the index: git commits a breach that is staged while the tree holds the clean text (`--staged` is not built). A hook never passes `--review` and cannot catch a loosened law.

### 1. Write the pre-commit hook

`.githooks/pre-commit`:

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

Git does not share `.git/hooks`. Commit `.githooks/`, and run this in each clone:

```text
$ git config core.hooksPath .githooks
```

### 4. Commit a breach

On the branch that adds the hook, with `src/core/total.ts` staged:

```text
$ git commit -m "Add the total"
```

```output
lawcheck: FAIL  1 error in 2 changed files (against origin/main)

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

Git keeps the commit out; a clean one goes through.

### 5. Add the pre-push hook

`.githooks/pre-push`, made executable. A push that only deletes a ref or sends a tag passes. Any other push runs the same check of the working tree, not of the commits pushed, so it misses a breach committed on another branch.

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

A check runs the script rules of the change it judges, so a stranger's pull request brings its own rules. Each rule runs in a Node process started with `--permission`, so it cannot write a file or start a process. It can still read every file under the root, `.env` included, open a network connection, and print what it read into the job's log ([Script rules](script-rules.md) lists the rest).

Run the check only where you would run that change's tests. On GitHub, a fork's pull request gets no secrets on `pull_request`, and `check` needs none. `pull_request_target` would run the fork's script rules with the repository's secrets.

## If it goes wrong

- `base-unreachable` says the clone is shallow, or did not fetch the base branch. Its `next:` line gives the `git fetch` that brings the history.
- `no-git` in a container: another user owns the checkout, and the `next:` line gives the `safe.directory` command, quoted for `sh`.
- A warning stays in the log of a job that passed. Warnings never fail a job.
