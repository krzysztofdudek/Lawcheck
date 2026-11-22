# Reviewers and keys

A reviewer rule needs a model that answers. You name one of nine providers in `.lawcheck/config.yaml` (`lawcheck docs config`), and the key comes from the environment, never from a file. The five HTTP providers need `model`. The four programs run on your machine, and `model` is optional for them.

## anthropic

Lawcheck sends `POST <address>/messages` to https://api.anthropic.com/v1, with `ANTHROPIC_API_KEY`, else `LAWCHECK_REVIEWER_KEY`, in `x-api-key`. It sends `anthropic-version: 2023-06-01`, asks for at most 8192 tokens, and joins the text items of `content`.

## openai

Lawcheck sends `POST <address>/chat/completions` to https://api.openai.com/v1, with `OPENAI_API_KEY`, else `LAWCHECK_REVIEWER_KEY`, as `authorization: Bearer <key>`. It asks for a JSON object with `response_format`, and reads the first choice's message.

```yaml
reviewer:
  provider: openai
  model: your-model-id
```

## google

Lawcheck sends `POST <address>/models/<model>:generateContent` to https://generativelanguage.googleapis.com/v1beta, with `GOOGLE_API_KEY`, else `LAWCHECK_REVIEWER_KEY`, in `x-goog-api-key`, never in the address. It asks for `application/json`, and joins the text parts of the first candidate, without the parts marked as thought.

## openai-compatible

Any server that answers chat completions. Lawcheck sends the request of `openai` to the address in `LAWCHECK_REVIEWER_ENDPOINT`, which this provider needs. It sends `LAWCHECK_REVIEWER_KEY` as `authorization: Bearer <key>` when that is set, and never reads `OPENAI_API_KEY`.

## ollama

Lawcheck sends `POST <address>/api/chat` to port 11434 of this machine over HTTP, with `stream: false`, `format: json` and the temperature in `options`, and reads `message.content`. It sends no key. `model` names a model the server has pulled, and a call has 300 seconds by default. A server on another machine:

```yaml
reviewer:
  provider: ollama
  model: your-model-id
```

```text
$ export LAWCHECK_REVIEWER_ENDPOINT=http://gpu-box:11434
$ lawcheck doctor --reviewer
```

## claude-code

Lawcheck runs `claude --print --output-format json` with no tools, no slash commands, no settings files, no MCP servers and no saved session. The program signs in its own way, or with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or `CLAUDE_CODE_OAUTH_TOKEN`.

## codex

Lawcheck runs `codex exec` in a read-only sandbox, with no saved session and no rules files, and with its shell, image, sub-agent, goal, hook, plugin, app and web search tools off. It reads your `~/.codex/config.toml`, so it calls the model provider set there. Lawcheck asks `codex mcp list --json` once a run and switches off each MCP server for the call. Lawcheck cannot switch off a server whose name holds a character other than a letter, a digit, `_` or `-`, so it refuses to call codex while one is on. The program signs in its own way, or with `OPENAI_API_KEY` or `CODEX_API_KEY`.

```yaml
reviewer:
  provider: codex
```

## gemini-cli

Lawcheck runs `gemini` with text output, in plan mode, with no extensions, no MCP server and a policy that denies every tool, written to a second temporary folder. The program signs in its own way, or with `GEMINI_API_KEY` or `GOOGLE_API_KEY`.

## copilot-cli

Lawcheck runs `copilot --silent` with no questions, no custom instructions, no tools, no MCP server, no access to the temporary folder and no update. It asks `copilot mcp list --json` once a run and switches off each server that list names. Lawcheck sets nothing about any history `copilot` keeps of its sessions. Lawcheck passes over a `copilot` inside the folder of the VS Code Copilot extension, which only offers to install the CLI. The program signs in its own way, or with `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` or a `COPILOT_PROVIDER_` variable.

## Over HTTP

`LAWCHECK_REVIEWER_ENDPOINT` sets the address of all five. Each request carries the prompt as one user message and the temperature. Lawcheck follows no redirect, reads no reply over 4 MiB, and refuses an address that holds a user or a password. A failed request names the fix for its HTTP status, such as the key for 401.

## The programs

Lawcheck finds the program on `PATH` and starts it with no shell, in a new empty folder that it removes afterwards. The prompt goes to its standard input. Lawcheck passes `--model` only when `model` is set; without it the program runs its own default. A call has 300 seconds by default, `parallel` is 1, and a `temperature` is refused. An exit other than 0 is a failure, with the last line of standard error as its message. Lawcheck ends the program and every process it started once the timeout passes. The program gets your environment without `LAWCHECK_REVIEWER_ENDPOINT` and `LAWCHECK_REVIEWER_KEY`, and of the sign-in variables only its own.

## Where a key goes

A key goes only to the address it was given for:

- with `LAWCHECK_REVIEWER_ENDPOINT` set, `anthropic`, `openai` and `google` send `LAWCHECK_REVIEWER_KEY` alone;
- without it, each sends its own variable, else `LAWCHECK_REVIEWER_KEY`, to its own address;
- `openai-compatible` never reads `OPENAI_API_KEY`, and `ollama` reads no key.

An empty variable counts as absent.

A new provider or model keeps every recorded pass (`lawcheck docs reviewer-rules`), so check a new setup with `lawcheck doctor --reviewer`.

## Text that leaves the machine

Without `--review`, and outside `lawcheck try` on a reviewer rule and `lawcheck doctor --reviewer`, nothing: Lawcheck opens no connection and starts no reviewer program.

With them, each call sends one prompt (`lawcheck docs reviewer-rules`): the frame, the rule's `why` and text, its context files, one judged file with its path, and the waived line numbers. With it go the model name, the parameters and the key. No other file, no git data and no other variable.

- The five HTTP providers send it to the address in force.
- The four programs get it on standard input. Each adds its own system prompt, may load your own instruction files, and sends everything where its own configuration points.

`check` sends a file that has a type and a reviewer rule binding it, and `try` a file you named. A prompt holds at most `reviewer.max_chars` characters, and a run sends at most `reviewer.max_calls` requests.

Lawcheck writes a key as `[key]` wherever it shows text from outside it: a reply, a program's output, a rule message, a file name, `--base`, a config value. The keys are the value of `LAWCHECK_REVIEWER_KEY` and the keys the configured provider would send or pass on; another provider's variables stay as they came. A key shorter than 8 characters stays. Lawcheck replaces the exact key only, never a prefix or a percent-encoded copy.

A line of `.lawcheck/verdicts` is a key and a rule id, and anyone who can commit can write one. The failure cache keeps the reviewer's messages on this machine.

## Failures

| Code | When |
|---|---|
| `reviewer-not-configured` | reviews are to be asked and no provider is set |
| `reviewer-unreachable` | the provider cannot be called, the request failed, or the program ended with an error |
| `reviewer-bad-answer` | the answer was no verdict twice |

After HTTP 429 Lawcheck sends a request once more after 2 seconds, and after a connection that gave no answer once more at once, both within the cap and the call's timeout. After a timeout it never sends it again, because the provider may still be working on the first one.

## Checking the setup

```text
$ lawcheck doctor
$ lawcheck doctor --reviewer
```

`doctor` says whether the provider can be called, without asking it for a review; for `ollama` it asks the server for its version and names the address it reached. `--reviewer` sends one small test request, outside every cap, and says whether it answered with a verdict. Each failure ends with a `next:` line that names what to set or start.
