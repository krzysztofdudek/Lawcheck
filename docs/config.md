# Settings

A [reviewer rule](concepts.md#reviewer-rule) needs a model. The key of that model stays out of the repository. The settings live in `.lawcheck/config.yaml` at the root of the law. Lawcheck takes keys from the environment alone. The file is optional. Without it, every setting has its default. Lawcheck then has no reviewer. [Script rules](concepts.md#script-rule) need no settings.

```yaml
reviewer:
  provider: openai-compatible
  model: your-model-id
```

| Key | Value | Default |
|---|---|---|
| `reviewer` | a mapping of the keys below | none: no reviewer |
| `runner` | `global`, `npx`, `pnpm`, `yarn` or `bun` | `global` |

An empty file, or one of comments only, sets nothing.

## reviewer

| Key | Value | Default |
|---|---|---|
| `provider` | `anthropic`, `openai`, `google`, `openai-compatible`, `ollama`, `claude-code`, `codex`, `gemini-cli` or `copilot-cli` (`lawcheck docs providers`) | none: no reviewer |
| `model` | a non-empty string of at most 256 characters with no control character | required for the five HTTP providers; without it the four programs run their own default |
| `timeout` | an integer of seconds, from 1 to 86400, for one call | 60; 300 for `ollama` and the four programs |
| `temperature` | a number, at least 0 | 0; the four programs take none |
| `max_chars` | an integer, at least 1: the largest prompt sent, in characters | 50000 |
| `parallel` | an integer, at least 1: requests in flight at once | 4; 1 for the four programs |
| `max_calls` | an integer, at least 0: the most requests one run sends, a request sent again included | 100 |

The five providers that call a model over HTTP are `anthropic`, `openai`, `google`, `openai-compatible` and `ollama`. The other four are programs that Lawcheck starts: `claude-code`, `codex`, `gemini-cli` and `copilot-cli`.

This file sets every key:

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

This file sets `claude-code` with a model and a longer timeout:

```yaml
reviewer:
  provider: claude-code
  model: your-model-id
  timeout: 600
```

## Keys and values Lawcheck refuses

Lawcheck stops with `config-invalid` and exit 2 in these cases:

- a key outside the table;
- a key written twice;
- a value outside the table.

The error names the line. The message names a known key or provider one or two letters away, when there is one. Three cases have a message of their own.

The first case is a key in the file. A key never goes into a committed file. Lawcheck takes it from the environment (section "Variables" below):

```text
reviewer:
  provider: openai-compatible
  model: your-model-id
  keys: sk-...
```

The second case is the address of the endpoint. Lawcheck takes it from `LAWCHECK_REVIEWER_ENDPOINT`:

```text
reviewer:
  endpoint: https://example.com/v1
```

The third case is a temperature for one of the four programs. Each program runs at its own temperature:

```text
reviewer:
  provider: codex
  temperature: 0
```

Lawcheck reads `.lawcheck/config.yaml` and `.lawcheck/law.yaml` through a symbolic link too. An error about such a file shows none of its text. A link can lead to a secret outside the repository.

## runner

`runner` names the command that starts Lawcheck in this repository. `prime` names that command to the agent. The Claude Code plugin runs it:

| `runner` | The command | Its install hint |
|---|---|---|
| `global` | `lawcheck` | `npm i -g lawcheck@alpha` |
| `npx` | `npx --no-install lawcheck` | `npm install` |
| `pnpm` | `pnpm exec lawcheck` | `pnpm install` |
| `yarn` | `yarn run lawcheck` | `yarn install` |
| `bun` | `bun x --no-install lawcheck` | `bun install` |

```yaml
runner: pnpm  # pinned in package.json
```

`global` runs the `lawcheck` program on your `PATH`. With any other runner, the package manager picks the program from the repository's own files. The repository then decides what runs. Use the plugin only in a repository whose tests you would run. `lawcheck doctor` checks that the program of the runner is on the `PATH`.

The plugin reads the runner without a YAML parser. It takes the first line that starts with `runner:` in its first column. The value is the rest of that line, trimmed, without a comment after a space or a tab. Without such a line, the runner is `global`. A value outside the five is `config-invalid`. A value that YAML reads another way is `config-invalid` too, such as `runner: "pnpm"` or a key in flow style. Write `runner: pnpm` on a line of its own, at the top level.

Yarn 1 prints lines of its own around the output of `yarn run`. Read `--json` from `yarn --silent run lawcheck`, which leaves those lines out.

Yarn 4 holds back a package published less than a day ago. Runes is the library that Lawcheck uses to read the code of each language. On the first day after a release of Lawcheck or of Runes, `yarn add` ends with `YN0016` and `quarantined`. This line in `.yarnrc.yml` lets the install through:

```text
npmPreapprovedPackages: [lawcheck, "@chrisdudek/runes"]
```

`.lawcheck/.gitignore` names `config.local.yaml`. No command of Lawcheck reads that file.

## Variables

| Variable | What Lawcheck does with it |
|---|---|
| `LAWCHECK_BASE` | takes it as the base of the change when `--base` is not given (`lawcheck docs change`) |
| `LAWCHECK_REVIEWER_ENDPOINT` | sends the requests of the HTTP providers to this address, which `openai-compatible` needs: `http:` or `https:`, with no user, password, query or fragment |
| `LAWCHECK_REVIEWER_KEY` | sends it as the key of `openai-compatible`, and of `anthropic`, `openai` and `google` when their own variable is unset or `LAWCHECK_REVIEWER_ENDPOINT` is set |
| `ANTHROPIC_API_KEY` | sends it as the key of `anthropic`, and passes it to `claude` |
| `OPENAI_API_KEY` | sends it as the key of `openai`, and passes it to `codex` |
| `GOOGLE_API_KEY` | sends it as the key of `google`, and passes it to `gemini` |
| `ANTHROPIC_AUTH_TOKEN` | passes it to `claude` |
| `CLAUDE_CODE_OAUTH_TOKEN` | passes it to `claude` |
| `CODEX_API_KEY` | passes it to `codex` |
| `GEMINI_API_KEY` | passes it to `gemini` |
| `COPILOT_GITHUB_TOKEN` | passes it to `copilot` |
| `GH_TOKEN` | passes it to `copilot` |
| `GITHUB_TOKEN` | passes it to `copilot` |
| `COPILOT_PROVIDER_API_KEY` | passes it to `copilot` |
| `COPILOT_PROVIDER_API_KEY_COMMAND` | passes it to `copilot`; it holds a command, so Lawcheck does not hide its value as a key |
| `COPILOT_PROVIDER_BEARER_TOKEN` | passes it to `copilot` |
| `CI` | treats the run as a CI job, where a plain check with no base is `base-unreachable`; set to 0, false, no or off, it means no job. Without `CI`, a CI service's own variable, such as `GITHUB_ACTIONS`, marks the job |
| `PATH` | finds `git` and the reviewer programs there, and leaves out relative and empty entries |
| `NODE_OPTIONS` | refuses every command when it holds `--permission`, under which Lawcheck cannot read its own files |
| `TMPDIR` | makes the folder of a reviewer program there; `TEMP` on Windows |

Lawcheck counts an empty variable as unset. Each reviewer program gets the sign-in variables of its own rows, and none of the others. No program gets `LAWCHECK_REVIEWER_KEY` or `LAWCHECK_REVIEWER_ENDPOINT`. The two variables of the plugin are on the page of the plugin (`lawcheck docs plugin`).

## Limits

| What | Value | Code |
|---|---|---|
| The text of one file | 16 MiB and 1,048,576 lines | `file-too-large` |
| The text of one run | 128 MiB | `text-too-large` |
| The law | 1 MiB, 10,000 rules and 1,000 types | `file-too-large` |
| The settings | 1 MiB | `file-too-large` |
| A file read for its uses | 512 KiB | `uses-not-read` |
| The findings of one run | 200,000, with 16 MiB of messages | `too-many-findings` |
| One message of a script rule | 4,096 characters | `rule-crashed` |
| A script rule's load, and each call | 30 seconds | `rule-crashed` |
| All script rules of a run | 600 seconds | `rules-too-slow` |
| One step of a run | 30 seconds | `step-too-slow` |
| The memory of a run | 1,536 MiB, or 85 percent of the machine's memory if less | `memory-too-large` |
| The memory one file adds | 384 MiB | `memory-too-large` |
| The memory the system has left | 128 MiB | `memory-too-large` |
| A reviewer prompt | `reviewer.max_chars` | `too-large-to-review` |
| The reviewer requests of one run | `reviewer.max_calls`, or `--max-calls <n>` for one run | `too-many-reviews` |
| A reviewer's reply | 4 MiB | `reviewer-unreachable` |
| The findings `check` and `try` print as text | 50; `--json` lists all | none |

Next: [Script rules](script-rules.md)
