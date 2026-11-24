# Lawcheck in GitHub Copilot CLI

In GitHub Copilot CLI, an agent writes `console.log` into `src/core/total.ts`. The [law](concepts.md#law) of the repository forbids that call there. With the Lawcheck plugin for Copilot CLI, the agent sees the [finding](concepts.md#finding) after its `create` or `edit`. A turn is the work the agent does for one message of yours. Before the agent ends its turn, the plugin sends it back to work while the files it changed in the turn break the law. At the start of a session, the plugin gives the agent a summary of the law. This page covers the `copilot` program in a terminal, not Copilot in VS Code and not the Copilot coding agent on GitHub.

The outputs below come from a repository with this law. Its [script rule](concepts.md#script-rule) `no-console` is the rule of [The first type and the first rule](first-law.md). The file `src/core/total.ts` has the [type](concepts.md#type) `library`:

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

## 1. Install Lawcheck

The plugin ships without Lawcheck. It starts the `lawcheck` program on your `PATH`, unless the `runner` setting in `.lawcheck/config.yaml` names another command ([Settings](config.md#runner)). Install Lawcheck with npm:

```text
$ npm install --global lawcheck@alpha
```

## 2. Add the plugin

Run these two commands in a terminal:

```text
copilot plugin marketplace add krzysztofdudek/Lawcheck
copilot plugin install lawcheck@lawcheck-marketplace
```

`copilot plugin list` then shows `lawcheck` as enabled. The plugin's hooks run in every session you start after that.

The hooks need `node` and `git` on the `PATH`. The hooks after an edit and before the end of a turn run `lawcheck check`, which runs the repository's script rules on your machine with your rights. A script rule is code of the repository, as its tests are. Use the plugin only in a repository whose code you would run yourself.

## 3. Start a session

When a session starts, the plugin gives the agent the text that `lawcheck prime` prints. The text says how to work in this repository, which steps need your word, and what the law holds, in short. You read the same text with:

```text
$ lawcheck prime
```

## 4. See the check after an edit

The agent writes `src/core/total.ts` with `create`. After the edit, the plugin runs `lawcheck check ./src/core/total.ts`. The agent gets this text after the result of its tool:

```output
Lawcheck: after this edit, src/core/total.ts breaks the law of this repository. lawcheck check ./src/core/total.ts printed:

lawcheck: FAIL  1 error in 1 named file

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

The plugin checks the file after `create`, `edit`, `str_replace_editor` and `apply_patch`. Copilot CLI takes at most 10 KB of such text, so the plugin cuts a long output to that size and says how many lines it left out.

The check after an edit does not see a file that the agent writes through the shell, such as with a here-document. Copilot's agent often writes files that way: in the 24 sessions of the trial below that had the check after an edit, it wrote every file with a shell command, so that check never ran. The check before the end of the turn judges every file of the turn, so it catches such a file.

## 5. See the check before the agent finishes

Before the agent ends its turn, the plugin checks every file that changed in the turn. While those files break the law, the plugin sends the agent back to work with this text:

```output
Lawcheck: the files that changed in this turn break the law of this repository. Fix the code, then finish; if a fix needs the user's word, tell the user what blocks you and finish. lawcheck check on those files printed:

lawcheck: FAIL  1 error in 1 named file

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

The plugin sends the agent back at most three times in one turn. It does not send the agent back twice in a row for the same output.

Copilot CLI gives a plugin no place to write to you. So when the plugin lets the agent finish while the check still fails, it sends the agent back once more, with this text:

```output
Lawcheck: before you finish, tell the user this message, word for word, then finish:

Lawcheck: the turn ended while the check of its files still fails. lawcheck check shows why.
```

The agent then tells you the message in its answer. The plugin does the same, once per turn, with the waivers the agent added and the changes it made to the law in the turn. When the law has a [reviewer rule](concepts.md#reviewer-rule) and `.lawcheck/config.yaml` sets no reviewer, the text of the session start asks the agent to tell you that in its first answer.

## 6. Switch off one of the checks

Copilot CLI gives a plugin no settings, so the two checks switch off through variables of the environment in which you start `copilot`. This line starts Copilot CLI with no check after an edit:

```text
LAWCHECK_PLUGIN_CHECK_AFTER_EDIT=false copilot
```

`LAWCHECK_PLUGIN_CHECK_BEFORE_STOP=false` switches off the check before the agent finishes, and the messages at the end of a turn with it. The plugin reads `false`, `0`, `no` and `off` as off, in upper or lower case. [The Claude Code plugin](plugin.md) says what each hook does, and in which cases it prints nothing.

## 7. Write the first law

The plugin holds one skill, `lawcheck:setup`. It writes the first law of a repository with you and changes nothing outside `.lawcheck/`. Only you start it, by typing `/lawcheck:setup` in Copilot CLI, with what you want after it. The skill's file sets `disable-model-invocation: true`, which Copilot CLI honors, so Copilot never starts it from your prompt on its own. In a folder with no law, the agent tells you to type the command instead of writing a law. [The setup skill](plugin.md#the-setup-skill) says what the skill does, including advice on the architecture and a target architecture, which you ask for in the words you type after the command. The agent asks its questions in a message, and its last message names the next step.

## What this integration does not do

- It writes nothing to you itself. It asks the agent to tell you, which costs one more answer of the model, and the agent may put the message in its own words.
- It checks no file after an edit that a shell command wrote. The check before the end of the turn judges that file.
- It has no switch for the setup skill: it starts only when you type `/lawcheck:setup`. That Copilot CLI honors the flag comes from its changelog, which says so since version 1.0.74; the skill was not started in a Copilot CLI session.
- It has no settings in Copilot CLI. Two variables of the environment switch its checks off.
- It is not in Copilot's own directory of plugins. It comes from the marketplace of the Lawcheck repository.
- It does not run in Copilot in VS Code or in the Copilot coding agent on GitHub. The coding agent installs no plugins.
- It was tried on Linux, in a container. It was not tried on macOS or Windows, and not after Copilot CLI compacts a long conversation.

## The trial

On 2026-11-24 the plugin ran in real sessions of GitHub Copilot CLI 1.0.105. Copilot sent its model calls to an endpoint that answered with Claude Sonnet 5.5. 23 of the 40 sessions got one prompt in one small shop: add a discount to the core code and show the saved amount as money. `tests/agent/result-copilot.json` in the repository holds every session.

- With the whole plugin, the law reached the agent in 10 of 10 sessions. No session imported the API code into the core, and 10 of 10 ended with passing tests and a passing `lawcheck check`.
- Without a law and without the plugin, 0 of 10 sessions imported the API code into the core.
- With a `lawcheck` that fails every check, the plugin sent the agent back three times, then once more to tell the user, and then let it finish, in 3 of 3 sessions. In 3 of 3 the agent's last answer was the message, word for word.
- In the shop no session imported the API code into the core, so the other 17 sessions ran in a second repository with its own task. With the hook after an edit alone, the agent broke the law there in 1 of 14 sessions, and the hook did not see it. With the hook before the end of a turn alone, no agent broke the law in 3 sessions. So these sessions show nothing about a fix. A test of the repository plants a breach and checks that each of the two hooks sends the agent back.
- In the 24 sessions with the hook after an edit, the agent wrote every file with a shell command, so that hook never ran a check.

## If it goes wrong

- Nothing happens in a session. Run `copilot plugin list`, and enable `lawcheck` with `copilot plugin enable lawcheck@lawcheck-marketplace` when it shows as disabled.
- The agent gets the message that `lawcheck prime` did not run because `lawcheck was not found`. The plugin found no Lawcheck through the command of the `runner` setting, which is `lawcheck` on your `PATH` by default. Install Lawcheck as [Install Lawcheck](#_1-install-lawcheck) says, then start a new session.
- The agent ended its turn, and CI fails. The plugin judges the files of the turn alone, with no [base](concepts.md#base). It never passes `--review`. CI judges the whole [change](concepts.md#change) and fails on `not-reviewed` ([CI and git hooks](ci.md)).

Next: [Other coding agents](other-agents.md)
