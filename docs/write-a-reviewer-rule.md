# Write a reviewer rule

A script can find `console.log` in a file. It cannot tell whether the message of `new Error('failed')` tells the caller what to do next. A reviewer rule can: a language model reads each file against a rule you write in plain words. At the end of these steps a reviewer rule judges `src/core/`, its pass sits in `.lawcheck/verdicts`, and a plain check reads that pass without calling a model.

The outputs below come from a repository whose `main` holds the `.lawcheck/` that `lawcheck init` makes, with the type `library` of step 2 in its law and no rule. On a branch made from `main`, you added `src/core/refund.ts`:

```ts
export function refund(paid: boolean): number {
  if (!paid) throw new Error('failed');
  return 1;
}
```

A test server that answers as Ollama does gave the answers below. A real model words its findings in its own way.

## 1. Write the rule file

Create `.lawcheck/rules/clear-errors.md`. Say what must hold, what to report, and what does not count. The reviewer receives this text, the rule's `why` and one file, and nothing else of the repository:

```text
Every error message a caller can see says what happened and what the caller can do next.

Report each thrown error or returned error message that leaves one of the two out. A message logged for developers is not such a message.
```

## 2. Put the rule in the law

Give the rule a `why` and list it on the type. A rule that needs another file, such as a catalogue of messages, names it in `context` ([Reviewer rules](reviewer-rules.md)). `.lawcheck/law.yaml`:

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
| Claude Code, Codex, Gemini CLI or Copilot CLI, signed in | `claude-code`, `codex`, `gemini-cli` or `copilot-cli` | the program's own sign-in |

These steps use Ollama, which Lawcheck calls on `localhost:11434`; set `LAWCHECK_REVIEWER_ENDPOINT` to the server's address when it runs elsewhere. Create `.lawcheck/config.yaml`, with the name of a model the server has pulled:

```yaml
reviewer:
  provider: ollama
  model: your-model-id
```

A key goes in the environment and never in this file, where it is `config-invalid`. [Reviewers and keys](providers.md) has every provider and its keys.

## 4. Check that the reviewer answers

```text
$ lawcheck doctor --reviewer
```

`doctor` sends the reviewer one small request. Its last line:

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

A plain check calls no model. It counts the calls a review would make.

## 6. See the cost of a try

```text
$ lawcheck try clear-errors src/core/refund.ts --dry-run
```

```output
lawcheck: try clear-errors (reviewer rule, enforced)  dry run: 1 reviewer call, none made

src/core/refund.ts  1 call, a prompt of 1814 characters
```

Each file you name costs one call, and `--times 2` makes it two.

## 7. Try the rule on the file

`try` sends the prompt `check --review` would send, and records nothing:

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

Answers that differ mean the rule's words leave room. Reword the rule file and ask again until the answers agree.

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

Lawcheck wrote the pass to `.lawcheck/verdicts`. It also wrote `.lawcheck/.gitattributes`, so git merges the passes of two branches without a conflict.

## 11. Commit the verdicts

Commit the passes with the change. git prints its own lines:

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

The plain check found the pass and called nobody, so CI needs no key ([CI and git hooks](ci.md)).

## If it goes wrong

- `reviewer-unreachable`: the server is down, the key is wrong, or the program is not signed in. The message names the cause. Fix it and run the same command again: `check --review` keeps what was answered and asks only the rest.
- The reviewer failed a file you believe is right. `check --review` keeps the fail on this machine and shows it again without a call, until the file or the rule changes. `--again` asks once more: `lawcheck check --review --again --base main`.
- `too-large-to-review`: the prompt of a file passes `reviewer.max_chars`, 50,000 characters by default, and Lawcheck never sends it. Split the file, or raise `max_chars` in `.lawcheck/config.yaml`.
- `reviewer-bad-answer`: the model gave no verdict twice. Reword the rule file, or try another model.
- `too-many-reviews`: the run needs more calls than `reviewer.max_calls`, 100 by default, and makes none. [A slow check](slow-check.md) shows how to keep calls bounded.
- A new model or provider keeps every pass: the key of a pass covers the file and the rule, and no provider or model. Check the new setup with `lawcheck doctor --reviewer`.
