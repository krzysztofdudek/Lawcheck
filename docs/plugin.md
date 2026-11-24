# The Claude Code plugin

The Claude Code plugin gives the agent the [law](concepts.md#law) at the start of every session. It checks each file that the agent writes with `Write`, `Edit` or `NotebookEdit`. A turn is the agent's work on one prompt of the user. If the files of a turn break the law when the agent finishes, the plugin sends the agent back to work. Install the plugin with:

```text
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

The plugin does not hold Lawcheck. It starts Lawcheck with the command that the `runner` setting of `.lawcheck/config.yaml` names ([Settings](config.md#runner)). Install Lawcheck where that command finds it. For the default `global`, that install is `npm i -g lawcheck@alpha`.

The plugin runs on Linux, macOS and Windows. It needs `node` and `git` on the `PATH`.

A hook is a command that Claude Code runs at an event. The plugin's hooks run Lawcheck on your machine at the start of a session, after each edit and before the agent finishes ([The four hooks](#the-four-hooks)).

The hooks run code of the repository on your machine. That code is the repository's [script rules](concepts.md#script-rule), and with some `runner` settings a program that the repository names. Use the plugin only in a repository whose code you would run yourself.

A script rule is a JavaScript module that the repository holds in `.lawcheck/rules/`. Lawcheck runs the script rules on each check, after an edit and before the agent finishes. A script rule may read the files below the folder that holds `.lawcheck/`. It cannot open a network connection ([Script rules](script-rules.md)).

With a `runner` setting other than `global`, the package manager starts Lawcheck from the repository's own files ([Settings](config.md#runner)). These files can name a program of the repository, such as `yarnPath` in `.yarnrc.yml` or a committed `node_modules/.bin/lawcheck`. The hook then runs the program that those files name.

The same plugin works in Codex. Its hooks there run on the same events, `apply_patch` stands for the three tools, and two variables stand for the settings ([Lawcheck in Codex](codex-cli.md)). For another coding agent, write in its instructions file that it runs `lawcheck prime` at the start of a session and `lawcheck check` after each change ([Other coding agents](other-agents.md)).

## The four hooks

Claude Code names each hook by its event. Each hook runs `node` on the plugin's `hooks/lawcheck-hook.mjs`.

| Hook | When it runs | Claude Code gives it | Lawcheck's deadline |
|---|---|---|---|
| `SessionStart` | a session starts, resumes, is cleared or compacted | 30 seconds | 25 seconds |
| `UserPromptSubmit` | the user sends a prompt | 20 seconds | 15 seconds |
| `PostToolUse` | `Write`, `Edit` or `NotebookEdit` succeeded | 30 seconds | 25 seconds |
| `Stop` | the agent is about to end its turn | 150 seconds | 145 seconds |

A hook's git calls and its Lawcheck run share one deadline. After the deadline, the hook stops Lawcheck and every child process that Lawcheck started. The deadline ends five seconds before the time Claude Code gives the hook. The hook uses those five seconds to end.

Each hook looks for `.lawcheck/law.yaml` in the folder where it starts, then in each folder above it. The first folder that holds the file is the root of the law. After an edit, the hook starts from the folder of the edited file. A file you edit in another repository therefore gets the law and the `runner` setting of that repository. The other hooks start from the folder where the session runs.

## SessionStart

The hook starts `lawcheck prime` with the command of the `runner` setting. The agent gets what `prime` prints.

When the law has a reviewer rule and `.lawcheck/config.yaml` sets no reviewer, `prime` says so to the agent. The hook also sends you a message, once per session:

```text
Lawcheck: this repository has a reviewer rule, and .lawcheck/config.yaml sets no reviewer, so a plain lawcheck check and CI fail on every file a reviewer rule judges. Setting reviewer.provider and reviewer.model there is the user's decision; lawcheck docs providers lists the choices.
```

Without a law, the agent gets two lines. The first says that the plugin is on and the folder has no law. The second tells the agent to start a law with `lawcheck init` only when the user asks for it.

When the `runner` setting holds a value outside the five of [Settings](config.md#runner), the hook tells the agent to read `.lawcheck/law.yaml` and to tell the user that the setting is wrong.

If `prime` does not run, the hook gives the agent three things:

- the reason;
- the line that installs Lawcheck for the `runner` setting, such as `npm i -g lawcheck@alpha`;
- the advice to read `.lawcheck/law.yaml` until a new session starts.

## UserPromptSubmit

The hook writes a note that records `HEAD`, the files that differ from it and the untracked files, with the waiver lines of those files. The `Stop` hook reads this note to find the files that the turn changed. The agent gets nothing from this hook.

The user can stop a turn, or an error can end it, before the `Stop` hook runs. The note of that turn then stays in place. The next `Stop` hook checks the files of both turns together.

With the setting `check_before_stop` off, this hook writes no note.

## PostToolUse

The hook runs `lawcheck check ./<file>` on the file that `Write`, `Edit` or `NotebookEdit` wrote. The agent gets what this table shows for each exit code:

| Exit | What the agent gets |
|---|---|
| 0 | nothing, warnings included |
| 1 | the output, under a line that names the file and says it breaks the law of this repository |
| 2 | the output, under a line that says Lawcheck could not check the file; the hook does not hand over the same output of one law twice in a row, so a law the user is still editing reaches the agent once. After an edit under the same law that Lawcheck could check, with exit 0 or 1, the same output reaches the agent again |

If the check runs past its deadline, the agent gets one line that says so. If Lawcheck does not run for another reason, such as a missing program, the agent gets nothing.

## Stop

The files of the turn are the files that changed since the user's prompt, and the files of the turn's commits. A file that the user's editor wrote during the turn counts as one of them. The hook runs `lawcheck check` on these files:

- Exit 0: the agent finishes.
- Exit 1: the hook sends the agent back with the output, to fix the code or to tell the user what blocks it.
- Exit 2, when the turn changed files under `.lawcheck/`: the hook sends the agent back to fix what the error names.
- Exit 2, when the turn changed no file under `.lawcheck/`: the error lies in the law, a rule or Lawcheck. The hook sends the user a notice ([The notices the user gets](#the-notices-the-user-gets)) and lets the agent finish.

When the hook lets the agent finish, it also tells the user what the turn did to the law and its waivers ([The end of a turn](#the-end-of-a-turn)).

This check judges the files of the turn by name, with no base. It calls no reviewer, since the hook never passes `--review`. A check of named files reports a missing review as a warning. An agent can therefore finish while a CI job fails on the same branch. The job can fail on `not-reviewed`, or on a file that the turn did not touch.

### Three returns at most

The hook sends the agent back at most three times in a turn. It never sends the agent back twice in a row for the same output. Past these limits, the hook lets the agent finish. It sends the user a message that the check still fails ([The notices the user gets](#the-notices-the-user-gets)).

A turn can start with no note from `UserPromptSubmit`. Then the hook checks every file that differs from `HEAD` and every untracked file. It sends the agent back at most once in that turn.

## The end of a turn

An agent that cannot fix a breach can add a waiver, or change the law, and finish with a check that passes. When the hook lets the agent finish a turn that did either, it sends you one message:

```text
Lawcheck: in this turn the agent added 1 waiver (no-console at src/core/shipping.ts:1) and changed .lawcheck/law.yaml. Read them before you accept the turn.
```

The message names each waiver that the turn added, by the rule after the marker and its line. The hook compares the text from `lawcheck-waive` to the end of each line with the same file at the start of the turn. A waiver that the file held before the turn is not named, whether the file was committed then or only changed on disk. The hook reads the marker as text in every file of the turn, so it also names a marker that `check` does not count, such as one in a file with no type. The message also names each file of the turn that is `.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a file in `.lawcheck/rules/`, as changed or as deleted. It shows five of each and the count of the rest. A turn that deletes `.lawcheck/law.yaml` leaves no law to check against, so the hook runs no check and sends only this message, naming the law as deleted.

The message goes to you and never to the agent, and it does not send the agent back. It comes once, at the stop that ends the turn. A stop that sends the agent back says nothing of it. A turn with no note from `UserPromptSubmit` gets no such message, because the hook does not know what the files held at its start. `lawcheck check` against a base names the waivers of the whole change ([What a check judges](change.md#waivers-a-change-adds)).

## The text the agent gets

The hook hands the agent at most 9,000 characters. From a longer output, it keeps the first line, the `next:` line and as many lines between them as fit. A line `... <n> more lines not shown` stands in place of the rest, or `... 1 more line not shown` for one line.

The hook cuts each line longer than 2,000 characters. At the cut, it says how many characters it left out.

## The notices the user gets

The `Stop` hook sends the user two kinds of text: notices and messages. A notice goes to the user and never to the agent. The user sees the first notice of a session and no later one. The hook sends a notice in these cases:

- Lawcheck is not installed, or the program of the `runner` setting is missing;
- the command of the `runner` setting printed an error, or ended with no result of Lawcheck;
- the project's Lawcheck is a version without `check <paths>`;
- a check did not finish within its deadline;
- git could not list the files of the turn;
- the check ended with exit 2, and the turn did not touch `.lawcheck/`.

The user gets a message each time the agent finishes, as long as its case holds. The hook sends a message in these cases:

- the turn changed more than 1,000 files. The hook then runs no check;
- a background subagent, teammate or workflow is running. The hook waits for it. The hook runs the check the first time the agent finishes after that task ends;
- the check still fails past the limits of [Three returns at most](#three-returns-at-most).

A hook that fails inside its own code prints `Lawcheck plugin:` and the cause on standard error. It then exits 1. A hook exits 0 in every other case.

## The settings

The plugin has two settings. Both are on by default:

| Setting | Its title in Claude Code | With it off |
|---|---|---|
| `check_after_edit` | Check each edited file | no `PostToolUse` check |
| `check_before_stop` | Check before the agent finishes | no `Stop` check and no message at the end of a turn, and `UserPromptSubmit` notes nothing |

Claude Code hands each hook the value as the variable `CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT` or `CLAUDE_PLUGIN_OPTION_CHECK_BEFORE_STOP`. The hook reads `false`, `0`, `no` and `off` as off, in upper or lower case. It reads any other value as on.

## The state the plugin keeps

Claude Code names the plugin's data folder in `CLAUDE_PLUGIN_DATA`. The hook keeps one file per session in that folder. Without that variable, the hook keeps the file in a folder of the system's temporary directory that only your user may read. On Windows, it keeps no file without `CLAUDE_PLUGIN_DATA`. At each session start, the hook deletes the files older than 7 days.

Next: [Files Lawcheck reads and writes](files.md)
