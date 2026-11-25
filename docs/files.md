# Files Lawcheck reads and writes

Lawcheck keeps its files in the folder `.lawcheck/`. The folder that holds it is the root, where each path of the law starts. You write the law, the settings and the rules. Lawcheck writes the other three: the [verdicts](concepts.md#verdict) of reviewer rules, a merge setting for them, and a local folder that git ignores. When you ask, a coding agent may write two proposals there: advice and a target architecture. Lawcheck reads neither of them.

## The folder .lawcheck

| File | What it holds | Written by | Commit it |
|---|---|---|---|
| `.lawcheck/law.yaml` | the law: the types, the rules and `may_use` ([The law file](law.md)) | `lawcheck init` writes the first one, and you edit it | yes |
| `.lawcheck/config.yaml` | the settings, such as the reviewer and the `runner` setting ([Settings](config.md)) | you; Lawcheck only reads it | yes |
| `.lawcheck/rules/` | one file per rule, `<id>.mjs` for a script rule or `<id>.md` for a reviewer rule, and helpers of script rules in `rules/lib/` | you; `init` makes no `rules/` folder | yes |
| `.lawcheck/verdicts` | the passes of reviewer rules, one line per pass: 32 hexadecimal characters, a space and the rule's id, sorted | `lawcheck check --review` | yes, so that CI reads the passes and calls no reviewer |
| `.lawcheck/.gitattributes` | the line `verdicts merge=union`, so a merge of two branches keeps the passes of both | `lawcheck check --review`, when it records a pass and the line is missing | yes |
| `.lawcheck/.gitignore` | `.local/` and `config.local.yaml` | `lawcheck init`, when the file is absent | yes |
| `.lawcheck/advice.md` | advice on the architecture: at most three boundaries or rules the code does not hold today, each with its evidence and count; nothing in it is law | a coding agent in the setup skill of the Claude Code plugin, when you ask for advice ([The setup skill](plugin.md#the-setup-skill)); no command of Lawcheck reads it | your choice: as the team's plan, or not at all |
| `.lawcheck/target.md` | a target architecture: the target law, the distance of the code from it, and the steps to reach it; nothing in it is law | a coding agent in the setup skill of the Claude Code plugin, when you ask for a target ([The setup skill](plugin.md#the-setup-skill)); no command of Lawcheck reads it | your choice: as the team's plan, or not at all |
| `.lawcheck/.local` | the failure cache, a lock and temporary files of the verdicts, and the reader cache | `lawcheck check --review`; `lawcheck check` writes the reader cache | no |

`init` writes this `.gitignore`:

```text
.local/
config.local.yaml
```

Lawcheck 0.1.0-alpha.5 reads no `config.local.yaml`. The second line of this file keeps a file of that name out of git.

A type's `paths` can match the law, the config and the rule files. Lawcheck then judges such a file against the rules of its type. `.lawcheck/verdicts` and `.lawcheck/.gitattributes` never get a type.

## The folder .lawcheck/.local

`check --review` makes this folder. A `check` that reads a file of Java, Kotlin, C#, Ruby or Rust for its uses makes it too. The folder holds its own `.gitignore` with the line `*`. Git ignores every file of the folder, even without `.lawcheck/.gitignore`.

| File | What it holds |
|---|---|
| `failures/<hash>.json` | one failed review: the rule and its findings, with any key hidden as `[key]`; a later `check` reports it again without a call, and `check --review --again` asks again ([Reviewer rules](reviewer-rules.md)) |
| `verdicts.lock` | a folder that one run holds while it writes `.lawcheck/verdicts`; a run that needs the lock removes a lock older than 10 seconds, or the lock of a run that ended |
| `verdicts-<pid>-<hex>` | the new verdicts file before it replaces the old one |
| `probe-<pid>-<hex>` | a file that Lawcheck makes and removes before the first call, to test that it can write to the folder |
| `readers/jvm`, `readers/csharp`, `readers/ruby`, `readers/rust` | the reader cache: what each file of the group declares, for the files of the last check ([Languages and uses](languages.md#the-reader-cache)) |

After a review passes, Lawcheck removes its file from `failures/`. If you delete the `.local` folder, you lose the cached failures and the reader cache. The next `check --review` asks the reviewer for those reviews again, and the next `check` reads every file of a group again.

## Outside the repository

| Where | What it holds | Written by |
|---|---|---|
| `CLAUDE_PLUGIN_DATA`, or a folder `lawcheck-plugin-<user id>` in the system's temporary directory | one small file per Claude Code session; each session start removes the files older than 7 days | the Claude Code plugin ([The Claude Code plugin](plugin.md)) |
| a folder in the system's temporary directory named `lawcheck-`, the program's name, a dash and 12 random characters, such as `lawcheck-claude-` and 12 characters for `claude-code` | the working folder of one call to a reviewer program; `gemini-cli` gets a second folder, ending `-aside-` and 12 characters, for its policy file | `check --review` and `try`, which remove both after the call |
| a folder `lawcheck-index-` and 12 random characters in the system's temporary directory | a copy of git's index, so that reading the change leaves the real index untouched | `check` and `doctor`, when they compare with a base; they remove it right after they read the change |

Outside `.lawcheck/`, Lawcheck reads three things:

- the files git lists below the root;
- the files that the `context` of a reviewer rule names;
- git's own data, through `git`.

Next: [Codes](codes.md)
