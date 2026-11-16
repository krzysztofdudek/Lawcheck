# JSON documents

`--json` on any command prints one JSON document to standard output and nothing else. Every document has `schema` first. A document named `/0` may still change; `lawcheck-error/1` is stable.

A string holds the text as it is, a file name or a message included. Control characters, U+2028, U+2029 and the format characters of Unicode, such as a zero-width space or a mark that changes the direction of text, except the joiners U+200C and U+200D, are written as `\u` escapes, so the document holds none of them raw when it is printed; a program that parses it gets the text unchanged. The text output writes the same characters as visible escapes, such as `\x1b` and `\u202e`.

## lawcheck-check/0

From `check`, exit 0 or 1.

| Key | Value |
|---|---|
| `result` | `pass` or `fail` |
| `scope` | `{ "mode", "base", "files", "law_changed", "law_changes" }`: `change`, `full` or `paths`, the base or null, the count of changed files, or of the named files under `paths`, and whether the change touches `.lawcheck/law.yaml`, `.lawcheck/config.yaml` or a rule file; `law_changes`, present only when a base was compared and the law differs, lists in words what the change does to the law, as `lawcheck docs change` says |
| `summary` | `{ "errors", "warnings", "debt", "waivers", "unresolved" }`, counted over the change; `debt` counts the debt findings |
| `findings` | every finding, the change before the debt: `{ "code", "rule", "severity", "blocking", "debt", "file", "line", "type", "message", "why" }`, `rule` null for a built-in code, `line` absent for a whole-file finding |
| `waivers` | `{ "file", "line", "rule", "debt", "waived", "reason" }` |
| `unresolved` | `{ "file", "line", "what", "answer", "reason", "candidates", "debt" }`: `what` the name or path of the use as the reader first reads it; `answer` `ambiguous` or `none`; `reason` `unfollowed` or `unowned` for `none` when the readers give one, else null; `candidates` the files an `ambiguous` use could name, or for `unowned` the one file it binds, else empty |
| `reviews` | `{ "missing", "calls_made", "passes_recorded" }` |
| `next` | `{ "command", "text" }`, or null when the run passes |

## lawcheck-error/1

From every command that ends with exit 2, except `doctor`.

| Key | Value |
|---|---|
| `errors` | `{ "code", "file", "line", "message", "why" }`, `file` and `line` null where there is no place |
| `next` | `{ "command", "text" }` |

## lawcheck-init/0

From `init`: `root` (the path of the new root below the top of the work tree, `""` at the top), `created` and `kept` (paths relative to the new root), and `next` as `{ "command", "text" }`.

## lawcheck-prime/0

From `prime`: `text` (the whole text output), `step` (1 to 4, the step of the budget that fit, or null without a law) and `characters` (the text's length in code points).

## lawcheck-explain/0

From `explain`, with `subject` one of `file`, `directory`, `type` and `rule`. Absent parts are null, never left out.

| Subject | Keys after `schema` and `subject` |
|---|---|
| `file` | `path`, `exists`, `type`, `chain`, `about`, `none`, `matched` (`{ "type", "pattern", "content" }`), `not_matched` (`{ "type", "content" }`), `then`, `may_use` (`{ "types", "from" }`), `uses` (`{ "read", "language" }`), `rules` (`{ "id", "kind", "status", "why", "from", "review" }`), `waivers` (`{ "line", "rule", "reason" }`) |
| `directory` | `path` (with a trailing `/`), `files`, `types` (`{ "type", "files" }`, `type` null for no type) |
| `type` | `id`, `chain`, `about`, `paths`, `content`, `may_use`, `rules` (without `review`), `subtypes`, `waivers` (false when the type's files hold no waivers), `files` |
| `rule` | `id`, `kind`, `status`, `why`, `file`, `context`, `types`, `files`, `reviewed` (a count, or null for a script rule) |

`review` is `reviewed`, `failed`, `too-large`, `not-reviewed`, or null for a script rule or a file that does not exist. A file with no type has `none`, the reason, and empty lists.

## lawcheck-try/0

From `try`, exit 0 or 1.

| Key | Value |
|---|---|
| `rule` | the rule's id |
| `files` | the count of chosen files |
| `summary` | `{ "findings", "files_with_findings", "waived", "calls_made" }` over every answer |
| `runs` | one item per file and answer: `{ "file", "attempt", "verdict", "findings", "waived", "answer", "prompt_chars" }`, `findings` holding `{ "line", "message", "severity" }` after waivers |
| `next` | null |

For a script rule `attempt` is 1, and `verdict`, `answer` and `prompt_chars` are null. In a dry run `findings` is empty and `verdict` and `answer` are null.

## lawcheck-docs/0

From `docs`: without a topic `topics`, a list of `{ "id", "title" }`; with one `id`, `title` and `text`, the page as it is.

## lawcheck-doctor/0

From `doctor`, exit 0 or 2: `result` (`pass` or `fail`) and `checks`, the nine checks in order, each `{ "id", "state", "message", "next" }`. `state` is `ok`, `note`, `fail` or `skip`. `next` is `{ "command", "text" }` or null, `command` being the command alone where the next step is one, such as `lawcheck init`.
