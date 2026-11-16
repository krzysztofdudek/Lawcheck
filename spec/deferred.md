# Deferred: what is designed and not built

One ledger of every feature or promise that the design has and Lawcheck does not build yet. The slice specs say what each slice builds and name this file for the rest, so a cut is written down once. "The design notes" means the notes the build started from, which are not in this repository. Each row says where the feature is mentioned in a spec, what a run does in its place, and why it waits.

A row leaves this file when its feature is built, and the commit that builds it removes the row and gives the feature its section in a spec. A feature that is not in a row and not in a spec is not designed.

## Not built

### Script rules

| What | Where it is mentioned | In its place | Why it waits |
|---|---|---|---|
| A call that sees several files, the `group` key of a rule, `repo.read`, `repo.exists`, `repo.list`, a file's `language`, `tree()` and `uses()`, and helpers from a `lawcheck/rule` import | `check-slice.md` section 1, section 3 and decisions 3 and 4; `dependency-slice.md` section 1 | one call per file with `path`, `type`, `text` and `lines`; `repo.filesOf` tells another file's type | One call per file keeps a finding a function of the file, its type and the rule, so a plain check gets for a changed file what a full run gets (`check-slice.md` decision 3). No later slice took the contract up. |
| The law keys `required` and `ignored`, and the code `untyped-file` | `check-slice.md` section 1 | `law-invalid` | Cut from the first slice's scope and not taken up since. |
| A `/` in a rule id, as in a rule grouped under a name | `check-slice.md` section 1 and section 2 | `law-invalid` | Cut from the first slice's scope and not taken up since. |

### The command line

| What | Where it is mentioned | In its place | Why it waits |
|---|---|---|---|
| `check --staged`, to judge the files of a commit and not the working tree | `check-slice.md` section 1; `commands-slice.md` section 1; `plugin-slice.md` section 1 | `usage`; the hook of `docs/ci.md` judges the working tree against the base | Cut from the first slice's scope. Judging the index would need each staged file's content from git and not from disk. |
| `check --no-scripts`, to answer a pull request from a stranger without running its rules | `check-slice.md` section 1 and decision 6 | `usage`; do not run a check where you would not run the change's tests (`docs/ci.md`, "Where a check may run") | Cut from the first slice's scope; the answer in the meantime is where to run a check. |
| `check --strict`, `--rule`, `--type`, `--no-color` | `check-slice.md` section 1; `commands-slice.md` section 1 | `usage`; `try` runs one rule, `explain` shows a type or a rule, nothing is coloured | Cut from the first slice's scope and not taken up since. |
| `check --dry-run`, the number of reviewer calls a run would make | `reviewer-slice.md` section 1 | `usage`; a run whose every error is `not-reviewed` names the number of calls in its `next:` line, and `reviews.missing` in JSON counts them | Cut from the second slice's scope; the count is given where a run needs it. |

### Waivers

| What | Where it is mentioned | In its place | Why it waits |
|---|---|---|---|
| A waiver for a range or a file (`lawcheck-waive-start`, `lawcheck-waive-end`, `lawcheck-waive-file`), also for a file too large to review | `check-slice.md` section 1; `reviewer-slice.md` section 1 | `waiver-unknown-rule` | The first slice built line waivers only and no later slice took the others up. |
| A waiver counted only inside a real comment | `check-slice.md` decision 12; `dependency-slice.md` section 1 | a waiver is read as text, so a marker quoted in a string or a document counts | Without language readers the tool cannot tell a comment from a string (`check-slice.md` decision 12), and the readers run only for a type with `may_use`. |
| A run that reports the waivers a change adds (`waivers[].new`, `new_waivers`) | `check-slice.md` decision 13 and decision 16 | every waiver in the files of a run is counted, none is marked new | It needs each file's content at the base (`check-slice.md` decision 13), which the run does not read. |

### Settings and the base

| What | Where it is mentioned | In its place | Why it waits |
|---|---|---|---|
| Settings per machine and a place for keys: `.lawcheck/config.local.yaml`, the machine's `~/.config/lawcheck/config.yaml`, and the keys `base`, `scripts.timeout`, `keys` and `reviewer.endpoint` | `check-slice.md` section 1 and decision 17; `reviewer-slice.md` section 1 and decision 1 | one committed `.lawcheck/config.yaml` with `reviewer` and `runner`; the reviewer's address and key come from the environment; the 30 seconds of a script rule are fixed. `init` still puts `config.local.yaml` into `.gitignore`, and nothing reads the file | A key in a file is a second place for a secret, and the environment closes the risk that a repository sends a key to an address of its own choosing. |
| The base from a CI system's variables, from a `base:` setting, or from a remote with another name than `origin` | `check-slice.md` section 1 and decision 10 | `--base`, then `LAWCHECK_BASE`, then `origin/HEAD` | Cut from the first slice's scope; `docs/ci.md` gives the line for GitHub. |

### Output and the law's version

| What | Where it is mentioned | In its place | Why it waits |
|---|---|---|---|
| The JSON document `lawcheck-check/1`, with `skipped_rules`, `new_waivers` and `waivers[].new` | `check-slice.md` decision 16; `commands-slice.md` section 2 | every document is named `/0`; `lawcheck-error/1` is the one `/1` | None of the `/0` documents matches a `/1` key for key, and none is published. |
| An unresolved use as a warning of its own, one per use | `dependency-slice.md` decisions 5 and 18 | a count in the first line and a list in `--json` | The slices chose a count and a list over a warning of their own (`dependency-slice.md` decisions 5 and 18). |
| `law-needs-update` and `law-newer-than-cli`, and the pages `update-<from>-to-<to>` | `commands-slice.md` section 1 | only the form of the `lawcheck:` line is checked | No release has an update page yet. |

### Language readers

| What | Where it is mentioned | In its place | Why it waits |
|---|---|---|---|
| A cache of syntax trees and declarations in `.lawcheck/.local/`, and a bound on the size of a file the readers parse. The design's one file in under 0.3 s on any language is not met for Java, Kotlin, C#, Ruby and Rust, which parse every file of the language | `dependency-slice.md` section 1, section 3.4 and decision 12 | every run reads what it needs; one changed file took about 0.2 s in a TypeScript repository, 6.1 s for Java in guava and 4.2 s for C# in Newtonsoft.Json | The owner decides whether either comes, with the measured numbers. |
| The readers' diagnostics about configuration files | `dependency-slice.md` section 1 | not shown | Not shown; the readers are used as they are. |
| A reader for JSON, YAML, TOML, Scala, Bash, Lua, Zig, Groovy, Solidity and Java properties | `dependency-slice.md` section 1 | `uses-not-read` where a list reaches such a file | Runes has the grammars and no reader of uses for them. |
| The forms the readers miss (`docs/languages.md`) | `dependency-slice.md` section 7 | a use is neither judged nor counted, and the page says which | They are Runes' to read; a cause in a reader is stated as a limit and not worked around in Lawcheck. |

### Reviewer rules

| What | Where it is mentioned | In its place | Why it waits |
|---|---|---|---|
| A second, independent answer for content that already has a verdict | `reviewer-slice.md` section 1 and decision 16 | one answer; `--again` asks again only where a failure is cached | The measurement of section 9 decides: below a `pairwise_agreement` of 0.95 on the clear files the question goes back to the owner. |
| Removing verdict lines that match no content | `reviewer-slice.md` section 1 and decision 11 | the tool never removes a line, so a merge never loses a verdict another branch needs | A pruning needs a rule for lines another branch may still use. |
| The debug log, and the tokens and the cost of a call | `reviewer-slice.md` section 1 | not kept | Cut from the second slice's scope and not taken up since. |
| A test that runs on any system the guard's wait for its list of processes on Windows: a list begun after the kill, else a fresh PowerShell after 10 seconds (`src/guard.ts`) | `reviewer-slice.md` section 6 and test 67 | the real Windows run of test 67 per push reaches the wait; no test reaches it deterministically (ledger row R-66) | The guard would need its platform injected, so that its Windows branch can run on Linux. It is a known gap of coverage, and no promise is softened. |

### The agent plugin

| What | Where it is mentioned | In its place | Why it waits |
|---|---|---|---|
| A plugin for Codex, Copilot, Cursor and other hosts | `plugin-slice.md` section 1 and section 9 | a README section for every agent: run `lawcheck prime` at the start of a session | The trial of section 10 measures Claude Code alone. |
| An MCP server | `plugin-slice.md` section 4.5 | none; every read it would offer is a command | A host whose agent cannot run a shell command, or a measured failure of agents to use `explain`, would change this. |
| A hook after a shell command | `plugin-slice.md` section 1 | the hook before the agent finishes sees what shell commands changed | The hook before the agent finishes sees what shell commands changed (`plugin-slice.md` section 8). |

## Built one way, and the owner may choose another

| What | Where it is mentioned | What is built |
|---|---|---|
| A use of an untyped text file from a type with a list | `dependency-slice.md` section 2 and decision 6 | `forbidden-use`, provisionally |
| An ambiguous use whose every candidate the list forbids | `questions.md` entry 71 | not judged; the candidates are in `--json` |
| The model is not part of the verdict key | `questions.md` entry 23; `reviewer-slice.md` section 5 | a change of model keeps every pass |
| A cap on the turns of the trial, and a tighter allow list for it | `questions.md` entry 63 | the 15 minutes of a run bound it, and the allow list is section 10's word for word |
| A new code for `init` where `.lawcheck` is a regular file | `questions.md` entry 47 | `internal` |
