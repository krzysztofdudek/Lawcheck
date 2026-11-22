# Reviewers and keys

A [reviewer rule](concepts.md#reviewer-rule) needs a model to judge each file. The provider is the service, or the program on your machine, that runs that model. You name one of nine providers in `.lawcheck/config.yaml` ([Settings](config.md)). The five HTTP providers need the setting `model`. For the four programs, `model` is optional.

Lawcheck takes the API key of a provider from an environment variable, never from a file. Each section below names the variables of its provider.

In the requests below, `<address>` stands for the address of the provider's API. With `LAWCHECK_REVIEWER_ENDPOINT` set, Lawcheck takes the address from that variable ([Over HTTP](providers.md#over-http)).

## anthropic

Lawcheck sends `POST <address>/messages`. The default `<address>` of `anthropic` is https://api.anthropic.com/v1. The API key goes in the header `x-api-key`, from `ANTHROPIC_API_KEY` or else from `LAWCHECK_REVIEWER_KEY`. The request carries the header `anthropic-version: 2023-06-01`. It asks for at most 8192 tokens. Lawcheck joins the text items of `content` in the reply into one answer.

## openai

Lawcheck sends `POST <address>/chat/completions`. The default `<address>` of `openai` is https://api.openai.com/v1. The API key goes in the header `authorization: Bearer <key>`, from `OPENAI_API_KEY` or else from `LAWCHECK_REVIEWER_KEY`. The request asks for a JSON object through `response_format`. Lawcheck reads the answer from the message of the first choice.

```yaml
reviewer:
  provider: openai
  model: your-model-id
```

## google

Lawcheck sends `POST <address>/models/<model>:generateContent`. The default `<address>` of `google` is https://generativelanguage.googleapis.com/v1beta. The API key goes in the header `x-goog-api-key`, never in the address. Lawcheck takes the key from `GOOGLE_API_KEY` or else from `LAWCHECK_REVIEWER_KEY`. The request asks for `application/json`. Lawcheck joins the text parts of the first candidate into one answer. It leaves out the parts that the model marks as thought.

## openai-compatible

This provider calls a server that answers the chat completions API of OpenAI. Lawcheck takes the address of that server from `LAWCHECK_REVIEWER_ENDPOINT`, such as http://gpu-box:8000/v1. Without that variable, a review stops with [`reviewer-unreachable`](codes.md#reviewer-unreachable). Lawcheck sends the server the same request as for `openai`. If the environment holds `LAWCHECK_REVIEWER_KEY`, Lawcheck sends it as `authorization: Bearer <key>`. This provider never reads `OPENAI_API_KEY`.

## ollama

Lawcheck sends `POST <address>/api/chat` with no API key. The default `<address>` of `ollama` is `http://localhost:11434`. The request sets three fields:

- `stream: false`;
- `format: json`;
- `options`, which holds the temperature.

Lawcheck reads the answer from `message.content`. The setting `model` names a model that the server has downloaded. A call may take 300 seconds, unless the setting `timeout` gives another limit.

For a server on another machine, set the provider in `.lawcheck/config.yaml` and the address in `LAWCHECK_REVIEWER_ENDPOINT`:

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

Lawcheck runs `codex exec` in a read-only sandbox, with no saved session and no rules files. For the call, Lawcheck switches off the shell, image, sub-agent, goal, hook, plugin, app and web search tools of codex. Codex calls the model provider that your `~/.codex/config.toml` sets.

Lawcheck runs `codex mcp list --json` once a run. For the call, it switches off each MCP server that this list names. Lawcheck cannot switch off a server whose name holds a character other than a letter, a digit, `_` or `-`. While such a server is on, Lawcheck refuses to call codex.

The program uses its own sign-in, or one of the variables `OPENAI_API_KEY` and `CODEX_API_KEY`.

```yaml
reviewer:
  provider: codex
```

## gemini-cli

Lawcheck runs `gemini` in plan mode, with text output. For the call, it turns off the extensions and every MCP server. Lawcheck writes a policy file that denies the program every tool. The policy file lies in a temporary folder apart from the empty folder where the program runs.

The program uses its own sign-in, or one of the variables `GEMINI_API_KEY` and `GOOGLE_API_KEY`.

## copilot-cli

Lawcheck runs `copilot --silent` and turns off six things for the call:

- questions to the user;
- custom instructions;
- the tools;
- the built-in MCP servers;
- access to the temporary folder;
- the automatic update.

Lawcheck runs `copilot mcp list --json` once a run. It switches off each server that this list names. `copilot` may keep a history of its sessions. Lawcheck changes none of the settings of that history.

The VS Code Copilot extension holds a `copilot` program that only offers to install the CLI. Lawcheck skips a `copilot` inside the folder of that extension.

The program uses its own sign-in, or one of the variables `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN` and `COPILOT_PROVIDER_`.

## Over HTTP

With `LAWCHECK_REVIEWER_ENDPOINT` set, Lawcheck sends the requests of all five HTTP providers to its address, in place of their own. The variable holds an `http:` or `https:` address. Lawcheck refuses an address with a user, a password, a query or a fragment. Lawcheck drops the `/` at the end of the address, if there is one. Then it adds the path of the provider:

- `openai` and `openai-compatible` add `/chat/completions`. A server that answers under `/v1` takes an address such as http://gpu-box:8000/v1;
- `anthropic` adds `/messages`, as it does to its own https://api.anthropic.com/v1;
- `google` adds `/models/<model>:generateContent`;
- `ollama` adds `/api/chat`. Its address is the server alone, such as http://gpu-box:11434.

Each request carries two things: the prompt as one user message, and the temperature.

Lawcheck follows no redirect. It counts a reply over 4 MiB as a failed request.

Lawcheck reports a failed request with a message that names the fix for its HTTP status. For HTTP 401 and 403, the message names the variable of the API key to check.

## The programs

Lawcheck finds the program on `PATH`. It starts the program with no shell, in a new empty folder that it removes after the call. Lawcheck sends the prompt to the program's standard input.

Lawcheck passes `--model` if the config sets `model`. Without `model`, the program runs its own default model. For a program, `timeout` defaults to 300 seconds and `parallel` to 1. Lawcheck refuses a `temperature` for a program, since each program sets its own.

Lawcheck counts an exit code other than 0 as a failed call. It takes the last line of the program's standard error as the message of that failure. After the timeout, Lawcheck ends the program and every process it started.

The program gets your environment with two changes:

- Lawcheck removes `LAWCHECK_REVIEWER_ENDPOINT` and `LAWCHECK_REVIEWER_KEY`;
- of the sign-in variables, the program gets its own and no other.

## Where a key goes

Lawcheck sends an API key only to the address that the key belongs to:

- with `LAWCHECK_REVIEWER_ENDPOINT` set, `anthropic`, `openai` and `google` send `LAWCHECK_REVIEWER_KEY` alone;
- without it, each sends its own variable, else `LAWCHECK_REVIEWER_KEY`, to its own address;
- `openai-compatible` never reads `OPENAI_API_KEY`;
- `ollama` reads no key.

An empty variable counts as absent.

A pass is a [verdict](concepts.md#verdict) of pass. Lawcheck records each pass in `.lawcheck/verdicts`. A recorded pass stays valid when you change the provider or the model, because its review hash holds neither ([Reviewer rules](reviewer-rules.md#verdicts)).

Check a new setup with `lawcheck doctor --reviewer` ([Checking the setup](#checking-the-setup)).

## Text that leaves the machine

Three commands send text to a reviewer: `lawcheck check --review`, `lawcheck try` on a reviewer rule, and `lawcheck doctor --reviewer`. In any other run, Lawcheck opens no connection to a reviewer and starts no reviewer program.

Each call of these commands sends one prompt ([Reviewer rules](reviewer-rules.md#the-prompt)). The prompt holds five parts:

- a fixed text that tells the reviewer how to answer;
- the rule's `why` and its text;
- the files that the rule's `context` names in the law;
- one judged file with its path;
- the numbers of the waived lines.

The request carries the model name, the request parameters and the API key beside the prompt. Other files, git data and other variables stay on the machine. The request goes out in one of two ways:

- The five HTTP providers send it to their own address, or to the address in `LAWCHECK_REVIEWER_ENDPOINT`.
- The four programs get it on standard input. Each program adds its own system prompt. A program can load your own instruction files, as its settings say. It sends the request to the model provider that its own configuration names.

A rule binds a file when the file's type, or a type above it, lists the rule. `check --review` sends each file that a reviewer rule binds. `try` sends the files you name. Two settings limit what Lawcheck sends:

- `reviewer.max_chars`, the characters of one prompt;
- `reviewer.max_calls`, the requests of one run.

Lawcheck hides two kinds of API key:

- the value of `LAWCHECK_REVIEWER_KEY`;
- each key that the configured provider would send or pass on.

It writes such a key as `[key]` wherever it shows text from outside itself:

- a reply;
- a program's output;
- a rule message;
- a file name;
- the value of `--base`;
- a config value.

Lawcheck shows two kinds of API key as they are: the key in a variable of another provider, and a key shorter than 8 characters. It replaces each exact copy of a hidden key. Lawcheck leaves a prefix of the key, and a copy in percent encoding, unchanged.

A line of `.lawcheck/verdicts` holds a review hash and a rule id ([Reviewer rules](reviewer-rules.md#verdicts)). A person who can commit to the repository can write such a line. Lawcheck reads that line as a pass.

Lawcheck keeps the reviewer's messages of a failed review on this machine, in `.lawcheck/.local/failures/`.

## Failures

| Code | When |
|---|---|
| `reviewer-not-configured` | reviews are to be asked and no provider is set |
| `reviewer-unreachable` | the provider cannot be called, the request failed, or the program ended with an error |
| `reviewer-bad-answer` | the answer was no verdict twice, or once when `reviewer.max_calls` leaves no call to ask again |

HTTP 429 is the status a provider gives for too many requests. Lawcheck sends a request a second time in two cases:

- after HTTP 429, with a wait of 2 seconds;
- after a connection that ends with no answer, with no wait.

A second request counts as one more request against `reviewer.max_calls`. The timeout of the call covers both requests. After a timeout, Lawcheck sends no second request, because the provider can still be working on the first one.

## Checking the setup

```text
$ lawcheck doctor
$ lawcheck doctor --reviewer
```

`lawcheck doctor` says whether Lawcheck can call the provider. It asks the provider for no review. For `ollama`, it asks the server for its version and names the address it reached.

`lawcheck doctor --reviewer` sends one test request. `reviewer.max_calls` does not count it. The command says whether the reviewer answered with a verdict. A failed check ends with a `next:` line that names what to set or start.

Next: [Languages and uses](languages.md)
