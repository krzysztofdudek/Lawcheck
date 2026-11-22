# Other coding agents

Codex, Copilot CLI, Gemini CLI and other coding agents work with Lawcheck through one line in their instructions file. That line tells the agent to run `lawcheck prime`. The text that `lawcheck prime` prints is the primer. The primer gives the agent the [law](concepts.md#law) and tells it to check its code with `lawcheck check`. Lawcheck has a plugin for Claude Code alone. For these agents, no hook checks an edit.

The outputs below come from a repository with this law. Its [script rule](concepts.md#script-rule) `no-console` is the rule of [The first type and the first rule](first-law.md):

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

A project may start Lawcheck through its package manager. Then the line names that command, such as `pnpm exec lawcheck prime`. The setting `runner` in `.lawcheck/config.yaml` names the same command for Lawcheck ([Settings](config.md)).

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

The part `Only on the user's word` lists the steps the agent leaves to you. These are a [waiver](concepts.md#waiver), a [rule](concepts.md#rule) taken off a [type](concepts.md#type) or deleted, and any edit of `.lawcheck/verdicts` or `.lawcheck/config.yaml`. For a law with `may_use`, that part also lists widening `may_use`.

The primer holds at most 8,000 characters. For a large law, Lawcheck shortens the part about the law. The last line then names the commands that show a type or a rule in full. Without a law, `prime` prints two lines that say so and exits 0.

## 3. See a failed check as the agent does

The primer tells the agent to run `lawcheck check` after each change of code. On a branch where `src/core/total.ts` calls `console.log`, the agent runs:

```text
$ lawcheck check --base main
```

```output
lawcheck: FAIL  1 error in 1 changed file (against main)

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

The check exits 1. The primer tells the agent that exit 1 means "fix the code". The `next:` line names the first line to fix. Exit 2 means that Lawcheck or the law is broken. The error then names what to fix.

## 4. Check in CI what the agent skips

Without a hook, no program checks a file after the agent edits it. No program keeps the agent at work while its files break the law. The agent checks its code only when it follows the primer. Run the same check in a CI job or a git hook ([CI and git hooks](ci.md)). That check catches a change the agent left unchecked.

## If it goes wrong

- The agent runs `lawcheck`. The shell finds no such program. The project keeps Lawcheck as a dev dependency, outside the `PATH`. Write the command of your runner in the line of step 1. With `runner` set, the first line of the primer names that command too.
- The agent says it is done while `lawcheck check` exits 1. The primer forbids that. No hook stops the agent. The CI job of step 4 fails the change.
- `lawcheck check` says "no base". The primer tells the agent to pass `--base` with the branch it started from.
- The law is not valid. `prime` prints the start of the text, then the errors, and exits 2.

Next: [CI and git hooks](ci.md)
