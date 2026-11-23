# JSON documents

With `--json`, every command prints one JSON document to standard output and nothing else. The first field of every document is `schema`. It names the document and its version. The form of a document whose name ends in `/0` may change between versions. `lawcheck-error/1` is stable: a later version keeps the name, the type and the meaning of each of its fields, and may add a field. A program that reads it skips the fields it does not know.

A field that holds no value is null and stays in the document. Two cases differ:

- `findings.line` and `runs.findings.line` are absent for a finding about the whole file;
- `law_changes` is present only when the check compared a base and the law differs.

A string holds the text as it is, a file name or a message included. A format character of Unicode is an invisible mark, such as a zero-width space or a mark that changes the direction of text. Lawcheck writes three kinds of character in a string as escapes, such as `\n`, `\u001b` and `\u202e`:

- the control characters, below U+0020 and from U+007F to U+009F;
- U+2028 and U+2029, which some programs read as line ends;
- the format characters of Unicode, except the joiners U+200C and U+200D.

The printed document holds none of these characters raw. A program that parses the document gets the text unchanged. In the text output, Lawcheck writes the same characters as visible escapes, such as `\x1b` and `\u202e` ([Codes](codes.md#escapes-in-the-output)). Lawcheck writes an API key of the reviewer as `[key]` in both outputs.

This page names a field of a list's items by its path. `findings.code` is the `code` of each item of `findings`.

## lawcheck-check/0

`check` prints this document, with exit 0 or 1. The repository of [The commands](commands.md) has a file `src/core/report.ts` that calls `console.log` on its line 2. In that repository, `lawcheck check --base main --json` prints:

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
| `result` | `fail` when a finding has severity error, else `pass`; a finding of debt has severity error only under `--strict` |
| `scope` | what the check judged |
| `scope.mode` | `change` for a check of the change with no path and no `--full`, `full` with `--full`, `paths` for named files |
| `scope.base` | the base as given, or null without one |
| `scope.files` | the count of changed files, or under `paths` of the named files |
| `scope.law_changed` | true when the change touches `.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a rule file |
| `scope.law_changes` | present only when a base was compared and the law differs: a list of what the change does to the law, in words ([What a check judges](change.md)) |
| `summary` | counts over the change |
| `summary.errors` | findings of the change with severity error; under `--strict`, an error of the debt counts in `summary.debt` and in `findings.blocking` alone |
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
| `findings.type` | the id of the file's type, or an empty string for a file with no type, as in `untyped-file` |
| `findings.message` | what is wrong |
| `findings.why` | the rule's `why`, or the line that explains the code |
| `waivers` | every waiver, in the change and in the debt |
| `waivers.file` | the file of the waiver |
| `waivers.line` | the line of its marker |
| `waivers.rule` | the rule it waives |
| `waivers.debt` | true for a file outside the change |
| `waivers.waived` | how many findings it dropped |
| `waivers.reason` | the text after `--` |
| `waivers.added` | true for a waiver that the file did not hold at the base, false for one it held there and for a waiver of debt, null where the check compared no base, as under `paths` ([What a check judges](change.md#waivers-a-change-adds)) |
| `unresolved` | every use the readers found and could not tie to one file |
| `unresolved.file` | the file that holds the use |
| `unresolved.line` | the line of the use |
| `unresolved.what` | the name or path of the use as the reader reads it |
| `unresolved.answer` | `ambiguous` or `none` |
| `unresolved.reason` | for `none`, `unfollowed` or `unowned` when the readers give one, else null |
| `unresolved.candidates` | the files an `ambiguous` use could name, or for `unowned` the one file it names, else empty |
| `unresolved.debt` | true for a file outside the change |
| `reviews` | the reviewer rules in this run |
| `reviews.missing` | `not-reviewed` findings |
| `reviews.calls_made` | the requests this run sent |
| `reviews.passes_recorded` | the new lines in `.lawcheck/verdicts` |
| `next` | the next step, or null when the check passes |
| `next.command` | the command alone, where the step is one command, else null |
| `next.text` | the step in words, as the `next:` line of the text output |

## lawcheck-error/1

Every command but `doctor` prints this document when it ends with exit 2.

| Field | Value |
|---|---|
| `errors` | every error, sorted by file and line |
| `errors.code` | the code ([Codes](codes.md)) |
| `errors.file` | the file, or null where there is no place |
| `errors.line` | the line, or null |
| `errors.message` | what is wrong |
| `errors.why` | the line that explains the code |
| `calls_made` | the requests this run sent to the reviewer before it ended; present only when it sent any, and then after `errors` |
| `next` | the next step for the first error |
| `next.command` | the command alone, where the step is one command, else null |
| `next.text` | the step in words |

## lawcheck-init/0

`init` prints this document, with exit 0.

| Field | Value |
|---|---|
| `root` | the path of the new root below the top of the git work tree, `""` at the top |
| `created` | the files `init` wrote, from the new root |
| `kept` | the files that were there and stay as they were |
| `next` | the next step |
| `next.command` | null |
| `next.text` | the step in words; it starts with a warning when git ignores `.lawcheck/law.yaml` |

## lawcheck-prime/0

`prime` prints this document, with exit 0.

| Field | Value |
|---|---|
| `text` | the whole text output |
| `step` | 1 to 4, the step of shortening that fit within 8,000 characters, or null without a law |
| `characters` | the length of `text` in code points |

## lawcheck-explain/0

`explain` prints this document, with exit 0. `subject` says which of the four forms follows: `file`, `directory`, `type` or `rule`.

| Field | Value |
|---|---|
| `subject` | `file`, `directory`, `type` or `rule` |

For a file, these fields follow `schema` and `subject`:

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

For a directory, these fields follow `schema` and `subject`:

| Field | Value |
|---|---|
| `path` | the folder, with a trailing `/` |
| `files` | the count of files git lists below it |
| `types` | one item per type that has files there, and one with `type` null for the files with no type |
| `types.type` | the type, or null |
| `types.files` | its count of files |

For a type, the document holds `chain`, `about`, `may_use`, `rules` (without `review`) and `files` after `schema` and `subject`, with the meanings above. It holds four fields of its own:

| Field | Value |
|---|---|
| `id` | the type |
| `paths` | its patterns, as the law writes them |
| `content` | its `content`, or null |
| `subtypes` | the ids of its subtypes |

`waivers` is false when the type's files take no waivers, else true. `files` lists the paths of the type's files.

For a rule, these fields follow `schema` and `subject`:

| Field | Value |
|---|---|
| `kind` | `script` or `reviewer` |
| `status` | `enforced` or `advisory` |
| `why` | the rule's `why` |
| `file` | the rule file, such as `.lawcheck/rules/no-console.mjs` |
| `context` | the paths of its `context`, or null |
| `companion` | the path of its `companion`, or null |
| `reviewed` | for a reviewer rule, how many of its files have a verdict; null for a script rule |

`id` is the rule. `types` names each type that lists it. `files` names the files it binds: each file whose type, or a type above it, lists the rule.

## lawcheck-try/0

`try` prints this document, with exit 0 or 1.

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

`docs` prints this document, with exit 0. Without a topic, the document holds these fields:

| Field | Value |
|---|---|
| `topics` | every page, in reading order |
| `topics.id` | the id `lawcheck docs` takes |
| `topics.title` | the title |

With a topic, the document holds `id`, `title` and `text`. `text` holds the Markdown of the page, with its links unchanged.

| Field | Value |
|---|---|
| `id` | the page's id |
| `title` | its title |
| `text` | the page |

## lawcheck-doctor/0

`doctor` prints this document, with exit 0 or 2.

| Field | Value |
|---|---|
| `result` | `pass` when no check failed, else `fail` |
| `checks` | the nine checks, in their order ([The commands](commands.md)) |
| `checks.id` | the check, such as `node` |
| `checks.state` | `ok`, `note`, `fail` or `skip` |
| `checks.message` | what the check found |
| `checks.details` | a list of lines about the check, present only when there are some; the `readers` check lists each configuration file a reader could not read |
| `checks.next` | the next step for a `note` or `fail`, or null |
| `checks.next.command` | the command alone, such as `lawcheck init`, where the step is one, else null |
| `checks.next.text` | the step in words |

Next: [The Claude Code plugin](plugin.md)
