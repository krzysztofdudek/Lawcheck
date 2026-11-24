# Security

## Reporting a vulnerability

Report it privately: on the repository's Security tab, choose "Report a vulnerability". Do not open a public issue for it. Say which version you ran (`lawcheck --version`), the command, and what it did. I answer in the private report.

Lawcheck is an alpha. Only the latest published version gets fixes.

## What is in scope

A report is in scope when Lawcheck breaks one of these promises. Each one has a test. [design/promises.md](design/promises.md) states the ones with an id in full.

- A script rule reads nothing outside the root and Lawcheck's folder, and reaches nothing outside the git work tree through a link git tracks (`I-runner-1`).
- No command starts a program that the repository's git config or attributes name (`I-git-1`).
- A script rule opens no network connection, listens on no port and sends no UDP packet. On Node 24, whose permission model has no network permission, the runner closes the routes to the network that Node has today. From Node 25, Node refuses them itself. A route that a later Node 24 release adds stays open until CI finds it: a test fails when a release adds an export to a module that reaches the network ([docs/script-rules.md](docs/script-rules.md)).
- No program Lawcheck starts comes from the repository through a relative or empty `PATH` entry (`I-start-1`).
- The reviewer key appears nowhere but in the header of its own request (`I-secret-1`). A key goes only to the address it was given for, and requests follow no redirect ([docs/providers.md](docs/providers.md)).
- An error about a law or a config read through a symbolic link quotes none of the file (`I-secret-2`).
- No output holds a character or a line that a terminal or a CI runner reads as a command (`I-out-1`).
- Text of a judged file cannot begin a line of the reviewer's prompt outside its numbered frame (`I-frame-1`).

## What Lawcheck does not promise

- The runner of script rules is no sandbox. A rule is code of the repository and runs with your rights: it reads every file under the root and puts what it read into its messages. Run `lawcheck check` only where you would run the repository's tests. [docs/script-rules.md](docs/script-rules.md) lists what the runner stops and what it does not.
- A line of `.lawcheck/verdicts` proves that someone wrote it, not that a model gave the verdict.
- A pull request can change the law that judges it. The check says so, and [docs/ci.md](docs/ci.md) gives a recipe that catches it.
- A reviewer model reads the text it judges, and that text can try to steer it. A verdict is a model's answer.
- A key shorter than 8 characters is not replaced by `[key]` ([decision 93](design/decisions.md#93-a-key-shorter-than-8-characters-is-not-replaced)).
