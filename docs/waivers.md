# Waivers

A [rule](concepts.md#rule) holds for a whole layer. One line breaks it, for a reason the team accepts. A [waiver](concepts.md#waiver) drops the findings of one rule on one line. Its reason stays in the code beside that line. Add a waiver only when the user agrees.

```ts
console.warn('no campaign'); // lawcheck-waive no-console -- the pricing team reads this warning until 2.0
```

## The form

A waiver is the text `lawcheck-waive <rule id> -- <reason>`, anywhere in a line. Its first word, `lawcheck-waive`, is the marker. Lawcheck reads the lines of a file and parses no comments. The same form works in every language. A marker inside a string counts as well.

- Lawcheck takes the first `lawcheck-waive` in a line as the marker. It reads a second one on the same line as plain text.
- Whitespace, the rule id, whitespace, `--` and the reason follow the marker.
- Lawcheck first cuts a closing `*/` or `-->` off the end of the line. With that cut, `<!-- lawcheck-waive no-console -- reason -->` works.
- The reason is the rest of the line after `--`. Lawcheck trims the whitespace at both ends of it. A waiver needs a reason.
- A type can set `waivers: false` (`lawcheck docs law`). In a file of such a type, Lawcheck reads the marker as plain text.

## The lines a waiver covers

A waiver with a letter or a digit before the marker on its line covers its own line. A line with no letter and no digit before the marker stands alone. A waiver on such a line covers the next line that does not stand alone:

```ts
// lawcheck-waive no-console -- the release script prints its progress
console.log('released');
```

Waivers on several lines that stand alone, one above the other, all cover the line below them. Two waivers of one rule can cover the same line. Then the waiver on the line itself drops the findings. Without a waiver there, the nearest one above drops them. A waiver at the end of a file covers nothing.

A waiver drops every finding of its rule on the line it covers. A finding about the whole file has no line, so no waiver can drop it.

## forbidden-use

A waiver can name the code `forbidden-use` in place of a rule of the law. Such a waiver drops the forbidden uses on the line it covers:

```ts
import '../cli/main.js'; // lawcheck-waive forbidden-use -- the report repeats the banner until 2.0
```

No other code takes a waiver, `uses-not-read`, `not-reviewed` and the three waiver codes below included.

## The three waiver codes

| Code | When | Severity |
|---|---|---|
| `waiver-unknown-rule` | no rule id of the law follows the marker: it is missing, names no rule, or the word runs on, as in `lawcheck-waive-file` | error |
| `waiver-without-reason` | the rule is known, and no `--` follows it, or nothing follows the `--` | error |
| `waiver-unused` | a counted waiver dropped no finding | warning |

A waiver with either of the first two codes waives nothing. Lawcheck reports all three codes at the waiver's line. No waiver can drop them. Outside the change, these findings are [debt](concepts.md#debt). A finding of debt is a warning.

Lawcheck has no waiver for a range of lines or for a whole file. `lawcheck-waive-file`, like any word joined to the marker, is `waiver-unknown-rule`.

A waiver of a [reviewer rule](concepts.md#reviewer-rule) never gets `waiver-unused`, because a recorded pass cannot show what such a waiver dropped. Lawcheck sends the waived lines to the reviewer inside `<waived>`. It drops what the reviewer reports on those lines.

## The count of waivers

Lawcheck counts each waiver that has a known rule and a reason, whether it dropped a finding or not. The first line of `check` counts the waivers of the changed files. Under `--full`, the debt heading counts the waivers of the other files. In JSON, `waivers` lists each waiver with `file`, `line`, `rule`, `reason` and `waived`. `waived` holds the number of findings the waiver dropped.

If a change edits the law and adds a waiver, `check` prints a note that names the waiver (`lawcheck docs change`). `lawcheck explain <path>` lists the counted waivers of a file. `lawcheck try` counts the findings that waivers dropped in its run.

Next: [What a check judges](change.md)
