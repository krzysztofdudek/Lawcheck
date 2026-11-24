# Lawcheck in Codex

In Codex, an agent writes `console.log` into `src/core/total.ts`. The [law](concepts.md#law) of the repository forbids that call there. With the Lawcheck plugin for Codex CLI, the agent sees the [finding](concepts.md#finding) after its `apply_patch`. A turn is the work the agent does for one message of yours. Before the agent ends its turn, the plugin sends it back to work while the files it changed in the turn break the law. At the start of a session, the plugin gives the agent a summary of the law.

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
codex plugin marketplace add krzysztofdudek/Lawcheck
codex plugin add lawcheck@lawcheck-marketplace
```

Then start `codex` in the repository, type `/hooks` and trust the four hooks of Lawcheck. Codex runs no hook of a plugin until you trust it, and it says nothing about a hook it skips. After an update of the plugin that changes a hook, trust that hook again in `/hooks`.

The hooks need `node` and `git` on the `PATH`. The hooks after an edit and before the end of a turn run `lawcheck check`, which runs the repository's script rules on your machine with your rights. A script rule is code of the repository, as its tests are. Use the plugin only in a repository whose code you would run yourself.

## 3. Start a session

The plugin gives the agent the text that `lawcheck prime` prints when a session starts, when you resume one, after `/clear` and after Codex compacts the conversation. The text says how to work in this repository, which steps need your word, and what the law holds, in short. You read the same text with:

```text
$ lawcheck prime
```

## 4. See the check after an edit

The agent writes `src/core/total.ts` with `apply_patch`. After the edit, the plugin runs `lawcheck check ./src/core/total.ts`. The agent gets this text:

```output
Lawcheck: after this edit, src/core/total.ts breaks the law of this repository. lawcheck check ./src/core/total.ts printed:

lawcheck: FAIL  1 error in 1 named file

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

One `apply_patch` can write several files. The plugin then checks them all in one `lawcheck check`.

The check after an edit does not see a file that the agent writes through the shell, such as with a here-document. The check before the end of the turn judges every file of the turn, so it catches such a file.

## 5. See the check before the agent finishes

Before the agent ends its turn, the plugin checks every file that changed in the turn. While those files break the law, the plugin sends the agent back to work with this text:

```output
Lawcheck: the files that changed in this turn break the law of this repository. Fix the code, then finish; if a fix needs the user's word, tell the user what blocks you and finish. lawcheck check on those files printed:

lawcheck: FAIL  1 error in 1 named file

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

The plugin sends the agent back at most three times in one turn. It does not send the agent back twice in a row for the same output. When the plugin lets the agent finish while the check still fails, Codex shows you this line under the turn:

```output
Lawcheck: the turn ended while the check of its files still fails. lawcheck check shows why.
```

## 6. Switch off one of the checks

Codex gives a plugin no settings, so the two checks switch off through variables of the environment in which you start `codex`. This line starts Codex with no check after an edit:

```text
LAWCHECK_PLUGIN_CHECK_AFTER_EDIT=false codex
```

`LAWCHECK_PLUGIN_CHECK_BEFORE_STOP=false` switches off the check before the agent finishes, and the message at the end of a turn with it. The plugin reads `false`, `0`, `no` and `off` as off, in upper or lower case. [The Claude Code plugin](plugin.md) says what each hook does, and in which cases it prints nothing.

## 7. Write the first law

The plugin holds one skill, `lawcheck:setup`. It writes the first law of a repository with you and changes nothing outside `.lawcheck/`. Only you start it, by typing `$lawcheck:setup` in Codex, with what you want after it. The plugin sets `allow_implicit_invocation: false` for the skill, so Codex never starts it from your prompt on its own. In a folder with no law, the agent tells you to type the command instead of writing a law. [The setup skill](plugin.md#the-setup-skill) says what the skill does, including advice on the architecture and a target architecture, which you ask for in the words you type after the command. The agent asks its questions in a message, and its last message names the next step.

## What this integration does not do

- Codex runs none of its hooks until you trust them in `/hooks`, and a hook that an update changes needs your trust again.
- It checks no file after an edit that a shell command wrote. The check before the end of the turn judges that file.
- It has no switch for the setup skill: it starts only when you type `$lawcheck:setup`.
- It has no settings in Codex. Two variables of the environment switch its checks off.
- It is not in Codex's own directory of plugins. It comes from the marketplace of the Lawcheck repository.
- `codex exec` does not print the plugin's messages for you. The agent still gets every text, and in the Codex window you see the messages under the turn.
- It was tried on Linux, in a container. It was not tried on macOS or Windows.

## The trial

On 2026-11-23 the plugin ran in real sessions of Codex CLI 0.171.0. Codex sent its model calls to an endpoint that answered with Claude Sonnet 5.5. 24 of the 38 sessions got one prompt in one small shop: add a discount to the core code and show the saved amount as money. `tests/agent/result-codex.json` in the repository holds every session.

- With the whole plugin, the law reached the agent in 10 of 10 sessions. No session imported the API code into the core, and 10 of 10 ended with passing tests and a passing `lawcheck check`.
- Without a law and without the plugin, 0 of 10 sessions imported the API code into the core.
- With a `lawcheck` that fails every check, the plugin sent the agent back three times and then let it finish, in 3 of 3 sessions the trial counted. The trial left out a fourth session, in which the agent started `lawcheck` from the shell and the trial's log shows no such call.
- In the shop no session imported the API code into the core, so the other 14 sessions ran in a second repository with its own task. With the hook after an edit alone, no agent broke the law there in 12 sessions, and with the hook before the end of a turn alone none did in 2. So these sessions show nothing about a fix. A test of the repository plants a breach and checks that the hook before the end of the turn sends the agent back.

## If it goes wrong

- Nothing happens in a session. Codex skips a hook you have not trusted, so type `/hooks` and trust the hooks of Lawcheck.
- The agent gets the message that `lawcheck prime` did not run because `lawcheck was not found`. The plugin found no Lawcheck through the command of the `runner` setting, which is `lawcheck` on your `PATH` by default. Install Lawcheck as [Install Lawcheck](#_1-install-lawcheck) says, then start a new session.
- The agent ended its turn, and CI fails. The plugin judges the files of the turn alone, with no [base](concepts.md#base). It never passes `--review`. CI judges the whole [change](concepts.md#change) and fails on `not-reviewed` ([CI and git hooks](ci.md)).

Next: [Lawcheck in GitHub Copilot CLI](copilot-cli.md)
