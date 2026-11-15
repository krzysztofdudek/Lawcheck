# Reviewers and keys

A reviewer rule needs a reviewer: a provider and, for two of them, a model in `.lawcheck/config.yaml`. Keys and addresses come from the environment, never from a file.

## The three providers

**openai-compatible** sends `POST <endpoint>/chat/completions` to any server that speaks that API, with `response_format` set to a JSON object. It needs `LAWCHECK_REVIEWER_ENDPOINT` and a model.

```yaml
reviewer:
  provider: openai-compatible
  model: your-model-id
```

**anthropic** sends `POST <endpoint>/messages`, by default to `https://api.anthropic.com/v1`. It needs a model and a key.

```yaml
reviewer:
  provider: anthropic
  model: your-model-id
```

**claude-code** starts the `claude` program found on `PATH`, with no tools, no slash commands, no MCP servers and no saved session, in a new empty folder. The prompt goes to its standard input. The model is optional.

```yaml
reviewer:
  provider: claude-code
```

## The variables

| Variable | Read by | Meaning |
|---|---|---|
| `LAWCHECK_REVIEWER_ENDPOINT` | `openai-compatible` (required), `anthropic` (optional) | the base address, `http:` or `https:`, without a user, a password, a query or a fragment |
| `LAWCHECK_REVIEWER_KEY` | `openai-compatible`, `anthropic` | the key for the endpoint in force |
| `ANTHROPIC_API_KEY` | `anthropic` | the key for `https://api.anthropic.com/v1` and no other address |

An empty variable counts as absent. `openai-compatible` sends `authorization: Bearer <key>` only when a key is set.

## Where a key goes

A key goes only to the address it was given for:

- with `LAWCHECK_REVIEWER_ENDPOINT` set, `anthropic` sends `LAWCHECK_REVIEWER_KEY` alone;
- without it, `anthropic` sends `ANTHROPIC_API_KEY`, else `LAWCHECK_REVIEWER_KEY`, to `https://api.anthropic.com/v1`;
- `openai-compatible` never reads `OPENAI_API_KEY`.

Requests follow no redirect, so no key reaches the address a redirect names. A key in `.lawcheck/config.yaml` is `config-invalid`.

## What leaves the machine

Without `--review`, and outside `lawcheck try` on a reviewer rule and `lawcheck doctor --reviewer`, nothing: Lawcheck opens no connection and starts no reviewer program.

With them, each call sends one prompt: a fixed frame, the rule's `why` and text, the text of each context file the law names for the rule, the path and text of one judged file, and its waived line numbers. With it go the model name, the parameters and the key in its header. No other file, no git data and no other variable.

- `openai-compatible` and `anthropic` send it to the endpoint in force.
- `claude-code` hands it to the `claude` program. That program adds its own system prompt with details of the machine, may load the user's own instruction files, and sends everything where its own configuration points. It gets every variable of Lawcheck's environment.

Bounds: `check` sends a file that has a type and a reviewer rule binding it, and `try` a file you named. A context file is one the law names and git lists. A prompt holds at most `reviewer.max_chars` characters, and a run sends at most `reviewer.max_calls` requests.

Lawcheck writes your key as `[key]` in everything it prints and writes, wherever the key comes from: an endpoint or the `claude` program sending it back, a rule message quoting a line that holds it, a file named with it, an argument. Only the exact key is replaced: the key the provider sent, and for `claude-code` the values of `LAWCHECK_REVIEWER_KEY` and `ANTHROPIC_API_KEY`. A prefix of it, a percent-encoded copy or any other value that only looks like a key is printed as it came.

What stays: `.lawcheck/verdicts` holds keys and rule ids. A line there proves that someone wrote it, not that a model gave the verdict. The failure cache keeps the reviewer's messages on this machine.

## Failures

| Code | When |
|---|---|
| `reviewer-not-configured` | reviews are to be asked and no provider is set |
| `reviewer-unreachable` | the provider cannot be called, the request failed, or the program ended with an error |
| `reviewer-bad-answer` | the answer was no verdict twice |

After HTTP 429 a request is sent once more after 2 seconds, and after a connection that gave no answer once more at once. After a timeout it is never sent again, because the provider may still be working on the first one.

## Checking the setup

```text
$ lawcheck doctor
$ lawcheck doctor --reviewer
```

`doctor` says whether the provider can be called, without calling it. `--reviewer` sends one small test request, outside every cap, and says whether it answered with a verdict.
