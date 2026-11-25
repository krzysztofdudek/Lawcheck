# Contributing

## Issues

Issues are welcome: a bug, a confusing message, a page of `docs/` that is wrong or missing. For a bug, the issue form asks for the output of `lawcheck doctor`, the command you ran and what it printed.

A security problem goes to [SECURITY.md](SECURITY.md), not to a public issue.

## Pull requests

Open an issue first, and say what you would change. Open the pull request once I answer in the issue that the change fits. A change that weakens a test needs an approved row in `tests/weakenings.md`, and the suite guard refuses it without one. The answer in the issue comes first, so you do not write a change that the guard then refuses.

## Building and testing

All code runs in the dev container in `.devcontainer/`, except the steps below that need Claude Code on the host. On a fresh clone:

    npm ci
    npm run build
    npm test

`npm run build` compiles `src/` to `dist/` and copies the grammars from the installed Runes package. `npm test` builds again and runs the commit set, with no network and no key.

Before you open a pull request, run the gate:

    npm run gate -- --base origin/main

It runs `npm test`, the suite guard of the base, and prints the pack a reviewer reads: the tests added, changed and removed, and which of them fail on the base.

[tests/README.md](tests/README.md) describes the layers of tests, the labels in test names and the rules of the suite guard. [design/architecture.md](design/architecture.md) follows one run through the code. [design/decisions.md](design/decisions.md) lists the choices that look like mistakes and are not.

## Lawcheck checks itself

`.lawcheck/` holds the law of this repository, and `npm test` checks the code against it. After you edit a file under `src/`, run `npm run build` before `node dist/cli.js check`, because the check runs the build, not the source.

## What a change goes through

1. CI runs the commit set on Linux, macOS and Windows.
2. The suite guard of `main` judges the change. A row of the four kinds the owner approves (`promise-changed`, `guard-changed`, `ci-changed`, `threshold-lowered`) lands on `main` first, in a change of its own, and names the change it approves. Every other weakening it finds needs its row in `tests/weakenings.md`, in the same change.
3. The change lands on `main` only after both are green.

## Before a release

The Nightly does not run by itself. Before a release it runs twice by hand on the tagged commit (`gh workflow run nightly.yml --ref <branch at that commit>`), and both runs must be green; the release workflow checks that both are. CI runs `npm run real` and `claude plugin validate` on every push to `main` and every pull request. These steps run by hand before the tag ([decision 58](design/decisions.md#58-acceptance-tests-that-run-outside-npm-test)):

- a person reads the README and the plugin's files for their wording and for names of other tools;
- when `node film/check.mjs` failed on a change since the last release, the loop is rendered again with `node film/render.mjs` ([film/README.md](film/README.md)).

The tests with a live model, `npm run stability` and `node tests/live/run.ts`, run too when the prompt, the providers or the plugin changed since their last result ([decision 75](design/decisions.md#75-when-the-tests-with-a-live-model-run)).

## After the tag

Once the release workflow has made the GitHub release, I attach the loop and the chapters of the film to it. Then I run `node film/publish.mjs --release <tag>`, which lists them in `film/published.json` and puts the loop of that release at the top of the README, and I deploy the landing page and the docs again ([film/README.md](film/README.md#where-the-chapters-live)).
