# Reviewers and keys

A reviewer rule needs a reviewer: a provider in `.lawcheck/config.yaml`, and a model for the five that Lawcheck calls over HTTP. Keys and addresses come from the environment, never from a file.

## The nine providers

| Provider | Calls | `model` | Address by default | Key |
|---|---|---|---|---|
| `anthropic` | `POST <address>/messages` | required | `https://api.anthropic.com/v1` | `ANTHROPIC_API_KEY` or `LAWCHECK_REVIEWER_KEY` |
| `openai` | `POST <address>/chat/completions` | required | `https://api.openai.com/v1` | `OPENAI_API_KEY` or `LAWCHECK_REVIEWER_KEY` |
| `google` | `POST <address>/models/<model>:generateContent` | required | `https://generativelanguage.googleapis.com/v1beta` | `GOOGLE_API_KEY` or `LAWCHECK_REVIEWER_KEY` |
| `openai-compatible` | `POST <address>/chat/completions` | required | none, `LAWCHECK_REVIEWER_ENDPOINT` is required | `LAWCHECK_REVIEWER_KEY`, when the server wants one |
| `ollama` | `POST <address>/api/chat` | required | `http://localhost:11434` | none |
| `claude-code` | the `claude` program | optional | | the program's own sign-in |
| `codex` | the `codex` program | optional | | the program's own sign-in |
| `gemini-cli` | the `gemini` program | optional | | the program's own sign-in |
| `copilot-cli` | the `copilot` program | optional | | the program's own sign-in |

```yaml
reviewer:
  provider: openai
  model: your-model-id
```

```yaml
reviewer:
  provider: codex
```

An Ollama server on another machine, with a model it has pulled:

```yaml
reviewer:
  provider: ollama
  model: your-model-id
```

```text
$ export LAWCHECK_REVIEWER_ENDPOINT=http://gpu-box:11434
$ lawcheck doctor --reviewer
```

## Over HTTP

`LAWCHECK_REVIEWER_ENDPOINT` replaces the address of all five. Each request carries the prompt as one user message and the temperature.

- `openai` and `openai-compatible` ask for a JSON object with `response_format`, and read the first choice's message. `openai-compatible` sends `authorization: Bearer <key>` only when a key is set.
- `anthropic` sends `x-api-key` and `anthropic-version: 2023-06-01`, asks for at most 8192 tokens, and joins the text items of `content`.
- `google` sends the key in `x-goog-api-key`, never in the address, asks for `application/json`, and joins the text parts of the first candidate.
- `ollama` sends `stream: false`, `format: json` and the temperature in `options`, and reads `message.content`. It sends no key.

## The programs

Lawcheck finds the program on `PATH` and starts it with no shell, in a new empty folder that it removes afterwards. The prompt goes to its standard input. It passes `--model` only when `model` is set; without it the program runs its own default. An exit other than 0 is a failure, with the last line of standard error as its message. The program gets your environment without `LAWCHECK_REVIEWER_ENDPOINT` and `LAWCHECK_REVIEWER_KEY`, and of the vendors' sign-in variables only its own: `claude` keeps `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`, `codex` keeps `OPENAI_API_KEY` and `CODEX_API_KEY`, `gemini` keeps `GEMINI_API_KEY` and `GOOGLE_API_KEY`, and `copilot` keeps `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` and its `COPILOT_PROVIDER_` keys.

- `claude-code` runs `claude --print --output-format json` with no tools, no slash commands, no settings files, no MCP servers and no saved session.
- `codex` runs `codex exec` in a read-only sandbox, with no saved session and no rules files, and with its shell, image, sub-agent, goal, hook, plugin, app and web search tools off. It reads your `~/.codex/config.toml`, so it calls the model provider set there. Lawcheck asks `codex mcp list --json` once a run and switches off each MCP server for the call. A server whose name holds a dot cannot be switched off that way, so Lawcheck refuses to call codex while one is on.
- `gemini-cli` runs `gemini` with text output, in plan mode, with no extensions, no MCP server and a policy that denies every tool, written to a second temporary folder.
- `copilot-cli` runs `copilot --silent` with no questions, no custom instructions, no tools, no MCP server and no access to the temporary folder. It reads its own configuration under `~/.copilot`, where its sign-in may live; Lawcheck asks `copilot mcp list --json` once a run and switches off each server it names. Each call stays in its session history. A `copilot` inside the folder of the VS Code Copilot extension is passed over: it only offers to install the CLI.

## Where a key goes

A key goes only to the address it was given for:

- with `LAWCHECK_REVIEWER_ENDPOINT` set, `anthropic`, `openai` and `google` send `LAWCHECK_REVIEWER_KEY` alone;
- without it, each sends its own variable, else `LAWCHECK_REVIEWER_KEY`, to its own address;
- `openai-compatible` never reads `OPENAI_API_KEY`, and `ollama` reads no key.

An empty variable counts as absent. Requests follow no redirect, so no key reaches the address a redirect names. A key in `.lawcheck/config.yaml` is `config-invalid`.

A verdict is recorded for the content and the rule alone, not for the provider or the model. A new provider keeps every verdict the old one gave, so `lawcheck doctor --reviewer` is how you check a new setup.

## What leaves the machine

Without `--review`, and outside `lawcheck try` on a reviewer rule and `lawcheck doctor --reviewer`, nothing: Lawcheck opens no connection and starts no reviewer program.

With them, each call sends one prompt: a fixed frame, the rule's `why` and text, the text of each context file the law names for the rule, the path and text of one judged file, and its waived line numbers. With it go the model name, the parameters and the key in its header. No other file, no git data and no other variable.

- The five HTTP providers send it to the address in force.
- The four programs get it on standard input. Each adds its own system prompt, may load your own instruction files, and sends everything where its own configuration points. Each gets the environment above.

Bounds: `check` sends a file that has a type and a reviewer rule binding it, and `try` a file you named. A context file is one the law names and git lists. A prompt holds at most `reviewer.max_chars` characters, and a run sends at most `reviewer.max_calls` requests.

Lawcheck writes your key as `[key]` wherever it shows text from outside it: a reply or a program sending the key back, a rule message, a file name, `--base`, a config value. Its own words and codes stay. The keys are the value of `LAWCHECK_REVIEWER_KEY`, always, and the keys the configured provider would send or pass on; another provider's variables stay as they came. A key shorter than 8 characters is no secret and stays. Only the exact key is replaced; a prefix, a percent-encoded copy or another key-shaped value stays as it came.

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

`doctor` says whether the provider can be called, without asking it for a review; for `ollama` it asks the server for its version and names the address it reached. `--reviewer` sends one small test request, outside every cap, and says whether it answered with a verdict. Each failure ends with a `next:` line that names what to set or start.
