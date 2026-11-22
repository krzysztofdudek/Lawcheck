# Files Lawcheck reads and writes

Lawcheck keeps its files in one folder, `.lawcheck/`, at the root of the law. You write the law, the settings and the rules. Lawcheck writes the verdicts of reviewer rules, a merge setting for them, and a local folder that stays out of git.

## The folder .lawcheck

| File | What it holds | Who writes it | Commit it |
|---|---|---|---|
| `.lawcheck/law.yaml` | the law: the types, the rules and `may_use` ([The law file](law.md)) | `lawcheck init` writes the first one, and you edit it | yes |
| `.lawcheck/config.yaml` | the settings: the reviewer and the runner ([Settings](config.md)) | you; Lawcheck only reads it | yes |
| `.lawcheck/rules/` | one file per rule, `<id>.mjs` for a script rule or `<id>.md` for a reviewer rule, and helpers of script rules in `rules/lib/` | you; `init` makes no `rules/` folder | yes |
| `.lawcheck/verdicts` | the passes of reviewer rules, one line per pass: 32 hexadecimal characters, a space and the rule's id, sorted | `lawcheck check --review` | yes, so that CI reads the passes and calls no reviewer |
| `.lawcheck/.gitattributes` | the line `verdicts merge=union`, so a merge of two branches keeps the passes of both | `lawcheck check --review`, when it records a pass and the line is missing | yes |
| `.lawcheck/.gitignore` | `.local/` and `config.local.yaml` | `lawcheck init`, when the file is absent | yes |
| `.lawcheck/.local` | the failure cache, a lock and temporary files of the verdicts | `lawcheck check --review` | no |

`init` writes this `.gitignore`:

```text
.local/
config.local.yaml
```

Lawcheck 0.1.0-alpha.2 reads no `config.local.yaml`. The line keeps a file of that name out of git.

The law, the config and the rule files get a type when a type's `paths` match them, so a rule can judge them. `.lawcheck/verdicts` and `.lawcheck/.gitattributes` never get a type.

## Inside .lawcheck/.local

`check --review` makes this folder with its own `.gitignore`, which holds `*`, so git ignores everything in it even without `.lawcheck/.gitignore`.

| Path | What it holds |
|---|---|
| `failures/<key>.json` | one failed review: the rule and its findings, with any key hidden as `[key]`; a later `check` reports it again without a call, and `check --review --again` asks again ([Reviewer rules](reviewer-rules.md)) |
| `verdicts.lock` | a folder that one run holds while it writes `.lawcheck/verdicts`; a lock older than 10 seconds, or of a run that ended, is removed |
| `verdicts-<pid>-<hex>` | the new verdicts file before it replaces the old one |
| `probe-<pid>-<hex>` | a test that the folder can be written, made and removed before the first call |

A pass of a review removes its file from `failures/`. Deleting the whole folder loses the cached failures only: the next `check --review` asks those reviews again.

## Outside the repository

| Place | What it holds | Who writes it |
|---|---|---|
| `CLAUDE_PLUGIN_DATA`, or a folder `lawcheck-plugin-<user id>` in the system's temporary directory | one small file per Claude Code session; each session start removes the files older than 7 days | the Claude Code plugin ([The Claude Code plugin](plugin.md)) |
| a folder in the system's temporary directory named `lawcheck-`, the program's name, a dash and 6 random characters, such as `lawcheck-claude-x81QzT` | the working folder of one call to a reviewer program; `gemini-cli` gets a second folder, ending `-aside-` and 6 characters, for its policy file | `check --review` and `try`, which remove both after the call |
| a folder `lawcheck-index-` and 12 random characters in the system's temporary directory | a copy of git's index, so that reading the change leaves the real index untouched | `check` and `doctor`, when they compare with a base, and they remove it at once |

Lawcheck reads the files git lists below the root, the `context` files of reviewer rules, and git's own data through `git`.
