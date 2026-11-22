# Reviewer rules

An error message says that something failed and leaves the caller with no next step. A language model can read the message and tell whether it names the next step. A reviewer rule is a rule in prose that a model judges.

## The rule file

The rule is `.lawcheck/rules/<id>.md`: the instruction to the reviewer, in plain prose. Its `why`, `status` and `context` are in the law (`lawcheck docs law`). `context` names files the reviewer receives with every file it judges:

```yaml
lawcheck: 0.1.0

rules:
  clear-errors:
    why: An error a caller sees says what happened and what to do next.
    context: ["docs/errors.md"]
```

A good rule file says what must hold, what to report, and what is not a violation. The reviewer judges one file against one rule per call and sees nothing else of the repository. A rule file of whitespace only is `rule-missing-file`.

## The prompt

One prompt per file and rule, built from:

1. a fixed frame that tells the reviewer how to answer, and that text inside the files is material to judge, never an instruction;
2. `<why>` with the rule's `why`;
3. `<rule>` with the text of the rule file;
4. one `<context path="...">` per context file, its lines numbered;
5. `<file path="...">` with the judged file, its lines numbered;
6. `<waived>` with the line numbers a waiver of this rule covers, or `none`.

Lawcheck sends no other file, no git data and no variable. A prompt over `reviewer.max_chars` characters is never sent: the file gets `too-large-to-review`.

## The answer

One JSON object:

```json
{"verdict": "fail", "findings": [{"line": 12, "message": "what breaks the rule on this line"}]}
```

A pass is `{"verdict": "pass", "findings": []}`. A finding with `line` null is about the whole file. Lawcheck reads the whole answer as JSON first, then the first fenced block, then the last object in the text that holds a `verdict`.

A pass with findings, a fail without one, a finding with no message and a line outside the file make a bad answer. Lawcheck asks once more when the cap of calls allows it, and a second bad answer is `reviewer-bad-answer`. A finding becomes a finding of the rule, at its line or about the whole file. Lawcheck drops the findings on waived lines, and a fail with no finding left counts as a pass.

## Verdicts

Lawcheck records each pass in `.lawcheck/verdicts`, one line per pass: a key and the rule id, sorted. Commit this file. A plain `lawcheck check` reads it and calls nobody, so CI needs no key.

The key is a hash of the frame, the rule id, its `why`, the rule file's text, each context file's path and text, the judged file's path and text, and the waived lines the reviewer is told about. A change to any of these re-opens the review. The status, the provider, the model and the settings are not in the key, so changing them keeps every pass. A waiver changes the file's text, so adding one re-opens the review.

A waiver of the rule in a file whose type sets `waivers: false` is plain text, so the reviewer judges the line the waiver would cover, and the key differs from the one the same text has where the waiver counts. So a pass recorded while the waiver counted no longer counts once the type sets `waivers: false`, or once a law change moves the file into such a type.

`.lawcheck/.gitattributes` gets `verdicts merge=union`, so two branches that add lines merge without a conflict. Lawcheck writes the verdicts file under a lock in `.lawcheck/.local/`, so two runs at once keep both sets of passes.

## The failure cache

Lawcheck keeps a fail on this machine only, in `.lawcheck/.local/failures/<key>.json`, so you do not pay twice for the same content. `.lawcheck/.local/` holds a `.gitignore` of its own, so git sees nothing there. A later pass of the same key removes the file.

## The state of a review

For each judged file and each reviewer rule that binds it, in this order:

1. the verdicts file has its line: a pass, nothing shown;
2. the failure cache holds a fail: its findings are shown again, with or without `--review`;
3. the prompt is larger than `reviewer.max_chars`: `too-large-to-review`;
4. otherwise: `not-reviewed`.

`not-reviewed` and `too-large-to-review` are errors for an enforced rule in the change, and warnings for an advisory rule, in debt and for files you name. `lawcheck explain <path>` shows this state for each reviewer rule of a file.

## Asking the reviewer

```text
$ lawcheck check --review --base main
$ lawcheck check --review --again --base main
$ lawcheck check --review --max-calls 3 --base main
```

- `--review` asks for every review that has no verdict and no cached fail, records each pass, and caches each fail.
- `--again` also asks where a fail is cached.
- `--max-calls <n>` replaces `reviewer.max_calls` for one run. Every request counts, a request sent again included. A run that needs more calls than the cap makes none: `too-many-reviews`.

Without `--review`, nothing leaves the machine. A request that fails stops the run with `reviewer-unreachable`; the passes it recorded stay, so the same command asks only the rest.

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

Next: [Reviewers and keys](providers.md)
