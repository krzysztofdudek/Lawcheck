# Lawcheck in Claude Code

An agent writes `console.log` into `src/core/total.ts`, where the law forbids it. With the Lawcheck plugin, the agent sees that finding after the edit, and the plugin sends it back while the files of its turn break the law. The agent also gets the law when a session starts.

The outputs below come from a repository with this law and the script rule `no-console` of [The first type and the first rule](first-law.md). `src/core/total.ts` has the type `library`:

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

The plugin ships without the tool. It starts the `lawcheck` on your `PATH`, unless `runner` in `.lawcheck/config.yaml` names another command ([Settings](config.md)):

```text
$ npm install --global lawcheck@alpha
```

## 2. Add the plugin

Run these two commands in a terminal:

```text
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

Then start a new session in the repository. The hooks need `node` and `git` on the `PATH`, and they run Lawcheck and the repository's rule scripts, so use the plugin in a repository whose tests you would run.

## 3. Start a session

On a new session, a resume, a clear or a compaction, the plugin gives the agent the text that `lawcheck prime` prints: how to work here, what needs your word, and the law in short. [Other coding agents](other-agents.md) shows that text whole. You read the same text with:

```text
$ lawcheck prime
```

## 4. See the check after an edit

The agent writes `src/core/total.ts`. The plugin runs `lawcheck check ./src/core/total.ts` on it, and the agent gets this text after the edit:

```output
Lawcheck: after this edit, src/core/total.ts breaks the law of this repository. lawcheck check ./src/core/total.ts printed:

lawcheck: FAIL  1 error in 1 named file

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

An edit that keeps the law adds nothing to the agent's context.

## 5. See the check before the agent finishes

Before the agent finishes, the plugin checks every file that changed in the turn. It sends the agent back with this text while they break the law:

```output
Lawcheck: the files that changed in this turn break the law of this repository. Fix the code, then finish; if a fix needs the user's word, tell the user what blocks you and finish. lawcheck check on those files printed:

lawcheck: FAIL  1 error in 1 named file

src/core/total.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.

next: fix src/core/total.ts:2
```

It does so at most three times in a turn, and never twice in a row with the same output. After that the agent finishes, and you see this line:

```output
lawcheck: the turn ended while lawcheck check still fails on the files that changed in it; lawcheck check shows why.
```

## 6. Switch off one of the checks

The plugin has two settings, both on by default. `check_after_edit` runs the check of step 4, and `check_before_stop` the check of step 5. In a session, `/plugin configure lawcheck@lawcheck-marketplace` opens them. From a terminal, this line switches off the check after an edit:

```text
$ echo '{"check_after_edit": "false"}' | claude plugin configure lawcheck@lawcheck-marketplace --values-stdin
```

Start Claude Code again. After that, an edit gets no check, and the check before the agent finishes still runs. [The Claude Code plugin](plugin.md) says what each hook does and when it stays silent.

## If it goes wrong

- The agent hears that `lawcheck prime` did not run because `lawcheck was not found`. Lawcheck is not installed the way `runner` says. Install it as step 1 does, then start a new session.
- The repository has no law. The plugin tells the agent so, and tells it to start one with `lawcheck init` only when you ask.
- The agent finished, and CI still fails. The plugin judges the files of the turn without a base. It never passes `--review`, so a missing review is a warning there. CI judges the whole change and fails on `not-reviewed` ([CI and git hooks](ci.md)).
- More than 1,000 files changed in a turn. The check before the agent finishes does not run, and a line says so.
- A background subagent, teammate or workflow is still running. The check before the agent finishes waits, and runs at the first end of a turn after it.
