# Lawcheck: the plugin slice

The fifth working slice: the plugin that makes a coding agent use Lawcheck, and the two additions to the tool it needs, `check <paths>` and the `runner` setting. It extends `spec/check-slice.md` (slice one), `spec/reviewer-slice.md` (slice two), `spec/dependency-slice.md` (slice three) and `spec/commands-slice.md` (slice four), and keeps their tests 1 to 141 with the amendments of section 11. A worker builds what this file says, and a reviewer ticks section 12. The conventions of the earlier slices hold: quoted text is exact, byte for byte; JSON is compared as parsed data; where this file says nothing, the earlier slices decide.

The Claude Code facts this file relies on were read on 2026-11-13 from the hooks reference, the plugin manifest reference and the marketplace reference on code.claude.com, and checked with Claude Code 2.1.322 on the host: `claude plugin validate` passes a plugin with a boolean `userConfig` option and section 4's hooks.

## 1. Scope

In:

- `lawcheck check <path or pattern>...`, a check of named files, for the hooks (section 2);
- the `runner` setting in `.lawcheck/config.yaml`, and the line it adds to `prime` (section 3);
- the Claude Code plugin in `plugin/`, and the marketplace file at the root that lists it (section 4);
- four hooks: session start, prompt, after an edit, before the agent finishes (sections 5 to 8);
- a section of the README for every agent (section 9);
- the trial of a fresh agent in a fixed repository (section 10).

Out, with what this slice does where the design has it:

| Out | Here |
|---|---|
| An MCP server | none; section 4.5 says why |
| Plugins for Codex, Copilot, Cursor and other hosts | the README sentence of section 9 |
| `doctor`'s check of the runner | `doctor` is unchanged; a bad `runner` shows as its `config` check's `config-invalid` |
| `check <paths>` with `--full`, `--base`, `--review`, `--again` or `--max-calls` | `usage` |
| `--staged`, `--strict`, `--rule`, `--type`, `--no-scripts` on `check` | `usage`, as before |
| A hook after a shell command | none; the hook before finishing sees what shell commands changed (section 8) |
| Windows | not built for, as in the earlier slices |

## 2. `check <paths>`

The hook after an edit asks about one file, and `check` judges a change against a base. This slice adds the form the design gives it: `lawcheck check <path or pattern>... [--json]`.

**Arguments.** Every word that is no flag is a target; a word that starts with `-` is a flag, so a file named `-x.ts` is written `./-x.ts`. Targets with `--full`, `--base`, `--review`, `--again` or `--max-calls` are `usage`, with the message `paths go with --json alone`. Slice one's other rules for flags hold.

**Targets** are read as `try` reads them (slice four, section 5, "Targets"), with one change: a target that selects no file adds nothing and is not an error. A file that does not exist, a file git ignores, a binary file, a directory that holds no listed file and a pattern that matches nothing each add nothing. A target that resolves outside the root is still `usage`. The chosen files are the union, each once.

**The run** is `check`'s run with the chosen files in place of the change:

- Git runs slice one's first two commands alone, the work tree and the file list. No base and no HEAD is read, so `--base`, `LAWCHECK_BASE` and `origin/HEAD` play no part, and a repository with no commit works.
- Everything `check` does to a changed file it does to a chosen file: script rules, uses and `may_use`, waivers, the state of each review.
- Severities are those of a changed file, except that `not-reviewed` and `too-large-to-review` are always warnings.
- There is no debt and no note about a change of the law. `next:` follows slice two's rule, so it is always `fix <place>`.
- Nothing is written that `check` without `--review` does not write.

**The first line** is slice one's first form with `<n> named files` in place of `<n> changed files (against <base>)`. `<n>` counts the chosen files, with a type or without, and is printed also when it is 0. The parts after it (waivers, unresolved uses) are as before.

In S, slice one's sample, on `work` with nothing changed, `lawcheck check src/core/price.ts` exits 1:

```
lawcheck: FAIL  1 error in 1 named file

src/core/price.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/price.ts:2
```

`lawcheck check nothing.ts` exits 0 and prints `lawcheck: PASS  0 named files`.

**JSON.** `lawcheck-check/0`, with `scope` `{ "mode": "paths", "base": null, "files": <n>, "law_changed": false }`. The rows of exit 2 about the base cannot occur.

**Usage.** `lawcheck check --help` prints:

```
usage: lawcheck check [--full] [--base <ref>] [--review [--again] [--max-calls <n>]] [--json]
       lawcheck check <path or pattern>... [--json]

Checks the files of this change, or the files named, against .lawcheck/law.yaml.

  <path or pattern>  judge these files, changed or not, and no others
  --full             also judge the files outside the change, as debt
  --base <ref>       the base of the change; else LAWCHECK_BASE, else origin/HEAD
  --review           ask the reviewer for the reviews that have no verdict
  --again            with --review, ask again where a failure is cached
  --max-calls <n>    with --review, the most requests this run sends
  --json             print one JSON document

Exit 0: no error. Exit 1: the code breaks the law. Exit 2: no conclusion.
```

The program's usage line for `check` becomes `  check  checks the files of this change, or the files named, against the law`.

## 3. The `runner` setting

### In `.lawcheck/config.yaml`

The file takes a second top-level key:

| Key | Value | Default |
|---|---|---|
| `runner` | `global`, `npx`, `pnpm`, `yarn` or `bun` | `global` |

**The line rule.** The plugin reads the key without a YAML parser, so the key has one written form. Read the file as UTF-8, split it at `\n`, and remove a trailing `\r` from each line. The runner line is the first line that starts with `runner:` in its first column. Its value is the rest of the line after `runner:`, with everything from the first `#` that follows a space or a tab removed, then trimmed of spaces and tabs. Without a runner line the runner is `global`.

**What the tool accepts.** The YAML value of `runner` is one of the five names, and the line rule reads the same name. Otherwise `config-invalid` at the key's line:

- a value outside the five: `the runner '<value>' is unknown<near>; it takes global, npx, pnpm, yarn or bun`, where `<near>` is ` (did you mean '<a>'?)` for the one nearest name within two edits, ` (did you mean '<a>' or '<b>'?)` for two at the same distance, in the order of the five, and nothing without one. `npm` reads `the runner 'npm' is unknown (did you mean 'npx' or 'pnpm'?); it takes global, npx, pnpm, yarn or bun`;
- a value the line rule reads differently, such as `runner: "pnpm"`, or a key in flow style: `write runner on one line of its own at the top level, as runner: pnpm`;
- `runner` under `reviewer`: slice two's unknown key.

`runner: pnpm  # pinned in package.json` is accepted. `.lawcheck/config.local.yaml` is still not read.

### The command it names

| `runner` | The command | Its install hint |
|---|---|---|
| `global` | `lawcheck` | `npm i -g lawcheck` |
| `npx` | `npx --no-install lawcheck` | `npm install` |
| `pnpm` | `pnpm exec lawcheck` | `pnpm install` |
| `yarn` | `yarn run lawcheck` | `yarn install` |
| `bun` | `bun x --no-install lawcheck` | `bun install` |

In this file `<cmd>` stands for the command of the runner in force, as one string with single spaces.

### In `prime`

`prime` reads `.lawcheck/config.yaml` with the line rule and nothing else, and never reports a problem of the config: an unreadable file and any value outside `npx`, `pnpm`, `yarn` and `bun` count as `global`.

With one of those four, the first line of the output gains ` Start it here as: <cmd>` at its end, and the budget counts the first part with it, so the law part's step is chosen against the longer first part. In S with `runner: pnpm` the first line reads:

```
Lawcheck checks this repository's code against its law: the file types and the rules each type keeps. The law is .lawcheck/law.yaml; rule files are in .lawcheck/rules/. Start it here as: pnpm exec lawcheck
```

Nothing else changes, and with `global` or no runner the output is slice four's, byte for byte. The first part stays within 1,800 characters: its longest form, 1,721, grows by at most 46.

### In `docs`

The page `config` gains a section `## runner`: the table above, the line rule, that `config.local.yaml` does not take it, and that `prime` and the agent plugin start Lawcheck with the command. The page `json` gains `paths` among the values of `scope.mode`, with `files` counting the named files there.

## 4. The plugin

### 4.1 Layout

The repository root holds the marketplace, and `plugin/` holds the plugin. Nothing in `plugin/` is part of the npm package, and the plugin holds no code of the tool.

```
.claude-plugin/marketplace.json
plugin/.claude-plugin/plugin.json
plugin/LICENSE
plugin/hooks/hooks.json
plugin/hooks/lawcheck-hook.mjs
plugin/hooks/<other modules>.mjs
```

The scripts are plain JavaScript modules for Node 24, as the package's `engines` says, with no build step. They import only `node:` modules and each other, and need `node` and `git` on the PATH. Section 9 gives the two commands that install the plugin.

### 4.2 `.claude-plugin/marketplace.json`

`<description>` is the text of `plugin.json`'s `description` below.

```json
{
  "name": "lawcheck-marketplace",
  "owner": { "name": "Krzysztof Dudek" },
  "description": "The Lawcheck plugin for Claude Code.",
  "plugins": [ { "name": "lawcheck", "source": "./plugin", "description": "<description>" } ]
}
```

### 4.3 `plugin/.claude-plugin/plugin.json`

`version` is always the `version` of `package.json`.

```json
{
  "name": "lawcheck",
  "version": "0.1.0",
  "description": "Gives your coding agent the law of the repository at the start of every session, checks each file it edits, and sends it back, up to three times, while the files that changed in its turn break the law. The hooks run Lawcheck and the repository's rule scripts, so use it where you would run the repository's tests.",
  "author": { "name": "Krzysztof Dudek", "url": "https://github.com/krzysztofdudek" },
  "homepage": "https://github.com/krzysztofdudek/Lawcheck",
  "repository": "https://github.com/krzysztofdudek/Lawcheck.git",
  "license": "MIT",
  "keywords": ["lawcheck", "architecture", "linter", "coding-agents", "hooks"],
  "userConfig": {
    "check_after_edit": {
      "type": "boolean",
      "title": "Check each edited file",
      "description": "After the agent writes or edits a file in a repository with a law, run lawcheck check on that file and show the agent what breaks the law.",
      "default": true
    },
    "check_before_stop": {
      "type": "boolean",
      "title": "Check before the agent finishes",
      "description": "When a turn that changed files is about to end, run lawcheck check on them and send the agent back while they break the law.",
      "default": true
    }
  }
}
```

The two options are the design's switches. Claude Code shows them in `/config` and exports them to hook processes as `CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT` and `CLAUDE_PLUGIN_OPTION_CHECK_BEFORE_STOP`. The documentation does not say how a boolean is written there, so a switch is off when the variable, trimmed and in lower case, is `false`, `0`, `no` or `off`, and on otherwise, absent included.

### 4.4 `plugin/hooks/hooks.json`

Exec form, as the reference asks for a command that names a path placeholder:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/lawcheck-hook.mjs", "session-start"], "timeout": 30 } ] }
    ],
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/lawcheck-hook.mjs", "prompt"], "timeout": 20 } ] }
    ],
    "PostToolUse": [
      { "matcher": "Write|Edit|NotebookEdit", "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/lawcheck-hook.mjs", "edit"], "timeout": 30 } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command", "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/lawcheck-hook.mjs", "stop"], "timeout": 150 } ] }
    ]
  }
}
```

`SessionStart` has no matcher, so it runs for every source: `startup`, `resume`, `clear`, `compact` and `fork`. The current documentation names no `MultiEdit` tool.

### 4.5 No MCP server

The plugin declares no MCP server, and the open mode needs none.

1. Every read such a server would offer is already a command. `prime` gives the law in short, `explain <path>`, `--type` and `--rule` explain a file, a type and a rule, and `.lawcheck/law.yaml` is a file the agent reads with its own tools. `law_read` would be a file read, and `law_explain` would be `explain --json`.
2. A server is a second surface that says the same things in another shape. Its tool names, schemas and descriptions would have to stay in step with the commands, with tests of their own.
3. The plugin asks the project's own `lawcheck` for everything. A server would either start that same command on every call, which adds nothing, or run Lawcheck's code from the plugin's copy, which can be another version than the one the project pins through `runner`.
4. Each tool's name sits in the context of every session, in every repository, and its definition loads on search.
5. Every host the plugin may reach lets the agent run shell commands, so the commands serve them all. The trial of section 10 measures that path in Claude Code alone.

What would change this: a host whose agent cannot run a shell command, or a measured failure of agents to use `explain` that a tool would fix.

## 5. What every hook shares

**The script.** `lawcheck-hook.mjs <event>`, the event being `session-start`, `prompt`, `edit` or `stop`. It reads its standard input to the end and parses it as JSON. It prints either one JSON document of section 4.4's event or nothing, because plain output of `SessionStart` and `UserPromptSubmit` would reach the agent's context, and exits 0, except on a failure of its own (input that is no JSON object, an unknown event, an exception): then it prints `lawcheck plugin: <the error's first line>` on standard error and exits 1, which Claude Code shows the user as a hook error and does not block on. It never exits 2.

**The input fields it reads.** `session_id`, `prompt_id`, `cwd` and `hook_event_name` from every event; `source` from `SessionStart`; `tool_name` and `tool_input` from `PostToolUse`, the path being `tool_input.file_path` for `Write` and `Edit` and `tool_input.notebook_path` for `NotebookEdit`; `stop_hook_active` and `background_tasks` from `Stop`. A missing `prompt_id` matches any.

**The root** is the nearest directory, from the start directory upward, that holds `.lawcheck/law.yaml` as a file. The start directory is `cwd`, except for `edit`, where it is the directory of the edited file.

**Starting Lawcheck.** The hook reads the runner from `<root>/.lawcheck/config.yaml` by the line rule of section 3; an unreadable or missing file is `global`, and a value outside the five is a bad runner. It starts the command's words, then its own, with `child_process.spawn`: no shell, its own environment, the root as working directory, `stdio` `['ignore', 'pipe', 'pipe']`, and `detached: true`, so the call leads a process group. A path is always passed as `./<path from the root>`, so no path reads as a flag. The call ends when the process has exited and both pipes have closed, or 2 seconds after it exited; then the hook sends `SIGKILL` to the group, which ends anything the call left behind. On `SIGTERM`, `SIGINT` or `SIGHUP` the hook sends `SIGKILL` to the group of a call in progress and exits.

**One deadline per hook**, its `timeout` less 5 seconds: 25 seconds for `session-start` and `edit`, 15 for `prompt`, 145 for `stop`, counted from the hook's start. Git commands and Lawcheck share it, and Lawcheck gets what is left. At the deadline the hook sends `SIGTERM` to the group, then `SIGKILL` 2 seconds later. A Lawcheck call stopped this way is not run, with the reason `it did not finish within <deadline> seconds`. Claude Code then never has to cancel the hook, which would discard its output.

**Lawcheck's output** is the call's standard output from its first line that starts with `lawcheck: ` or `Lawcheck `; with `runner: yarn`, a last line that starts with `Done in ` is also removed. Yarn 1 prints its own lines before and after the program's.

**Lawcheck answered** a `check` call when the exit code is 0, 1 or 2 and its output's first line starts with `lawcheck: PASS  `, `lawcheck: FAIL  ` or `lawcheck: ERROR  `, and a `prime` call when the exit code is 0 or 2 and there is output. Anything else is not run, with this reason:

| The case | `<reason>` |
|---|---|
| the program is not found (`ENOENT`) | `<the command's first word> was not found` |
| the deadline | `it did not finish within <deadline> seconds` |
| `check` exits 2 and every line of its output that holds `error[` holds `error[usage]` | `this lawcheck does not take check <paths>; update it` |
| standard error holds a line that is not blank | its first such line, cut to 200 code points |
| otherwise | `it exited with <code or signal> and printed no Lawcheck result` |

A runner exits 1 when it cannot find what it should start, so an exit code alone never says that Lawcheck ran.

**The text the agent reads.** The hook passes Lawcheck's output through, in the design's grammar, as the agent reads it from its own runs. It never asks for `--json`, never renders findings and never passes `--review`, so no hook calls a reviewer.

**Fitting.** Claude Code caps a hook's text at 10,000 characters and replaces anything longer with a file path and a 2,000-character preview it does not ask the agent to read. A text the hook hands over is a header, a blank line and Lawcheck's output without its final line end, at most 9,000 code points in all. When it would hold more, the hook keeps the header, the blank line and the output's first line; then the output's next lines in order while they fit; then `... <k> more lines not shown; run the command yourself to see them all`, with `k` the lines left out; and last the output's last line when it starts with `next: `. Lines are kept whole.

**State** is one file per session, `<data>/sessions/<session_id>.json`. `<data>` is `CLAUDE_PLUGIN_DATA`, or without it `<os.tmpdir()>/lawcheck-plugin-<uid>`, which the hook creates with mode `0700` and refuses, as having no state, when another user owns it. The hook creates `<data>/sessions/`. A `session_id` with a character outside `A-Z`, `a-z`, `0-9`, `_` and `-` has no state file. The file is written to a temporary name in the same directory and renamed. It holds:

```json
{ "root": "<absolute>", "prompt_id": "<id or null>", "open": true, "started": 0, "head": "<commit or null>", "files": { "<path>": "<blob id or ->" }, "blocks": 0, "last": null, "last_error": null, "told": false }
```

**A snapshot** is `head` and `files`, taken at the root with `GIT_OPTIONAL_LOCKS=0`:

1. `head`: `git rev-parse --verify --quiet HEAD^{commit}`, or null.
2. The paths: with a HEAD, `git diff -z --name-only --no-renames --relative HEAD --` and `git ls-files -z --others --exclude-standard`; without one, `git ls-files -z --cached --others --exclude-standard`. Paths under `.lawcheck/.local/` are left out.
3. Each path's blob id from one `git hash-object --stdin-paths`, or `-` when the path is no regular file.

A snapshot that fails or passes the deadline is no snapshot.

## 6. The session start

| The case | `additionalContext` |
|---|---|
| no root | the two lines below; nothing is started |
| a bad runner | the two lines below |
| `prime` answered | its output without its final line end, fitted, with no header |
| `prime` did not run | the two lines below |

The document is `{ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": <text> } }`.

Without a root:

```
The Lawcheck plugin is on, and this directory has no law (.lawcheck/law.yaml here or above).
Start one with lawcheck init only when the user asks for it.
```

These two lines are what the plugin costs a session in a repository without a law.

A bad runner, `<value>` cut to 40 code points:

```
This repository has a Lawcheck law (.lawcheck/law.yaml), and .lawcheck/config.yaml sets runner to <value>, which is none of global, npx, pnpm, yarn, bun, so Lawcheck was not started.
Read .lawcheck/law.yaml for the law, and tell the user that the runner setting is wrong.
```

`prime` did not run:

```
This repository has a Lawcheck law (.lawcheck/law.yaml), and <cmd> prime did not run: <reason>.
Install it with <install hint>, then start a new session. Until then, read .lawcheck/law.yaml for the law.
```

`prime` runs again after a compaction, as the design asks, and on a resume, because the law may have changed since. At every session start, root or none, the hook deletes the files of `<data>/sessions/` last modified more than 7 days ago. It takes no snapshot: the prompt hook does, before any turn can end.

## 7. The prompt hook

Runs on `UserPromptSubmit`, which also fires when Claude Code starts a turn on its own. With the switch `check_before_stop` off or no root, it does nothing. Otherwise it opens a turn in the session's state file and prints nothing:

- When the state's `root` is this root and `open` is true, the last turn never reached a stop that let the agent finish (the user pressed Esc, or an API error ended it). Its `started`, `head` and `files` are kept, so the next stop checks that turn's files too.
- Otherwise it takes a snapshot, sets `started` to the current time in seconds, and `open` to true. Without a snapshot it deletes the state file.

Either way `prompt_id` is the input's, `blocks` 0, `last` and `last_error` null, and `told` is kept or false.

## 8. The hook after an edit and the hook before finishing

### After an edit

Runs on `PostToolUse` for `Write`, `Edit` and `NotebookEdit`, after the tool succeeded.

1. Switch `check_after_edit` off, another `tool_name`, no path in the input, a path that is not a regular file now, no root, or a bad runner: nothing.
2. `<rel>` is the path from the root, with forward slashes. The hook starts `<cmd> check ./<rel>`.
3. Exit 0: nothing, warnings included. An advisory finding or a missing review after every edit would bury the errors, and a review is paid once per content, at the end of a change.
4. Exit 1: `{ "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": <text> } }`, fitted under the header `Lawcheck: after this edit, <rel> breaks the law of this repository. <cmd> check ./<rel> printed:`.
5. Exit 2: the same with the header `Lawcheck could not check <rel> after this edit. <cmd> check ./<rel> printed:`, but only when the SHA-256 of the output differs from the state's `last_error`, which it then becomes. A law the user is still editing, or a rule that crashes, then reaches the agent once, not after every edit. Without a state file it is handed every time.
6. The deadline: the document with the one line `Lawcheck: <cmd> check ./<rel> did not finish within 25 seconds and was stopped.`
7. Any other case of not run: nothing. The session start has told the agent already.

The headers state facts and give no order: the reference warns that context written as commands can trip the agent's defences against injected instructions. The output's own `next:` line says what to do.

### Before finishing

Runs on `Stop`. A stop "lets the agent finish" when it hands nothing back; such a stop sets `open` to false.

1. Switch `check_before_stop` off, no root, or a bad runner: nothing.
2. `background_tasks` lists a task whose `status` is `running` and whose `type` is `subagent`, `teammate` or `workflow`: the notice `lawcheck: the check before the agent finished waits for the background task <id> (<type>), which may still be writing files; it runs at the first stop after that task ends.`, sent every time, and the turn stays open, because a background agent may still be writing the files. A running task of any other type, such as a shell that serves or watches, does not hold the check back.
3. **The state.** It counts when its `root` is this root and `open` is true. `blocks` and `last` count only when its `prompt_id` matches the input's; otherwise they are 0 and null.
4. **What changed in this turn.** Take a snapshot. With a state, the candidates are the paths of both snapshots' `files`. When `head` moved and the two heads have a merge base, every commit from that base to the new `head`, merges left out, whose committer time is at or after `started` is the turn's, and the paths each changes (`git diff-tree --no-commit-id -r -z --name-only --no-renames --relative <commit> --`) count as changed; older commits add none, so a pull, a rebase or a checkout of someone else's commits brings in no one else's work, and a commit the turn amends or follows with a merge still counts. A candidate's blob at each snapshot is its entry in `files`, or, without one, its blob in that snapshot's `head` (`git ls-tree -z`), `-` when absent. A candidate changed when the two blobs differ, so `touch`, a stash and its pop, and a rewrite to the same bytes change nothing. Without a state, the turn's paths are those of the snapshot. Keep the paths that are regular files now, sorted.
5. No path: nothing; the agent finishes.
6. More than 1,000 paths: `{ "systemMessage": "lawcheck: <n> files changed in this turn, more than the 1000 the check before finishing takes, so it did not run; <cmd> check shows the result." }`; the agent finishes.
7. Start `<cmd> check ./<path>...`.
8. Exit 0: nothing; the agent finishes.
9. Exit 1: the guard decides, with the header `Lawcheck: the files that changed in this turn break the law of this repository. Fix the code, then finish; if a fix needs the user's word, tell the user what blocks you and finish. <cmd> check on those files printed:`.
10. Exit 2, and a path of the turn lies under `.lawcheck/`: the guard decides, with the header `Lawcheck could not check the files that changed in this turn, and the turn changed files under .lawcheck/. Fix what the error names, then finish; if that needs the user's word, tell the user and finish. <cmd> check on those files printed:`.
11. Exit 2 otherwise: the law, a rule or Lawcheck broke without the turn touching them, which is the user's to fix. A notice, `lawcheck: lawcheck check could not judge the files that changed in this turn; <cmd> check shows why.`; the agent finishes.
12. Not run: a notice, `lawcheck: the check before the agent finished did not run: <reason>.`; the agent finishes.

A notice is `{ "systemMessage": <text> }` when `told` is false, which it then becomes, and nothing otherwise, so the user reads each kind of trouble once per session.

**A hand-back** is `{ "hookSpecificOutput": { "hookEventName": "Stop", "additionalContext": <text> } }`, the text fitted under the step's header. The reference gives this form for a Stop hook that works as designed: the turn goes on under the same loop protections as `decision: "block"`, and the user sees hook feedback, not a hook error.

**The guard.** Let `h` be the SHA-256 of Lawcheck's output. With a state: when `h` equals `last`, or `blocks` is 3, the hook releases with `{ "systemMessage": "lawcheck: the turn ended while lawcheck check still fails on the files that changed in it; <cmd> check shows why." }` and the agent finishes; otherwise it hands back, adds 1 to `blocks` and sets `last` to `h`. Without a state, when `stop_hook_active` is true, which Claude Code sets once a stop hook has kept the turn going, the agent finishes and nothing is printed; otherwise the hook hands back. With a state, every stop writes it back.

So a turn is handed back at most three times, never twice for the same output, and once without a state: an agent that changed nothing since the last hand-back, or cannot fix what is left, is let go, and the user is told. Claude Code's own cap of eight continuations in a row resets whenever the agent calls a tool, so in a turn where the agent edits between stops it bounds nothing; the guard does.

**Why the turn's files and not the change.** The design's hook runs `lawcheck check` on the whole change. A clone without `origin/HEAD` has no base, and `check` then judges every file, so the agent would be held to all the debt. Findings in the branch's older commits, or in the user's unfinished files, would stop every turn of an agent that touched anything. An enforced reviewer rule would hold every such turn until the agent paid for a review. The agent's own loop is unchanged: `prime` still tells it never to report work as done while `lawcheck check` exits 1.

**Failure modes.**

| The case | After an edit | Before finishing |
|---|---|---|
| Lawcheck not installed, or the runner's program missing | nothing | a notice |
| a project's `lawcheck` older than `check <paths>` | nothing | a notice |
| past the deadline | one line to the agent | a notice |
| a reviewer unreachable, a review missing | cannot happen: no hook passes `--review`, and a missing review is a warning | the same |
| a huge change | one file is checked | above 1,000 files, one message |
| the law or a rule broken | once per distinct output | handed back when the turn touched `.lawcheck/`, else a notice |
| a file of another repository edited | its own root and runner | only the session's root counts |
| git missing | `no-git`, handed once | no snapshot, so nothing runs |
| the user's editor, or another session, writes in the checkout during the turn | not seen | its files count as the turn's |

## 9. Every agent

The README gains this section after its first paragraph. Other hosts get the sentence and nothing more: their hook events and output shapes were not checked, and hooks no test runs would ship untried.

````markdown
## Coding agents

In Claude Code, the Lawcheck plugin gives the agent the law at the start of every session, checks each file it edits, and sends it back, up to three times, while the files that changed in its turn break the law:

```
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

The hooks run Lawcheck and the repository's rule scripts after edits and before the agent finishes, so use the plugin where you would run the repository's tests. Both checks can be switched off in `/config`.

With any other agent, paste this sentence into its instructions file:

```
Run `lawcheck prime` at the start of every session and follow it.
```

That agent then checks only when it follows the primer: nothing checks a file after an edit or holds the turn while the law is broken. A project that starts Lawcheck through its package manager names it as `runner` in `.lawcheck/config.yaml` (`lawcheck docs config`), and the sentence then uses that command, such as `pnpm exec lawcheck prime`.
````

## 10. The trial

**The question:** a fresh agent that knows nothing about Lawcheck, in a repository with a law, breaks a rule; does it fix the breach itself, by the rule's intent, before its turn ends?

**Where it runs.** On the host, where `claude` is signed in with the subscription, against `dist/` built in the dev container, with the host's Node 24. The host's rules keep a project's code in its dev container, and here unattended agents run the fixture, its rule script and `dist/`. Before the first run the director asks the owner for this exception, and his answer goes to `spec/questions.md`; without his yes, tests 181 and 182 wait. Meanwhile each agent is bounded by `--permission-mode dontAsk` and an allow list (step 3).

### The repository

`tests/agent/fixture/`, every file ending with a line end. `src/core/tax.js` breaks the rule, sits outside any change, and is the file nearest to the task.

`package.json`:

```json
{ "name": "shop", "private": true, "type": "module" }
```

`src/core/errors.js`:

```js
export class ShopError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ShopError';
    this.code = code;
  }
}
```

`src/core/price.js`:

```js
export function parsePrice(text) {
  const [whole, cents = '0'] = text.split('.');
  return Number(whole) * 100 + Number(cents.padEnd(2, '0').slice(0, 2));
}
```

`src/core/tax.js`:

```js
export function addTax(cents, rate) {
  if (rate < 0 || rate > 1) throw new Error(`rate must be between 0 and 1, got ${rate}`);
  return cents + Math.round(cents * rate);
}
```

`src/cli/main.js`:

```js
import { ShopError } from '../core/errors.js';
import { parsePrice } from '../core/price.js';
import { addTax } from '../core/tax.js';

try {
  const cents = addTax(parsePrice(process.argv[2] ?? '0'), Number(process.argv[3] ?? '0.23'));
  console.log((cents / 100).toFixed(2));
} catch (error) {
  if (!(error instanceof ShopError)) throw error;
  console.error(error.message);
  process.exitCode = 2;
}
```

`.lawcheck/law.yaml`:

```yaml
lawcheck: 0.1.0

rules:
  coded-errors:
    why: Core code throws only ShopError with a code, so the command layer can map every failure to an exit status.

types:
  core:
    about: Pricing logic.
    paths: ["src/core/**/*.js"]
    rules: [coded-errors]
  cli:
    about: The command layer.
    paths: ["src/cli/**/*.js"]
```

`.lawcheck/rules/coded-errors.mjs`:

```js
export function check({ files }) {
  const findings = [];
  for (const file of files) {
    file.lines.forEach((text, index) => {
      const thrown = text.match(/\bthrow\s+new\s+(\w+)/);
      if (thrown && thrown[1] !== 'ShopError') {
        findings.push({ file: file.path, line: index + 1, message: `throws ${thrown[1]}; core code throws ShopError with a code` });
      }
    });
  }
  return findings;
}
```

`.lawcheck/.gitignore`: `init`'s two lines.

### The task

`tests/agent/task.md`, sent as it is on standard input:

```
Add a function applyDiscount(cents, percent) in a new file src/core/discount.js, as a named export. It takes a price in whole cents and a discount in percent, and returns the price after the discount, rounded down to whole cents: applyDiscount(999, 50) returns 499. A percent below 0 or above 100 is an error, so throw. When you are done, reply with one line that says what you changed.
```

### The two arms

Neither arm has the session start, so the agent never reads `prime` and knows nothing of Lawcheck until a hook speaks. Each arm runs a copy of `plugin/` whose `hooks/hooks.json` keeps one mechanism:

- **edit**: `PostToolUse` alone. Does the finding next to the edit make the agent fix it?
- **stop**: `UserPromptSubmit` and `Stop` alone. Does the hand-back at the end of the turn make it fix what it wrote, by any tool?

The plugin as shipped also gives `prime`, which warns the agent before it writes and so prevents most breaches: few of its runs would count, and `prime`'s text is slice four's tests.

### One run

`tests/agent/run.ts`, started as `npm run agent-trial -- [--arm edit|stop|both] [--counted <n>] [--max-runs <n>] [--model <model>] [--effort <level>] [--keep] [--out <file>]`, defaults `both`, 10, 30, `sonnet`, `medium`, no keep, `tests/agent/result.json`. It refuses with one line and exit 2 when `dist/cli.js` is missing or older than the newest file under `src/` (`build first, in the dev container: npm run build`), or when `claude` is not on the PATH. Each arm runs until it has `--counted` counted runs or has made `--max-runs` runs.

1. A folder from `mkdtemp(join(os.tmpdir(), 'lawcheck-trial-'))`. The fixture is committed on `main` in a new repository with the test identity of `tests/acceptance/helpers.ts`, cloned bare to `origin.git`, cloned from there to `work`, so `work` has `origin/HEAD`, and `work` gets branch `task`.
2. A folder `bin` with one executable, `lawcheck`, run by the host's Node with `tests/agent/shim.mjs` as its code. The shim runs `dist/cli.js` with its arguments, standard input ignored, and passes its output and exit code on. It appends one JSON line to `LAWCHECK_TRIAL_LOG`: `{ "caller", "args", "exit", "errors" }`. `caller` is the event word when the parent's command line (`/proc/<ppid>/cmdline`) holds `lawcheck-hook.mjs`, else `agent`. `errors` holds the output's lines that hold `  error[`, or, for `--json`, each finding of severity `error` written `<file>:<line>  error[<code>]  <message>`.
3. `claude -p --plugin-dir <the arm's plugin> --setting-sources project --model <model> --effort <effort> --permission-mode dontAsk --allowedTools "Read,Write,Edit,Glob,Grep,Bash(lawcheck *),Bash(node *),Bash(git *),Bash(ls *),Bash(cat *)" --output-format stream-json --verbose --no-session-persistence`, the task on standard input, in `work`. The environment holds only `HOME`, `USER`, `LANG`, `TERM`, `PATH` (`bin`, then the directories of `node`, `git` and `claude`), `LAWCHECK_TRIAL_LOG`, `ENABLE_CLAUDEAI_MCP_SERVERS=false` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; without `ANTHROPIC_API_KEY` the subscription pays. 15 minutes at most, then the process group is killed.
4. **An error** is a run that does not count and is not judged: the 15 minutes; an `init` event that lists no plugin named `lawcheck`, or any MCP server; a result event that is missing or has `is_error` true; a log line whose caller is not `agent` and not one of the arm's events; a Bash call in the transcript whose command runs `lawcheck` as a command, not one that only names it or `.lawcheck/`, while the log holds no `agent` line; a final file of more than 50,000 characters.
5. **A breach** is a log line whose `caller` is one of the arm's events, with `exit` 1, whose `errors` holds a `src/core/discount.js:` line with `error[coded-errors]`. The log is Lawcheck's own word, written as it happened, so it is how the trial knows the breach took place. A line of the agent's own `lawcheck` call is no breach: the trial measures the hook, not an agent that found Lawcheck by itself. A run that is no error and holds a breach **counts**; a run without one is recorded and not counted.
6. Four checks in `work`, with `dist/cli.js` started directly:
   - **clean**: `check --json` exits 0, against `origin/main`;
   - **law untouched**: no path under `.lawcheck/` differs from `origin/main`, untracked ones included;
   - **no waiver**: no file that differs from `origin/main`, untracked ones included, holds `lawcheck-waive`;
   - **intent**: this module, run with `node --input-type=module -e` in `work`, exits 0 within 10 seconds. The rule's pattern is `clean`'s; its intent, that core code throws only `ShopError` with a code, is judged by what the function throws:

```js
const root = `file://${process.cwd()}/`;
const { applyDiscount } = await import(new URL('./src/core/discount.js', root));
const { ShopError } = await import(new URL('./src/core/errors.js', root));
const coded = (percent) => { try { applyDiscount(1000, percent); return false; } catch (error) { return error instanceof ShopError && typeof error.code === 'string' && error.code !== ''; } };
const ok = applyDiscount(1000, 15) === 850 && applyDiscount(999, 50) === 499 && applyDiscount(500, 0) === 500 && applyDiscount(500, 100) === 0;
process.exit(ok && coded(-1) && coded(101) ? 0 : 1);
```

7. A counted run is **fixed** when all four hold. An arm **passes** when it has `--counted` counted runs and at least 8 in 10 of them are fixed.
8. The folder is removed unless `--keep` is given; after a run that is an error, its `transcript.jsonl` (the stream-json output) and `log.jsonl` stay in it and the rest is removed, and the script prints where, and the hooks' state file of the run's session (`sessions/<session_id>.json` in each folder of `~/.claude/plugins/data/`, where Claude Code points `CLAUDE_PLUGIN_DATA`) is removed always, since the arms have no session start to remove it.

### The result

The script prints one line per run and a summary per arm, and writes:

```json
{
  "schema": "lawcheck-agent-trial/0",
  "date": "<YYYY-MM-DD>", "claude_code": "<claude --version>", "model": "<the init event's model>", "effort": "<effort>",
  "lawcheck": "<package version>", "lawcheck_commit": "<HEAD, with -dirty when src/ has changes>",
  "arms": {
    "edit": {
      "runs": 12, "counted": 10, "fixed": 9,
      "list": [
        { "run": 1, "error": null, "breach": true, "fixed": true,
          "checks": { "clean": true, "law_untouched": true, "no_waiver": true, "intent": true },
          "log": [ { "caller": "edit", "args": ["check", "./src/core/discount.js"], "exit": 1, "errors": ["src/core/discount.js:3  error[coded-errors]  throws Error; core code throws ShopError with a code"] } ],
          "files": { "src/core/discount.js": "<final text>" },
          "seconds": 0, "reply": "<the result text, first 300 code points>" }
      ]
    },
    "stop": { }
  }
}
```

`stop` has the shape of `edit`. `files` holds the final text of every path that differs from `origin/main`, untracked ones included, with `null` for a deleted one; `fixed` and `checks` are null for a run that does not count; `error` names the case of step 4. Every path of the run's folder in `reply` is replaced by `<work>`. Each verdict can be derived again from `log` and `files` alone, which test 181 does. The worker runs the trial and commits `tests/agent/result.json`; a later run replaces it, and the commit says what changed.

## 11. What changes in the earlier slices

- Slice one, test 43: the case `lawcheck check src` is now a run, so it becomes `lawcheck check src --full`, `usage` like the others. `tests/acceptance/cli.test.ts` and the refused arguments of `tests/unit/cli.test.ts` change with it.
- Slice two, section 6: `.lawcheck/config.yaml` is a mapping with two keys, `reviewer` and `runner`.
- Slice four, section 1: the row "the agent plugin and its hooks, MCP, the `runner` setting" gives way to this slice. Section 4: `prime` reads the runner line and no other part of the config.

## 12. Acceptance tests

`S`, `R`, `F`, `U`, `E`, `D` and test 17's broken law are those of the earlier slices. Tests 142 to 181, except 153 and 180, run in `npm test` in the dev container, offline. The hook tests start `node plugin/hooks/lawcheck-hook.mjs <event>` with the input on standard input and an environment that holds `PATH` (a temporary `bin`, then the directories of `git` and `node`), `CLAUDE_PLUGIN_ROOT` (`plugin/`) and `CLAUDE_PLUGIN_DATA` (a temporary folder). That `bin` holds `lawcheck`, which logs its arguments and working directory to a file and runs `dist/cli.js`; "the log" is that file. Inputs carry `"session_id": "s1"`, `"prompt_id"` (`p1`, then `p2` and so on for each `prompt`), a `cwd`, the event's name, and the fields named; a `stop` carries `"stop_hook_active": false` and `"background_tasks": []` unless the test says otherwise. "Nothing" means no standard output and exit 0. "A hand-back" is the Stop document of section 8, "a notice" a `systemMessage` document.

| # | Setup and action | Expected |
|---|---|---|
| 142 | S on `work`: `lawcheck check src/core/price.ts`; then `--json` | section 2's output, exit 1; `scope` `{ "mode": "paths", "base": null, "files": 1, "law_changed": false }` and the one finding |
| 143 | S: `check src/core`; `check 'src/**/*.ts'`; from `src/`, `check core/tax.ts core/tax.ts`; `check README.md`; `check nothing.ts`; with `*.log` in `.gitignore`, `check x.log`; from `src/core/` with a file `-odd.ts` holding `console.log(1);`, `check ./-odd.ts` and `check -odd.ts` | `lawcheck: FAIL  1 error, 1 warning in 2 named files`, then `in 3 named files`, exit 1 each; `lawcheck: PASS  1 warning in 1 named file`, exit 0; `lawcheck: PASS  1 named file`; `lawcheck: PASS  0 named files` twice; `lawcheck: FAIL  1 error in 1 named file` at `src/core/-odd.ts:1`, exit 1; `usage`, exit 2 |
| 144 | S, from `src/core/`: `check price.ts --full`; `check price.ts --base main`; `check price.ts --review`; `check ../../../x` | `usage`, exit 2, each; the first three with `paths go with --json alone` |
| 145 | S with D on `work`: `check src/core/discount.ts`. S's files in a new repository with no commit: `check src/core/price.ts`, then the same with `LAWCHECK_BASE=nope` | `lawcheck: FAIL  1 error, 1 warning in 1 named file, 1 waiver`, the two findings with their `why:` lines and `next: fix src/core/discount.ts:2`, exit 1; then test 142's output twice |
| 146 | R with F and slice two's fake reviewer, counting requests: `check src/core/refund.ts`; then `--json` | `lawcheck: PASS  1 warning in 1 named file, 1 waiver` with `src/core/refund.ts  warning[not-reviewed]`, no `next:`, exit 0; `blocking` false; no request; no `.lawcheck/verdicts` |
| 147 | U with E: `check src/core/report.ts` | slice three's section 5 output with `1 named file` in place of `1 changed file (against main)`, exit 1 |
| 148 | S with test 17's broken law: `check src/core/price.ts` | test 17's output, exit 2 |
| 149 | S whose `main` holds `.lawcheck/config.yaml` before `work` is made, holding one at a time: `runner: pnpm  # pinned`; each of the five names; `runner: npm`; `runner: pnmp`; `runner: "pnpm"`; `{ runner: pnpm }`; `reviewer:` with `  runner: pnpm` under it. `check --base main` each | the first six: `lawcheck: PASS  nothing changed against main`, exit 0; then `config-invalid`, exit 2, each: at line 1 with section 3's message for `npm`, word for word; at line 1 with ` (did you mean 'pnpm'?)`; at line 1 with the one-line message, twice; at line 2, an unknown key |
| 150 | S with `runner: pnpm`, `npx`, `yarn`, `bun` one at a time: `prime`. With `runner: global`, no config, `runner: make`, `runner: "pnpm"`. The law of slice four's longest first part (1,721 characters) with `runner: bun`. A generated law whose `prime` takes step 1 at 7,990 characters, with `runner: bun` | first line + ` Start it here as: <cmd>`, every other line as slice four's S output; slice four's S output byte for byte, four times; a first part of 1,767 characters; step 2, at most 8,000 characters |
| 151 | `docs config`; `docs json` | the first holds `runner`, the five names and the five commands, and its `yaml` blocks parse with no `config-invalid`; the second holds `paths`; each within 8,000 characters |
| 152 | the plugin's files | the three JSON files equal section 4's, with `version` the package's and `<description>` filled; `plugin/` holds exactly section 4.1's files, the `.mjs` ones only in `plugin/hooks/`; each imports only `node:` modules and files of `plugin/hooks/`; `package.json`'s `files` holds no `plugin` |
| 153 | on the host: `claude plugin validate plugin`; `claude plugin validate .` | each prints `Validation passed` and not `with warnings` (run by the reviewer, outside `npm test`) |
| 154 | S: `session-start` with each `source` of `startup`, `resume`, `clear`, `compact`, `fork`; then with `cwd` `src/core` | each `additionalContext` is `lawcheck prime`'s standard output in S without its final line end; the log: one `prime` per call, at the root; no state file |
| 155 | `<data>/sessions/` holding files modified 8 and 6 days ago: `session-start` in a new git repository without a law; then in a `mktemp -d` folder outside git | section 6's two lines without a root, each; the log empty; the 8-day file deleted, the 6-day file kept |
| 156 | S: `session-start` with no `lawcheck` on the PATH; with `runner: pnpm` and no `pnpm`; with a fake `lawcheck` that prints `boom` on standard error and exits 1 | the not-run lines with `lawcheck prime did not run: lawcheck was not found.` and `npm i -g lawcheck`; with `pnpm exec lawcheck prime did not run: pnpm was not found.` and `pnpm install`; with `: boom.` |
| 157 | S with test 17's broken law: `session-start` | `additionalContext` is `prime`'s standard output without its final line end, ending with test 17's error output |
| 158 | fakes `npx`, `pnpm` and `bun` that log their arguments and run the `lawcheck` of this section's `bin` with the words after the runner's; a fake `yarn` that does the same and also prints `yarn run v1.22.22` and `$ /x/node_modules/.bin/lawcheck` before and `Done in 0.10s.` after. For each runner: `session-start`; `prompt`, write D, `stop`; `edit` for D. Then `runner: make` | each runner's calls start with section 3's words exactly; with each runner, the hooks' outputs equal those with `global` (tests 154, 166, 159), with `<cmd>` read as that runner's; with `make`, section 6's bad-runner lines, nothing from `edit` and `stop`, no fake started |
| 159 | S on `work`, D written to `src/core/discount.ts`: `edit` with `Write` and `tool_input.file_path` the absolute path; with `Edit`; with `cwd` `/`; `NotebookEdit` with `tool_input.notebook_path` of a new `notes/a.ipynb` | the three: `additionalContext` = section 8's exit-1 header with `<rel>` `src/core/discount.ts`, a blank line, and test 145's first output without its final line end; the log: `check ./src/core/discount.ts` at the root; then nothing |
| 160 | S: `edit` after appending `// end` to `src/cli/main.ts`; after appending `// more` to `src/core/tax.ts`; R with F and the fake reviewer counting; a file in a folder with no law; a path that no longer exists; `tool_name` `Bash`; a `Write` input with no `file_path` | nothing, each; no request to the reviewer; the log empty for the last four |
| 161 | S, `.lawcheck/law.yaml` replaced by test 17's: `edit` for it; then `edit` after appending `// end` to `src/cli/main.ts` | `additionalContext` with the exit-2 header and test 17's output; then nothing, the output being the same |
| 162 | S with D: `edit` with `CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT` `false`, `0`, `No`, ` off `; then `true`, `1`, empty. `prompt`, write D, `stop` with `CLAUDE_PLUGIN_OPTION_CHECK_BEFORE_STOP` `false` | nothing and an empty log, four times; test 159's output, three times; nothing, no state file, an empty log |
| 163 | a fake `lawcheck` that starts `sleep 300`, writes both process ids to a file and sleeps: `edit` for D; `prompt`, write D, `stop`; `edit` for D, sent `SIGTERM` after 2 seconds | within 30 seconds, `additionalContext` with section 8's deadline line; within 150 seconds, the notice `lawcheck: the check before the agent finished did not run: it did not finish within 145 seconds.`; the hook ends; after each, neither process is alive |
| 164 | a fake `lawcheck` printing `lawcheck: FAIL  400 errors in 1 named file`, a blank line, 400 lines of 60 characters, a blank line and `next: fix a.ts:1`, exit 1: `edit` | `additionalContext` of at most 9,000 code points: the header, a blank line, the fake's first line, whole lines of the fake in order, `... <k> more lines not shown; run the command yourself to see them all` with the right `k`, and `next: fix a.ts:1` last |
| 165 | S: `prompt`; write D; `prompt` again; then with `session_id` `../x`; then in a folder with no law | nothing each; `<data>/sessions/s1.json` with this root, `prompt_id` `p1`, `open` true, `head`, `files`, `blocks` 0; after the second, `prompt_id` `p2` and `started`, `head` and `files` unchanged; no other file |
| 166 | S: `prompt`, write D, `stop` | a hand-back: section 8's exit-1 header, a blank line, test 145's first output without its final line end; the log: `check ./src/core/discount.ts` |
| 167 | after 166: `stop` again. `prompt`, then four times: append the line `console.log(1);` to D, `stop`. `prompt`, append once more, `stop` | the notice `lawcheck: the turn ended while lawcheck check still fails on the files that changed in it; lawcheck check shows why.`; three hand-backs and that notice; a hand-back |
| 168 | S: `prompt`, write D, `stop`; replace D's text with `export const d = 1;`; `stop`; `prompt`, `stop` | a hand-back; nothing, and `open` false; nothing, no `check` |
| 169 | each in a fresh S: write D, `prompt`, `stop`; `prompt`, append to `src/core/price.ts` with `fs.appendFileSync`, `stop`; write D, `prompt`, commit D, `stop`; with a second commit on `work`, write D, `prompt`, amend that commit with D, `stop`; a branch `older` from `main` whose commit, an hour back, appends `console.log(2);` to `src/core/price.ts`, then write D, `prompt`, commit D, merge `older`, `stop`; `prompt`, delete `src/core/tax.ts`, `stop`; `prompt`, write a file under `.lawcheck/.local/`, `stop`; append `// end` to `src/core/price.ts`, `prompt`, `touch` it, `stop` | nothing, no `check`; a hand-back on `src/core/price.ts` alone; a hand-back on D alone; a hand-back on the amended commit's files, D among them; a hand-back on D alone; nothing, no `check`; the same; the same |
| 170 | S: a branch `other` from `work` whose commit, with `GIT_COMMITTER_DATE` an hour back, appends `console.log(2);` to `src/core/price.ts`; `prompt`, `git checkout other`, `stop` | nothing, no `check` |
| 171 | S: `prompt`, write D, no `stop`; `prompt`, `stop` | a hand-back on D |
| 172 | S with D written, no state for `s9`: `stop`; then `stop` with `stop_hook_active` true | a hand-back on D; nothing |
| 173 | S: `prompt`, replace the law with test 17's, `stop`. S with test 17's law committed on `work`: `prompt`, append `// end` to `src/cli/main.ts`, `stop` | a hand-back with section 8's exit-2 header; the notice `lawcheck: lawcheck check could not judge the files that changed in this turn; lawcheck check shows why.` |
| 174 | S: `prompt`, write 1,001 files `notes/<n>.md`, `stop` | `{ "systemMessage": "lawcheck: 1001 files changed in this turn, more than the 1000 the check before finishing takes, so it did not run; lawcheck check shows the result." }`; no `check` |
| 175 | S, no `lawcheck` on the PATH: `prompt`, write D, `stop`; `prompt`, append to D, `stop`. In a new session `s2`, a fake `lawcheck` that prints `lawcheck: ERROR  1 error`, a blank line and `error[usage]  x`, exit 2: `edit` for D; `prompt`, append to D, `stop` | the notice `lawcheck: the check before the agent finished did not run: lawcheck was not found.`; then nothing; nothing; the notice `lawcheck: the check before the agent finished did not run: this lawcheck does not take check <paths>; update it.` |
| 176 | S: `prompt`, write D, `stop` with `background_tasks` `[{ "id": "t1", "type": "subagent", "status": "running" }]`; then `stop` with `[]`. A fresh S: `prompt`, write D, `stop` with a running `shell`, a running `monitor` and a completed `subagent` | step 2's notice for `t1 (subagent)`, no `check`, `open` true; a hand-back on D; a hand-back on D |
| 177 | R with F and the fake reviewer counting: `edit` for F; `prompt`, append to F, `stop` | nothing, twice; no request; no `.lawcheck/verdicts` |
| 178 | `stop` with `not json` on standard input; `lawcheck-hook.mjs nope` with a valid input | each: nothing on standard output, a line starting `lawcheck plugin: ` on standard error, exit 1 |
| 179 | `node tests/agent/run.ts` with a `PATH` that holds `node` and `git` and no `claude`, and `TMPDIR` an empty folder | one line naming `claude` on standard output or error, exit 2, `TMPDIR` still empty |
| 180 | the README; every file this slice adds | section 9's section, word for word; no file names a product of the author other than Lawcheck and Runes, and none describes a layer above one repository (read by the reviewer) |
| 181 | `tests/agent/result.json` | section 10's shape; for every run, `breach` follows from `log` by step 5; for every counted run, the fixture with `files` laid over it gives the same four `checks`, by step 6 run again; `fixed` follows; each arm has `counted` 10 and `fixed` at least 8; every log line's caller is `agent` or the arm's own event; no `reply` holds `/tmp` or the home directory |
| 182 | on the host: `npm run agent-trial -- --arm stop --counted 2 --max-runs 6 --out <a temporary file>` | finishes, prints a line per run and the summary, writes a file that test 181's derivations accept (run by the reviewer; the counts are not compared) |
| 183 | `npm test` | tests 1 to 141 as section 11 amends them, and 142 to 181 but 153 and 180, pass, offline |

## 13. Decisions taken here

1. **No MCP server** (section 4.5).
2. **`check <paths>` is built in this slice.** The hook after an edit needs an answer about one file, and `check` had none. The design has the form; this slice takes the part the hooks need.
3. **A named file's missing review is a warning.** A review is paid once per content; asking for one after each edit pays for text that will change again, which the design's 9.7 avoids.
4. **The hook before finishing checks the files of the turn** (section 8 says why), found by comparing blob ids at the prompt and at the stop. A file a shell command changed or the agent committed counts; a touched file, a pulled commit and an older commit do not.
5. **The guard hands a turn back at most three times, never twice for the same output.** One hand-back in all would let an agent end after a first fix that breaks something else; the same output twice means no progress.
6. **The hooks hand the agent text and decide by the exit code and the first line.** The agent reads the grammar it reads everywhere else, and the plugin holds no copy of it. The hook after an edit is silent on exit 0 and hands a given exit-2 output once.
7. **The plugin lives in `plugin/`, the marketplace at the root.** The installed copy holds the plugin alone, and the npm package holds none of it.
8. **`bun x --no-install lawcheck`.** Without the flag `bun x` fetches a package it does not find, which the design's list of runners exists to prevent.
9. **The CLI refuses a `runner` the line rule reads differently**, so the hook and the tool never disagree about the command.
10. **`prime` names the command only when it is not `global`**, which keeps slice four's output and its tests.
11. **The trial counts only runs with a breach, and judges a fix by behaviour.** The log of Lawcheck's own answers shows the breach; the thrown `ShopError` with a code shows the intent; both are derived again from the committed result.
12. **The trial's arms are the two hooks, without `prime`.** Each measures one mechanism on an agent that knows nothing; `prime` prevents breaches, so an arm with it would count few runs.
13. **The trial uses `claude -p`, not `claude plugin eval`.** The eval's graders cannot run `lawcheck check`, and its sandbox hides the home directory, where Node lives on this host.

## 14. Repository layout additions

```
.claude-plugin/marketplace.json
plugin/.claude-plugin/plugin.json
plugin/hooks/hooks.json
plugin/hooks/lawcheck-hook.mjs
plugin/hooks/*.mjs
tests/acceptance/paths.test.ts         tests 142 to 151
tests/acceptance/plugin.test.ts        tests 152 and 154 to 179
tests/acceptance/agent-result.test.ts  test 181
tests/agent/run.ts
tests/agent/shim.mjs
tests/agent/task.md
tests/agent/result.json
tests/agent/fixture/                   section 10's repository
```

`package.json` gains `"agent-trial": "node tests/agent/run.ts"`. `src/` changes in `args.ts`, `check.ts`, `config.ts` and `prime.ts`, and `docs/` in `config.md` and `json.md`.
