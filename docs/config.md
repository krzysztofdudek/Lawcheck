# Settings

The settings are in `.lawcheck/config.yaml` at the root. The file is optional: without it, every setting has its default and no reviewer is set. Only reviewer rules need settings; script rules need none.

```yaml
reviewer:
  provider: openai-compatible
  model: your-model-id
```

The file is a mapping with two keys, `reviewer` and `runner`. An empty file, or one of comments only, sets nothing.

## Keys of reviewer

| Key | Value | Default |
|---|---|---|
| `provider` | `anthropic`, `openai`, `google`, `openai-compatible`, `ollama`, `claude-code`, `codex`, `gemini-cli` or `copilot-cli` (`lawcheck docs providers`) | none: no reviewer |
| `model` | a non-empty string of at most 256 characters with no control character | required for the five HTTP providers; none for `claude-code`, `codex`, `gemini-cli` and `copilot-cli`, which then run their own default |
| `timeout` | an integer of seconds, from 1 to 86400 | 60; 300 for `ollama` and the four programs |
| `temperature` | a number, at least 0 | 0; the four programs take none |
| `max_chars` | an integer, at least 1: the largest prompt sent, in characters | 50000 |
| `parallel` | an integer, at least 1: requests in flight at once | 4; 1 for the four programs |
| `max_calls` | an integer, at least 0: the most requests one run sends | 100 |

Every key in one file:

```yaml
reviewer:
  provider: anthropic
  model: your-model-id
  timeout: 120
  temperature: 0
  max_chars: 80000
  parallel: 2
  max_calls: 40
```

`claude-code` with a model, and a longer timeout:

```yaml
reviewer:
  provider: claude-code
  model: your-model-id
  timeout: 600
```

## What is refused

Any other key, or a value outside the table, is `config-invalid`, exit 2, at its line; the message names the nearest known key. Three cases have a message of their own.

A key in the file. A key never goes into a committed file; it comes from the environment (`lawcheck docs providers`):

```text
reviewer:
  provider: openai-compatible
  model: your-model-id
  keys: sk-...
```

The address of the endpoint. It comes from `LAWCHECK_REVIEWER_ENDPOINT`:

```text
reviewer:
  endpoint: https://example.com/v1
```

A temperature under one of the four programs, which runs at its own:

```text
reviewer:
  provider: codex
  temperature: 0
```

## runner

How this repository starts Lawcheck. `prime` and the agent plugin start Lawcheck with the command it names:

| `runner` | The command | Its install hint |
|---|---|---|
| `global` | `lawcheck` | `npm i -g lawcheck@alpha` |
| `npx` | `npx --no-install lawcheck` | `npm install` |
| `pnpm` | `pnpm exec lawcheck` | `pnpm install` |
| `yarn` | `yarn run lawcheck` | `yarn install` |
| `bun` | `bun x --no-install lawcheck` | `bun install` |

The default is `global`.

A runner other than `global` starts a program the repository chooses. The package manager reads the repository's own files: yarn runs the file that `yarnPath` in `.yarnrc.yml` names, or `yarn-path` in the `.yarnrc` of Yarn 1, and `npx`, `pnpm exec` and `bun x` run the repository's `node_modules/.bin/lawcheck`, which can be any program. `global` runs the `lawcheck` on your `PATH`. Lawcheck itself never takes a program from the repository: it leaves relative and empty entries out of `PATH`, and on Windows it keeps `cmd.exe` from looking in the current folder first. The plugin starts the runner in every session, and the script rules are the repository's code as well, so use the plugin only in a repository whose tests you would run.

```yaml
runner: pnpm  # pinned in package.json
```

Yarn 1 prints its own lines before and after the output of `yarn run`. To read `--json`, start Lawcheck with `yarn --silent run lawcheck`, which prints the document alone.

Lawcheck runs on Node 24 or later, with npm, pnpm, Yarn 1, Yarn 4 with `nodeLinker: node-modules`, or Bun beside Node (Yarn 4 with `nodeLinker: pnpm` works, and is not promised), and with git 2.34 or later. Anywhere else every command but `--version`, `--help` and `docs` refuses, and its first line names the cause: Bun as the runtime, as on a machine with no Node or with `bun --bun`; a Node older than 24, which npm and pnpm install on with only a warning; Yarn Plug'n'Play, which is not supported, since the runner of script rules cannot open its archives; an older git; `--permission` in `NODE_OPTIONS`.

Yarn 4 holds back a package published less than a day ago. In the first day after a release of Lawcheck or of Runes, the library its readers come from, `yarn add` ends with `YN0016` and the word `quarantined`. This line in `.yarnrc.yml` lets the install through:

```text
npmPreapprovedPackages: [lawcheck, "@chrisdudek/runes"]
```

The plugin reads the key without a YAML parser, so the key has one written form. The runner line is the first line that starts with `runner:` in its first column. Its value is the rest of the line after `runner:`, without a comment that follows a space or a tab, trimmed of spaces and tabs. Without a runner line the runner is `global`. A value outside the five is `config-invalid`, and so is a value this rule reads differently from YAML, such as `runner: "pnpm"`, or a key in flow style: write `runner: pnpm` on one line of its own at the top level.

`.lawcheck/config.local.yaml` does not take `runner`; it is not read.

`.lawcheck/config.yaml` and `.lawcheck/law.yaml` are read through a symbolic link. When a file read that way is not valid, the error says what is wrong and shows none of the file, since a link can lead to a file outside the repository, such as a token.

## Limits that keep a run bounded

- `max_chars`: a file whose prompt is larger is never sent. `check` reports it as `too-large-to-review`.
- `max_calls`: a run that needs more calls makes none, `too-many-reviews`. `--max-calls <n>` replaces it for one run.
- `parallel`: at most this many requests at a time.

`lawcheck doctor` reads the settings and says what they set.
