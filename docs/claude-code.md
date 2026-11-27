# Lawcheck in Claude Code

The Lawcheck plugin for Claude Code gives the agent your law. It checks each file the agent edits. A turn is the work the agent does for one message of yours. Before the agent ends a turn, the plugin checks the files of that turn.

An agent writes `console.log` into `src/core/total.ts`. The [law](concepts.md#law) of the repository forbids that call there. With the Lawcheck plugin, the agent sees the [finding](concepts.md#finding) after its edit. While the files of its turn break the law, the plugin sends the agent back to work. At the start of a session, the plugin gives the agent a summary of the law.

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
$ npm install --global lawcheck
```

## 2. Add the plugin

Run these two commands in a terminal:

```text
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

Then start a new Claude Code session in the repository. The plugin works through hooks. A hook is a command that Claude Code runs at a set moment of a session, such as after an edit. The hooks need `node` and `git` on the `PATH`. Two of the hooks, the one after an edit and the one before the end of a turn, run `lawcheck check`. That command runs the repository's script rules on your machine, with your rights. A script rule is code of the repository, as its tests are. Use the plugin only in a repository whose code you would run yourself.

## 3. Start a session

The plugin gives the agent the text that `lawcheck prime` prints, at these moments:

- when a session starts;
- when you resume a session;
- after `/clear`;
- after Claude Code compacts the conversation into a summary.

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

The plugin sends the agent back at most three times in one turn. It does not send the agent back twice in a row for the same output. The plugin can let the agent finish while the check still fails. You then see this line:

```output
Lawcheck: the turn ended while the check of its files still fails. lawcheck check shows why.
```

## 6. Switch off one of the checks

The plugin has two settings, and both are on by default:

- `check_after_edit` turns on the check after each edit ([See the check after an edit](#_4-see-the-check-after-an-edit));
- `check_before_stop` turns on the check before the agent finishes ([See the check before the agent finishes](#_5-see-the-check-before-the-agent-finishes)).

In a session, the command `/plugin configure lawcheck@lawcheck-marketplace` opens the two settings. From a terminal, this line switches off the check after an edit:

```text
$ echo '{"check_after_edit": "false"}' | claude plugin configure lawcheck@lawcheck-marketplace --values-stdin
```

Then start Claude Code again. From then on, the plugin checks no file after an edit. The check before the agent ends its turn keeps running. The page [The Claude Code plugin](plugin.md) says what each hook does. It also says in which cases a hook prints nothing.

## 7. Let the agent write the first law

In a repository with no law, type this in a session:

```text
/lawcheck:setup
```

The command starts the setup skill of the plugin. A skill is a set of instructions that the agent follows for one task. The agent can also start this skill when you ask it for a law in your own words. It writes no law you did not ask for. The skill follows [Let a coding agent write the first law](agent-setup.md). It describes the folders as [types](concepts.md#type). It writes down which type uses which today. It asks you before it forbids a [use](concepts.md#use) that the code already makes. It changes nothing outside `.lawcheck/`, except a CI job you ask for. It commits nothing unless you ask. At the end of the turn, the plugin tells you that the agent changed `.lawcheck/law.yaml` ([The end of a turn](plugin.md#the-end-of-a-turn)).

You can ask for more in the words you type with the command. `/lawcheck:setup what could be better here?` asks for advice as well. The agent then writes at most three boundaries or rules that the code does not hold today. Each one comes with its evidence: the files and uses that break it, as Lawcheck counts them. You can also name a target in your words, such as `/lawcheck:setup the domain should not use the database`. The agent then writes the law the code should reach, and the steps to get there. Both go to files beside the law, `.lawcheck/advice.md` and `.lawcheck/target.md`, and nothing in them is law until you say yes to one item or one step ([The setup skill](plugin.md#the-setup-skill)).

## If it goes wrong

- The agent gets the message that `lawcheck prime` did not run because `lawcheck was not found`. The plugin starts Lawcheck with the command of the `runner` setting, and it found no Lawcheck there. By default that command is `lawcheck` on your `PATH`. Install Lawcheck as [Install Lawcheck](#_1-install-lawcheck) says, then start a new session.
- The repository has no law. At the start of the session, the plugin gives the agent two lines. The first says that the folder has no `.lawcheck/law.yaml`. The second tells the agent to write no law you did not ask for, and to start the setup skill when you ask for one ([Let the agent write the first law](#_7-let-the-agent-write-the-first-law)).
- The agent ended its turn, and CI fails. The plugin judges the files of the turn alone, with no [base](concepts.md#base). It never passes `--review`. Its check therefore shows a missing review as a warning. CI judges the whole [change](concepts.md#change). It fails with `not-reviewed` when a reviewer rule has no verdict for a file ([CI and git hooks](ci.md)).
- More than 1,000 files changed in a turn. The plugin skips the check before the end of the turn and prints one line that says so.
- A background subagent, teammate or workflow is still running. The plugin holds back the check before the end of the turn. It runs that check at the first end of a turn after the background work has ended.

Next: [Lawcheck in Codex](codex-cli.md)
