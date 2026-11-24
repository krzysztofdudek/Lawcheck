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
| asks for advice, for a target architecture or for a plan to rebuild | say in one sentence that this version gives neither; when this session wrote the law, give its list "could be tightened later" instead; write no file |
| asks for setup, and a law is already here | say that the law stands and that `lawcheck prime` says how to change it |

## In Claude Code

- Ask the user with the question tool, one decision per question, with the options and what each changes. The rules with findings share one question, with one answer per rule, and each boundary the code already breaks gets the three ways of the page's part "A boundary the code already breaks". Send all the questions of step 10 in one call.
- Where the question tool is missing, as in a session started with `claude -p`, a person still reads your message and answers in the next prompt. Ask the questions of step 10 in your message, put nothing after them, and end the turn. Never skip them because the session looks non-interactive: skip them only when the user said that no one will answer.
- The plugin's hooks check each file you edit, and the files of your turn before you finish, by the law in `.lawcheck/law.yaml` at that moment. So a measurement keeps its candidate outside the repository and swaps it in and out within one shell command, as the page's part "Measure a law that is not in force" shows.
- Write, check and delete the probes of the page's part "Prove each restriction bites" within one shell command. A probe written with the edit tool gets the hook's message that it breaks the law, which is what the probe is for.
- At the end of the turn, the plugin tells the user that you changed `.lawcheck/law.yaml` and the rule files. That is expected.
- Talk to the user in plain words. Name a type by its id and say what its files do. Give who may use whom as sentences, never as YAML.
