# Lawcheck in Cursor

Cursor runs the Lawcheck plugin for Claude Code. Cursor loads the plugins that Claude Code has installed, and the plugin's hooks run in Cursor on the same events. There is no second plugin for Cursor. This page says how to install the plugin so that Cursor loads it, what each hook does in Cursor, and what was checked and what was not.

## 1. Install Lawcheck

The plugin ships without Lawcheck. It starts the `lawcheck` program on your `PATH`, unless the `runner` setting in `.lawcheck/config.yaml` names another command ([Settings](config.md#runner)). Install Lawcheck with npm:

```text
$ npm install --global lawcheck@alpha
```

## 2. Add the plugin

Run these two commands in a terminal. They need the `claude` program, because Cursor reads the plugins that Claude Code installed:

```text
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

Then start a new agent session in Cursor. Cursor loads the plugin while the setting "Include Third-Party Plugins, Skills, and Other Configs" is on, in Cursor Settings under Agents and Third-Party Imports. The setting is on by default. To keep the plugin out of Cursor and leave it in Claude Code, write `"lawcheck@lawcheck-marketplace": false` under `enabledPlugins` in `~/.claude/settings.json`. That also switches it off in Claude Code.

The hooks need `node` and `git` on the `PATH`. The hooks after an edit and before the end of a turn run `lawcheck check`, which runs the repository's script rules on your machine with your rights. A script rule is code of the repository, as its tests are. Use the plugin only in a repository whose code you would run yourself.

## 3. What each hook does in Cursor

Cursor runs the four hooks of the plugin on its own events:

| Hook of the plugin | Event in Cursor | What the agent gets |
|---|---|---|
| `SessionStart` | `sessionStart` | the text that `lawcheck prime` prints, once, when the session starts |
| `UserPromptSubmit` | `beforeSubmitPrompt` | nothing; the hook notes the files that differ from `HEAD` |
| `PostToolUse` | `postToolUse` | the output of `lawcheck check` on the file that the `Write` tool wrote, when the file breaks the law |
| `Stop` | `stop` | the output of `lawcheck check` on the files of the turn, as a message that Cursor sends as the next message of yours |

The texts are the ones of [Lawcheck in Claude Code](claude-code.md). Four things differ in Cursor:

- Cursor calls the tool that writes a file `Write`, and the plugin checks the files of that tool. A file that the agent writes through the shell gets no check after the edit, and the check before the agent finishes catches it.
- Cursor shows the user no message that a hook sends, so the plugin asks the agent to tell you. At the start of a session it asks once when a reviewer rule has no reviewer set ([The Claude Code plugin](plugin.md#sessionstart)). At the end of a turn it asks once for the messages that the `Stop` hook sends the user ([The end of a turn](plugin.md#the-end-of-a-turn), [The notices the user gets](plugin.md#the-notices-the-user-gets)).
- Cursor sets no limit on the returns of a hook of a Claude Code plugin, so the plugin keeps its own: at most three returns in a turn, and never two in a row for the same output ([Three returns at most](plugin.md#three-returns-at-most)).
- When you stop the agent, or a turn ends with an error, Cursor runs the `Stop` hook with a status that is not `completed`. The plugin then checks nothing and sends no return.

Cursor passes no plugin settings, so the two checks of [The settings](plugin.md#the-settings) stay on.

## 4. What was checked, and what was not

Checked:

- Cursor's documentation of its hooks: it loads Claude Code hooks, maps `SessionStart`, `UserPromptSubmit`, `PostToolUse` and `Stop` to the four events above, maps the Claude Code tool `Edit` to its own `Write`, and treats a `Stop` hook's `decision` of `block` with a `reason` as a message sent as the next one.
- The code of Cursor Agent CLI 2026.11.22, read on disk with no account. It loads the plugins in `~/.claude/plugins/installed_plugins.json` that `enabledPlugins` does not switch off. It reads `.claude-plugin/plugin.json` and the `hooks/hooks.json` of the plugin, joins each `command` and its `args`, and sets `CLAUDE_PLUGIN_ROOT` for the hook. It runs a plugin's hooks from the plugin's folder, except `stop`, which runs from the workspace. The input of the session start and of `beforeSubmitPrompt` holds no `cwd` and names the workspace in `workspace_roots`. The input of a `Write` holds `file_path`. The input of `stop` holds `status` and `loop_count`, and no `stop_hook_active`. Its output handling reads `hookSpecificOutput` with `additionalContext` for the first three events, and has no place for a message to the user.
- Lawcheck's tests run the plugin's hooks on inputs with these fields, and the hooks give the outputs of this page.

Not checked:

- No session of Cursor ran the plugin. Running an agent needs a Cursor account, and none was used.
- The Cursor editor. The code read is the one of Cursor Agent CLI.
- Windows. Cursor starts a hook there through PowerShell, and the check did not follow how it expands `${CLAUDE_PLUGIN_ROOT}`.
- The marketplace of Cursor and its commands, such as `agent plugin marketplace add`, and a team marketplace. The way above does not use them.
- Cursor's cloud agents.
- Whether the agent follows the text that a hook gives it.

## If it goes wrong

- The agent gets no law at the start of a session. Check that `claude plugin list` names `lawcheck@lawcheck-marketplace`, that the setting of [Add the plugin](#_2-add-the-plugin) is on, and that `enabledPlugins` does not hold `false` for the plugin.
- A hook prints `Lawcheck plugin:` and a cause on standard error, and Cursor lets the agent go on. The cause names what to fix.
- The agent finishes while a file breaks the law. The plugin sends the agent back at most three times in a turn. Run the same check in CI ([CI and git hooks](ci.md)).

Next: [Other coding agents](other-agents.md)
