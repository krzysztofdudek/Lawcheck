# Settings

A [reviewer rule](concepts.md#reviewer-rule) needs a model to judge it. Lawcheck reads the API key of that model's service from an environment variable alone, so no API key goes into a committed file. The other settings live in `.lawcheck/config.yaml`, beside the law. You may leave the file out. Without it, every setting has its default, and Lawcheck has no reviewer. [Script rules](concepts.md#script-rule) need no settings.

```yaml
reviewer:
  provider: openai-compatible
  model: your-model-id
```

| Key | Value | Default |
|---|---|---|
| `reviewer` | a mapping of the keys below | none: no reviewer |
| `runner` | `global`, `npx`, `pnpm`, `yarn` or `bun` | `global` |

An empty file, or a file that holds only comments, sets nothing.

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

Lawcheck stops with `config-invalid` and exits with code 2 in these cases:

- a key outside the table;
- a key written twice;
- a value outside the table.

The error names the line. When a known key or provider differs by one or two letters from what you wrote, the message names it. Three cases get a message of their own.

The first case is an API key written into the file. An API key never goes into a committed file, so Lawcheck reads it from an environment variable instead (section "Variables" below):

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

When `.lawcheck/config.yaml` or `.lawcheck/law.yaml` is a symbolic link, Lawcheck reads the file it leads to. An error about such a file shows none of its text, because the link can lead to a secret outside the repository.

## runner

The `runner` setting names the command that starts Lawcheck in this repository. With a value other than `global`, `lawcheck prime` names that command to the coding agent. The Claude Code plugin starts Lawcheck with it:

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

With `global`, the plugin runs the `lawcheck` program on your `PATH`. With any other value, the package manager takes the `lawcheck` program from the repository's own files. The repository then decides which code runs on your machine, with your rights, each time the plugin starts Lawcheck. Use the plugin in such a repository only when you would run its code yourself. `lawcheck doctor` fails its `config` check when the program of the `runner` setting, such as `pnpm`, is not on the `PATH`.

The plugin reads the `runner` setting without a YAML parser. It takes the first line that starts with `runner:` in its first column. The value is the rest of that line, trimmed, without a comment after a space or a tab. With no such line, the setting is `global`. Lawcheck stops with `config-invalid` on a value outside the five. It stops the same way when YAML reads a value other than the one the plugin took, as with `runner: "pnpm"` or a key in flow style. Write `runner: pnpm` on a line of its own, at the top level.

Yarn 1 prints lines of its own around the output of `yarn run`. To read the JSON of `--json`, start Lawcheck with `yarn --silent run lawcheck`. The flag `--silent` leaves those lines out.

Yarn 4.15.0 and later hold back a package published less than a day ago. Lawcheck reads the code of each language with the package `@chrisdudek/runes`, which these pages call Runes. On the first day after a release of Lawcheck or of Runes, `yarn add` ends with `YN0016` and `quarantined`. With this line in `.yarnrc.yml`, Yarn installs both packages on that first day. Yarn 4.10.1 to 4.14.1 hold nothing back and accept the line. Yarn 4.0.0 to 4.9.4 do not know it and stop every command with `Usage Error`, so leave it out there.

```text
npmPreapprovedPackages: [lawcheck, "@chrisdudek/runes"]
```

pnpm 11 and later also hold back a package published less than a day ago, and they do not stop the install. `pnpm add --save-dev lawcheck@alpha` installs the newest version that is at least a day old, so on the first day after a release you get the release before it. Runes is held back in the same way. With this line in `pnpm-workspace.yaml`, pnpm installs both new versions on that first day:

```text
minimumReleaseAgeExclude: [lawcheck, "@chrisdudek/runes"]
```

Git ignores `.lawcheck/config.local.yaml`, because `.lawcheck/.gitignore` names it. No command of Lawcheck reads that file.

## Variables

| Variable | What Lawcheck does with it |
|---|---|
| `LAWCHECK_BASE` | takes it as the base of the change when `--base` is not given (`lawcheck docs change`) |
| `GITHUB_BASE_REF`, `CI_MERGE_REQUEST_TARGET_BRANCH_NAME`, `CI_COMMIT_BEFORE_SHA`, `SYSTEM_PULLREQUEST_TARGETBRANCH` | take the one that the CI service sets as the base of the change, when neither `--base` nor `LAWCHECK_BASE` is given (`lawcheck docs ci`) |
| `LAWCHECK_REVIEWER_ENDPOINT` | sends the requests of the HTTP providers to this address, which `openai-compatible` needs: `http:` or `https:`, with no user, password, query or fragment |
| `LAWCHECK_REVIEWER_KEY` | sends it as the key of `openai-compatible`, and of `anthropic`, `openai` and `google` when their own variable is unset or `LAWCHECK_REVIEWER_ENDPOINT` is set |
| `LAWCHECK_SIGNING_KEY` | signs each pass that `check --review` records, when the law names signers ([Signed passes](reviewer-rules.md#signed-passes)); Lawcheck hides it as a key and passes it to no program |
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
| `CI` | treats the run as a CI job, where a check of the change with no base and no `--full` is `base-unreachable`; set to 0, false, no or off, it means no job. Without `CI`, a CI service's own variable, such as `GITHUB_ACTIONS`, marks the job |
| `PATH` | finds `git` and the reviewer programs there, and leaves out relative and empty entries |
| `NODE_OPTIONS` | refuses every command when it holds `--permission`, under which Lawcheck cannot read its own files |
| `TMPDIR` | makes the folder of a reviewer program there; `TEMP` on Windows |

Lawcheck counts an empty variable as unset. Each reviewer program gets the sign-in variables of its own rows in the table, and none of the other rows. Lawcheck passes `LAWCHECK_REVIEWER_KEY` and `LAWCHECK_REVIEWER_ENDPOINT` to no program. The plugin reads two variables of its own, which `lawcheck docs plugin` lists.

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
