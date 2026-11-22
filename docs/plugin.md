# The Claude Code plugin

The Claude Code plugin gives the agent the [law](concepts.md#law) at the start of every session. It checks each file the agent edits. It sends the agent back to work while the files of its turn break the law. Install the plugin with:

```text
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

The plugin ships without Lawcheck itself. It starts Lawcheck with the command that `runner` in `.lawcheck/config.yaml` names ([Settings](config.md)). Install Lawcheck the way that `runner` says. The hooks need `node` and `git` on the `PATH` as well. The plugin runs on Linux, macOS and Windows.

A hook is a command that Claude Code runs at an event of a session. The plugin's hooks run Lawcheck and the repository's rule scripts after edits and before the agent finishes. Use the plugin in a repository whose tests you would run on your machine.

Lawcheck has no plugin for another coding agent. That agent's instructions file tells it to run `lawcheck prime` at the start and `lawcheck check` after a change ([Other coding agents](other-agents.md)).

## The four hooks

Claude Code names each hook by its event. Each hook runs `node` on the plugin's `hooks/lawcheck-hook.mjs`.

| Hook | When it runs | Claude Code gives it | Lawcheck's deadline |
|---|---|---|---|
| `SessionStart` | a session starts, resumes, is cleared or compacted | 30 seconds | 25 seconds |
| `UserPromptSubmit` | the user sends a prompt | 20 seconds | 15 seconds |
| `PostToolUse` | `Write`, `Edit` or `NotebookEdit` succeeded | 30 seconds | 25 seconds |
| `Stop` | the agent is about to end its turn | 150 seconds | 145 seconds |

Git and Lawcheck share the deadline of their hook. After the deadline, the hook stops Lawcheck and its child processes. The deadline ends five seconds before the time Claude Code gives the hook. The hook uses those five seconds to end.

The root is the nearest folder, here or above, that holds `.lawcheck/law.yaml`. After an edit, the hook looks for the root from the edited file. A file of another repository gets that repository's law and runner. The other hooks look from the session's current folder.

## SessionStart

The hook starts `lawcheck prime` through the runner and gives the agent its output.

Without a law, the agent gets two lines. The first says that the plugin is on and the folder has no law. The second tells the agent to start a law with `lawcheck init` only when the user asks for it.

A `runner` can name none of the five runners. Then the hook tells the agent to read `.lawcheck/law.yaml` and to tell the user that the setting is wrong.

If `prime` does not run, the hook gives the agent three things:

- the reason;
- the line that installs Lawcheck for the runner, such as `npm i -g lawcheck@alpha`;
- the advice to read `.lawcheck/law.yaml` until a new session starts.

## UserPromptSubmit

The hook notes `HEAD`, the files that differ from it and the untracked files. The `Stop` hook reads this note to learn what the turn changed. This hook says nothing to the agent.

A turn can stop before its end, because the user stopped it or an error ended it. Its note then stays. The next `Stop` hook checks both turns together. With `check_before_stop` off, this hook does nothing.

## PostToolUse

The hook runs `lawcheck check ./<file>` on the file that `Write`, `Edit` or `NotebookEdit` wrote. The agent gets what this table shows for each exit code:

| Exit | What the agent gets |
|---|---|
| 0 | nothing, warnings included |
| 1 | the output, under a line that names the file and says it breaks the law of this repository |
| 2 | the output, under a line that says Lawcheck could not check the file; the hook does not hand over the same output twice in a row, so a law the user is still editing reaches the agent once |

If the check passes its deadline, the agent gets one line that says so. If Lawcheck fails to start for any other reason, the agent gets nothing.

## Stop

The files of the turn are the files that changed since the prompt, and the files of the commits of the turn. A file that the user's editor wrote during the turn counts as a file of the turn. The hook runs `lawcheck check` on these files:

- Exit 0: the agent finishes.
- Exit 1: the hook sends the agent back with the output, to fix the code or to tell the user what blocks it.
- Exit 2, when the turn changed files under `.lawcheck/`: the hook sends the agent back to fix what the error names.
- Exit 2 otherwise: the law, a rule or Lawcheck fails, and the turn touched none of them. The user gets a notice. The agent finishes.

This check judges the files of the turn and compares nothing with a base. The hook never passes `--review`, so the check calls no reviewer. A missing review is a warning here. An agent can finish while CI fails on `not-reviewed`, or on files the turn did not touch.

### Three returns at most

The hook sends the agent back at most three times in a turn. It never sends the agent back twice in a row for the same output. Past these limits, the hook lets the agent finish. It tells the user that the check fails.

A turn can have no note of its start. Then the hook checks every file that differs from `HEAD` and every untracked file. It sends the agent back at most once in that turn.

## The text the agent gets

The hook hands the agent at most 9,000 characters. From a longer output, the hook keeps the first line and the `next:` line. It drops lines from the middle and says how many it dropped. The hook cuts a line longer than 2,000 characters. At the cut, it says how many characters it left out.

## The notices the user gets

A notice goes to the user and never to the agent. The `Stop` hook sends a notice in the cases below. The user sees the first notice of a session and no later one:

- Lawcheck is not installed, or the runner's program is missing;
- the runner printed an error, or ended with no Lawcheck result;
- the project's Lawcheck is older than `check <paths>`;
- a check did not finish within its deadline;
- git could not list the files of the turn;
- the check ended with exit 2, and the turn did not touch `.lawcheck/`.

Two messages come at every end of a turn, in place of a notice:

- more than 1,000 files changed in the turn, so the check did not run;
- a background subagent, teammate or workflow is running. The check waits for it and runs at the first end of a turn after it ends.

A hook that fails inside itself prints `lawcheck plugin:` and the cause on standard error. It exits 1. A hook exits 0 in every other case.

## The settings

The plugin has two settings, and both are on by default:

| Setting | Its title in Claude Code | With it off |
|---|---|---|
| `check_after_edit` | Check each edited file | no `PostToolUse` check |
| `check_before_stop` | Check before the agent finishes | no `Stop` check, and `UserPromptSubmit` notes nothing |

Claude Code hands each hook the value as the variable `CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT` or `CLAUDE_PLUGIN_OPTION_CHECK_BEFORE_STOP`. The hook reads `false`, `0`, `no` and `off` as off, in upper or lower case. It reads any other value as on.

## The state the plugin keeps

The hook keeps one small file per session in the plugin's data folder, which Claude Code names in `CLAUDE_PLUGIN_DATA`. Without that variable, the hook keeps the file in a folder of the system's temporary directory that only your user may read. Each session start deletes the files older than 7 days. On Windows, the hook needs `CLAUDE_PLUGIN_DATA` for its state. Without that variable on Windows, the hook keeps no state.

Next: [Files Lawcheck reads and writes](files.md)
