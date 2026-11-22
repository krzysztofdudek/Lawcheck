# A finding you believe is wrong

A check fails on a line that, to you, breaks no rule. Waiving the line makes the build green and leaves the cause in place. These steps find the cause first: the type, the rule, or one line that is a real exception. At the end the rule reads the file right, the one exception carries a waiver with its reason, and no waiver in the repository is left unused.

The outputs below come from a repository whose `main` holds the law of [Bring a law into an existing repository](adopt-in-an-existing-repository.md), with the rule `no-console` enforced on the type `library`. It also holds `src/core/round.ts`, whose comment someone waived:

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

Line 3 is a comment. Line 6 calls `console.warn`, and the pricing team reads that warning.

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

The file is code the commands call, so `library` is right. A file with the wrong type is a fault of the law: change the type's `paths`, add a `!` pattern, or a `content` expression ([Types for an existing project](types-for-a-project.md)).

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

`try` runs one rule on the files you name and writes nothing. The rule gives both findings, so the cause sits in the rule or in the code.

## 4. Choose the fix

| The finding is wrong because | Fix |
|---|---|
| the file has the wrong type | the law |
| the rule misreads lines like this one, in any file | the rule |
| the rule is right, and this one line is an agreed exception | a waiver on that line |

The rule reads line 3, a comment, as a call. That is the rule's fault. Line 6 is a real call the team keeps on purpose: a waiver.

## 5. Fix the rule

`.lawcheck/rules/no-console.mjs` now skips lines that start a comment:

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

Add the marker, the rule's id, `--` and the reason at the end of line 6:

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

The note names the waiver, so whoever reviews the change sees it. [Waivers](waivers.md) has every form of the marker.

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

The older waiver in `src/core/round.ts` covered a comment, and the fixed rule finds nothing there now. `lawcheck check --full --json` lists every waiver of the repository in `waivers`, with its file, line, rule and reason. Its field `waived` counts the findings it dropped, and a 0 there marks a waiver of a script rule that waives nothing ([JSON documents](json.md)).

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

- `waiver-unknown-rule` or `waiver-without-reason`: the marker names no rule of the law, or has no reason after `--`. That waiver waives nothing, and Lawcheck reports it as an error in the change.
- A type with `waivers: false` reads the marker as text, so the finding stays.
- A finding about the whole file has no line, and no waiver covers it. Fix the rule or the law.
- A reviewer rule you believe is wrong: the fail stays cached on this machine. Reword the rule file, then ask again with `lawcheck check --review --again` ([Write a reviewer rule](write-a-reviewer-rule.md)).
