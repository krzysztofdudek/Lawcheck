---
name: setup
description: Writes the first Lawcheck law of this repository from the code as it is, and asks the user before it forbids a use the code already makes. Only the user starts it, by typing /lawcheck:setup.
disable-model-invocation: true
---

# Set up Lawcheck

## Start

Run `lawcheck docs agent-setup` and follow that page, step by step. It is the procedure, and it comes with the Lawcheck that runs here, so it matches the commands.

The page's step 10 may ask the user questions. That message stops after the last question, with no next step. The final message of step 11, after the answers, carries the next step.

- The shell finds no `lawcheck`: tell the user to install it with `npm install --global lawcheck@alpha`, and stop.
- Lawcheck answers that it has no topic `agent-setup`: the installed Lawcheck is older than this plugin. Tell the user to update it with the same command, and stop.

## What the user asked for

| The user | Do |
|---|---|
| types `/lawcheck:setup`, with no law here | the page, all of it |
| asks what could be better, for advice or for recommendations | the page when there is no law, then [references/advice.md](references/advice.md) |
| asks for a target architecture, a redesign, a plan to rebuild, or says where the code should get to | the page when there is no law, then [references/target.md](references/target.md) |
| asks for both | the page when there is no law, then advice, then target |
| asks for setup, and a law is already here | say that the law stands and that `lawcheck prime` says how to change it |

Ask no question about which of these to do. Start advice or a target only when the user asked for it. In a repository with no law, start them only after step 11 of the page passed.

## Advice and a target

This version of the plugin gives no advice and drafts no target architecture. Never offer either of them. When the user asks for one, its file under `references/` says what to tell the user.

## In Claude Code

- Ask the user with the question tool, one decision per question, with the options and what each changes. The rules with findings share one question, with one answer per rule. Send all the questions of step 10 in one call.
- Where the question tool is missing, as in a session started with `claude -p`, a person still reads your message and answers in the next prompt. Ask the questions of step 10 in your message, put nothing after them, and end the turn. Never skip them because the session looks non-interactive: skip them only when the user said that no one will answer.
- The plugin's hooks check each file you edit, and the files of your turn before you finish, by the law in `.lawcheck/law.yaml` at that moment. So a measurement keeps its candidate outside the repository and swaps it in and out within one shell command, as the page shows.
- Write, check and delete the probes of the page within one shell command. A probe written with the edit tool gets the hook's message that it breaks the law, which is what the probe is for.
- At the end of the turn, the plugin tells the user that you changed `.lawcheck/law.yaml` and the rule files. That is expected.
- Talk to the user in plain words. Name a type by its id and say what its files do. Give who may use whom as sentences, never as YAML.

## The rules of a proposal

Advice and a target are proposals. These rules hold for both:

- A proposal is a file beside the law, `.lawcheck/advice.md` or `.lawcheck/target.md`, and Lawcheck reads neither. Its first paragraph says that a coding agent wrote it, the date, the commit, the Lawcheck version, and "Nothing in this file is law."
- Every item names its evidence: `written`, `direction`, `cycle`, `few`, `mixed` or `convention`, with the file and line or the measured counts; in a target also `aim`, with the user's words quoted. The name of a pattern is never evidence.
- Every count comes from the page's part "Measure a law that is not in force".
- An item becomes law only on the user's yes to that item, through the page's parts "A boundary the code already breaks" and "Prove each restriction bites". An accepted item leaves the file.
- When the code gives no ground for an item, say so in one sentence and write no file.
- The page's part "Never" holds here too.
