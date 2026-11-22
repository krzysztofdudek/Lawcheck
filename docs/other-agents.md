# Other coding agents

Codex, Copilot CLI, Gemini CLI and other agents read the law from `lawcheck prime` and check their code with `lawcheck check`, once one line of their instructions file tells them to. Lawcheck has a plugin for Claude Code alone, so no hook checks the edits of these agents.

The outputs below come from a repository with this law and the script rule `no-console` of [The first type and the first rule](first-law.md):

```yaml
lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.

types:
  library:
    about: The code every command shares.
    paths: ["src/core/**"]
    rules: [no-console]
  command:
    about: The entry points of the command line.
    paths: ["src/cli/**"]
```

## 1. Add one line to the instructions file

Put this line in the file your agent reads at the start of a session, such as `AGENTS.md`:

```text
Run `lawcheck prime` at the start of every session and follow it.
```

A project that starts Lawcheck through its package manager writes that command instead, such as `pnpm exec lawcheck prime`. The `runner` setting names it ([Settings](config.md)).

## 2. See what the agent reads

```text
$ lawcheck prime
```

```output
Lawcheck checks this repository's code against its law: the file types and the rules each type keeps. The law is .lawcheck/law.yaml; rule files are in .lawcheck/rules/.

How to work here
- Before you create a file, or first edit a file of a type new to you: lawcheck explain <path>
- After you change code: lawcheck check. If it says "no base", run lawcheck check --base <the branch you started from>.
- Exit 0: nothing blocks; warnings are advisory. Exit 1: the code breaks the law; fix the code. Exit 2: Lawcheck or the law is broken; fix what the error names, not the code.
- Never report work as done while lawcheck check exits 1.
- A failing run ends with a next line; do what it says. When it asks for something listed below as the user's, or a finding cannot be fixed in the code, ask the user.
- A plain check judges only changed files. After you change the law or a rule file, run lawcheck check --full and tell the user how many findings it lists outside your change.
- Findings outside your change are debt. Leave them unless the user asks.

Only on the user's word
- a waiver comment: lawcheck-waive <rule> -- <reason> (lawcheck docs waivers), or taking a rule off a type
- deleting a rule, or changing its status or its why
- any edit of .lawcheck/verdicts or of .lawcheck/config.yaml

You may, unasked
- add a type for a new kind of file, or make a type finer
- write a rule the user asked for, and try it first: lawcheck try <rule> <files>

The law here: 2 types, 1 rule
library  src/core/**  The code every command shares.  rules: no-console
command  src/cli/**  The entry points of the command line.

Rules
no-console  script  Only the command layer writes to the terminal.

More: lawcheck docs
```

The part `Only on the user's word` lists what the agent leaves to you: a waiver, a rule taken off a type or deleted, and any edit of `.lawcheck/verdicts` or `.lawcheck/config.yaml`. A law with `may_use` adds a line for widening it.

The text stays within 8,000 characters. For a large law, Lawcheck shortens the part about the law and says what it left out. Without a law, `prime` prints two lines that say so, and exits 0.

## 3. See a failed check as the agent does

The primer tells the agent to run `lawcheck check` after it changes code. On a branch where `src/core/total.ts` calls `console.log`:

```text
$ lawcheck check --base main
```

```output
lawcheck: FAIL  1 error in 1 changed file (against main)

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

The check exits 1. The primer tells the agent that exit 1 means "fix the code", and the `next:` line names the first line to fix. Exit 2 means that Lawcheck or the law is broken, and the error names what to fix there.

## 4. Check in CI what the agent skips

Nothing checks a file after an edit, and nothing holds the turn while the law is broken. The agent checks only when it follows the primer. Run the same check in a CI job or a git hook ([CI and git hooks](ci.md)), so a change the agent never checked still meets the law.

## If it goes wrong

- The agent runs `lawcheck`, and the shell finds no such program. Lawcheck is a dev dependency of the project. Write the runner's command in the line of step 1; with a `runner` set, the primer names that command too.
- The agent says it is done while `lawcheck check` exits 1. The primer tells it never to, and no hook holds it to that. The CI job catches the change.
- `lawcheck check` says "no base". The primer tells the agent to pass `--base` with the branch it started from.
- The law is not valid. `prime` prints the start of the text, then the errors, and exits 2.
