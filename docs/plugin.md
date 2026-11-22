# The Claude Code plugin

The plugin gives the agent the law at the start of every session, checks each file it edits, and sends it back while the files of its turn break the law. Install it with:

```text
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

The plugin ships without the tool. It starts Lawcheck with the command that `runner` in `.lawcheck/config.yaml` names ([Settings](config.md)), so install Lawcheck that way. The hooks also need `node` and `git` on the `PATH`. The plugin runs on Linux, macOS and Windows.

The hooks run Lawcheck and the repository's rule scripts after edits and before the agent finishes. Use the plugin where you would run the repository's tests.

For another coding agent there is no plugin: its instructions tell it to run `lawcheck prime` at the start and `lawcheck check` after a change ([The commands](commands.md)).

## The four hooks

Claude Code names each hook by its event. Each one runs `node` on the plugin's `hooks/lawcheck-hook.mjs`.

| Hook | When it runs | Claude Code gives it | Lawcheck's deadline |
|---|---|---|---|
| `SessionStart` | a session starts, resumes, is cleared or compacted | 30 seconds | 25 seconds |
| `UserPromptSubmit` | the user sends a prompt | 20 seconds | 15 seconds |
| `PostToolUse` | `Write`, `Edit` or `NotebookEdit` succeeded | 30 seconds | 25 seconds |
| `Stop` | the agent is about to end its turn | 150 seconds | 145 seconds |

Git and Lawcheck share the deadline of their hook. After the deadline, the hook stops Lawcheck and its child processes. The deadline ends five seconds before the time Claude Code gives the hook, so the hook has those seconds to end.

The root is the nearest folder, here or above, that holds `.lawcheck/law.yaml`. After an edit, the hook looks for it from the edited file, so it checks a file of another repository under that repository's law and runner. The other hooks look from the session's current folder.

## SessionStart

The hook gives the agent the output of `lawcheck prime`, started through the runner. Without a law, the agent gets two lines: the plugin is on, the folder has no law, and the agent starts one with `lawcheck init` only when the user asks. A `runner` that names none of the five runners gives the agent the advice to read `.lawcheck/law.yaml` and to tell the user that the setting is wrong. A `prime` that does not run gives the agent the reason, the line that installs Lawcheck for the runner, such as `npm i -g lawcheck@alpha`, and the advice to read `.lawcheck/law.yaml` until a new session starts.

## UserPromptSubmit

The hook notes `HEAD`, the files that differ from it and the untracked ones, so the `Stop` hook knows what the turn changed. It says nothing to the agent. A turn that never reached its end, because the user stopped it or an error ended it, keeps its note, and the next `Stop` checks both turns together. With `check_before_stop` off, this hook does nothing.

## PostToolUse

The hook runs `lawcheck check ./<file>` on the file that `Write`, `Edit` or `NotebookEdit` wrote. The exit code decides what the agent hears:

| Exit | What the agent gets |
|---|---|
| 0 | nothing, warnings included |
| 1 | the output, under a line that names the file and says it breaks the law of this repository |
| 2 | the output, under a line that says Lawcheck could not check the file; the hook does not hand over the same output twice in a row, so a law the user is still editing reaches the agent once |

A check past its deadline gives the agent one line that says so. Any other failure to start Lawcheck gives the agent nothing.

## Stop

The files of the turn are the files that changed since the prompt, and the files of commits made during the turn. A file the user's editor wrote during the turn counts as the turn's. The hook runs `lawcheck check` on those files:

- Exit 0: the agent finishes.
- Exit 1: the hook sends the agent back with the output, to fix the code or to tell the user what blocks it.
- Exit 2, when the turn changed files under `.lawcheck/`: the hook sends the agent back to fix what the error names.
- Exit 2 otherwise: the law, a rule or Lawcheck broke without the turn touching them. The user gets a notice, and the agent finishes.

This check judges the files of the turn, not the change against a base. It never passes `--review`, so it calls no reviewer, and a missing review is a warning. An agent can finish while CI still fails on `not-reviewed` or on files the turn did not touch.

### Three returns at most

The hook sends the agent back at most three times in a turn, and never twice in a row for the same output. After that it lets the agent finish and tells the user that the check still fails. Without a note of the turn's start, the hook checks every file that differs from `HEAD` and the untracked ones, and sends the agent back at most once.

## The text the agent gets

The hook hands the agent at most 9,000 characters. A longer output keeps its first line and its `next:` line, drops lines from the middle, and says how many it dropped. The hook cuts a line longer than 2,000 characters, and the cut says how many characters it left out.

## The notices the user gets

A notice goes to the user, never to the agent. The `Stop` hook sends one in these cases, and only the first notice of a session is shown:

- Lawcheck is not installed, or the runner's program is missing;
- the runner printed an error, or ended with no Lawcheck result;
- the project's Lawcheck is older than `check <paths>`;
- a check did not finish within its deadline;
- git could not list the files of the turn;
- the check ended with exit 2, and the turn did not touch `.lawcheck/`.

Two messages come at every end of a turn instead: more than 1,000 files changed in the turn, so the check did not run; and a background subagent, teammate or workflow is still running, so the check waits for it and runs at the first end of a turn after it.

A hook that fails inside itself prints `lawcheck plugin:` and the cause on standard error, and exits 1. Every other end of a hook is exit 0.

## The settings

Two settings, both on by default:

| Setting | Its title in Claude Code | With it off |
|---|---|---|
| `check_after_edit` | Check each edited file | no `PostToolUse` check |
| `check_before_stop` | Check before the agent finishes | no `Stop` check, and `UserPromptSubmit` notes nothing |

Claude Code hands each hook the value as the variable `CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT` or `CLAUDE_PLUGIN_OPTION_CHECK_BEFORE_STOP`. The hook reads `false`, `0`, `no` and `off` as off, in any case, and any other value as on.

## The state the plugin keeps

The hook keeps one small file per session in the plugin's data folder (`CLAUDE_PLUGIN_DATA`), or else in a folder of the system's temporary directory that only your user may read. Each session start deletes the files older than 7 days. On Windows the hook needs `CLAUDE_PLUGIN_DATA` for its state, and keeps none without it.
