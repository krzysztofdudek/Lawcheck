# Write a script rule

You end with a rule that finds the calls of `fetch()` outside the api layer, built on a helper other rules can import, first as an error and then as a warning.

The outputs below come from a repository with three files under `src/`: `src/api/orders.ts` calls `fetch()`, the second line of `src/core/price.ts` calls it too, and `src/core/tax.ts` does not. The law gives `src/**/*.ts` the type `source`, with the subtypes `api` for `src/api/` and `core` for `src/core/` ([Types for an existing project](types-for-a-project.md)).

## 1. Add the rule to the law

Give the rule an entry under `rules`, with its `why`, and list it on the type whose files it judges:

```yaml
lawcheck: 0.1.0

rules:
  no-fetch:
    why: Only the api layer talks to the network.

types:
  source:
    about: Everything that ships.
    paths: ["src/**/*.ts"]
    types:
      api:
        about: The HTTP handlers.
        paths: ["src/api/**"]
      core:
        about: The business logic.
        paths: ["src/core/**"]
        rules: [no-fetch]
```

## 2. Write a helper the rules share

A file below `.lawcheck/rules/lib/` is no rule, and every rule may import it. Write `.lawcheck/rules/lib/lines.mjs`:

```js
export function linesMatching(files, pattern, message) {
  const findings = [];
  for (const file of files) {
    file.lines.forEach((text, index) => {
      if (pattern.test(text)) findings.push({ line: index + 1, message });
    });
  }
  return findings;
}
```

## 3. Write the rule

The file of the rule is `.lawcheck/rules/no-fetch.mjs`, named by its id. It exports `check`, which gets the files and returns a list of findings:

```js
import { linesMatching } from './lib/lines.mjs';

export function check({ files }) {
  return linesMatching(files, /\bfetch\(/, 'calls fetch outside the api layer');
}
```

A second rule imports `./lib/lines.mjs` in the same way. [Script rules](script-rules.md) says what `check` receives and what a finding holds.

## 4. See the files the rule binds

```text
$ lawcheck explain --rule no-fetch
```

```output
rule no-fetch  script  enforced
  why:  Only the api layer talks to the network.
  file:  .lawcheck/rules/no-fetch.mjs
  on types:  core
  binds:  2 files
    src/core/price.ts
    src/core/tax.ts
```

## 5. Try the rule

Without a path, `lawcheck try` runs a script rule on every file it binds:

```text
$ lawcheck try no-fetch
```

```output
lawcheck: try no-fetch (script rule, enforced)  1 finding in 1 of 2 files

src/core/price.ts:2  error[no-fetch]  calls fetch outside the api layer
  why:  Only the api layer talks to the network.
```

`src/api/orders.ts` calls `fetch()` too, and gets no finding, since `api` does not list the rule.

## 6. Check the code

```text
$ lawcheck check src
```

```output
lawcheck: FAIL  1 error in 3 named files

src/core/price.ts:2  error[no-fetch]  calls fetch outside the api layer
  why:  Only the api layer talks to the network.

next: fix src/core/price.ts:2
```

An enforced rule's finding is an error, and `check` exits 1.

## 7. Make the rule advisory

Give the rule `status: advisory` in its entry:

```yaml
rules:
  no-fetch:
    why: Only the api layer talks to the network.
    status: advisory
```

## 8. Check the code again

```text
$ lawcheck check src
```

```output
lawcheck: PASS  1 warning in 3 named files

src/core/price.ts:2  warning[no-fetch]  calls fetch outside the api layer
  why:  Only the api layer talks to the network.
```

An advisory rule's findings are warnings, and `check` exits 0. Without the `status` line the rule is enforced again.

## 9. Put a typo in the helper

To see a broken rule, write `line` in place of `lines` in the fourth line of `.lawcheck/rules/lib/lines.mjs`:

```js
    file.line.forEach((text, index) => {
```

## 10. Try the broken rule

```text
$ lawcheck try no-fetch
```

```output
lawcheck: ERROR  1 error

.lawcheck/rules/no-fetch.mjs  error[rule-crashed]  throws on src/core/price.ts: Cannot read properties of undefined (reading 'forEach')
  why:  a broken rule says nothing about the code

next: fix .lawcheck/rules/no-fetch.mjs, then run lawcheck try again
```

The error names the file of the rule, though the line that throws is in the helper. The message names the file the call judged, `src/core/price.ts`, and the error the rule threw. A broken rule says nothing about the code, so `try` and `check` exit 2 ([rule-crashed](codes.md#rule-crashed)).

## 11. Fix the helper

Write `lines` again:

```js
    file.lines.forEach((text, index) => {
```

## 12. Try the rule again

```text
$ lawcheck try no-fetch
```

```output
lawcheck: try no-fetch (script rule, advisory)  1 finding in 1 of 2 files

src/core/price.ts:2  warning[no-fetch]  calls fetch outside the api layer
  why:  Only the api layer talks to the network.
```

`try` exits 1 on a finding, an advisory one included.

## If it goes wrong

- `rule-crashed`, and the message says the rule cannot find a package: the rule imports a package no `node_modules` below the root holds. A rule may read nothing outside the root and Lawcheck's folder, so a package a monorepo keeps in a `node_modules` above it does not load. Install the package below the root, or write the code in `.lawcheck/rules/lib/`.
- `rule-crashed`, and the message says the rule passes 30 seconds on a file: one call took longer than 30 seconds. The load has 30 seconds too. Make the rule do less work per file.
- `rules-too-slow`: the script rules of one run took over 600 seconds together. List the rule on fewer types, or narrow their paths.
- `rule-crashed` with `writes` or `reads` and a path: the rule wrote a file or read outside the root, and Lawcheck stopped it. A rule may write no file, and may read no file outside the root and Lawcheck's own folder.
- The rule finds nothing in a file where you expected a finding: the file has no type that lists the rule. `lawcheck explain <path>` shows its rules.
- A plain `lawcheck check` passes on code that breaks a new rule: a plain check judges the changed files only. `lawcheck check --full` lists the rest as debt.

Next: [Write a reviewer rule](write-a-reviewer-rule.md)
