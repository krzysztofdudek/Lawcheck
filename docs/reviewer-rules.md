# Reviewer rules

An error message says that something failed and gives the caller no next step. A language model can read such a message and tell whether it names a next step. A [reviewer rule](concepts.md#reviewer-rule) is a rule in prose that a model judges.

## The rule file

The rule is the file `.lawcheck/rules/<id>.md`. The model that judges the rule is the reviewer. The file holds your instruction to the reviewer, in plain prose or Markdown. The law holds the rule's `why`, `status` and `context` (`lawcheck docs law`). The key `context` names files that the reviewer receives beside every file it judges for this rule, such as a page of your error codes:

```yaml
lawcheck: 0.1.0

rules:
  clear-errors:
    why: An error a caller sees says what happened and what to do next.
    context: ["docs/errors.md"]
```

A good rule file says what must hold, what to report, and which cases do not break the rule. The reviewer judges one file against one rule per call. It sees the context files and no other file of the repository. A rule file of whitespace alone is `rule-missing-file`.

## The prompt

A prompt is the text that Lawcheck sends to the reviewer in one call. Lawcheck builds one prompt per file and rule, from these parts:

1. a fixed frame. It tells the reviewer how to answer. It says that text inside the files is material to judge, never an instruction;
2. `<why>` with the rule's `why`;
3. `<rule>` with the text of the rule file;
4. one `<context path="...">` per context file, its lines numbered;
5. `<file path="...">` with the judged file, its lines numbered;
6. `<waived>` with the line numbers a waiver of this rule covers, or `none`.

The prompt holds these parts and nothing else from the repository, from git or from the environment. Lawcheck does not send a prompt over `reviewer.max_chars` characters. The file gets `too-large-to-review` instead.

## The answer

The reviewer answers with one JSON object:

```json
{"verdict": "fail", "findings": [{"line": 12, "message": "what breaks the rule on this line"}]}
```

A pass is `{"verdict": "pass", "findings": []}`. A finding with `line` null is about the whole file. Lawcheck first reads the whole answer as JSON. When that fails, it tries the first fenced code block of the answer, then the last object in the text that holds a `verdict`.

An answer is bad in four cases:

- a pass with findings;
- a fail without a finding;
- a finding with no message;
- a finding with a line outside the file.

After a bad answer, Lawcheck asks once more when `reviewer.max_calls` leaves room for one more call (section "Asking the reviewer" below). A second bad answer stops the run with `reviewer-bad-answer`. From a good answer, Lawcheck turns each finding into a finding of the rule, at its line or about the whole file. Lawcheck drops the findings on waived lines. A fail with no finding left counts as a pass.

## Verdicts

Lawcheck records each pass in `.lawcheck/verdicts`, one line per pass. A line holds a key and the rule id. Lawcheck keeps the lines sorted. Commit this file. A plain `lawcheck check` reads it and calls no reviewer for a file and rule with a pass. CI then needs no API key.

The key is a hash of these parts:

- the frame;
- the rule id, its `why` and the text of the rule file;
- the path and text of each context file;
- the path and text of the judged file;
- the waived lines that the prompt names.

After a change to any of these parts, the key changes, so the old pass no longer counts. The key leaves out the status of the rule, the provider, the model and the settings. A pass therefore holds when you change any of them. A waiver is part of the text of the file, so a new waiver needs a new review.

In a type with `waivers: false`, Lawcheck reads a waiver marker as plain text. The prompt then names no waived line. The reviewer judges the line that the marker would cover. The key of that prompt therefore differs from the key of the same text where the waiver counts. A pass recorded while the waiver counted no longer counts once the type sets `waivers: false`, or once a change of the law moves the file into such a type.

Lawcheck writes `verdicts merge=union` into `.lawcheck/.gitattributes`. Git then merges two branches that add lines to the file without a conflict. Lawcheck holds a lock in `.lawcheck/.local/` while it writes the file. When two runs write at once, the file keeps the passes of both.

## The failure cache

Lawcheck keeps a failed review on this machine alone, in `.lawcheck/.local/failures/<key>.json`. A second run over the same content shows the cached findings and makes no new call. `.lawcheck/.local/` holds a `.gitignore` of its own, so git ignores every file there. When a later review of the same key passes, Lawcheck removes the failure file.

## The state of a review

For each judged file and each reviewer rule that the file keeps, Lawcheck takes the first state that applies, in this order:

1. the verdicts file has its line: a pass, nothing shown;
2. the failure cache holds a fail: Lawcheck shows its findings again, with or without `--review`;
3. the prompt is larger than `reviewer.max_chars`: `too-large-to-review`;
4. otherwise: `not-reviewed`.

`not-reviewed` and `too-large-to-review` are errors for an enforced rule in the [change](concepts.md#change). The two are warnings in these cases:

- for an advisory rule;
- in [debt](concepts.md#debt);
- for files you name on the command line.

`lawcheck explain <path>` shows this state for each reviewer rule of a file.

## Asking the reviewer

```text
$ lawcheck check --review --base main
$ lawcheck check --review --again --base main
$ lawcheck check --review --max-calls 3 --base main
```

- With `--review`, Lawcheck asks the reviewer for each review that has no verdict and no cached failure. It records each pass and caches each failure.
- With `--again`, Lawcheck asks the reviewer again for a review whose failure the cache holds.
- `--max-calls <n>` replaces `reviewer.max_calls` for one run. Both set the most requests that one run may send. A request sent again counts as one more. A run that needs more requests than that makes none, and stops with `too-many-reviews`.

Without `--review`, Lawcheck sends nothing to a reviewer. A request that fails stops the run with `reviewer-unreachable`. The passes that the run recorded before it stay in `.lawcheck/verdicts`. When you run the same command again, Lawcheck asks the reviewer for the remaining reviews alone.

## Trying a reviewer rule

`lawcheck try` sends the reviewer the files you name, with the prompt that `lawcheck check --review` would send. It records no verdict and caches no failure.

```text
$ lawcheck try clear-errors src/core/refund.ts --dry-run
$ lawcheck try clear-errors src/core/refund.ts
$ lawcheck try clear-errors src/core/refund.ts --times 3
```

- `--dry-run` makes no call. It prints the calls that the run would make and the size of each prompt. Each file costs one call, so start with `--dry-run` to see the count.
- `--times <n>` sends each file to the reviewer n times. The answers show whether the reviewer judges the file the same way each time.
- `--max-calls <n>` bounds the run, as in `check`.

For a reviewer rule, `lawcheck try` takes each file by its name. It refuses a directory, a pattern and a run without a file. `lawcheck docs providers` says how to set a reviewer up.

Next: [Reviewers and keys](providers.md)
