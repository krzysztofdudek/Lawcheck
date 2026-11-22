# A finding you believe is wrong

A check fails on a line that you believe breaks no [rule](concepts.md#rule). A [waiver](concepts.md#waiver) on the line would make the build green and leave the cause in place. These steps find the cause first: the [type](concepts.md#type), the rule, or one line that is a real exception. At the end:

- the rule reads the file right;
- the one exception carries a waiver with its reason;
- each waiver left in the repository drops a [finding](concepts.md#finding).

The outputs below come from a repository whose `main` holds the [law](concepts.md#law) of [Bring a law into an existing repository](adopt-in-an-existing-repository.md). In that law, the type `library` has the rule `no-console`, enforced. The branch `main` holds `src/core/round.ts` as well, where someone put a waiver on a comment:

```ts
/**
 * lawcheck-waive no-console -- the example in this comment prints nothing
 * Example: console.log(round(2.5)) prints 3.
 */
export function round(value: number): number {
  return Math.round(value);
}
```

On a branch made from `main`, you added `src/core/format.ts`:

```ts
/**
 * Formats cents as euros.
 * Example: console.log(format(250)) prints 2.50.
 */
export function format(cents: number): string {
  if (cents < 0) console.warn('a negative amount reached format');
  return (cents / 100).toFixed(2);
}
```

## 1. Read the finding

```text
$ lawcheck check --base main
```

```output
lawcheck: FAIL  2 errors in 1 changed file (against main)

src/core/format.ts:3  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
src/core/format.ts:6  error[no-console]  writes to the terminal with console.warn

next: fix src/core/format.ts:3
```

The finding on line 3 points at a comment. Line 6 calls `console.warn`. The pricing team reads that warning.

## 2. Check the type

```text
$ lawcheck explain src/core/format.ts
```

```output
src/core/format.ts
  type:  library  (library)  Code the commands call.
  matched:  library by "src/core/**"
  may use:  any file; no type on the way up has may_use
  rules:
    no-console  script  enforced  from library  Only the command layer writes to the terminal.
  waivers:  none
```

The file holds code that the commands call. `library` is the right type for it. A file with the wrong type is a fault of the law. Fix it in the law: change the `paths` of the type, add a `!` pattern, or add a `content` expression ([Types for an existing project](types-for-a-project.md)).

## 3. Check the rule alone

```text
$ lawcheck try no-console src/core/format.ts
```

```output
lawcheck: try no-console (script rule, enforced)  2 findings in 1 of 1 file

src/core/format.ts:3  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
src/core/format.ts:6  error[no-console]  writes to the terminal with console.warn
```

`try` runs one rule on the files you name. It writes nothing. The rule gives both findings by itself. The cause is in the rule or in the code.

## 4. Choose the fix

| The finding is wrong because | Fix |
|---|---|
| the file has the wrong type | the law |
| the rule misreads lines like this one, in any file | the rule |
| the rule is right, and this one line is an agreed exception | a waiver on that line |

The rule reads line 3, a comment, as a call. The fix for line 3 goes into the rule. Line 6 is a real call that the team keeps on purpose. The fix for line 6 is a waiver.

## 5. Fix the rule

Change `.lawcheck/rules/no-console.mjs` so that it skips the lines that start a comment:

```js
export function check({ files }) {
  const findings = [];
  for (const file of files) {
    file.lines.forEach((text, index) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(text)) return;
      const call = text.match(/\bconsole\.(\w+)/);
      if (call) findings.push({ line: index + 1, message: `writes to the terminal with console.${call[1]}` });
    });
  }
  return findings;
}
```

```text
$ lawcheck try no-console src/core/format.ts
```

```output
lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 1 file

src/core/format.ts:6  error[no-console]  writes to the terminal with console.warn
  why:  Only the command layer writes to the terminal.
```

## 6. Waive the one line

At the end of line 6, add the marker `lawcheck-waive`, the id of the rule, `--` and the reason:

```ts
/**
 * Formats cents as euros.
 * Example: console.log(format(250)) prints 2.50.
 */
export function format(cents: number): string {
  if (cents < 0) console.warn('a negative amount reached format'); // lawcheck-waive no-console -- the pricing team reads this warning until 2.0
  return (cents / 100).toFixed(2);
}
```

```text
$ lawcheck check --base main
```

```output
lawcheck: PASS  2 changed files (against main), 1 waiver
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
note: this change edits the law that judges it: changes .lawcheck/rules/no-console.mjs; adds a waiver of no-console in src/core/format.ts
```

The note names the waiver. The person who reviews the [change](concepts.md#change) sees the waiver there. [Waivers](waivers.md) shows every form of the marker.

## 7. Find the waivers that waive nothing

```text
$ lawcheck check --full --base main
```

```output
lawcheck: PASS  2 changed files (against main), 1 waiver
note: this change edits the law that judges it: changes .lawcheck/rules/no-console.mjs; adds a waiver of no-console in src/core/format.ts

debt (outside this change): 1 finding in 1 file, 1 waiver
src/core/round.ts:2  warning[waiver-unused]  the waiver of 'no-console' drops no finding
  why:  a waiver that drops nothing would hide the next finding on its line
```

The older waiver in `src/core/round.ts` covered a comment, where the fixed rule finds nothing. Lawcheck reports [`waiver-unused`](codes.md#waiver-unused) for it. That file lies outside the change, so the finding shows as a warning of [debt](concepts.md#debt).

`lawcheck check --full --json` lists every waiver of the repository in `waivers`, with its file, line, rule and reason. The field `waived` of a waiver counts the findings it dropped. On a waiver of a [script rule](concepts.md#script-rule), a 0 there marks a waiver that waives nothing ([JSON documents](json.md)).

## 8. Remove it

Delete line 2 of `src/core/round.ts`:

```ts
/**
 * Example: console.log(round(2.5)) prints 3.
 */
export function round(value: number): number {
  return Math.round(value);
}
```

```text
$ lawcheck check --full --base main
```

```output
lawcheck: PASS  3 changed files (against main), 1 waiver
note: this change edits the law that judges it: changes .lawcheck/rules/no-console.mjs; adds a waiver of no-console in src/core/format.ts

debt (outside this change): none
```

## If it goes wrong

- [`waiver-unknown-rule`](codes.md#waiver-unknown-rule) or [`waiver-without-reason`](codes.md#waiver-without-reason): the marker names no rule of the law, or it has no reason after `--`. Such a waiver waives nothing. Lawcheck reports it as an error in the change.
- In a type with `waivers: false`, Lawcheck reads the marker as plain text. The finding stays.
- A finding about the whole file has no line. Lawcheck has no waiver for a whole file. Fix the rule or the law.
- A [reviewer rule](concepts.md#reviewer-rule) failed a file you believe is right. Lawcheck keeps the failed review on this machine. `lawcheck check --review --again` sends the file to the reviewer once more. After you reword the rule file, `lawcheck check --review` reviews the file again without `--again` ([Write a reviewer rule](write-a-reviewer-rule.md)).

Next: [A slow check](slow-check.md)
