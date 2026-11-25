# Findings in the pull request

A job that passes prints its warnings in its log, and nowhere else. A warning leaves the exit code at 0, so GitHub and GitLab show nothing on the pull request.

A plain check prints no debt either. Its text names no finding of a file outside the change, and `summary.debt` of its JSON is 0. With `--full` or `--strict`, `findings` holds the debt with `debt: true`.

A short script turns the `--json` document ([JSON documents](json.md)) into what the service shows on the changed lines.

## 1. Annotate on GitHub

Save this script as `.github/lawcheck-annotations.mjs`. It prints one workflow command for each finding: `error` for a finding that blocks, `warning` for the other findings of the change, and `notice` for debt. It also prints the `next:` line, because `--json` replaces the text output that holds it. The JSON gives each path from the folder that holds `.lawcheck`, so the script asks git for that folder. The annotations then land on the right lines when the law sits below the top.

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

In the script of the step `Check the change` of [the workflow](ci.md#_2-add-the-workflow), define this function first. Then replace each `npx --no-install lawcheck check` line with a call of it: `check_and_annotate --base "$base"`, and `check_and_annotate --full` for the root commit.

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

The function writes the JSON outside the checkout, so the report is not a changed file. A check that ends with exit 2 prints `lawcheck-error/1`, and the script annotates its errors too. GitHub limits the annotations it shows per step and per job. The log keeps every line.

## 2. Report code quality on GitLab

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

The job below extends the job of [Give the base on GitLab CI](ci.md#_6-give-the-base-on-gitlab-ci). It keeps the exit code of the check, and keeps the report as an artifact after an error too. A check that ends with exit 2 has no findings, so the report is an empty list.

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

## 3. Show the findings in GitHub code scanning

In [the workflow](ci.md#_2-add-the-workflow), add `security-events: write` to `permissions`. Add `--sarif "$RUNNER_TEMP/lawcheck.sarif"` to the check with `--full`, and `--full --sarif "$RUNNER_TEMP/lawcheck.sarif"` to the first check with `--base "$base"`. With the base's law alone, both checks with `--base` need them. Code scanning closes every alert that an upload lacks. With `--full`, the SARIF file holds the findings of every file. So this optional recipe makes each run an audit of the whole code. Then add this step ([SARIF 2.1.0](json.md#sarif-2-1-0)):

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

Next: [A law shared by a team](team.md)
