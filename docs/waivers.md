# Waivers

A [rule](concepts.md#rule) holds for a whole layer. One line breaks it, for a reason the team accepts. A [waiver](concepts.md#waiver) drops the findings of one rule on one line. Its reason sits beside the line. Add a waiver only when the user agrees.

```ts
console.warn('no campaign'); // lawcheck-waive no-console -- the pricing team reads this warning until 2.0
```

## The form

A waiver is the text `lawcheck-waive <rule id> -- <reason>`, anywhere in a line. Its first word, `lawcheck-waive`, is the marker. Lawcheck reads the lines of a file and parses no comments. The same form works in every language. A marker inside a string counts as well.

- Lawcheck takes the first `lawcheck-waive` in a line as the marker. It reads a second one on the same line as plain text.
- Whitespace, the rule id, whitespace, `--` and the reason follow the marker.
- Lawcheck first cuts a closing `*/` or `-->` off the end of the line. With that cut, `<!-- lawcheck-waive no-console -- reason -->` works.
- The reason is the rest of the line after `--`. Lawcheck trims the whitespace at both ends of it. A waiver needs a reason. A reason that holds only whitespace and invisible format characters, such as a zero-width space, counts as no reason.
- A type can set `waivers: false` (`lawcheck docs law`). In a file of such a type, Lawcheck reads the marker as plain text.

## The lines a waiver covers

A waiver with a letter or a digit before the marker on its line covers its own line. A line with no letter and no digit before the marker stands alone. A waiver on such a line covers the next line that does not stand alone:

```ts
// lawcheck-waive no-console -- the release script prints its progress
console.log('released');
```

Waivers on several lines that stand alone, one above the other, all cover the line below them. Two waivers of one rule can cover the same line. Then only one of them drops the findings: the waiver on the line itself, or else the nearest waiver above it. Lawcheck reports each of the others as `waiver-unused` and names the waiver that drops the findings. A waiver at the end of a file covers nothing.

A waiver drops every finding of its rule on the line it covers. No waiver can drop a finding about the whole file, because such a finding has no line.

## forbidden-use

A waiver can name the code `forbidden-use` in place of a rule of the law. Such a waiver drops the `forbidden-use` findings on the line it covers:

```ts
import '../cli/main.js'; // lawcheck-waive forbidden-use -- the report repeats the banner until 2.0
```

The `forbidden-use` finding of an import that spans several lines sits on the first line of the statement. Put the waiver on its own line above the statement, so that it covers that first line:

```ts
// lawcheck-waive forbidden-use -- the report repeats the banner until 2.0
import {
  banner,
} from '../cli/main.js';
```

```python
# lawcheck-waive forbidden-use -- the report repeats the banner until 2.0
from app.cli.main import (
    banner,
)
```

A waiver at the end of the last line, after `} from '../cli/main.js';` or after `)`, covers only that last line. It drops nothing, and Lawcheck reports it as `waiver-unused`.

`forbidden-use` is the one built-in code that takes a waiver. `uses-not-read`, `not-reviewed` and the three waiver codes below take none.

## The three waiver codes

| Code | When | Severity |
|---|---|---|
| `waiver-unknown-rule` | no rule id of the law follows the marker: it is missing, names no rule, or the word runs on, as in `lawcheck-waive-file` | error |
| `waiver-without-reason` | the rule is known, and no `--` follows it, or nothing but whitespace and invisible format characters follows the `--` | error |
| `waiver-unused` | a counted waiver dropped no finding | warning |

A waiver with either of the first two codes waives nothing. Lawcheck reports all three codes at the waiver's line, where no waiver can drop them. Outside the [change](concepts.md#change), Lawcheck reports these findings as warnings, because they are [debt](concepts.md#debt).

Lawcheck has no waiver for a range of lines or for a whole file. Lawcheck reports `lawcheck-waive-file`, like any word joined to the marker, as `waiver-unknown-rule`.

Lawcheck never reports `waiver-unused` for a waiver of a [reviewer rule](concepts.md#reviewer-rule), because a recorded pass cannot show what such a waiver dropped. Lawcheck sends the waived lines to the reviewer inside `<waived>`. It drops what the reviewer reports on those lines.

## The count of waivers

Lawcheck counts each waiver that has a known rule and a reason, whether it dropped a finding or not. The first line of `check` counts the waivers of the changed files. Under `--full`, the debt heading counts those of the other files. In JSON, the list `waivers` holds each waiver with its `file`, `line`, `rule`, `reason`, `waived` and `added`. `waived` holds the number of findings the waiver dropped. `added` is true for a waiver that the change adds.

`check` prints a note about the waivers that the change adds, such as `note: this change adds 1 waiver: no-console at src/core/shipping.ts:1`. The note names up to five of them and counts the rest ([What a check judges](change.md#waivers-a-change-adds)). The Claude Code plugin tells you at the end of a turn in which the agent added a waiver ([The Claude Code plugin](plugin.md#the-end-of-a-turn)). `lawcheck explain <path>` lists the counted waivers of a file. `lawcheck try` counts the findings that waivers dropped in its run.

Next: [What a check judges](change.md)
