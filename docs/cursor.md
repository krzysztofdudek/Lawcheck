# Lawcheck in Cursor

Cursor loads the plugins that Claude Code has installed, so Cursor loads the Lawcheck plugin through its support for Claude Code plugins. No session of Cursor has run the plugin yet. This page says how to install the plugin so that Cursor loads it, and what was checked and what was not.

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

Then start a new agent session in Cursor. Cursor loads the plugin while the setting for third-party plugins is on, under `Cursor Settings > Agents > Third-Party Imports`. The setting is on by default. Cursor loads a plugin only when `enabledPlugins` holds `true` for it: in `~/.claude/settings.json` for a plugin installed for the user, and in the repository's `.claude/settings.json` or `.claude/settings.local.json` for a plugin installed for that project. `claude plugin install` writes that value. To keep the plugin out of Cursor, set the value to `false`. That also switches the plugin off in Claude Code.

The hooks need `node` and `git` on the `PATH`. The hooks after an edit and before the end of a turn run `lawcheck check`, which runs the repository's script rules on your machine with your rights. A script rule is code of the repository, as its tests are. Use the plugin only in a repository whose code you would run yourself.

## 3. Add two entries for the other hooks

No session of Cursor has run the plugin, so this page does not say which hooks of the plugin run in Cursor or what they need. [Lawcheck in Claude Code](claude-code.md) says what each hook does where it was run.

## 4. What each hook does in Cursor

No session of Cursor has run the plugin, so this page does not say what its hooks do in Cursor. The hooks are those of [The Claude Code plugin](plugin.md#the-four-hooks).

## 5. What was checked, and what was not

These were checked:

- Cursor's documentation of third-party hooks says that Cursor loads Claude Code hooks while its setting for third-party imports is on, and that the setting is on by default.
- The code of Cursor's command-line agent, version 2026.11.22, read on disk with no account, loads the plugins in `~/.claude/plugins/installed_plugins.json` for which `enabledPlugins` holds `true`, and none for which it holds `false`.

These were not checked:

- No session of Cursor ran the plugin. An agent needs a Cursor account to run, and none was used.
- The hooks of the plugin that run in Cursor, what each one gives the agent, and what the agent does with it.
- The Cursor editor. The code read is the one of the command-line agent.
- Windows.
- The marketplace of Cursor, its commands and a team marketplace. The way above does not use them.
- Cursor's cloud agents.
- That Cursor starts the setup skill of the plugin with `/lawcheck:setup`.

## If it goes wrong

- The agent gets no law at the start of a session. Check that `claude plugin list` names `lawcheck@lawcheck-marketplace`, that the setting of [Add the plugin](#_2-add-the-plugin) is on, and that `enabledPlugins` holds `true` for the plugin where [Add the plugin](#_2-add-the-plugin) says.
- Nothing checks the files of a turn in Cursor. Run the same check in CI ([CI and git hooks](ci.md)).

Next: [Other coding agents](other-agents.md)
