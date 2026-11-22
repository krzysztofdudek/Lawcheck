# The first type and the first rule

You end with a law of one type and one script rule, and `lawcheck try` and `lawcheck check` show the line of `src/report.ts` that breaks the rule.

The outputs below come from a repository whose `main` holds `src/price.ts`, a file that writes nothing, and `src/report.ts`, whose first line calls `console.log`, with `node_modules/` in `.gitignore`. You work on a branch made from `main`.

## 1. Start the law

Run this at the root of the code you want checked, inside a git work tree:

```text
$ lawcheck init
```

```output
lawcheck: created .lawcheck/law.yaml and .lawcheck/.gitignore

Nothing is checked yet: the law has no types.
next: describe your first file type in .lawcheck/law.yaml  (lawcheck docs first-law shows how)
```

`init` writes these two files and nothing else.

## 2. Describe one type

A type names the files of one kind. Write this into `.lawcheck/law.yaml`, in place of what `init` put there: one type, its `paths` and an `about`:

<!-- example: first-law-type -->
```yaml
lawcheck: 0.1.0

types:
  source:
    about: Everything that ships.
    paths: ["src/**/*.ts"]
```

A type matches only the files git lists, so a folder that `.gitignore` names, `node_modules/` or a build folder, is never judged; one that git does not ignore would be.

## 3. See what a file gets

```text
$ lawcheck explain src/price.ts
```

```output
src/price.ts
  type:  source  (source)  Everything that ships.
  matched:  source by "src/**/*.ts"
  may use:  any file; no type on the way up has may_use
  rules:  none
  waivers:  none
```

The file has the type `source` and no rule yet.

## 4. Add the rule to the law

A rule has an entry in the law and one file. Add the entry under `rules`, with its `why`. Lawcheck prints the `why` under every finding of the rule:

<!-- example: first-law-entry -->
```yaml
lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.

types:
  source:
    about: Everything that ships.
    paths: ["src/**/*.ts"]
```

## 5. Make the rules folder

The rule's file goes in `.lawcheck/rules/`. `init` makes no `rules/` folder, so create it:

```text
$ mkdir -p .lawcheck/rules
```

## 6. Write the rule file

Write `.lawcheck/rules/no-console.mjs`. The name of the file is the id of the rule. The file exports `check`, which gets one file at a time and returns findings:

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

The rule reads lines as text and parses no comments, so it also finds `console.log` inside a comment or a string, such as a code example in a doc comment. A rule that must not do that removes comments from the text first. [Script rules](script-rules.md) has the whole contract.

## 7. Try the rule on one file

`lawcheck try` runs one rule on the files you name. It needs no base, writes nothing in the repository, and works before a type lists the rule:

```text
$ lawcheck try no-console src/price.ts
```

```output
lawcheck: try no-console (script rule, enforced)  nothing found in 1 file
```

`src/price.ts` writes nothing to the terminal, so `try` exits 0.

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

A pattern selects every file it matches. Put it in quotes, so the shell passes it to Lawcheck as written:

```text
$ lawcheck try no-console 'src/**/*.ts'
```

```output
lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 2 files

src/report.ts:1  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
```

## 10. List the rule on the type

Add `rules` to the type:

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

From now on `lawcheck check` judges the changed files of type `source` with the rule.

## 11. See the debt

A plain check judges only the files that differ from the base. The files nobody touched may already break the new rule. `--full` judges them too:

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

The three changed files are the new files of `.lawcheck/`: a file git lists counts, the law's own included, and the note line says the change edits the law ([What a check judges](change.md)). A finding outside the change is debt. Debt is a warning and never fails the run.

## 12. Fix the debt, or start the rule advisory

Fix `src/report.ts`, so it no longer calls `console.log`, and keep the rule `enforced`, the default. If the debt is too large to fix now, give the rule `status: advisory` instead. Its findings are then warnings everywhere, and the run passes:

```yaml
lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.
    status: advisory
```

Make the rule enforced again once the debt is paid: delete the `status` line. [The law file](law.md) describes every key of the law.

## If it goes wrong

- `lawcheck check` passes, and you expected the finding in `src/report.ts`: a plain check judges only the changed files. Add `--full`, as in step 11.
- `law-invalid`: a key of the law is misspelled, such as `path` for `paths`. The message names the line and ends with the nearest known key, `(did you mean 'paths'?)`.
- `rule-missing-file`: the law names a rule, and `.lawcheck/rules/` holds no file of that name. The file name must be the rule id followed by `.mjs`.
- `rule-file-without-entry`: a file in `.lawcheck/rules/` names no rule of the law. Give the file the rule id as its name, or add an entry for it.
- `rule-crashed`: the rule threw an error or returned something other than a list of findings. [Write a script rule](write-a-script-rule.md) shows how to find the cause.
- `lawcheck explain` answers `none: git ignores it, so Lawcheck never sees it`: the file is in `.gitignore`, so no type takes it.
