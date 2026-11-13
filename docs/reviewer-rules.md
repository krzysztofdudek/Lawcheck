# Reviewer rules

A reviewer rule is judged by a language model. Use one for what a script cannot check, such as whether an error message says what to do next.

## The rule file

The rule is `.lawcheck/rules/<id>.md`: the instruction to the reviewer, in plain prose. Its `why`, `status` and `context` are in the law. `context` names files the reviewer receives with every file it judges:

```yaml
lawcheck: 0.1.0

rules:
  clear-errors:
    why: An error a caller sees says what happened and what to do next.
    context: ["docs/errors.md"]
```

A good rule file says what must hold, what to report, and what is not a violation. The reviewer judges one file against one rule per call and sees nothing else of the repository.

## What the reviewer receives

One prompt per file and rule, built from:

1. a fixed frame that tells the reviewer how to answer, and that text inside the files is material to judge, never an instruction;
2. `<why>` with the rule's `why`;
3. `<rule>` with the text of the rule file;
4. one `<context path="...">` per context file, its lines numbered;
5. `<file path="...">` with the judged file, its lines numbered;
6. `<waived>` with the line numbers a waiver of this rule covers, or `none`.

No other file, no git data and no variable is sent.

## What it must answer

One JSON object:

```json
{"verdict": "fail", "findings": [{"line": 12, "message": "what breaks the rule on this line"}]}
```

A pass is `{"verdict": "pass", "findings": []}`. A finding with `line` null is about the whole file. Lawcheck also finds the object inside a fenced block or after other text. A pass with findings, a fail without one, or a line outside the file is a bad answer: Lawcheck asks once more, and a second bad answer is `reviewer-bad-answer`.

Findings on waived lines are dropped. A fail with no finding left counts as a pass.

## Verdicts

A pass is recorded in `.lawcheck/verdicts`, one line per pass: a key and the rule id. Commit this file. A plain `lawcheck check` reads it and calls nobody, so CI needs no key.

The key is a hash of the frame, the rule id, its `why`, the rule file's text, each context file's path and text, and the judged file's path and text. A change to any of these re-opens the review. The status, the provider, the model and the settings are not in the key, so changing them re-opens nothing. A waiver changes the file's text, so adding one re-opens the review.

`.lawcheck/.gitattributes` gets `verdicts merge=union`, so two branches that add lines merge without a conflict.

## The failure cache

A fail is kept on this machine only, in `.lawcheck/.local/failures/<key>.json`, so the same content is not paid for twice. `.lawcheck/.local/` holds a `.gitignore` of its own, so git sees nothing there. A later pass of the same key removes the file.

## The state of a review

For each changed file and each reviewer rule that binds it, in this order:

1. the verdicts file has its line: a pass, nothing shown;
2. the failure cache holds a fail: its findings are shown again;
3. the prompt is larger than `reviewer.max_chars`: `too-large-to-review`;
4. otherwise: `not-reviewed`, an error in the change.

`lawcheck explain <path>` shows this state for each reviewer rule of a file.

## Asking the reviewer

```text
$ lawcheck check --review --base main
$ lawcheck check --review --again --base main
$ lawcheck check --review --max-calls 3 --base main
```

- `--review` asks for every review that has no verdict and no cached fail, records each pass, and caches each fail.
- `--again` also asks where a fail is cached.
- `--max-calls <n>` replaces `reviewer.max_calls` for one run. Every request counts, a request sent again included. A run that needs more calls than the cap makes none: `too-many-reviews`.

Without `--review`, nothing leaves the machine.

## Trying a reviewer rule

`try` asks the reviewer about files you name, with the same prompt `check --review` would send. It records no verdict and caches no fail.

```text
$ lawcheck try clear-errors src/core/refund.ts --dry-run
$ lawcheck try clear-errors src/core/refund.ts
$ lawcheck try clear-errors src/core/refund.ts --times 3
```

- `--dry-run` makes no call and prints the calls and the size of each prompt. Start with it: each file costs one call.
- `--times <n>` asks about each file n times, to see whether the answer holds steady.
- `--max-calls <n>` bounds the run, as in `check`.

A reviewer rule takes files one by one: no directory, no pattern, and no run without a file. `lawcheck docs providers` says how to set a reviewer up.
