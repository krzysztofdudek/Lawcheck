# Changelog

Lawcheck follows [Semantic Versioning](https://semver.org/).

## [0.1.0-alpha.2] - 2026-11-18

Lawcheck now reads the code with Runes 1.2.0, so `check` finds uses that alpha.1 missed and judges them against `may_use`. A law that passed on alpha.1 can fail now. The new uses are a Python package under a folder that `pyproject.toml` or `setup.cfg` names, a Rust `mod` with `#[path]`, a Rust path to a path dependency written without `use`, a Go module wired with a relative `replace`, a Vite, webpack or Babel alias in the forms `lawcheck docs languages` lists, `vi.mock` and `jest.mock`, a Vue or Svelte `<script src>`, and a Ruby `require` of a file in the repository. A script inside an HTML comment of a Vue or Svelte file is no longer read. You see fewer unresolved uses: a C or C++ system header, a gem, a Ruby constant the repository does not declare and a Java or Kotlin member type inherited from a library now leave the repository. An alias the readers cannot follow is counted as unresolved, where alpha.1 dropped it. In a file whose lines end with a lone CR, a finding names its own line instead of line 1. The install takes about 34 MB more disk, because Runes now ships its grammars.

## [0.1.0-alpha.1] - 2026-11-17

The first release of Lawcheck. You write the law of your repository in `.lawcheck/law.yaml`: the types of its files, which type may use which, and the rules each type follows. `lawcheck check` gives every file its type, runs your script rules, sends the rules you write in Markdown to a model for review, and reads the uses in the code of twelve languages. It judges the files a change touches against a base branch, lists the older breaches as debt with `--full`, and names the file and line of each one. The commands `init`, `explain`, `try`, `docs`, `doctor` and `prime` start a law, show how Lawcheck reads a file, and give the law to a coding agent. The Claude Code plugin checks each file the agent edits and sends the agent back, up to three times, while the files of its turn break the law.
