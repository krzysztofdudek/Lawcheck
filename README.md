# Lawcheck

You write your repository's architecture and rules. Lawcheck checks the code against them and tells your coding agent which line breaks which rule.

## Install

This is an alpha for early testing.

Lawcheck needs Node 24 or later and git 2.34 or later. It installs with npm, pnpm, Yarn 1, Yarn 4 with `nodeLinker: node-modules` or `nodeLinker: pnpm`, and Bun beside Node. Yarn Plug'n'Play is not supported, and neither is Bun without Node.

    npm install --global lawcheck@alpha

Then, at the root of a git repository:

    lawcheck init
    lawcheck docs first-law

To keep Lawcheck in a project instead, run `npm install --save-dev lawcheck@alpha`, set `runner` in `.lawcheck/config.yaml` (`lawcheck docs config`), and start it with `npx lawcheck`.

## Coding agents

In Claude Code, the Lawcheck plugin gives the agent the law at the start of every session, checks each file it edits, and sends it back, up to three times, while the files that changed in its turn break the law:

```
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

The hooks run Lawcheck and the repository's rule scripts after edits and before the agent finishes, so use the plugin where you would run the repository's tests. With a `runner` other than `global`, the package manager also reads the repository's own files, such as `yarnPath` in `.yarnrc.yml` or a committed `node_modules/.bin/lawcheck`, and starts the program they name. The two checks, the one after an edit and the one before the agent finishes, can both be switched off with `/plugin configure lawcheck@lawcheck-marketplace`.

With any other agent, paste this sentence into its instructions file:

```
Run `lawcheck prime` at the start of every session and follow it.
```

That agent then checks only when it follows the primer: nothing checks a file after an edit or holds the turn while the law is broken. A project that starts Lawcheck through its package manager names it as `runner` in `.lawcheck/config.yaml` (`lawcheck docs config`), and the sentence then uses that command, such as `pnpm exec lawcheck prime`.

## More

`lawcheck docs` prints the pages of [docs/](docs): the law file, script and reviewer rules, waivers, codes, JSON, settings, providers and CI. [CONTRIBUTING.md](CONTRIBUTING.md) says how to report a bug and how to build and test Lawcheck. [SECURITY.md](SECURITY.md) says how to report a vulnerability privately.
