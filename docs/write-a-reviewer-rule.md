# Write a reviewer rule

A [script rule](concepts.md#script-rule) can find `console.log` in a file. It cannot tell whether the message of `new Error('failed')` tells the caller what to do next. A [reviewer rule](concepts.md#reviewer-rule) can tell. With a reviewer rule, a language model reads each file against a [rule](concepts.md#rule) you write in plain words. That model is the reviewer.

You end with a reviewer rule that judges `src/core/`. Lawcheck records the [verdict](concepts.md#verdict) of the reviewer in `.lawcheck/verdicts`. A later `lawcheck check` without `--review` reads that verdict in place of a call to the model.

The outputs below come from a repository whose `main` holds the `.lawcheck/` that `lawcheck init` makes. Its [law](concepts.md#law) has the [type](concepts.md#type) `library` that [Put the rule in the law](#_2-put-the-rule-in-the-law) shows, without the rule. On a branch made from `main`, you added `src/core/refund.ts`:

```ts
export function refund(paid: boolean): number {
  if (!paid) throw new Error('failed');
  return 1;
}
```

A test server that answers as Ollama does gave the answers below. A real model words its [findings](concepts.md#finding) in its own way.

## 1. Write the rule file

`init` makes no `rules/` folder. Create it with `mkdir -p .lawcheck/rules`, then write the file `.lawcheck/rules/clear-errors.md`. It says what must hold, what to report, and what does not count:

```text
Every error message a caller can see says what happened and what the caller can do next.

Report each thrown error or returned error message that leaves one of the two out. A message logged for developers is not such a message.
```

The reviewer receives this text, the rule's `why` and the file it judges.

## 2. Put the rule in the law

Give the rule a `why`. List the rule on the type. The reviewer may need another file beside the file it judges, such as a catalogue of messages. In that case, list the file under the `context` key of the rule ([Reviewer rules](reviewer-rules.md)). Write `.lawcheck/law.yaml`:

```yaml
lawcheck: 0.1.0

rules:
  clear-errors:
    why: An error a caller sees says what happened and what to do next.

types:
  library:
    about: Code the commands call.
    paths: ["src/core/**"]
    rules: [clear-errors]
```

## 3. Choose a reviewer

| You have | `provider` | Key |
|---|---|---|
| an API key of Anthropic, OpenAI or Google | `anthropic`, `openai` or `google` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_API_KEY` in the environment |
| a model on your own machine, served by Ollama | `ollama` | none |
| another server that answers chat completions as OpenAI does | `openai-compatible`, with its address in `LAWCHECK_REVIEWER_ENDPOINT` | `LAWCHECK_REVIEWER_KEY` in the environment, when the server needs a key |
| Claude Code, Codex, Gemini CLI or Copilot CLI, signed in | `claude-code`, `codex`, `gemini-cli` or `copilot-cli` | the program's own sign-in |

These steps use Ollama. Lawcheck calls it on `localhost:11434`, or at the address in `LAWCHECK_REVIEWER_ENDPOINT`. Create `.lawcheck/config.yaml`, with the name of a model the server has pulled:

```yaml
reviewer:
  provider: ollama
  model: your-model-id
```

A key goes in the environment, because Lawcheck refuses a key in this file with [`config-invalid`](codes.md#config-invalid). [Reviewers and keys](providers.md) has every provider and its keys.

## 4. Check that the reviewer answers

```text
$ lawcheck doctor --reviewer
```

`doctor` sends the reviewer one small request. The last line of its output is:

```output
ok  reviewer  1 reviewer rule; ollama answered a test call
```

## 5. See what the change needs

```text
$ lawcheck check --base main
```

```output
lawcheck: FAIL  1 error in 4 changed files (against main)
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
note: this change edits the law that judges it: adds the rule clear-errors; adds .lawcheck/rules/clear-errors.md; adds .lawcheck/config.yaml

src/core/refund.ts  error[not-reviewed]  clear-errors has no verdict for this content
  why:  a reviewer rule says nothing about content it has not judged

next: lawcheck check --review --base main  (1 reviewer call)
```

`lawcheck check` without `--review` judges the [change](concepts.md#change). It calls no model. Its `next:` line counts the calls a review would make.

## 6. See the cost of a try

```text
$ lawcheck try clear-errors src/core/refund.ts --dry-run
```

```output
lawcheck: try clear-errors (reviewer rule, enforced)  dry run: 1 reviewer call, none made

src/core/refund.ts  1 call, a prompt of 1814 characters
```

Each file you name costs one call. `--times 2` makes it two calls.

## 7. Try the rule on the file

`try` sends the prompt that `check --review` would send. It records nothing:

```text
$ lawcheck try clear-errors src/core/refund.ts
```

```output
lawcheck: 1 reviewer call to ollama
lawcheck: try clear-errors (reviewer rule, enforced)  1 finding in 1 of 1 file, 1 reviewer call

src/core/refund.ts:2  error[clear-errors]  the message says neither what happened nor what to do next
  why:  An error a caller sees says what happened and what to do next.
```

## 8. Ask the same question twice

```text
$ lawcheck try clear-errors src/core/refund.ts --times 2
```

```output
lawcheck: 2 reviewer calls to ollama
lawcheck: try clear-errors (reviewer rule, enforced)  2 answers for 1 file: 2 fail, 0 pass, 2 reviewer calls

src/core/refund.ts  answer 1 of 2: fail
src/core/refund.ts:2  error[clear-errors]  the message says neither what happened nor what to do next
  why:  An error a caller sees says what happened and what to do next.
src/core/refund.ts  answer 2 of 2: fail
src/core/refund.ts:2  error[clear-errors]  the message says neither what happened nor what to do next
```

Two answers that differ mean that the rule allows two readings. Reword the rule file. Ask again until the answers agree.

## 9. Fix the file

Make the message say what happened and what to do:

```ts
export function refund(paid: boolean): number {
  if (!paid) throw new Error('The order is not paid yet; take the payment before a refund.');
  return 1;
}
```

## 10. Review the change

```text
$ lawcheck check --review --base main
```

```output
lawcheck: 1 reviewer call to ollama
lawcheck: PASS  4 changed files (against main), 1 reviewer call
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
note: this change edits the law that judges it: adds the rule clear-errors; adds .lawcheck/rules/clear-errors.md; adds .lawcheck/config.yaml
```

Lawcheck wrote the pass to `.lawcheck/verdicts`. It wrote `.lawcheck/.gitattributes` beside it. With that file, git merges the passes of two branches without a conflict.

## 11. Commit the verdicts

Commit the passes with the change. The page leaves out the lines that git prints:

```text
$ git add .lawcheck src
$ git commit -m "Errors of the library say what to do next"
```

## 12. Check as CI does

```text
$ lawcheck check --base main
```

```output
lawcheck: PASS  6 changed files (against main)
note: the law changed in this change; lawcheck check --full --base main shows what it finds in the rest of the code
note: this change edits the law that judges it: adds the rule clear-errors; adds .lawcheck/rules/clear-errors.md; adds .lawcheck/config.yaml
```

The plain check found the pass. It called no model. A CI job runs the same check with no key ([CI and git hooks](ci.md)).

## If it goes wrong

- Lawcheck prints [`reviewer-unreachable`](codes.md#reviewer-unreachable): the server is down, the key is wrong, or the program is not signed in. The message names the cause. Fix the cause and run the same command again. `check --review` keeps the answers it got before the failure, so the second run asks the reviewer only about the files it has no answer for.
- The reviewer failed a file you believe is right. Lawcheck keeps the fail on this machine. It shows the fail again without a call, until the file or the rule changes. With `--again`, Lawcheck asks the reviewer once more: `lawcheck check --review --again --base main`.
- Lawcheck prints [`too-large-to-review`](codes.md#too-large-to-review): the prompt of a file holds more characters than the setting `reviewer.max_chars` allows. Its default is 50,000. Lawcheck never sends such a prompt. Split the file, or raise `max_chars` in `.lawcheck/config.yaml`.
- Lawcheck prints [`reviewer-bad-answer`](codes.md#reviewer-bad-answer): the model gave no verdict twice. Reword the rule file, or try another model.
- Lawcheck prints [`too-many-reviews`](codes.md#too-many-reviews): the run needs more calls than the setting `reviewer.max_calls` allows (100 by default). Lawcheck then makes none of them. [A slow check](slow-check.md) shows how to cap the calls.
- Lawcheck keeps every recorded pass after you change the model or the provider. It records a pass under a key made from the file and the rule. The key holds no provider and no model. Check the new setup with `lawcheck doctor --reviewer`.

Next: [Bring a law into an existing repository](adopt-in-an-existing-repository.md)
