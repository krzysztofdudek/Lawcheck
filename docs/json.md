# JSON documents

`--json` on any command prints one JSON document to standard output and nothing else. Every document has `schema` first, which names the document and its version. A document named `/0` may still change; `lawcheck-error/1` is stable. A field that holds no value is null and stays in the document, except `scope.law_changes`, `findings.line` and `runs.findings.line`, which are absent.

A string holds the text as it is, a file name or a message included. Control characters, U+2028, U+2029 and the format characters of Unicode, such as a zero-width space or a mark that changes the direction of text, except the joiners U+200C and U+200D, are written as `\u` escapes, so the document holds none of them raw when it is printed; a program that parses it gets the text unchanged. The text output writes the same characters as visible escapes, such as `\x1b` and `‮`. An API key of the reviewer is written as `[key]` in both.

A field of a list's items is named here by its path, such as `findings.code` for the `code` of each item of `findings`.

## lawcheck-check/0

From `check`, exit 0 or 1. In the repository of [The commands](commands.md), where `src/core/report.ts` calls `console.log` on its line 2, `lawcheck check --base main --json` prints:

```json
{
  "schema": "lawcheck-check/0",
  "result": "fail",
  "scope": {
    "mode": "change",
    "base": "main",
    "files": 1,
    "law_changed": false
  },
  "summary": {
    "errors": 1,
    "warnings": 0,
    "debt": 0,
    "waivers": 0,
    "unresolved": 0
  },
  "findings": [
    {
      "code": "no-console",
      "rule": "no-console",
      "severity": "error",
      "blocking": true,
      "debt": false,
      "file": "src/core/report.ts",
      "line": 2,
      "type": "library",
      "message": "writes to the terminal with console.log",
      "why": "Only the command layer writes to the terminal."
    }
  ],
  "waivers": [],
  "unresolved": [],
  "reviews": {
    "missing": 0,
    "calls_made": 0,
    "passes_recorded": 0
  },
  "next": {
    "command": null,
    "text": "fix src/core/report.ts:2"
  }
}
```

| Field | Value |
|---|---|
| `result` | `fail` when a finding has severity error, else `pass` |
| `scope` | what the check judged |
| `scope.mode` | `change` for a plain check, `full` with `--full`, `paths` for named files |
| `scope.base` | the base as given, or null without one |
| `scope.files` | the count of changed files, or under `paths` of the named files |
| `scope.law_changed` | true when the change touches `.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a rule file |
| `scope.law_changes` | present only when a base was compared and the law differs: a list of what the change does to the law, in words ([What a check judges](change.md)) |
| `summary` | counts over the change |
| `summary.errors` | findings of the change with severity error |
| `summary.warnings` | findings of the change with severity warning |
| `summary.debt` | findings outside the change, under `--full` |
| `summary.waivers` | waivers in the files of the change |
| `summary.unresolved` | unresolved uses in the files of the change |
| `findings` | every finding, those of the change first, then the debt |
| `findings.code` | the rule's id for a finding of a rule, or the code, such as `forbidden-use` ([Codes](codes.md)) |
| `findings.rule` | the id of the rule the finding concerns, or null for a code that concerns none |
| `findings.severity` | `error` or `warning` |
| `findings.blocking` | true for severity error |
| `findings.debt` | true for a file outside the change |
| `findings.file` | the path from the root |
| `findings.line` | the line, from 1; absent for a finding about the whole file |
| `findings.type` | the id of the file's type |
| `findings.message` | what is wrong |
| `findings.why` | the rule's `why`, or the line that explains the code |
| `waivers` | every waiver, in the change and in the debt |
| `waivers.file` | the file of the waiver |
| `waivers.line` | the line of its marker |
| `waivers.rule` | the rule it waives |
| `waivers.debt` | true for a file outside the change |
| `waivers.waived` | how many findings it dropped |
| `waivers.reason` | the text after `--` |
| `unresolved` | every use the readers found and could not tie to one file |
| `unresolved.file` | the file that holds the use |
| `unresolved.line` | the line of the use |
| `unresolved.what` | the name or path of the use as the reader reads it |
| `unresolved.answer` | `ambiguous` or `none` |
| `unresolved.reason` | for `none`, `unfollowed` or `unowned` when the readers give one, else null |
| `unresolved.candidates` | the files an `ambiguous` use could name, or for `unowned` the one file it binds, else empty |
| `unresolved.debt` | true for a file outside the change |
| `reviews` | the reviewer rules in this run |
| `reviews.missing` | `not-reviewed` findings |
| `reviews.calls_made` | the requests this run sent |
| `reviews.passes_recorded` | the new lines in `.lawcheck/verdicts` |
| `next` | the next step, or null when the check passes |
| `next.command` | the command alone, where the step is one command, else null |
| `next.text` | the step in words, as the `next:` line of the text output |

## lawcheck-error/1

From every command that ends with exit 2, except `doctor`.

| Field | Value |
|---|---|
| `errors` | every error, sorted by file and line |
| `errors.code` | the code ([Codes](codes.md)) |
| `errors.file` | the file, or null where there is no place |
| `errors.line` | the line, or null |
| `errors.message` | what is wrong |
| `errors.why` | the line that explains the code |
| `next` | the next step for the first error |
| `next.command` | the command alone, where the step is one command, else null |
| `next.text` | the step in words |

## lawcheck-init/0

From `init`, exit 0.

| Field | Value |
|---|---|
| `root` | the path of the new root below the top of the git work tree, `""` at the top |
| `created` | the files `init` wrote, from the new root |
| `kept` | the files that were there and stay as they were |
| `next` | the next step |
| `next.command` | null |
| `next.text` | the step in words |

## lawcheck-prime/0

From `prime`, exit 0.

| Field | Value |
|---|---|
| `text` | the whole text output |
| `step` | 1 to 4, the step of shortening that fit within 8,000 characters, or null without a law |
| `characters` | the length of `text` in code points |

## lawcheck-explain/0

From `explain`, exit 0. `subject` says which of the four forms follows: `file`, `directory`, `type` or `rule`.

| Field | Value |
|---|---|
| `subject` | `file`, `directory`, `type` or `rule` |

For a file, after `schema` and `subject`:

| Field | Value |
|---|---|
| `path` | the path from the root |
| `exists` | false for a file that does not exist yet |
| `type` | the id of its type, or null |
| `chain` | the ids from the root type down to its type |
| `about` | the `about` of its type, or null |
| `none` | the reason it has no type, or null |
| `matched` | one item per type of the chain |
| `matched.type` | the type |
| `matched.pattern` | the first pattern of the type that matches the path |
| `matched.content` | the type's `content`, or null |
| `not_matched` | the subtypes whose paths match and whose `content` does not |
| `not_matched.type` | the subtype |
| `not_matched.content` | its `content` |
| `then` | for a path whose type depends on its text, which type each text would give, or null |
| `may_use` | the list in force, or null when no type on the way up has `may_use` |
| `may_use.types` | the types its files may use |
| `may_use.from` | the type above whose list holds, or null for the file's own type |
| `uses` | whether its uses are read, or null when no list is in force |
| `uses.read` | true when a reader reads the file |
| `uses.language` | the reader's language, or null |
| `rules` | every rule of the chain |
| `rules.id` | the rule |
| `rules.kind` | `script` or `reviewer` |
| `rules.status` | `enforced` or `advisory` |
| `rules.why` | the rule's `why` |
| `rules.from` | the type that lists it |
| `rules.review` | `reviewed`, `failed`, `too-large` or `not-reviewed`, or null for a script rule or a file that does not exist |
| `waivers` | the waivers in the file |
| `waivers.line` | the line of the marker |
| `waivers.rule` | the rule it waives |
| `waivers.reason` | the text after `--` |

For a directory, after `schema` and `subject`:

| Field | Value |
|---|---|
| `path` | the folder, with a trailing `/` |
| `files` | the count of files git lists below it |
| `types` | one item per type that has files there, and one with `type` null for the files with no type |
| `types.type` | the type, or null |
| `types.files` | its count of files |

For a type, after `schema` and `subject`: `id`, `chain`, `about`, `may_use`, `rules` (without `review`) and `files` as above, and:

| Field | Value |
|---|---|
| `id` | the type |
| `paths` | its patterns, as the law writes them |
| `content` | its `content`, or null |
| `subtypes` | the ids of its subtypes |

`waivers` is false when the type's files take no waivers, else true, and `files` lists the paths of its files.

For a rule, after `schema` and `subject`:

| Field | Value |
|---|---|
| `kind` | `script` or `reviewer` |
| `status` | `enforced` or `advisory` |
| `why` | the rule's `why` |
| `file` | the rule file, such as `.lawcheck/rules/no-console.mjs` |
| `context` | the paths of its `context`, or null |
| `reviewed` | for a reviewer rule, how many of its files have a verdict; null for a script rule |

`id` is the rule, `types` the types that list it and `files` the files it binds.

## lawcheck-try/0

From `try`, exit 0 or 1.

| Field | Value |
|---|---|
| `rule` | the rule's id |
| `files` | the count of chosen files |
| `summary` | counts over every answer |
| `summary.findings` | the findings left after waivers |
| `summary.files_with_findings` | the files with at least one |
| `summary.waived` | the findings that waivers dropped |
| `summary.calls_made` | the requests this run sent |
| `runs` | one item per file and answer |
| `runs.file` | the file |
| `runs.attempt` | the answer's number, from 1; 1 for a script rule |
| `runs.verdict` | `pass` or `fail`, or null for a script rule and in a dry run |
| `runs.findings` | the findings after waivers; empty in a dry run |
| `runs.findings.line` | the line, or absent for the whole file |
| `runs.findings.message` | what is wrong |
| `runs.findings.severity` | `error` for an enforced rule, `warning` for an advisory one |
| `runs.waived` | the findings that waivers dropped |
| `runs.answer` | the reviewer's answer as it came, or null for a script rule and in a dry run |
| `runs.prompt_chars` | the size of the prompt in characters, or null for a script rule |
| `next` | null |

## lawcheck-docs/0

From `docs`, exit 0. Without a topic:

| Field | Value |
|---|---|
| `topics` | every page, in reading order |
| `topics.id` | the id `lawcheck docs` takes |
| `topics.title` | the title |

With a topic: `id`, `title`, and `text`, the page as it is written, with its links as they are.

| Field | Value |
|---|---|
| `id` | the page's id |
| `title` | its title |
| `text` | the page |

## lawcheck-doctor/0

From `doctor`, exit 0 or 2.

| Field | Value |
|---|---|
| `result` | `pass` when no check failed, else `fail` |
| `checks` | the nine checks, in their order ([The commands](commands.md)) |
| `checks.id` | the check, such as `node` |
| `checks.state` | `ok`, `note`, `fail` or `skip` |
| `checks.message` | what the check found |
| `checks.next` | the next step for a `note` or `fail`, or null |
| `checks.next.command` | the command alone, such as `lawcheck init`, where the step is one, else null |
| `checks.next.text` | the step in words |
