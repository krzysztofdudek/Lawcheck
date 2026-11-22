# Changelog

Lawcheck follows [Semantic Versioning](https://semver.org/).

## [0.1.0-alpha.3] - 2026-11-22

`lawcheck docs` lists 36 pages, where alpha.2 listed 12, and groups them in five sections. The 24 new pages include an install page, a quick start, guides for Claude Code, for other coding agents, for an existing repository and for a monorepo, a reference of every command, a page of questions and an upgrade page. The twelve topics of alpha.2 keep their names and gain detail: `lawcheck docs codes` gives every code its cause, its fix and the output of a real case. In the terminal, a link to another page prints with the command that prints that page, as in `Install (lawcheck docs install)`. The pages are also a website, at https://krzysztofdudek.github.io/Lawcheck/, and `README.md` shows one law and the finding it gives on its first screen. `check`, the readers, the plugin's hooks and the reviewer's prompt work as in alpha.2: a check gives the same results, and the verdicts in `.lawcheck/verdicts` still count.

### Before you upgrade

The text list of `lawcheck docs` has a line for each section, with the topics indented under it, so a script that reads that list meets lines it did not see before. `lawcheck docs --json` lists the topics as before, under the schema `lawcheck-docs/0`, each with its `id` and `title`.

## [0.1.0-alpha.2] - 2026-11-18

Lawcheck now reads the code with Runes 1.2.0, and `check` finds uses that alpha.1 missed. It judges them against `may_use`, so a law that passed on alpha.1 can fail now. The new uses are a Python package under a folder that `pyproject.toml` or `setup.cfg` names, a Rust `mod` with `#[path]`, a Rust path to a path dependency written without `use`, a Go module wired with a relative `replace`, a Vite, webpack or Babel alias in the forms `lawcheck docs languages` lists, `vi.mock` and `jest.mock`, a relative `<script src>` in a Vue or Svelte file, a Ruby `require` of a file in the repository, and more forms in C#. A few findings of alpha.1 go away, because the code does not reach what they named: a script inside an HTML comment of a Vue or Svelte file, and a C# name that the file declares as a value. You see fewer unresolved uses. A name imported from a relative Python module (`from .m import x`) is judged as a use of the module's file, and a C or C++ system header, a Ruby constant the repository does not declare and a Java or Kotlin member type inherited from a library now leave the repository. An alias the readers cannot follow is counted as unresolved, where alpha.1 dropped it. The install takes about 34 MB more disk, because Runes now ships its grammars.

## [0.1.0-alpha.1] - 2026-11-17

The first release of Lawcheck. You write the law of your repository in `.lawcheck/law.yaml`: the types of its files, which type may use which, and the rules each type follows. `lawcheck check` gives every file its type, runs your script rules, sends the rules you write in Markdown to a model for review, and reads the uses in the code of twelve languages. It judges the files a change touches against a base branch, lists the older breaches as debt with `--full`, and names the file and line of each one. The commands `init`, `explain`, `try`, `docs`, `doctor` and `prime` start a law, show how Lawcheck reads a file, and give the law to a coding agent. The Claude Code plugin checks each file the agent edits and sends the agent back, up to three times, while the files of its turn break the law.

Next: [Supported environments](support.md)
