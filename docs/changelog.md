# Changelog

Lawcheck follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

A script rule can read the syntax tree and the uses of its file. `await file.tree()` gives the tree that the grammar of the file's language parses, with each node's type, field, place in the text, line, column and children. `await file.uses()` gives the uses that `may_use` judges, each with the file it reaches and that file's type. Lawcheck reads either one only when the rule asks, so a rule that asks for neither costs what it cost in alpha.4. A file over 512 KiB, a language with no reader and a reader that fails give the rule an `absent` reason instead of an error of the run. The grammars are those of Runes 1.2.0, the same as in alpha.4. `lawcheck docs script-rules` lists each grammar's version and says what a new grammar may change.

A plain `lawcheck check` in GitHub Actions, GitLab CI and Azure Pipelines now finds its base from the variables of the pull request: `GITHUB_BASE_REF`, `CI_MERGE_REQUEST_TARGET_BRANCH_NAME` (and `CI_COMMIT_BEFORE_SHA` for a push to a branch) and `SYSTEM_PULLREQUEST_TARGETBRANCH`. Before, the first run in CI stopped with `base-unreachable` until you added `--base` from the docs. `--base` and `LAWCHECK_BASE` still come first, and the job still has to fetch the history of the base. GitHub Actions and Azure Pipelines set no variable for the commit before a push, so a push there still needs `--base`. The recipes for GitLab CI and Azure Pipelines in `lawcheck docs ci` lose the flag.

`lawcheck check --strict` judges every file as `--full` does, and a finding in old code fails the run when the same finding in the change would. A finding of an `enforced` rule in an old file is then an error with exit 1, and a finding of an `advisory` rule stays a warning. A team that paid its debt can keep it at zero. Without `--strict`, debt fails nothing, as before.

A check of one changed file in Java, Kotlin, C#, Ruby or Rust no longer parses every file of the language. `check` keeps what each file declares in `.lawcheck/.local/readers/`, and a later check parses again only the files that changed. In a Java repository of 3,267 files, a check of one changed file took 6 seconds in alpha.4 and takes about 0.3 seconds with the cache. In a C# repository of 951 files, it took 4 seconds and takes about 0.3 seconds. A check with the cache gives the same output as a check without it. `lawcheck docs languages` says when Lawcheck does not trust the cache. Lawcheck also stops counting the memory a run gains after its last parse against the last file it parsed. In alpha.4, `check --full` in that Java repository, with a law that reads the uses of every Java file, stopped with `memory-too-large` at a Kotlin build script of a few lines, the last file it parsed.

The law takes two new keys at the top, `required` and `ignored`, each a list of patterns. A text file under `required` that no type takes is the new finding `untyped-file`: an error in the change, a warning in debt. Before, such a file was judged by no rule and nothing said so, so an agent that put code in a new folder beside the layers put it outside the whole law. A file under `ignored` has no type, even when a type's `paths` match it. `lawcheck explain` names both, `lawcheck prime` lists them, and the note about a change to the law says `changes required` or `changes ignored`. A law without the two keys works as in alpha.4.

A use that could name several files is now a `forbidden-use` when the `may_use` list forbids every one of them, such as a Java star import of a package whose files are all of forbidden types, or a C# partial class spread over two forbidden layers. The message names each file with its type. In alpha.4 such a use was only counted as unresolved and the check passed. A use with one allowed file among its candidates still passes, and every such use stays in the unresolved list.

A change that moves a type under another parent is now named in the note about a change to the law, such as `moves the type library from source to script`. In alpha.4 the note said `edits .lawcheck/law.yaml without changing a rule or a type`, though the files of the moved type could lose their rules and their `may_use` list.

`lawcheck docs adopt-in-an-existing-repository` gains the section "Bring in a may_use list". A `may_use` list has no advisory status, so the section says how to close one on old code that already breaks it: the list goes first on the clean types, each old use gets a waiver with its reason, and the waivers are paid back one at a time.

A script rule may return `line: null` for a finding about the whole file. In alpha.4 the rule was `rule-crashed`. A string such as `'2'`, a bigint or `1.5` still crashes the rule, with a message that names the value.

When a reviewer's answer holds two verdict objects and one of them is a `fail`, the answer is that fail. In alpha.4 the last object won, so a fail followed by a quoted pass read as a pass.

A `check` or `try` that ends with exit 2 after it sent requests to a reviewer now says how many. The first line ends with the count, such as `lawcheck: ERROR  1 error, 2 reviewer calls`, and the JSON document `lawcheck-error/1` gains `calls_made` when the count is above 0. A program that checks the document against a schema that refuses unknown keys has to allow `calls_made`.

## [0.1.0-alpha.4] - 2026-11-23

A script rule that uses the network now gets an error from the call itself, on every Node. On Node 24, alpha.3 let the call through. On Node 25 and later, alpha.3 passed Node's refusal to the callback, the `error` event or the promise, so a rule that handled the refusal there passed. The rule runner of alpha.4 closes the network before the rule loads. A rule that connects, listens on a port, sends over UDP, looks up a name in DNS or calls `fetch` gets the error. A rule that does not catch it is `rule-crashed`, with the message `uses the network, which is closed to script rules`.

The documentation site is now at https://lawcheck.dev, and its old address redirects there. The pages of `lawcheck docs` now say that a file outside the change can stop a plain check with exit 2, with a code such as `type-overlap` or `file-unreadable`. The alpha.3 pages said that such a file never fails a plain check. `check` judges such a file as alpha.3 does.

### Before you upgrade

A script rule that uses the network now gets an error at the call, on any Node. A handler on the callback, the `error` event or the promise no longer sees it. The rule is `rule-crashed` if it does not catch that error at the call, and the check exits with code 2. Keep what the rule needs in a file of the repository, and let the rule read that file.

## [0.1.0-alpha.3] - 2026-11-22

`lawcheck docs` lists 36 pages, where alpha.2 listed 12, and groups them in five sections. The 24 new pages include an install page, a quick start, guides for Claude Code, for other coding agents, for an existing repository and for a monorepo, a reference of every command, a page of questions and an upgrade page. The twelve topics of alpha.2 keep their names and gain detail: `lawcheck docs codes` gives every code its cause, its fix and the output of a real case. In the terminal, a link to another page prints with the command that prints that page, as in `Install (lawcheck docs install)`. The pages are also a website, at https://lawcheck.dev, and `README.md` shows one law and the finding it gives on its first screen. `check`, the readers, the plugin's hooks and the reviewer's prompt work as in alpha.2: a check gives the same results, and the verdicts in `.lawcheck/verdicts` still count.

### Before you upgrade

The text list of `lawcheck docs` has a line for each section, with the topics indented under it, so a script that reads that list meets lines it did not see before. `lawcheck docs --json` lists the topics as before, under the schema `lawcheck-docs/0`, each with its `id` and `title`.

## [0.1.0-alpha.2] - 2026-11-18

Lawcheck now reads the code with Runes 1.2.0, and `check` finds uses that alpha.1 missed. It judges them against `may_use`, so a law that passed on alpha.1 can fail now. The new uses are a Python package under a folder that `pyproject.toml` or `setup.cfg` names, a Rust `mod` with `#[path]`, a Rust path to a path dependency written without `use`, a Go module wired with a relative `replace`, a Vite, webpack or Babel alias in the forms `lawcheck docs languages` lists, `vi.mock` and `jest.mock`, a relative `<script src>` in a Vue or Svelte file, a Ruby `require` of a file in the repository, and more forms in C#. A few findings of alpha.1 go away, because the code does not reach what they named: a script inside an HTML comment of a Vue or Svelte file, and a C# name that the file declares as a value. You see fewer unresolved uses. A name imported from a relative Python module (`from .m import x`) is judged as a use of the module's file, and a C or C++ system header, a Ruby constant the repository does not declare and a Java or Kotlin member type inherited from a library now leave the repository. An alias the readers cannot follow is counted as unresolved, where alpha.1 dropped it. The install takes about 34 MB more disk, because Runes now ships its grammars.

## [0.1.0-alpha.1] - 2026-11-17

The first release of Lawcheck. You write the law of your repository in `.lawcheck/law.yaml`: the types of its files, which type may use which, and the rules each type follows. `lawcheck check` gives every file its type, runs your script rules, sends the rules you write in Markdown to a model for review, and reads the uses in the code of twelve languages. It judges the files a change touches against a base branch, lists the older breaches as debt with `--full`, and names the file and line of each one. The commands `init`, `explain`, `try`, `docs`, `doctor` and `prime` start a law, show how Lawcheck reads a file, and give the law to a coding agent. The Claude Code plugin checks each file the agent edits and sends the agent back, up to three times, while the files of its turn break the law.

Next: [Supported environments](support.md)
