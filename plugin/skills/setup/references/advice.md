# Advice on the architecture

Read this file only when the user asked for advice. The advice is at most three things the code does not hold today, each with its evidence and its bill, written to `.lawcheck/advice.md`. It changes no law until the user says yes to one item. What the skill says under "The rules of a proposal" and "Measure for a proposal" holds for every line.

## 1. What you start from

- The law in `.lawcheck/law.yaml`, and what `lawcheck prime` prints of it.
- The table of uses between types. When this session wrote the law, take the table of the page's step 5. Otherwise measure it again: the candidate is the law with `may_use` naming only the type itself on every type, subtypes included, as in step 5 of the page.
- The debt: what `lawcheck check --full --base HEAD` lists outside the change. A use the law already forbids is law, not advice.
- The written rules that the page's step 2 finds, each with its file and line.
- The list "could be tightened later", when this session wrote the law.
- An existing `.lawcheck/advice.md`. Never propose an item under its `Declined` again. Measure each of its open items again before you keep it.

## 2. What can be a candidate

A candidate is a boundary the law could add, or a script rule. Its evidence is one of six kinds:

- `written`: a rule that someone wrote in the repository, found by the page's step 2, that the law does not hold yet. Its words are quoted with the file and line.
- `direction`: a use against the main direction between two types, such as 40 files one way and 2 the other.
- `cycle`: two types that use each other.
- `few`: a use between two types that three files or fewer make.
- `mixed`: a type whose files fall into two groups by the types they use, so one `may_use` list cannot describe both. Find it in `$KEEP/report.json` of the measurement: list the types each file of the type uses. As law, it is a split into two subtypes, each with its own list.
- `convention`: a pattern that at least nine in ten files of a type keep, and a few break, such as a header, a suffix of the name, or a call that no other file of the type makes. As law, it is a script rule.

These are never candidates:

- a boundary in a language whose uses Lawcheck cannot read, shown as `not read:` in the measurement;
- a use that the law already forbids;
- a reviewer rule;
- a rule that a script cannot judge from the file's text, its syntax tree or its uses;
- an item the user declined.

## 3. Pick at most three

Take `written` first, because the team already decided it. Then the smallest bill: the fewest files that break the boundary, against the number of files that already keep it. Give three more only when the user asks for more, never one that is already in the file.

## 4. The bill of each

- A boundary: measure the law with that one change as the candidate. The rows that the law of today did not have are its bill: the files, the uses, and each use by file and line.
- A script rule: write it as the page's step 8 says, and count its findings as "Measure for a proposal" counts a rule that is not law yet.
- Then the lines of law it adds, and the way of the page's part "A boundary the code already breaks" that fits. A boundary that a few files break fits "Forbid it now", with their count as debt. A boundary that many files break fits "Make the exception visible". A rule with findings starts as `status: advisory`.

## 5. The file

Write `.lawcheck/advice.md` after the last measurement, when no candidate is in place:

````markdown
# Advice for the law of this repository

Written by a coding agent on <date>, at commit <commit>, with Lawcheck <version>. Nothing in this file is law: `lawcheck check` reads none of it. An item becomes law when you say yes to that item.

## 1. <the boundary or the rule, in one sentence>

- Evidence (<kind>): <file:line and the words quoted, or the measured counts>
- Today: <N> uses in <M> files: <file:line, ...>
- As law: <the lines of `law.yaml`, and for a rule its file `.lawcheck/rules/<id>.mjs`>
- If you accept: <the way, and what happens to the <M> files>

## Declined

- <the item in one sentence>: <the user's reason>
````

The items are numbered from 1. Keep the `Declined` part of an earlier file as it was, and add to it. Leave the part out while it is empty.

## 6. Tell and ask

Give each item in two sentences of plain words: what it would forbid, and what it costs today. Then ask one question: which of them to make law now, with "none" as an answer. With the question tool, let the user pick several.

- **On a yes to an item.** Make it law through the page's parts "A boundary the code already breaks" and "Prove each restriction bites", then run `lawcheck check --full --base HEAD`, which exits 0. Take the item out of the file and number the rest again. When the file then holds no item and nothing declined, delete it.
- **On a no to an item.** Move it under `Declined`, with the user's reason in the user's words, or "no reason given".
- **No answer about an item.** It stays in the file as it is.
- **No one will answer**, and the user said so: write the file, list its items in the final message, and change no law.

## 7. The final message

It stands on its own. It gives each item with its counts, what became law, what the user declined, and where the file is. It says that nothing in the file is law, and that the user decides whether to commit the file or delete it. It offers no target.
