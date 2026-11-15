# Changelog

Lawcheck follows [Semantic Versioning](https://semver.org/).

## [0.1.0-alpha.1] - 2026-11-15

The first release of Lawcheck. You write the law of your repository in `.lawcheck/law.yaml`: the types of its files, which type may use which, and the rules each type follows. `lawcheck check` gives every file its type, runs your script rules, sends the rules you write in Markdown to a model for review, and reads the uses in the code of twelve languages. It judges the files a change touches against a base branch, lists the older breaches as debt with `--full`, and names the file and line of each one. The commands `init`, `explain`, `try`, `docs`, `doctor` and `prime` start a law, show how Lawcheck reads a file, and give the law to a coding agent. The Claude Code plugin checks each file the agent edits and sends the agent back, up to three times, while the files of its turn break the law.

The prompt a reviewer gets now writes a line break inside a line as an escape, so a file cannot close a block of the prompt with it. The verdict key names this layout as `lawcheck-verdict/2`, so a review recorded under the earlier layout is asked once more and recorded again.
