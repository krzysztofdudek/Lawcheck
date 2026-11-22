# The commands

`lawcheck <command> --help` prints the arguments of each command. This page says what each one reads, writes and exits with. Every command takes `--json` and then prints one document (`lawcheck docs json`). Outside `doctor`, exit 2 means that the command could not reach a conclusion, and the error names the next step (`lawcheck docs codes`).

| Command | Exit codes |
|---|---|
| `check` | 0 no error, 1 the code breaks the law, 2 no conclusion |
| `try` | 0 no finding, 1 a finding, advisory ones included, 2 the run could not be made |
| `init`, `prime`, `explain`, `docs` | 0, or 2 |
| `doctor` | 0 when no check fails, 2 when one does |

## init

`lawcheck init` starts a law in the current folder, which becomes the root. It writes `.lawcheck/law.yaml` with an empty law and a short example in comments, and `.lawcheck/.gitignore` with `.local/` and `config.local.yaml`. It never overwrites a file and writes no config. Run below the top of the git work tree, it starts a law that covers only that folder. It refuses with `already-initialized` when a law exists here or above, or when git lists one below. `lawcheck docs first-law` goes on from there.

## prime

`lawcheck prime` prints what a coding agent reads at the start of a session: how to work with Lawcheck here, which steps are only the user's to take, and the law in short. It runs no rule, reads no use, calls no reviewer and writes nothing. Without a law it prints two lines that say so, and exits 0. With a law that is not valid, it prints the start of the text, then the errors, and exits 2. The text stays within 8,000 characters, so the law part of a large law is shortened, and the text says what it left out. With a `runner` set, it says how to start Lawcheck here.

## explain

`lawcheck explain <path>` says why a file has the law it has: its type and the chain of types above it, the pattern that matched, what it may use, whether its uses are read, its rules with the state of each review, and its waivers. The path may name a file that does not exist yet, which shows the law a new file there would get, or a folder. `--type <id>` explains a type with its files, and `--rule <id>` a rule with the files it binds. A file without a type gets the reason, such as no pattern that matches it, git ignoring it, or a binary file. `explain` runs no rule and writes nothing. It exits 0 when it answered, a type overlap included.

## try

`lawcheck try <rule> [<path or pattern>...]` runs one rule on the files you choose, with no base, and writes nothing in the repository. A path or pattern is read from the current folder, a folder selects its files at any depth, and binary files are left out. A script rule without targets takes the files it binds. `--times`, `--dry-run` and `--max-calls` go only with a reviewer rule (`lawcheck docs reviewer-rules`).

## docs

`lawcheck docs` lists the topics, and `lawcheck docs <topic>` prints one page. It needs no law, no git and no network.

## doctor

`lawcheck doctor` says what is wrong with this setup, with one next step for each problem. It writes nothing. It works without a law and outside git, and it opens no connection unless you pass `--reviewer`, which sends the reviewer one small test request. Its nine checks run in this order:

| Check | What it looks at |
|---|---|
| `node` | the Node version |
| `git` | git, its version and the work tree |
| `law` | `.lawcheck/law.yaml` |
| `config` | `.lawcheck/config.yaml`, and the runner's program on the `PATH` |
| `types` | how many files have a type, and the first file that cannot be typed |
| `base` | the base of the change, and how many files the change holds |
| `law-change` | whether the change touches the law |
| `readers` | the languages whose uses are read, and the 13 grammars, which it loads |
| `reviewer` | the reviewer rules, and whether a reviewer can be called |

Each check is `ok`, `note`, `fail` or `skip`. A check is skipped when a check it needs did not pass. A `note` or `fail` line is followed by its `next:` line. Where Lawcheck refuses the environment, `doctor` starts with the same refusal as every other command, and still runs its nine checks below it.
