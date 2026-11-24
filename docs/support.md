# Supported environments

Lawcheck 0.1.0-alpha.4 runs on Node 24 or later with git 2.34 or later, on Linux, macOS and Windows. With an older Node or an older git, Lawcheck stops before it reads the law. Its message names the program to update.

## Node, git and the systems

| Program or system | Lawcheck needs | What the tests run it on |
|---|---|---|
| Node | 24 or later, as `engines` in `package.json` says | every push: Node 24.0.0, the newest Node 24 and the newest Node on Linux, and the newest Node 24 on Windows and macOS |
| git | 2.34 or later | in the long test run that is started by hand before a release: the git of Ubuntu 22.04, Debian 12, Ubuntu 24.04 and Debian sid |
| Linux | a system that runs Node 24 | every push, on the newest Ubuntu machine of GitHub Actions; in the same long run, in the Node 24 images of Debian and Alpine |
| macOS | a version that runs Node 24 | every push, on the newest macOS machine of GitHub Actions |
| Windows | a version that runs Node 24 | every push, on the newest Windows machine of GitHub Actions |

## Package managers

Lawcheck installs as a package of the project or as a global package. The `runner` setting in `.lawcheck/config.yaml` names the command that starts it ([Settings](config.md)). In the long test run started by hand before a release, the tests install the package in a new project with npm, pnpm, Yarn 1, both kinds of Yarn 4 and Bun. The tests then run `doctor`, `check` and `try` through the command of the `runner` setting:

| Package manager | Lawcheck starts as | `runner` |
|---|---|---|
| npm, as a global package | `lawcheck` | `global`, the default |
| npm, in the project | `npx --no-install lawcheck` | `npx` |
| pnpm | `pnpm exec lawcheck` | `pnpm` |
| Yarn 1 | `yarn run lawcheck` | `yarn` |
| Yarn 4 with `nodeLinker: node-modules` or `nodeLinker: pnpm` | `yarn run lawcheck` | `yarn` |
| Bun, with Node 24 on the `PATH` | `bun x --no-install lawcheck` | `bun` |

Yarn 1 prints lines of its own around the output of `yarn run`. To read `--json`, run `yarn --silent run lawcheck`.

Yarn 4.15.0 and later hold back a package published less than a day ago. On the first day after a release, `yarn add` of Lawcheck ends with `YN0016` and `quarantined`. [Settings](config.md) gives the line of `.yarnrc.yml` that lets the install through, and says which Yarn 4 versions reject it. pnpm 11 and later do not stop the install on that day. `pnpm add` of Lawcheck installs the release before it, and Settings gives the line of `pnpm-workspace.yaml` that takes the new one.

## The environments Lawcheck refuses

Every command but `docs` and `doctor` stops with the code `unsupported-environment` and exit 2 ([unsupported-environment](codes.md#unsupported-environment)). `doctor` prints the same first line. Its `node` or `git` check fails with that message. `doctor` runs its other checks as usual.

| Environment | Message | Fix |
|---|---|---|
| Node older than 24, on which npm and pnpm install Lawcheck with a warning and no more | `Node 22.11.0 is older than 24, the oldest Node Lawcheck runs on` | install Node 24 or later |
| git older than 2.34 | `git 2.30.2 is older than 2.34, the oldest git Lawcheck runs with` | install git 2.34 or later |
| Bun as the runtime: on a machine with no Node, or with `--bun` | `this run is on Bun 1.4.0, and Lawcheck runs on Node 24 or later`, with the node the `PATH` holds, or the words that it holds none | start it without `--bun`, as `bun x --no-install lawcheck`, which runs it on the node of the `PATH`, or install Node 24 beside Bun |
| Yarn Plug'n'Play, with Lawcheck installed in the project, since the Node process that runs script rules cannot open its archives | `Yarn Plug'n'Play is not supported`, with the archive Lawcheck is served from | set `nodeLinker: node-modules` in `.yarnrc.yml` and run `yarn install`; a Lawcheck installed outside the project runs in such a project |
| Node with `--permission` in `NODE_OPTIONS` | `Node runs with --permission, set in NODE_OPTIONS, and under it Lawcheck cannot read its own files` | start Lawcheck with `NODE_OPTIONS` free of `--permission` |

A `check` on Node 22 prints:

```output
lawcheck: ERROR  Node 22.11.0 is older than 24, the oldest Node Lawcheck runs on

error[unsupported-environment]  Node 22.11.0 is older than 24, the oldest Node Lawcheck runs on
  why:  Lawcheck answers only where its rules and readers are known to run

next: install Node 24 or later, then run lawcheck check
```

Node's permission model is the set of limits that `--permission` turns on. Under it, Node loads Lawcheck's entry file and refuses every module that the file imports. Lawcheck's entry file holds the check for the model, before the first import. If the model is on, Lawcheck prints the refusal above. That check runs only when Node 24.2 or later starts the entry file by the file's own path. A shim is the small script that npm installs to start a command. The Windows shims of npm start the entry file that way.

In two other cases, Node with `--permission` stops before the entry file runs:

- on Linux and macOS, when Lawcheck starts through the link that npm installs;
- on Node 24.0 and 24.1.

Node then prints its own `ERR_ACCESS_DENIED` and exits 1.

Next: [Upgrade Lawcheck](upgrade.md)
