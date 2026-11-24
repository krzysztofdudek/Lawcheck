# Lawcheck in GitHub Copilot CLI

In GitHub Copilot CLI, an agent writes `console.log` into `src/core/total.ts`. The [law](concepts.md#law) of the repository forbids that call there. With the Lawcheck plugin for Copilot CLI, the agent sees the [finding](concepts.md#finding) after its tool `create` or `edit` writes the file. A turn is the work the agent does for one message of yours. Before the agent ends its turn, the plugin checks the files it changed in the turn. While those files break the law, the plugin sends the agent back to work. At the start of a session, the plugin gives the agent a summary of the law. This page covers the `copilot` program in a terminal. It does not cover Copilot in VS Code or the Copilot coding agent on GitHub.

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

`copilot plugin list` then shows `lawcheck` as enabled. A hook is a command that Copilot CLI runs at a set moment of a session, such as after an edit. The plugin's hooks run in every session you start after that.

The hooks need `node` and `git` on the `PATH`. Two of the hooks, the one after an edit and the one before the end of a turn, run `lawcheck check`. That command runs the repository's script rules on your machine, with your rights. A script rule is code of the repository, as its tests are. Use the plugin only in a repository whose code you would run yourself.

## 3. Start a session

At the start of a session, the plugin gives the agent the text that `lawcheck prime` prints. The text says how to work in this repository, which steps need your word, and what the law holds, in short. You read the same text with:

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

The plugin checks the file after the tools `create`, `edit`, `str_replace_editor` and `apply_patch`. Copilot CLI takes at most 10 KB of the text a hook gives the agent. The plugin cuts a longer output to that size and says how many lines it left out.

The check after an edit does not see a file that the agent writes through the shell, for example with a here-document. Copilot's agent often writes files that way. The trial below had 24 sessions with the check after an edit. In each of them, the agent wrote every file with a shell command, so that check never ran. The check before the end of the turn judges every file of the turn, and so it catches a file written through the shell.

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

In Copilot CLI, the output of a hook has no field for a message to you. Copilot CLI shows you a timeline of the session. A hook that runs a command can print progress lines to that timeline while it runs ([Copilot CLI's reference of hooks](https://docs.github.com/en/copilot/reference/hooks-configuration), read on 2026-11-24). The Lawcheck plugin prints none. So the plugin reaches you through the agent. It can let the agent finish while the check still fails. In that case it first sends the agent back once more, with this text:

```output
Lawcheck: before you finish, tell the user this message, word for word, then finish:

Lawcheck: the turn ended while the check of its files still fails. lawcheck check shows why.
```

The agent then tells you the message in its answer. Once per turn, the plugin passes you two more things the same way: the [waivers](concepts.md#waiver) the agent added in the turn, and the changes it made to the law. Your law may have a [reviewer rule](concepts.md#reviewer-rule) while `.lawcheck/config.yaml` sets no reviewer. Then the text of the session start asks the agent to tell you so in its first answer.

## 6. Switch off one of the checks

Copilot CLI gives a plugin no settings. You switch the two checks off with environment variables, in the environment where you start `copilot`. This line starts Copilot CLI with no check after an edit:

```text
LAWCHECK_PLUGIN_CHECK_AFTER_EDIT=false copilot
```

`LAWCHECK_PLUGIN_CHECK_BEFORE_STOP=false` switches off the check before the agent finishes. It also switches off the messages for you at the end of a turn. The plugin reads `false`, `0`, `no` and `off` as off, in upper or lower case. The page [The Claude Code plugin](plugin.md) says what each hook does. It also says in which cases a hook prints nothing.

## 7. Write the first law

The plugin holds one skill, `lawcheck:setup`. A skill is a set of instructions that the agent follows for one task. This skill writes the first law of a repository with you. It changes nothing outside `.lawcheck/`. Only you start it: type `/lawcheck:setup` in Copilot CLI, followed by what you want. The skill's file sets `disable-model-invocation: true`. Copilot CLI honors that flag, so Copilot never starts the skill from your prompt on its own. In a folder with no law, the agent tells you to type the command instead of writing a law. The skill can also give you advice on the architecture of your code, or plan a target: the law your code should reach. You ask for either in the words you type after the command. [The setup skill](plugin.md#the-setup-skill) says what the skill does. The agent asks its questions in a message. Its last message names the next step.

## What this integration does not do

- It writes nothing to you itself. It asks the agent to tell you, and that costs one more answer of the model. The agent may put the message in its own words.
- After an edit, it checks no file that a shell command wrote. The check before the end of the turn judges that file.
- It has no switch for the setup skill. The skill starts only when you type `/lawcheck:setup`. The changelog of Copilot CLI says that Copilot CLI honors the flag `disable-model-invocation` since version 1.0.74. No Copilot CLI session started the skill.
- It has no settings in Copilot CLI. Two environment variables switch its checks off.
- It is not in Copilot's own directory of plugins. It comes from the marketplace of the Lawcheck repository.
- It does not run in Copilot in VS Code or in the Copilot coding agent on GitHub. The coding agent installs no plugins.
- The trial ran on Linux, in a container. It did not run on macOS or Windows. It did not cover a session after Copilot CLI compacts a long conversation into a summary.

## The trial

On 2026-11-24 the plugin ran in 40 real sessions of GitHub Copilot CLI 1.0.105. Copilot sent its model calls to an endpoint that answered with Claude Sonnet 5.5. 23 of the sessions ran in the repository of one small shop. Each of them got the same prompt: add a discount to the core code and show the saved amount as money. The file `tests/agent/result-copilot.json` of the Lawcheck repository holds every session.

- With the whole plugin, the law reached the agent in 10 of 10 sessions. No session imported the API code into the core. All 10 ended with passing tests and a passing `lawcheck check`.
- Without a law and without the plugin, 0 of 10 sessions imported the API code into the core.
- 3 sessions ran with a `lawcheck` that fails every check. In each of them, the plugin sent the agent back three times, then once more to tell the user, and then let it finish. In all 3, the agent's last answer was the message, word for word.
- No session in the shop imported the API code into the core. So the other 17 sessions ran in a second repository, with a task of its own. 14 of them had only the hook after an edit. In 1 of those 14, the agent broke the law, and the hook did not see the breach. The other 3 sessions had only the hook before the end of a turn, and no agent broke the law in them. None of the 17 sessions shows the plugin making an agent fix a breach. A test of the Lawcheck repository plants a breach instead. It checks that each of the two hooks sends the agent back.
- In the 24 sessions with the hook after an edit, the agent wrote every file with a shell command, so that hook never ran a check.

## If it goes wrong

- Nothing happens in a session. Run `copilot plugin list`, and enable `lawcheck` with `copilot plugin enable lawcheck@lawcheck-marketplace` when it shows as disabled.
- The agent gets the message that `lawcheck prime` did not run because `lawcheck was not found`. The plugin starts Lawcheck with the command of the `runner` setting, and it found no Lawcheck there. By default that command is `lawcheck` on your `PATH`. Install Lawcheck as [Install Lawcheck](#_1-install-lawcheck) says, then start a new session.
- The agent ended its turn, and CI fails. The plugin judges the files of the turn alone, with no [base](concepts.md#base). It never passes `--review`. CI judges the whole [change](concepts.md#change). It fails with `not-reviewed` when a reviewer rule has no verdict for a file ([CI and git hooks](ci.md)).

Next: [Lawcheck in Cursor](cursor.md)
