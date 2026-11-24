# The first type and the first rule

At the end of this guide, you have a law of one [type](concepts.md#type) and one [script rule](concepts.md#script-rule). A script rule is a JavaScript file of your repository. For each line of your files that breaks the rule, the script returns a [finding](concepts.md#finding). Three steps after `lawcheck init`, `lawcheck check` fails on the line of `src/report.ts` that calls `console.log`.

The outputs below come from a repository with two files on `main`:

- `src/price.ts` writes nothing;
- the first line of `src/report.ts` calls `console.log`.

The `.gitignore` of the repository names `node_modules/`. You work on a branch made from `main`.

## 1. Start the law

Run this in the folder of the code you want checked, inside a git work tree. That folder becomes the [root](concepts.md#law) of the law:

```text
$ lawcheck init
```

```output
lawcheck: created .lawcheck/law.yaml and .lawcheck/.gitignore

Nothing is checked yet: the law has no types.
next: describe your first file type in .lawcheck/law.yaml  (lawcheck docs first-law shows how)
```

`init` writes these two files and nothing else.

## 2. Write the rule file

The rule file goes in `.lawcheck/rules/`. `init` makes no `rules/` folder. You create it in this step:

```text
$ mkdir -p .lawcheck/rules
```

In that folder, write `no-console.mjs`. The name of the file, without `.mjs`, is the id of the rule. Lawcheck calls the exported function `check` once for each file it judges. `check` returns the findings of the file it was given:

<!-- example: first-law-rule -->
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

The rule reads lines as text. It parses no comments. It finds `console.log` inside a comment or a string, such as a code example in a doc comment. To skip those, a rule removes the comments from the text first. [Script rules](script-rules.md) has the whole contract.

Until you add the rule to the law in [Write the law](#_3-write-the-law), a command that reads the law stops with [`rule-file-without-entry`](codes.md#rule-file-without-entry) and exit 2.

## 3. Write the law

Replace the text that `init` put in `.lawcheck/law.yaml` with the whole law, in one edit:

<!-- example: first-law-law -->
```yaml
lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.

types:
  source:
    about: Everything that ships.
    paths: ["src/**/*.ts"]
    rules: [no-console]
```

A rule has an entry in the law and one file. The entry of `no-console`, under `rules`, holds the `why` that Lawcheck prints under every finding of the rule.

A type names the files of one kind. The type `source` has three keys:

- `about` says what its files are;
- `paths` takes its files, here every `.ts` file below `src/`;
- `rules` lists the rules that Lawcheck judges its files against.

A type matches only the files git lists. Lawcheck never judges a folder that `.gitignore` names, such as `node_modules/` or a build folder. It would judge the same folder if git did not ignore it. A file that git already tracks is the exception: it stays listed, and keeps its type, even when `.gitignore` names it.

## 4. Check the file that breaks the rule

`lawcheck check` judges the files of the type `source` against the rule. With a path, it judges the files you name, changed or not:

```text
$ lawcheck check src/report.ts
```

```output
lawcheck: FAIL  1 error in 1 named file

src/report.ts:1  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/report.ts:1
```

The check fails and exits 1. Without a path, `lawcheck check` judges the files that differ from the [base](concepts.md#base). `src/report.ts` is the same as on `main`. So a check against `main` with no path passes. A check with `--full` lists the finding of that file as [debt](concepts.md#debt) ([See the debt](#_6-see-the-debt)).

## 5. See what a file gets

`lawcheck explain` shows the type of a file and the rules that judge it:

```text
$ lawcheck explain src/price.ts
```

```output
src/price.ts
  type:  source  (source)  Everything that ships.
  matched:  source by "src/**/*.ts"
  may use:  any file; no type on the way up has may_use
  rules:
    no-console  script  enforced  from source  Only the command layer writes to the terminal.
  waivers:  none
```

`src/price.ts` has the type `source`. Under `rules`, the line of `no-console` gives its kind, its status, the type it comes from and its `why`.

## 6. See the debt

Without a path, a check judges only the files that differ from the base. The files you did not touch may already break the new rule. With `--full`, Lawcheck judges them too:

```text
$ lawcheck check --full --base main
```

```output
lawcheck: PASS  3 changed files (against main)
note: this change edits the law that judges it: adds .lawcheck/law.yaml; adds .lawcheck/rules/no-console.mjs

debt (outside this change): 1 finding in 1 file
src/report.ts:1  warning[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
```

The three changed files are the new files of `.lawcheck/`. Lawcheck counts them like any other file git lists. The note line says the change edits the law ([What a check judges](change.md)). Lawcheck lists a finding outside the change as debt. Lawcheck prints a finding of debt as a warning. So a finding of debt never fails the run.

## 7. Try the rule on one file

`lawcheck try` runs one rule on the files you name, with no base. It writes nothing in the repository. Try `no-console` on `src/price.ts`:

```text
$ lawcheck try no-console src/price.ts
```

```output
lawcheck: try no-console (script rule, enforced)  nothing found in 1 file
```

`src/price.ts` writes nothing to the terminal. `try` exits 0.

You can run `try` while you write a rule, before any type lists the rule. Until a type lists it, `try` needs a path. Without one, it stops with the error [`usage`](codes.md#usage). The message says that no file has a type that lists the rule.

## 8. Try it on a file that breaks it

```text
$ lawcheck try no-console src/report.ts
```

```output
lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 1 file

src/report.ts:1  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
```

The finding names the file, the line, the rule and its `why`. `try` exits 1.

## 9. Try it on a whole folder

A pattern selects every file it matches. Put the pattern in quotes, so that the shell passes it to Lawcheck as written:

```text
$ lawcheck try no-console 'src/**/*.ts'
```

```output
lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 2 files

src/report.ts:1  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
```

## 10. Fix the debt, or start the rule advisory

Fix `src/report.ts`: take out its call of `console.log`. The default status of a rule is `enforced`. So after the fix, the rule needs no `status` line. If the debt is too large to fix now, give the rule `status: advisory` instead. Lawcheck then prints its findings as warnings in every file. The run passes:

```yaml
lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.
    status: advisory
```

After you fix the debt, delete the `status` line. The rule is then enforced again. [The law file](law.md) describes every key of the law.

## If it goes wrong

- `lawcheck check` passes, and you expected the finding in `src/report.ts`: without a path, a check judges only the changed files. Add `--full`, as in [See the debt](#_6-see-the-debt).
- Lawcheck prints `law-invalid`: the law misspells a key, such as `path` for `paths`. The message names the line and ends with the nearest known key, `(did you mean 'paths'?)`.
- Lawcheck prints `rule-missing-file`: the law names a rule, and `.lawcheck/rules/` holds no file of that name. The file name must be the rule id followed by `.mjs`.
- Lawcheck prints `rule-file-without-entry`: a file in `.lawcheck/rules/` names no rule of the law, as between [Write the rule file](#_2-write-the-rule-file) and [Write the law](#_3-write-the-law). Give the file the rule id as its name, or add an entry for it.
- Lawcheck prints `rule-crashed`: the rule threw an error or returned something other than a list of findings. [Write a script rule](write-a-script-rule.md) shows how to find the cause.
- `lawcheck explain` answers `none: git ignores it, so Lawcheck never sees it`: `.gitignore` names the file, and git does not track it. No type takes such a file. A file that git tracks keeps its type even when `.gitignore` names it.
- `lawcheck try no-console` without a path stops with [`usage`](codes.md#usage): no file has a type that lists the rule yet. Name a file, as in [Try the rule on one file](#_7-try-the-rule-on-one-file).

Next: [Types for an existing project](types-for-a-project.md)
