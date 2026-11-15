# Lawcheck

You write your repository's architecture and rules. Lawcheck checks the code against them and tells your coding agent which line breaks which rule.

## Install

Lawcheck needs Node 24 or later and git.

    npm install --global lawcheck

Then, at the root of a git repository:

    lawcheck init
    lawcheck docs first-law

To keep Lawcheck in a project instead, run `npm install --save-dev lawcheck`, set `runner` in `.lawcheck/config.yaml` (`lawcheck docs config`), and start it with `npx lawcheck`.

## Coding agents

In Claude Code, the Lawcheck plugin gives the agent the law at the start of every session, checks each file it edits, and sends it back, up to three times, while the files that changed in its turn break the law:

```
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

The hooks run Lawcheck and the repository's rule scripts after edits and before the agent finishes, so use the plugin where you would run the repository's tests. Both checks can be switched off with `/plugin configure lawcheck@lawcheck-marketplace`.

With any other agent, paste this sentence into its instructions file:

```
Run `lawcheck prime` at the start of every session and follow it.
```

That agent then checks only when it follows the primer: nothing checks a file after an edit or holds the turn while the law is broken. A project that starts Lawcheck through its package manager names it as `runner` in `.lawcheck/config.yaml` (`lawcheck docs config`), and the sentence then uses that command, such as `pnpm exec lawcheck prime`.
