# Waivers

A waiver drops the findings of one rule on one line, with a reason that stays in the code. Add one only when the user agrees.

```ts
console.warn('no campaign'); // lawcheck-waive no-console -- the pricing team reads this warning until 2.0
```

## The form

`lawcheck-waive <rule id> -- <reason>`, anywhere in a line. Lawcheck reads lines and parses no comments, so the same form works in every language.

- The marker is the first `lawcheck-waive` in the line. A second one on the line is text.
- Whitespace, the rule id, whitespace, `--` and the reason follow the marker.
- A closing `*/` or `-->` at the end of the line is cut off first, so `<!-- lawcheck-waive no-console -- reason -->` works.
- The reason is the rest of the line after `--`, trimmed. It is required.
- A file whose type sets `waivers: false` holds no waivers, so a page or a test that writes about waivers can have a type: the marker there is text.

## What it covers

With a letter or a digit before the marker on its line, the waiver covers its own line. Otherwise the line stands alone, and the waiver covers the next line that does not stand alone:

```ts
// lawcheck-waive no-console -- the release script prints its progress
console.log('released');
```

A waiver at the end of a file covers nothing. A waiver drops every finding of its rule on the line it covers. A finding about the whole file has no line and cannot be waived.

## forbidden-use

A waiver may name `forbidden-use` as well as a rule of the law. It drops the forbidden uses on its line:

```ts
import '../cli/main.js'; // lawcheck-waive forbidden-use -- the report repeats the banner until 2.0
```

No other code can be waived: `uses-not-read`, `not-reviewed` and the waiver codes below cannot.

## The three waiver codes

| Code | When | Severity |
|---|---|---|
| `waiver-unknown-rule` | no rule id of the law follows the marker: it is missing, names no rule, or the word runs on, as in `lawcheck-waive-file` | error |
| `waiver-without-reason` | the rule is known, and no `--` follows it, or nothing follows the `--` | error |
| `waiver-unused` | a counted waiver dropped no finding | warning |

A waiver with either of the first two waives nothing. All three sit on the waiver's line and cannot be waived. Outside the change they are debt, so warnings.

A waiver of a reviewer rule is never `waiver-unused`: a recorded pass cannot show what the waiver dropped. Its lines go to the reviewer in `<waived>`, and the reviewer reports nothing on them.

## How waivers are counted

A waiver with a known rule and a reason is counted, used or not. The first line of `check` counts the waivers of the changed files, and the debt heading those of the other files under `--full`. In JSON, `waivers` lists each one with `waived`, the number of findings it dropped.

`lawcheck explain <path>` lists the counted waivers of a file, and `lawcheck try` counts the findings its run waived.
