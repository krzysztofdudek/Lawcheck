# Reviewers and keys

A [reviewer rule](concepts.md#reviewer-rule) needs a model that answers. You name one of nine providers in `.lawcheck/config.yaml` (`lawcheck docs config`). Lawcheck takes the provider's key from the environment and never from a file. The five HTTP providers need `model`. For the four programs, which run on your machine, `model` is optional.

## anthropic

Lawcheck sends `POST <address>/messages` to https://api.anthropic.com/v1. The key goes in the header `x-api-key`: `ANTHROPIC_API_KEY`, else `LAWCHECK_REVIEWER_KEY`. The request carries the header `anthropic-version: 2023-06-01`. It asks for at most 8192 tokens. Lawcheck joins the text items of `content` into one answer.

## openai

Lawcheck sends `POST <address>/chat/completions` to https://api.openai.com/v1. The key goes as `authorization: Bearer <key>`: `OPENAI_API_KEY`, else `LAWCHECK_REVIEWER_KEY`. The request asks for a JSON object through `response_format`. Lawcheck reads the first choice's message.

```yaml
reviewer:
  provider: openai
  model: your-model-id
```

## google

Lawcheck sends `POST <address>/models/<model>:generateContent` to https://generativelanguage.googleapis.com/v1beta. The key goes in the header `x-goog-api-key` and never in the address: `GOOGLE_API_KEY`, else `LAWCHECK_REVIEWER_KEY`. The request asks for `application/json`. Lawcheck joins the text parts of the first candidate into one answer. It leaves out the parts that the model marks as thought.

## openai-compatible

This provider calls any server that answers chat completions, at the address that `LAWCHECK_REVIEWER_ENDPOINT` holds, such as http://gpu-box:8000/v1. The variable is required. Lawcheck sends the server the request of `openai`. If the environment holds `LAWCHECK_REVIEWER_KEY`, Lawcheck sends it as `authorization: Bearer <key>`. This provider never reads `OPENAI_API_KEY`.

## ollama

Lawcheck sends `POST <address>/api/chat` over HTTP to port 11434 of this machine, with no key. The request sets three fields:

- `stream: false`;
- `format: json`;
- `options`, which holds the temperature.

Lawcheck reads the answer from `message.content`. `model` names a model that the server has pulled. A call may take 300 seconds by default, and the setting `timeout` changes that. For a server on another machine, set the provider and the address:

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

Lawcheck runs `claude --print --output-format json` and turns off five things for the call:

- the tools;
- the slash commands;
- the settings files;
- the MCP servers;
- the saved session.

The program uses its own sign-in, or one of the variables `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN`.

## codex

Lawcheck runs `codex exec` in a read-only sandbox, with no saved session and no rules files. For the call, Lawcheck switches off the shell, image, sub-agent, goal, hook, plugin, app and web search tools of codex. Codex reads your `~/.codex/config.toml` and calls the model provider that file sets. Lawcheck runs `codex mcp list --json` once a run. It switches off, for the call, each MCP server that this list names. Lawcheck cannot switch off a server whose name holds a character other than a letter, a digit, `_` or `-`. While such a server is on, Lawcheck refuses to call codex. The program uses its own sign-in, or one of the variables `OPENAI_API_KEY` and `CODEX_API_KEY`.

```yaml
reviewer:
  provider: codex
```

## gemini-cli

Lawcheck runs `gemini` with text output, in plan mode, with no extensions and no MCP server. A policy file denies the program every tool. Lawcheck writes that policy file to a second temporary folder. The program uses its own sign-in, or one of the variables `GEMINI_API_KEY` and `GOOGLE_API_KEY`.

## copilot-cli

Lawcheck runs `copilot --silent` and turns off six things for the call:

- questions to the user;
- custom instructions;
- the tools;
- the built-in MCP servers;
- access to the temporary folder;
- the automatic update.

Lawcheck runs `copilot mcp list --json` once a run. It switches off each server that this list names. Lawcheck changes no setting of the history that `copilot` may keep of its sessions. The VS Code Copilot extension holds a `copilot` program that only offers to install the CLI. Lawcheck passes over a `copilot` inside the folder of that extension. The program uses its own sign-in, or one of the variables `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` and `COPILOT_PROVIDER_`.

## Over HTTP

`LAWCHECK_REVIEWER_ENDPOINT` sets the base address for all five HTTP providers, in place of their own. It holds an `http:` or `https:` address, and Lawcheck refuses one with a user, a password, a query or a fragment. Lawcheck drops the `/` at the end of the address, if there is one. Then it adds the path of the provider:

- `openai` and `openai-compatible` add `/chat/completions`, so a server that answers under `/v1` takes http://gpu-box:8000/v1;
- `anthropic` adds `/messages`, as it does to its own https://api.anthropic.com/v1;
- `google` adds `/models/<model>:generateContent`;
- `ollama` adds `/api/chat`, so its address is the server alone, such as http://gpu-box:11434.

Each request carries two things: the prompt as one user message, and the temperature. Lawcheck follows no redirect, and it reads no reply over 4 MiB.

A failed request gets a message that names the fix for its HTTP status. For HTTP 401, the fix is the key.

## The programs

Lawcheck finds the program on `PATH` and starts it with no shell. The program runs in a new empty folder, which Lawcheck removes after the call. The prompt goes to the program's standard input.

Lawcheck passes `--model` if the config sets `model`. Without it, the program runs its own default model. The defaults are 300 seconds for a call and 1 for `parallel`. Lawcheck refuses a `temperature` for a program, since each program sets its own.

An exit code other than 0 counts as a failure. The last line of the program's standard error becomes the message of that failure. After the timeout, Lawcheck ends the program and every process it started.

The program gets your environment with two changes:

- Lawcheck removes `LAWCHECK_REVIEWER_ENDPOINT` and `LAWCHECK_REVIEWER_KEY`;
- of the sign-in variables, the program gets its own and no other.

## Where a key goes

Lawcheck sends a key only to the address that the key belongs to:

- with `LAWCHECK_REVIEWER_ENDPOINT` set, `anthropic`, `openai` and `google` send `LAWCHECK_REVIEWER_KEY` alone;
- without it, each sends its own variable, else `LAWCHECK_REVIEWER_KEY`, to its own address;
- `openai-compatible` never reads `OPENAI_API_KEY`;
- `ollama` reads no key.

An empty variable counts as absent.

A pass is a [verdict](concepts.md#verdict) of pass, recorded in `.lawcheck/verdicts`. A new provider or a new model keeps every recorded pass (`lawcheck docs reviewer-rules`). Check a new setup with `lawcheck doctor --reviewer`.

## Text that leaves the machine

Three commands send text to a reviewer: `lawcheck check --review`, `lawcheck try` on a reviewer rule, and `lawcheck doctor --reviewer`. Any other run of Lawcheck opens no connection and starts no reviewer program.

Each call of these commands sends one prompt (`lawcheck docs reviewer-rules`). The prompt holds five parts:

- the frame, a fixed text that tells the reviewer how to answer;
- the rule's `why` and its text;
- the files that the rule's `context` names in the law;
- one judged file with its path;
- the numbers of the waived lines.

The request carries the model name, the parameters and the key beside the prompt. Other files, git data and other variables stay on the machine.

- The five HTTP providers send it to the address in force.
- The four programs get it on standard input. Each program adds its own system prompt. A program can load your own instruction files, as its settings say. It sends the request to the model provider that its own configuration names.

A rule binds a file when the file's type, or a type above it, lists the rule. `check --review` sends each file that a reviewer rule binds. `try` sends the file you name. Two settings cap the cost: a prompt holds at most `reviewer.max_chars` characters, and a run sends at most `reviewer.max_calls` requests.

Lawcheck writes a key as `[key]` wherever it shows text from outside itself: a reply, a program's output, a rule message, a file name, `--base`, a config value. Lawcheck hides two kinds of key. The first is the value of `LAWCHECK_REVIEWER_KEY`. The second is each key that the configured provider would send or pass on. Lawcheck leaves the variables of another provider as they came. It leaves a key shorter than 8 characters as it is. Lawcheck replaces the exact key and never a prefix of it or a percent-encoded copy.

A line of `.lawcheck/verdicts` holds the hash of what the reviewer judged and a rule id. A person who can commit to the repository can write such a line. Lawcheck keeps the reviewer's messages of a failed review in `.lawcheck/.local/failures/`, on this machine.

## Failures

| Code | When |
|---|---|
| `reviewer-not-configured` | reviews are to be asked and no provider is set |
| `reviewer-unreachable` | the provider cannot be called, the request failed, or the program ended with an error |
| `reviewer-bad-answer` | the answer was no verdict twice, or once when the cap leaves no call to ask again |

HTTP 429 is the status a provider gives for too many requests. After it, Lawcheck waits 2 seconds and sends the request a second time. After a connection that ends with no answer, Lawcheck sends the request a second time with no wait. Both second requests stay within the cap and within the timeout of the call. After a timeout, Lawcheck sends no second request, because the provider can still be working on the first one.

## Checking the setup

```text
$ lawcheck doctor
$ lawcheck doctor --reviewer
```

`lawcheck doctor` says whether Lawcheck can call the provider. It asks the provider for no review. For `ollama`, it asks the server for its version and names the address it reached.

`lawcheck doctor --reviewer` sends one small test request, which no cap counts. It says whether the reviewer answered with a verdict. A failed check ends with a `next:` line that names what to set or start.

Next: [Languages and uses](languages.md)
