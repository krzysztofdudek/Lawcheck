# The Claude Code plugin

The plugin gives the agent the law at the start of every session, checks each file it edits, and sends it back while the files of its turn break the law. Install it with:

```text
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

The plugin ships without the tool. It starts Lawcheck with the command that `runner` in `.lawcheck/config.yaml` names (`lawcheck docs config`), so Lawcheck must be installed that way. The hooks also need `node` and `git` on the `PATH`. The plugin runs on Linux, macOS and Windows.

## The four hooks

| The hook | When | What it does |
|---|---|---|
| session start | a session starts, resumes, is cleared or compacted | gives the agent the output of `lawcheck prime`; without a law, two lines that say so |
| prompt | the user sends a prompt | notes the files that differ from `HEAD` and the untracked ones, so the hook before finishing knows what the turn changed |
| after an edit | `Write`, `Edit` or `NotebookEdit` succeeded | runs `lawcheck check ./<file>` on the edited file |
| before finishing | the agent is about to end its turn | runs `lawcheck check` on the files that changed in the turn |

The root is the nearest folder above that holds `.lawcheck/law.yaml`. After an edit, the hook looks for it from the edited file, so a file of another repository is checked under that repository's law and runner. Before finishing, only the session's root counts.

## After an edit

Exit 0 says nothing, warnings included. Exit 1 hands the output to the agent under a header that names the file. Exit 2 hands it over too, once for each distinct output, so a law the user is still editing reaches the agent once.

## Before finishing

The files of the turn are the files that changed since the prompt, and the files of commits made during the turn. A file the user's editor wrote during the turn counts as the turn's.

- Exit 0: the agent finishes.
- Exit 1: the hook sends the agent back with the output, to fix the code or to tell the user what blocks it. It does this at most three times in a turn, and never twice for the same output. Then it lets the agent finish and tells the user that the check still fails.
- Exit 2, when the turn changed files under `.lawcheck/`: the agent is sent back to fix what the error names.
- Exit 2 otherwise: the law, a rule or Lawcheck broke without the turn touching them. The user gets a notice, and the agent finishes.

This check judges the files of the turn, not the change against a base. It never passes `--review`, so it calls no reviewer, and a missing review is a warning. An agent can finish while CI still fails on `not-reviewed` or on files the turn did not touch.

## What the user is told

A notice goes to the user, never to the agent, and each kind comes once per session:

- Lawcheck is not installed, or the runner's program is missing;
- the project's Lawcheck is older than `check <paths>`;
- a check did not finish within its time;
- more than 1,000 files changed in the turn, so the check did not run;
- a background subagent, teammate or workflow is still running, so the check waits for it;
- git could not list the files of the turn.

After an edit, none of these is shown, except a check past its time, which the agent hears in one line.

## How long a hook may run

Each hook has a deadline: 25 seconds at the session start and after an edit, 15 seconds for the prompt, 145 seconds before finishing. Git and Lawcheck share it. When it passes, the hook stops Lawcheck and its child processes.

## The switches

Two switches, both on by default, under `/plugin configure lawcheck@lawcheck-marketplace`:

- `check_after_edit`: the check after an edit;
- `check_before_stop`: the check before finishing. When it is off, the prompt hook does nothing either.

## What the plugin keeps

The hook keeps one small file per session in the plugin's data folder (`CLAUDE_PLUGIN_DATA`), or else in a folder of the system's temporary directory that only your user may read. Each session start deletes the files older than 7 days.

The hooks run Lawcheck and the repository's rule scripts after edits and before the agent finishes. Use the plugin where you would run the repository's tests.
