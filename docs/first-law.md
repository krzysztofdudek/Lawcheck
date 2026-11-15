# The first type and the first rule

This page builds a law with one type and one script rule, tries the rule, and turns it on.

## Start the law

Run this at the root of the code you want checked, inside a git work tree:

```text
$ lawcheck init
```

It writes `.lawcheck/law.yaml` and `.lawcheck/.gitignore`, and nothing else. The law has no types yet, so nothing is checked.

## Describe one type

A type says which files are of one kind. Give it `paths` and an `about`. A type matches only the files git lists, so a folder that `.gitignore` names, `node_modules/` or a build folder, is never judged; one that git does not ignore would be:

```yaml
lawcheck: 0.1.0

types:
  source:
    about: Everything that ships.
    paths: ["src/**/*.ts"]
```

Check what a file gets:

```text
$ lawcheck explain src/price.ts
```

## Write one script rule

A rule has an entry in the law and one file. The entry holds its `why`:

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

The file is `.lawcheck/rules/no-console.mjs`. `init` makes no `rules/` folder, so create it first:

```text
$ mkdir -p .lawcheck/rules
```

The file exports `check`, which gets one file at a time and returns findings:

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

The rule reads lines as text and parses no comments, so it also finds `console.log` inside a comment or a string, such as a code example in a doc comment. A rule that must not do that removes comments from the text first. `lawcheck docs script-rules` has the whole contract.

## Try it before a type lists it

`try` runs one rule on files you name. It needs no base and writes nothing in the repository:

```text
$ lawcheck try no-console src/price.ts
$ lawcheck try no-console src/cli/main.ts
```

A file that writes to the terminal gives a finding and exit 1. A file that does not gives `nothing found in 1 file` and exit 0. Try a pattern to see a whole folder:

```text
$ lawcheck try no-console 'src/**/*.ts'
```

## List the rule on the type

Add the rule to the type:

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

From now on, `lawcheck check` judges the changed files of type `source` with this rule.

## See the debt

A plain check judges only the files that differ from the base. The files nobody touched may already break the new rule. To see them:

```text
$ lawcheck check --full --base main
```

What it finds outside the change is listed as debt. Debt is a warning and never fails the run.

## Pay the debt, or start advisory

You have two choices when the debt is large:

- Fix the files the debt lists, then keep the rule `enforced`, the default.
- Start the rule with `status: advisory`. Its findings are warnings everywhere, and the run passes. Make it enforced once the debt is paid.

```yaml
lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.
    status: advisory
```

`lawcheck docs law` describes every key of the law.
