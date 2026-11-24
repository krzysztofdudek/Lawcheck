# Lawcheck in Cursor

Cursor runs the Lawcheck plugin for Claude Code. Cursor loads the plugins that Claude Code has installed. A hook is a command that the agent's program runs at a set moment of a session, such as after an edit. In Cursor, the hooks of the plugin run on Cursor's own events. Lawcheck has no second plugin for Cursor. Two of the four hooks run from the plugin alone: the one at the start of a session and the one after an edit. The other two run only after you add two entries to a `hooks.json` file of Cursor: the hook at the prompt and the one before the agent finishes ([Add two entries for the other hooks](#_3-add-two-entries-for-the-other-hooks)). This page says how to install the plugin so that Cursor loads it. It says what each hook does in Cursor, and what was checked and what was not.

## 1. Install Lawcheck

The plugin ships without Lawcheck. It starts the `lawcheck` program on your `PATH`, unless the `runner` setting in `.lawcheck/config.yaml` names another command ([Settings](config.md#runner)). Install Lawcheck with npm:

```text
$ npm install --global lawcheck@alpha
```

## 2. Add the plugin

Run these two commands in a terminal. Both need the `claude` program, because Cursor reads the plugins that Claude Code installed:

```text
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

Then start a new agent session in Cursor. Cursor loads the plugin while the setting for third-party plugins is on, under `Cursor Settings > Agents > Third-Party Imports`. The setting is on by default. Cursor loads a plugin only when `enabledPlugins` holds `true` for it. `enabledPlugins` is a key of Claude Code's settings. For a plugin installed for the user, that key is in `~/.claude/settings.json`. For a plugin installed for one project, it is in the repository's `.claude/settings.json` or `.claude/settings.local.json`. `claude plugin install` writes that value. To keep the plugin out of Cursor, set the value to `false`. That also switches the plugin off in Claude Code.

The hooks need `node` and `git` on the `PATH`. Two of the hooks, the one after an edit and the one before the end of a turn, run `lawcheck check`. That command runs the repository's script rules on your machine, with your rights. A script rule is code of the repository, as its tests are. Use the plugin only in a repository whose code you would run yourself.

## 3. Add two entries for the other hooks

Cursor's command-line agent runs two of the hooks only when a `hooks.json` file of Cursor holds an entry for their event: the hook at the prompt and the hook before the agent finishes. That file is `~/.cursor/hooks.json` or the `.cursor/hooks.json` of the repository. The hooks of a plugin do not count as entries. Without the two entries below there is no check before the agent finishes. The plugin also notes no files of the turn, and it sends no message at the end of a turn. Put the entries in `.cursor/hooks.json`. If that file exists, add the two keys to its `hooks`:

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [{ "command": "echo {}" }],
    "stop": [{ "command": "echo {}" }]
  }
}
```

Each entry only prints `{}`. With the entry in place, Cursor runs the event. Cursor then runs the plugin's hook for that event beside the entry.

## 4. What each hook does in Cursor

Cursor runs the four hooks of the plugin on its own events:

| Hook of the plugin | Cursor event | Runs from the plugin alone | What the agent gets |
|---|---|---|---|
| `SessionStart` | `sessionStart` | yes | the text that `lawcheck prime` prints, once, when the session starts |
| `UserPromptSubmit` | `beforeSubmitPrompt` | no, it needs its entry | nothing; the hook notes the files that differ from `HEAD` |
| `PostToolUse` | `postToolUse` | yes | the output of `lawcheck check` on the file that the `Write` tool wrote, when the file breaks the law |
| `Stop` | `stop` | no, it needs its entry | the output of `lawcheck check` on the files of the turn, as a message that Cursor sends as the next message of yours |

The texts are the ones of [Lawcheck in Claude Code](claude-code.md). Four things differ in Cursor:

- Cursor calls the tool that writes a file `Write`. The plugin checks the files that `Write` writes. A file that the agent writes through the shell gets no check after the edit. The check before the agent finishes catches that file.
- Cursor shows the user no message that a hook of this plugin sends. So the plugin asks the agent to tell you. At the start of a session, it asks once, when the law has a reviewer rule and no reviewer is set ([The Claude Code plugin](plugin.md#sessionstart)). At the end of a turn, it asks once for the messages that the `Stop` hook has for you ([The end of a turn](plugin.md#the-end-of-a-turn), [The notices the user gets](plugin.md#the-notices-the-user-gets)).
- A return is one time the plugin sends the agent back to work. Cursor sets no limit on the returns of a hook of a Claude Code plugin. So the plugin keeps its own limit: at most three returns in a turn, and never two in a row for the same output ([Three returns at most](plugin.md#three-returns-at-most)).
- You may stop the agent, or a turn may end with an error. In both cases, Cursor runs the `Stop` hook with a status other than `completed`. The plugin then checks nothing and sends no return. The next turn starts with all three returns.

Cursor passes no plugin settings, so the two checks of [The settings](plugin.md#the-settings) stay on.

## 5. What was checked, and what was not

These were checked:

- Cursor's documentation of its hooks. By that documentation, Cursor loads Claude Code hooks. Cursor maps `SessionStart`, `UserPromptSubmit`, `PostToolUse` and `Stop` to the four events above. Cursor maps the Claude Code tool `Edit` to its own `Write`. Cursor treats a `Stop` hook's `decision` of `block` with a `reason` as a message sent as the next one. The documentation lists a `cwd` for the input of the edit, and none for the session start and `beforeSubmitPrompt`.
- The code of Cursor's command-line agent, version 2026.11.22, read on disk with no account. It loads the plugins in `~/.claude/plugins/installed_plugins.json` for which `enabledPlugins` holds `true`, and none for which it holds `false`. It runs the events `stop` and `beforeSubmitPrompt` only when the `hooks.json` of the user or of the project has an entry for them. Once it runs an event, it runs every source for that event, the hooks of plugins included. It reads `.claude-plugin/plugin.json` and the `hooks/hooks.json` of the plugin. It joins each `command` with its `args`, and it sets `CLAUDE_PLUGIN_ROOT` for the hook. Cursor calls the folder the agent works in its workspace. The agent runs a plugin's hooks from the plugin's folder, except `stop`, which runs from the workspace. Every input names the workspace in `workspace_roots`. The input of a `Write` holds `file_path`. The input of `stop` holds `status` and `loop_count`, and no `stop_hook_active`. For the first three events, the agent reads `hookSpecificOutput` with `additionalContext` from the output of a hook. It has no place for a message to the user, except the message of a hook that blocks a prompt or a tool.
- The hooks of the plugin, run on inputs with these fields, give the outputs of this page. The inputs are built from the documentation and the code above, not recorded from a session.

These were not checked:

- No session of Cursor ran the plugin. An agent needs a Cursor account to run, and none was used.
- The Cursor editor. The code read is the one of the command-line agent.
- That the plugin's `stop` and `beforeSubmitPrompt` hooks run beside the two entries. The code runs every source for the event, and no session showed it.
- Windows. Cursor starts a hook there through the Windows shell. The check did not follow how that shell expands `${CLAUDE_PLUGIN_ROOT}`.
- The marketplace of Cursor, its commands and a team marketplace. The way above does not use them.
- Cursor's cloud agents.
- That Cursor starts the setup skill of the plugin with `/lawcheck:setup`. The text at the start of a session names that command when the folder has no law.
- That the agent follows the text that a hook gives it.

## If it goes wrong

- The agent gets no law at the start of a session. Check three things. `claude plugin list` names `lawcheck@lawcheck-marketplace`. The setting for third-party plugins of [Add the plugin](#_2-add-the-plugin) is on. `enabledPlugins` holds `true` for the plugin, in the file that [Add the plugin](#_2-add-the-plugin) names.
- A hook prints `Lawcheck plugin:` and a cause on standard error. Cursor lets the agent go on. The cause names what to fix.
- The agent finishes while a file breaks the law, and the plugin checked nothing at the end of the turn. The two entries of [Add two entries for the other hooks](#_3-add-two-entries-for-the-other-hooks) are missing. With them, the plugin sends the agent back at most three times in a turn. Run `lawcheck check` in CI as well ([CI and git hooks](ci.md)).

Next: [Other coding agents](other-agents.md)
