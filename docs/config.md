# Settings

The settings are in `.lawcheck/config.yaml` at the root. The file is optional: without it, every setting has its default and no reviewer is set. Only reviewer rules need settings; script rules need none.

```yaml
reviewer:
  provider: openai-compatible
  model: your-model-id
```

The file is a mapping with one key, `reviewer`. An empty file, or one of comments only, sets nothing.

## Keys of reviewer

| Key | Value | Default |
|---|---|---|
| `provider` | `openai-compatible`, `anthropic` or `claude-code` | none: no reviewer |
| `model` | a non-empty string without a line break | required for `openai-compatible` and `anthropic`; none for `claude-code`, which then runs its own default |
| `timeout` | an integer of seconds, from 1 to 86400 | 60; 300 for `claude-code` |
| `temperature` | a number, at least 0 | 0; `claude-code` takes none |
| `max_chars` | an integer, at least 1: the largest prompt sent, in characters | 50000 |
| `parallel` | an integer, at least 1: requests in flight at once | 4; 1 for `claude-code` |
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

Any other key, or a value outside the table, is `config-invalid`, exit 2, at its line; the message names the nearest known key. Four cases have a message of their own.

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

A provider that this version does not have, such as `openai`, `google`, `ollama`, `codex`, `gemini-cli` or `copilot-cli`:

```text
reviewer:
  provider: ollama
```

A temperature under `claude-code`, which runs at its own:

```text
reviewer:
  provider: claude-code
  temperature: 0
```

## Limits that keep a run bounded

- `max_chars`: a file whose prompt is larger is never sent. `check` reports it as `too-large-to-review`.
- `max_calls`: a run that needs more calls makes none, `too-many-reviews`. `--max-calls <n>` replaces it for one run.
- `parallel`: at most this many requests at a time.

`lawcheck doctor` reads the settings and says what they set.
