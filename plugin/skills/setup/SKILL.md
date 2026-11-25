---
name: setup
description: Writes the first Lawcheck law of this repository from the code as it is, and asks the user before it forbids a use the code already makes. When the user asks, it also writes advice on the architecture, or a target architecture with a plan, as a proposal beside the law that becomes law only item by item on the user's yes. Only the user starts it, by typing /lawcheck:setup.
disable-model-invocation: true
---

# Set up Lawcheck

## Start

Read the words the user typed with the command and before it, and pick the row of "What the user asked for" below. Ask no question about which row.

Run `lawcheck docs agent-setup`, in every row. That page is the procedure of the first law, and the files of advice and of a target use its parts. It comes with the Lawcheck that runs here, so it matches the commands. Say nothing about advice or a target before that page and the measurements it asks for have run.

- The shell finds no `lawcheck`: give the user the two ways to install it, and let the user choose and run one. `npm install --global lawcheck@alpha` puts one program on this machine, for every repository. `npm install --save-dev lawcheck@alpha` pins the version in this project's `package.json`, for the whole team and CI; then run each `lawcheck` as `npx --no-install lawcheck`, and write `runner: npx` into `.lawcheck/config.yaml` after `lawcheck init`. End the turn. When the user says it is installed, go on with what the user first asked for. Never ask the user to type the command or the request again.
- Lawcheck answers that it has no topic `agent-setup`: the installed Lawcheck is older than this plugin. Tell the user to update it with the command of the way it was installed, and stop.

Every message to the user follows the page's part "The words for the user". The page's steps 3 and 10 may ask the user questions. Such a message stops after the last question, with no next step. The final message carries the next step.

## What the user asked for

| The user | Do |
|---|---|
| types `/lawcheck:setup` alone, or asks for a law, with no law here | the page, all of it |
| asks for advice: what could be better, what to tighten, recommendations, or types `advice` | with no law here, the page first, all of it; then [the advice](references/advice.md) |
| asks for a target architecture, a redesign, a plan to rebuild, or says where the code should get to, or types `target` | with no law here, the page first, all of it; then [the target](references/target.md) |
| asks for advice and for a target | the page when no law is here, then the advice, then the target |
| types `/lawcheck:setup` alone, or asks for a law, and a law is already here | say that the law stands and that `lawcheck prime` says how to change it, and stop |
| asks to make an item of `.lawcheck/advice.md` or a step of `.lawcheck/target.md` law | the page's step 1 up to `lawcheck prime`, then what the file of the advice or the target says to do on a yes, for that item or step alone |

The user's words count in any language, and so do the words typed after the command.

With a law already here, the advice and the target start from the law that stands. Do the page's step 1 up to `lawcheck prime`, then its step 2, and go to the file of the advice or the target. The page's other steps do not run.

With no law here, the advice or the target starts only after the four checks of the page's step 11 hold. When step 10 asked questions, that is after the user answered them. The final message then holds everything that step 11 lists and what the file of the advice or the target says to tell. Its next step is still to commit `.lawcheck/law.yaml` and the rule files.

With advice or a target asked, the final message has no list "could be tightened later". Its lines become candidates of the advice, or lines of the target's `Later`. The user sees at most five suggestions in the whole conversation: the questions of the page's steps 7 and 8 and the items of the advice count together.

With a law already here, the final message still opens with the labels **The law** and **Debt** of the page's step 11, for the law that stands, so the user can tell the law from the proposal.

With both asked, the target starts after the user answered the question of the advice, so an item the user accepted is already law when the target starts from it.

Read a file of `references/` only for the row that names it.

## No offer at the end

No final message offers advice, a target or another run of the skill. The user asks for them in their own words, by typing `/lawcheck:setup` again.

A line that says how to make an item or a step of a proposal file law is no offer, because the file already holds that item.

## The rules of a proposal

Advice and a target are proposals. They hold in every line of both:

- A proposal is a file beside the law, `.lawcheck/advice.md` or `.lawcheck/target.md`. Lawcheck reads neither. Its first paragraph says that a coding agent wrote it, the date, the commit (`git rev-parse --short HEAD`), the Lawcheck version, and "Nothing in this file is law."
- Every item names its evidence, of one kind: `written`, `direction`, `cycle`, `few`, `mixed` or `convention`, with the file and line and the words quoted, or with the measured counts. In a target, also `aim`: the user's words, quoted. The name of a pattern, such as "layers", "hexagonal" or "clean architecture", is never evidence. What the files do is.
- Every count of files and uses comes from a measurement, as "Measure for a proposal" below says. Never count uses by reading the imports yourself.
- An item becomes law only on the user's yes to that item. Then it goes through the page's parts "A boundary the code already breaks" and "Prove each restriction bites", and `lawcheck check --full --base HEAD` exits 0. An accepted item leaves the file, because the law holds it from then on. A yes to a whole proposal writes no law.
- When the code gives no ground, say so in one sentence and write no file.
- Change no file outside `.lawcheck/`. Until the user says yes to an item, change in `.lawcheck/` only the proposal file and what this session's run of the page wrote. The page's part "Never" holds here too.
- Commit nothing. The user decides whether the proposal stays in git as the team's plan, or goes.

## Measure for a proposal

Each `lawcheck check --full` here is a deliberate audit of the whole code, run on purpose to count or prove a candidate law. It is no step for each later change, and no step of CI.

Make the temporary folder and save `uses.mjs` in it as the page's part "Measure a law that is not in force" says. Save this script there once, as `$KEEP/total.mjs`:

```js
let text = '';
for await (const chunk of process.stdin) text += chunk;
const report = JSON.parse(text);
if (report.schema !== 'lawcheck-check/0') process.exit(2);
const uses = report.findings.filter((finding) => finding.code === 'forbidden-use');
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
console.log(`total: ${count(uses.length, 'use')} in ${count(new Set(uses.map((finding) => finding.file)).size, 'file')}`);
```

Write the candidate into that folder as `candidate.yaml`: the whole law, the same as `.lawcheck/law.yaml` except in its types and their `may_use` lists. Then run this as one shell command:

```text
$ cp .lawcheck/law.yaml "$KEEP/law.yaml" && cp "$KEEP/candidate.yaml" .lawcheck/law.yaml; lawcheck check --full --base HEAD --json > "$KEEP/report.json"; lawcheck prime > "$KEEP/prime.txt"; lawcheck explain . > "$KEEP/types.txt"; cp "$KEEP/law.yaml" .lawcheck/law.yaml && cmp "$KEEP/law.yaml" .lawcheck/law.yaml; node "$KEEP/uses.mjs" < "$KEEP/report.json"; node "$KEEP/total.mjs" < "$KEEP/report.json"; if grep -q 'shortened to fit' "$KEEP/prime.txt"; then echo 'prime: shortened'; fi
```

It prints the table of the page's part, then one line `total:` with every use the candidate forbids and the files that make them, each file counted once. A last line `prime: shortened` means the candidate does not fit `lawcheck prime` unshortened. The file `$KEEP/report.json` keeps each use with its file, line and type, for a question the table does not answer. The file `$KEEP/types.txt` holds the count of files of each type of the candidate. Lines that start with an error code mean the candidate is no valid law: fix the candidate, never the code.

A script rule that is not law yet is counted the same way, with its file in the folder as `<id>.mjs` and `candidate.yaml` holding the law plus the rule's entry and `why`. Pick an id the law does not use. Run as one shell command:

```text
$ cp .lawcheck/law.yaml "$KEEP/law.yaml" && cp "$KEEP/candidate.yaml" .lawcheck/law.yaml && mkdir -p .lawcheck/rules && cp "$KEEP/<id>.mjs" .lawcheck/rules/<id>.mjs; lawcheck try <id> '<pattern>'; rm -f .lawcheck/rules/<id>.mjs; rmdir .lawcheck/rules 2>/dev/null; cp "$KEEP/law.yaml" .lawcheck/law.yaml && cmp "$KEEP/law.yaml" .lawcheck/law.yaml
```

Delete the folder with `rm -r` and its path before the final message.

## In Claude Code

- Ask the user with the question tool, one decision per question, with the options and what each changes. The rules with findings share one question, with one answer per rule, and each boundary the code already breaks gets the three ways of the page's part "A boundary the code already breaks". Ask the question of step 3 alone, before `lawcheck init`. Send all the questions of step 10 in one call.
- Where the question tool is missing, as in a session started with `claude -p`, a person still reads your message and answers in the next prompt. Ask the questions of step 3 or 10, of the advice or of the target in your message, put nothing after them, and end the turn. Never skip them because the session looks non-interactive: skip them only when the user said that no one will answer.
- The plugin's hooks check each file you edit, and the files of your turn before you finish, by the law in `.lawcheck/law.yaml` at that moment. So a measurement keeps its candidate outside the repository and swaps it in and out within one shell command, as the page's part "Measure a law that is not in force" shows, and as "Measure for a proposal" above does. Write a proposal file only when no candidate is in place.
- Write, check and delete the probes of the page's part "Prove each restriction bites" within one shell command. A probe written with the edit tool gets the hook's message that it breaks the law, which is what the probe is for.
- At the end of the turn, the plugin tells the user that you changed `.lawcheck/law.yaml` and the rule files. That is expected.
- Name a type by its id and say what its files do. Give who may use whom as sentences, never as YAML.
