# Bring a law into an existing repository

Your code already breaks the [rule](concepts.md#rule) you are about to write. `lawcheck check` without `--full` passes the [change](concepts.md#change) that adds the [law](concepts.md#law). That change touches no file outside `.lawcheck/`. The next change that edits an old file then fails, on a line its author did not touch.

## Start the rule enforced or advisory

A rule is enforced unless its entry says `status: advisory`. An enforced rule fits when the old code holds few findings of the rule. `lawcheck check --base main` passes the change that adds the law, because that change holds only the files of `.lawcheck/`. Lawcheck fails no run on the old code until a change edits an old file. Lawcheck then fails that change on every finding in the file, on old lines as much as on new ones. Its author fixes them in the same change.

An advisory rule fits when the old code holds many findings of the rule, or when other people edit the old files before you can fix them. The findings of an advisory rule are warnings. A warning never fails a change. The steps below take this path, from the advisory rule to the enforced one:

- the rule starts as advisory;
- `lawcheck check --full` lists the old [findings](concepts.md#finding) as [debt](concepts.md#debt);
- you fix the debt;
- you make the rule enforced.

A [`may_use`](law.md#may-use) list has no advisory status. The section [Bring in a may_use list](#bring-in-a-may-use-list) says how to close one on old code that breaks it.

The outputs below come from a repository whose `main` holds four files:

- `src/core/report.ts` calls `console.log` on line 2;
- `src/core/tax.ts` calls `console.warn` on line 2;
- `src/core/price.ts` writes nothing;
- `src/cli/main.ts` is the command layer.

## 1. Start the law on a branch

```text
$ git checkout -b law
$ lawcheck init
```

```output
lawcheck: created .lawcheck/law.yaml and .lawcheck/.gitignore

Nothing is checked yet: the law has no types.
next: describe your first file type in .lawcheck/law.yaml  (lawcheck docs first-law shows how)
```

## 2. Write the law with an advisory rule

Write `.lawcheck/law.yaml` with two [types](concepts.md#type): `library` for `src/core/` and `command` for `src/cli/`. With `status: advisory`, the findings of the rule are warnings. A warning never fails a run:

```yaml
lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.
    status: advisory

types:
  library:
    about: Code the commands call.
    paths: ["src/core/**"]
    rules: [no-console]
  command:
    about: The command layer.
    paths: ["src/cli/**"]
```

## 3. Write the rule

The rule is a [script rule](concepts.md#script-rule). Create the folder `.lawcheck/rules/`. In it, write `no-console.mjs` ([The first type and the first rule](first-law.md) explains it):

```js
export function check({ files }) {
  const findings = [];
  for (const file of files) {
    file.lines.forEach((text, index) => {
      const call = text.match(/\bconsole\.(\w+)/);
      if (call) findings.push({ line: index + 1, message: `writes to the terminal with console.${call[1]}` });
    });
  }
  return findings;
}
```

## 4. Check the branch

```text
$ lawcheck check --base main
```

```output
lawcheck: PASS  3 changed files (against main)
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
note: this change edits the law that judges it: adds .lawcheck/law.yaml; adds .lawcheck/rules/no-console.mjs
```

The change holds the three files of `.lawcheck/`. Lawcheck judges none of the old code.

## 5. List the debt

```text
$ lawcheck check --full --base main
```

```output
lawcheck: PASS  3 changed files (against main)
note: this change edits the law that judges it: adds .lawcheck/law.yaml; adds .lawcheck/rules/no-console.mjs

debt (outside this change): 2 findings in 2 files
src/core/report.ts:2  warning[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
src/core/tax.ts:2  warning[no-console]  writes to the terminal with console.warn
```

With `--full`, Lawcheck judges every other file too. Lawcheck lists a finding outside the change as debt. A finding of debt is a warning, whatever the status of the rule. The run passes, unless you pass `--strict`, which makes a finding of an `enforced` rule in old code an error. `--json` gives the count of debt in `summary.debt`. It marks each finding of debt with `"debt": true` ([JSON documents](json.md)).

## 6. Merge the law

The page leaves out the lines that git prints:

```text
$ git add .lawcheck
$ git commit -m "A law: only the command layer writes to the terminal"
$ git checkout main
$ git merge law
```

## 7. Change an old file

Start a new branch with `git checkout -b unit`. Add a line to `src/core/report.ts`:

```ts
export function report(total: number): void {
  console.log('total', total);
}

export const unit = 'EUR';
```

```text
$ lawcheck check --base main
```

```output
lawcheck: PASS  1 warning in 1 changed file (against main)

src/core/report.ts:2  warning[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
```

The old line 2 is part of the change, because Lawcheck judges a changed file whole. Its finding is a warning, as the rule is advisory. The run passes.

## 8. Pay the debt

Remove the `console` calls from the files of `library`. `src/core/report.ts`:

```ts
export function report(total: number): string {
  return 'total ' + total;
}

export const unit = 'EUR';
```

`src/core/tax.ts`:

```ts
export function tax(cents: number): number {
  return Math.round(cents * 0.2);
}
```

```text
$ lawcheck check --full --base main
```

```output
lawcheck: PASS  2 changed files (against main)

debt (outside this change): none
```

## 9. Make the rule enforced

On the same branch, delete the line `status: advisory` from the law. A rule without `status` is enforced:

```yaml
lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.

types:
  library:
    about: Code the commands call.
    paths: ["src/core/**"]
    rules: [no-console]
  command:
    about: The command layer.
    paths: ["src/cli/**"]
```

```text
$ lawcheck check --base main
```

```output
lawcheck: PASS  3 changed files (against main)
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
note: this change edits the law that judges it: makes the rule no-console enforced
```

From the merge of this change on, a `console` call in a changed file of `src/core/` fails the run with exit 1.

## Bring in a may_use list

A `may_use` list has no `status`. A use that the list forbids is a [`forbidden-use`](codes.md#forbidden-use), and in a changed file it is an error. A list put on a type whose old files already break it fails the next change of each of those files. Bring the list in with these steps:

1. On a branch, add the list to the law and run `lawcheck check --full`. Each `forbidden-use` in the debt is an old use that the list forbids.
2. Put the list first on the types whose files hold none of those findings. From the merge on, a new use that breaks the list fails its change.
3. On a type with old uses that the list forbids, put a waiver with its reason on each of those lines, such as `import '../cli/main.js'; // lawcheck-waive forbidden-use -- the report prints the banner until 2.0`. Then put the list on that type. Every use that a change adds is judged, and the old ones pass.
4. Pay the waivers back one at a time. Remove the use, then its waiver. A waiver left on a line whose use is gone is [`waiver-unused`](codes.md#waiver-unused).

In `lawcheck check --full --json`, the list `waivers` holds every waiver of the repository, so the waivers of `forbidden-use` left in it are what the list still owes. [Waivers](waivers.md#forbidden-use) gives the form of a waiver.

## If it goes wrong

A rule enforced from the start fails the first change that edits `src/core/report.ts`. The run fails on line 2, though the change left that line as it was:

```output
lawcheck: FAIL  1 error in 1 changed file (against main)

src/core/report.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/report.ts:2
```

- A CI job with no [base](concepts.md#base) stops with [`base-unreachable`](codes.md#base-unreachable), because without a base Lawcheck cannot tell the change from debt. On a pull request in GitHub Actions, GitLab CI or Azure Pipelines, Lawcheck takes the base from the service's variables. On any other service, pass `--base`, or set `LAWCHECK_BASE` ([CI and git hooks](ci.md)).
- For every old file that a [reviewer rule](concepts.md#reviewer-rule) [binds](concepts.md#rule), Lawcheck lists a [`not-reviewed`](codes.md#not-reviewed) finding as debt. The reviewer is the model that judges a reviewer rule. `lawcheck check --full --review` asks the reviewer about each of those files, with one call per file and rule. The setting `reviewer.max_calls` caps the calls of one run. A run that needs more calls than the cap makes none.

Next: [Lawcheck in Claude Code](claude-code.md)
