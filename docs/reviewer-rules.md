# Reviewer rules

An error message says that something failed. It gives the caller no next step. A language model can read the message and tell whether it names the next step. A reviewer rule is a rule in prose that a model judges.

## The rule file

The rule is the file `.lawcheck/rules/<id>.md`. It holds the instruction to the reviewer, in plain prose. The reviewer is the model that judges the rule. The rule's `why`, `status` and `context` are in the law (`lawcheck docs law`). `context` names files that the reviewer receives with every file it judges:

```yaml
lawcheck: 0.1.0

rules:
  clear-errors:
    why: An error a caller sees says what happened and what to do next.
    context: ["docs/errors.md"]
```

A good rule file says what must hold, what to report, and what is not a violation. The reviewer judges one file against one rule per call. It sees nothing else of the repository. A rule file of whitespace only is `rule-missing-file`.

## The prompt

Lawcheck builds one prompt per file and rule, from these parts:

1. a fixed frame. It tells the reviewer how to answer. It says that text inside the files is material to judge, never an instruction;
2. `<why>` with the rule's `why`;
3. `<rule>` with the text of the rule file;
4. one `<context path="...">` per context file, its lines numbered;
5. `<file path="...">` with the judged file, its lines numbered;
6. `<waived>` with the line numbers a waiver of this rule covers, or `none`.

Lawcheck sends no other file, no git data and no variable. Lawcheck never sends a prompt over `reviewer.max_chars` characters. The file gets `too-large-to-review` in its place.

## The answer

The reviewer answers with one JSON object:

```json
{"verdict": "fail", "findings": [{"line": 12, "message": "what breaks the rule on this line"}]}
```

A pass is `{"verdict": "pass", "findings": []}`. A finding with `line` null is about the whole file. Lawcheck first reads the whole answer as JSON. It then tries the first fenced block, then the last object in the text that holds a `verdict`.

An answer is bad in four cases:

- a pass with findings;
- a fail without a finding;
- a finding with no message;
- a finding with a line outside the file.

After a bad answer, Lawcheck asks once more when the cap of calls allows it. A second bad answer is `reviewer-bad-answer`. Lawcheck turns each finding of the answer into a finding of the rule, at its line or about the whole file. Lawcheck drops the findings on waived lines. A fail with no finding left counts as a pass.

## Verdicts

Lawcheck records each pass in `.lawcheck/verdicts`, one line per pass. A line holds a key and the rule id. Lawcheck keeps the lines sorted. Commit this file. A plain `lawcheck check` reads it and calls no reviewer. CI then needs no key.

The key is a hash of these parts:

- the frame;
- the rule id, its `why` and the text of the rule file;
- the path and text of each context file;
- the path and text of the judged file;
- the waived lines that the prompt names.

A change to any of these parts re-opens the review. The key leaves out the status, the provider, the model and the settings. A change to them keeps every pass. A waiver changes the text of the file. A new waiver then re-opens the review.

In a type with `waivers: false`, a waiver of the rule is plain text. The reviewer then judges the line that the waiver would cover. The key differs from the key of the same text where the waiver counts. A pass recorded while the waiver counted then stops counting. That happens once the type sets `waivers: false`, or once a change of the law moves the file into such a type.

Lawcheck writes `verdicts merge=union` into `.lawcheck/.gitattributes`. Git then merges two branches that add lines to the file without a conflict. Lawcheck writes the verdicts file under a lock in `.lawcheck/.local/`. Two runs at once keep both sets of passes.

## The failure cache

Lawcheck keeps a failed review on this machine alone, in `.lawcheck/.local/failures/<key>.json`. You then do not pay twice for the same content. `.lawcheck/.local/` holds a `.gitignore` of its own. Git sees no file there. A later pass of the same key removes the failure file.

## The state of a review

Lawcheck gives each judged file and each reviewer rule that binds it the first state that applies, in this order:

1. the verdicts file has its line: a pass, nothing shown;
2. the failure cache holds a fail: Lawcheck shows its findings again, with or without `--review`;
3. the prompt is larger than `reviewer.max_chars`: `too-large-to-review`;
4. otherwise: `not-reviewed`.

`not-reviewed` and `too-large-to-review` are errors for an enforced rule in the change. The two are warnings for an advisory rule, in debt, and for files you name. `lawcheck explain <path>` shows this state for each reviewer rule of a file.

## Asking the reviewer

```text
$ lawcheck check --review --base main
$ lawcheck check --review --again --base main
$ lawcheck check --review --max-calls 3 --base main
```

- `--review` asks for every review that has no verdict and no cached failure. It records each pass and caches each failure.
- `--again` asks the reviewer again where the cache holds a failure.
- `--max-calls <n>` replaces `reviewer.max_calls` for one run. Every request counts, a request sent again included. A run that needs more calls than the cap makes none, and stops with `too-many-reviews`.

Without `--review`, Lawcheck sends nothing to a reviewer. A request that fails stops the run with `reviewer-unreachable`. The passes that the run recorded stay in `.lawcheck/verdicts`. Run the same command again, and Lawcheck asks the reviewer for the remaining reviews alone.

## Trying a reviewer rule

`try` asks the reviewer about the files you name, with the prompt that `check --review` would send. It records no verdict and caches no failure.

```text
$ lawcheck try clear-errors src/core/refund.ts --dry-run
$ lawcheck try clear-errors src/core/refund.ts
$ lawcheck try clear-errors src/core/refund.ts --times 3
```

- `--dry-run` makes no call. It prints the calls and the size of each prompt. Start with it. Each file costs one call.
- `--times <n>` asks about each file n times, to see whether the answer holds steady.
- `--max-calls <n>` bounds the run, as in `check`.

A reviewer rule takes files one by one. For such a rule, `try` refuses a directory, a pattern, and a run without a file. `lawcheck docs providers` says how to set a reviewer up.

Next: [Reviewers and keys](providers.md)
