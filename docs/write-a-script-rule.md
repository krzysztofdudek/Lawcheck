# Write a script rule

You end with a [script rule](concepts.md#script-rule) that finds the calls of `fetch()` outside the api layer. The rule calls code from a helper module that other rules can import. At first, its finding is an error. A later step makes it a warning.

The outputs below come from a repository with three files under `src/`:

- `src/api/orders.ts` calls `fetch()`;
- the second line of `src/core/price.ts` calls `fetch()` too;
- `src/core/tax.ts` makes no such call.

Step 13 adds a fourth file.

The law gives `src/**/*.ts` the type `source`. Its subtypes are `api` for `src/api/` and `core` for `src/core/` ([Types for an existing project](types-for-a-project.md)).

## 1. Add the rule to the law

Give the rule an entry under `rules`, with its `why`. List the rule on the type whose files it judges:

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

Lawcheck reads no file below `.lawcheck/rules/lib/` as a rule. Every rule may import such a file. Write `.lawcheck/rules/lib/lines.mjs`:

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

The file of the rule is `.lawcheck/rules/no-fetch.mjs`, as the name of a rule file is the id of its rule. It exports `check`. Lawcheck calls that function with the files of the rule. The function returns a list of findings:

```js
import { linesMatching } from './lib/lines.mjs';

export function check({ files }) {
  return linesMatching(files, /\bfetch\(/, 'calls fetch outside the api layer');
}
```

A second rule imports `./lib/lines.mjs` in the same way. [Script rules](script-rules.md) says what `check` receives and what a finding holds.

## 4. See the files the rule binds

A rule [binds](concepts.md#rule) the files of the types that list it.

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

Without a path, `lawcheck try` runs a script rule on every file it binds: here, the two files of `core`. A rule that no type lists binds no file. For such a rule, `try` needs a path. Without a path, `try` stops with the error [`usage`](codes.md#usage) before it runs the rule. Run it without a path:

```text
$ lawcheck try no-fetch
```

```output
lawcheck: try no-fetch (script rule, enforced)  1 finding in 1 of 2 files

src/core/price.ts:2  error[no-fetch]  calls fetch outside the api layer
  why:  Only the api layer talks to the network.
```

`src/api/orders.ts` calls `fetch()` too. It gets no finding, since `api` does not list the rule.

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

The finding of an enforced rule is an error. `check` exits 1.

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

The findings of an advisory rule are warnings. `check` exits 0. Without the `status` line, the rule is enforced again.

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

The error names the file of the rule, though the line that throws is in the helper. Its message names `src/core/price.ts` and the error that the rule threw. `try` and `check` exit 2, because a broken rule says nothing about the code ([rule-crashed](codes.md#rule-crashed)).

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

## 13. Read the syntax tree

The rule reads lines, so it also reports `fetch(` in a comment or a string. Add `src/core/cart.ts`, whose first line is a comment:

```ts
// Orders reach the network through fetch() in src/api, never here.
export async function total() {
  return (await fetch('/cart')).json();
}
```

The rule of step 3 reports line 1 and line 3 of this file. Write `.lawcheck/rules/no-fetch.mjs` again. This time it reads the [syntax tree](script-rules.md#the-syntax-tree) of the file and reports only a call whose function is `fetch`:

```js
export async function check({ files: [file] }) {
  const { root } = await file.tree();
  if (root === null) return [];
  const findings = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    const callee = node.type === 'call_expression' ? node.children.find((child) => child.field === 'function') : undefined;
    if (callee && file.text.slice(callee.start, callee.end) === 'fetch') findings.push({ line: node.line, message: 'calls fetch outside the api layer' });
    stack.push(...node.children);
  }
  return findings;
}
```

A comment is a node of type `comment`, so the rule never reports it. A file with no tree, such as a file in a language Lawcheck does not read, gets no finding. The rule no longer imports `./lib/lines.mjs`, and another rule can still import it.

```text
$ lawcheck try no-fetch
```

```output
lawcheck: try no-fetch (script rule, advisory)  2 findings in 2 of 3 files

src/core/cart.ts:3  warning[no-fetch]  calls fetch outside the api layer
  why:  Only the api layer talks to the network.
src/core/price.ts:2  warning[no-fetch]  calls fetch outside the api layer
```

The finding in `src/core/cart.ts` is on line 3, the call. Line 1, the comment, has none.

## If it goes wrong

- Lawcheck prints `rule-crashed`, and the message says the rule cannot find a package: the rule imports a package that no `node_modules` below the [root](concepts.md#law) of the law holds. Lawcheck lets a rule read files only below the root and in the folder of Lawcheck. A rule cannot load a package from a `node_modules` above the root, where a monorepo can keep it. Install the package below the root, or write the code in `.lawcheck/rules/lib/`.
- Lawcheck prints `rule-crashed`, and the message says the rule passes 30 seconds on a file: one call of `check` on one file took longer than 30 seconds. The load of the rule module has its own limit of 30 seconds. Make the rule do less work per file.
- Lawcheck prints `rules-too-slow`: the script rules of one run took over 600 seconds together. List the rule on fewer types, or narrow their paths.
- Lawcheck prints `rule-crashed` with `writes` or `reads` and a path: the rule wrote a file, or read outside the root. Lawcheck stopped it. A rule may write no file. It may read no file outside the root and the folder of Lawcheck.
- The rule finds nothing in a file where you expected a finding: the file has no type that lists the rule. `lawcheck explain <path>` shows its rules.
- `lawcheck try no-fetch` stops with [`usage`](codes.md#usage): no file has a type that lists the rule. Name the files, or list the rule on a type as in [Add the rule to the law](#_1-add-the-rule-to-the-law).
- `lawcheck check` without a path passes on code that breaks a new rule: without a path or `--full`, it judges the changed files only. `lawcheck check --full` lists the rest as debt.

Next: [Write a reviewer rule](write-a-reviewer-rule.md)
