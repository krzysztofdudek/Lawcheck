# Lawcheck in Claude Code

An agent writes `console.log` into `src/core/total.ts`. The [law](concepts.md#law) of the repository forbids that call there. With the Lawcheck plugin, the agent sees the [finding](concepts.md#finding) after its edit. A turn is the work the agent does for one message of yours. Before the agent ends its turn, the plugin sends it back to work while the files it changed in the turn break the law. At the start of a session, the plugin gives the agent a summary of the law.

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
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

Then start a new Claude Code session in the repository. The plugin works through hooks. A hook is a command that Claude Code runs at a set moment of a session, such as after an edit. The hooks need `node` and `git` on the `PATH`. The hooks after an edit and before the end of a turn run `lawcheck check`, which runs the repository's script rules on your machine with your rights. A script rule is code of the repository, as its tests are. Use the plugin only in a repository whose code you would run yourself.

## 3. Start a session

The plugin gives the agent the text that `lawcheck prime` prints, at these moments:

- when a session starts;
- when you resume a session;
- after `/clear`;
- after Claude Code compacts the conversation.

The text says how to work in this repository, which steps need your word, and what the law holds, in short. [Other coding agents](other-agents.md) shows the whole text. You read the same text with:

```text
$ lawcheck prime
```

## 4. See the check after an edit

The agent writes `src/core/total.ts`. After the edit, the plugin runs `lawcheck check ./src/core/total.ts`. The agent gets this text:

```output
Lawcheck: after this edit, src/core/total.ts breaks the law of this repository. lawcheck check ./src/core/total.ts printed:

lawcheck: FAIL  1 error in 1 named file

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

After an edit that keeps the law, the plugin gives the agent no text.

## 5. See the check before the agent finishes

Before the agent ends its turn, the plugin checks every file that changed in the turn. While those files break the law, the plugin sends the agent back to work with this text:

```output
Lawcheck: the files that changed in this turn break the law of this repository. Fix the code, then finish; if a fix needs the user's word, tell the user what blocks you and finish. lawcheck check on those files printed:

lawcheck: FAIL  1 error in 1 named file

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

The plugin sends the agent back at most three times in one turn. It does not send the agent back twice in a row for the same output. When the plugin lets the agent finish while the check still fails, you see this line:

```output
lawcheck: the turn ended while lawcheck check still fails on the files that changed in it; lawcheck check shows why.
```

## 6. Switch off one of the checks

The plugin has two settings, and both are on by default:

- `check_after_edit` turns on the check of step 4;
- `check_before_stop` turns on the check of step 5.

In a session, the command `/plugin configure lawcheck@lawcheck-marketplace` opens the two settings. From a terminal, this line switches off the check after an edit:

```text
$ echo '{"check_after_edit": "false"}' | claude plugin configure lawcheck@lawcheck-marketplace --values-stdin
```

Then start Claude Code again. From then on, the plugin checks no file after an edit. The check before the agent ends its turn keeps running. [The Claude Code plugin](plugin.md) says what each hook does, and in which cases it prints nothing.

## If it goes wrong

- The agent gets the message that `lawcheck prime` did not run because `lawcheck was not found`. The plugin found no Lawcheck through the command of the `runner` setting, which is `lawcheck` on your `PATH` by default. Install Lawcheck as in step 1, then start a new session.
- The repository has no law. The plugin tells the agent so. It tells the agent to start a law with `lawcheck init` only when you ask for one.
- The agent ended its turn, and CI fails. The plugin judges the files of the turn alone, with no [base](concepts.md#base). It never passes `--review`. Its check therefore shows a missing review as a warning. CI judges the whole [change](concepts.md#change) and fails on `not-reviewed` ([CI and git hooks](ci.md)).
- More than 1,000 files changed in a turn. The plugin skips the check before the end of the turn and prints one line that says so.
- A background subagent, teammate or workflow is still running. The plugin holds back the check before the end of the turn. It runs that check when the agent next finishes a turn after the background work has ended.

Next: [Other coding agents](other-agents.md)
