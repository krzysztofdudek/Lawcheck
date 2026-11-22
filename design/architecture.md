# Architecture

This page is for someone who changes Lawcheck's code. What the tool does for a user is in [docs/](../docs). The promises that hold for every input are in [promises.md](promises.md), and the choices not to undo are in [decisions.md](decisions.md).

Lawcheck is TypeScript on Node 24, compiled from `src/` to `dist/`. Its runtime dependencies are `yaml`, `web-tree-sitter` and `@chrisdudek/runes`, which brings the readers of the twelve languages and their grammars. `npm run build` compiles the code and copies the grammars from the installed Runes package into `dist/grammars/`.

## One run, from the command line to the result

1. `src/bin.cts` is the installed entry. It looks at Node's permission model before it imports anything of Lawcheck, because under that model every import of the tool's own modules fails. It is CommonJS, since Node 24.2 to 24.6 under the permission model cannot read `package.json`. Then it imports `src/cli.ts`.
2. `src/cli.ts` runs on the main thread. It makes `PATH` absolute, answers `SIGTERM`, `SIGINT` and `SIGHUP`, and starts the command in a worker thread (`src/work.ts`). Every git command of the worker runs here, so a signal can end it while the worker waits for its answer. The main thread also watches two things. A step of the run that takes more than 30 seconds ends the run as `step-too-slow`. Memory that grows past its limit ends it as `memory-too-large`. The main thread writes the result to standard output and exits with its code.
3. `src/main.ts` runs in the worker. It answers `--version` and `--help`, reads the arguments (`src/args.ts`), refuses an unsupported Node, Bun, Plug'n'Play or git (`src/environment.ts`), and calls the command. Any failure it did not expect becomes `internal`, exit 2.
4. `src/check.ts` is the command `check`. Its steps:
   - `src/setup.ts` finds the root (the folder that holds `.lawcheck/law.yaml`), reads the law (`src/law.ts`) and `.lawcheck/config.yaml` (`src/config.ts`), and lists the files with git (`src/files.ts`);
   - each listed file gets its type (`src/types.ts`, with the patterns of `src/glob.ts`);
   - `src/setup.ts` takes the change: the base from `--base`, `LAWCHECK_BASE` or `origin/HEAD`, and the files that differ from the merge base;
   - the script rules run (`src/rules.ts`). Each rule has its own Node process, `src/runner.ts`, started with `--permission` and read access to the root and to Lawcheck's folder only;
   - the readers find each file's uses of other files (`src/readers.ts`), and `src/uses.ts` turns them into `forbidden-use` findings and unresolved uses;
   - each reviewer rule gets its state from `.lawcheck/verdicts` (`src/verdicts.ts`). With `--review`, `src/review.ts` asks the provider for what is missing, through `src/providers/`, and records each pass;
   - the waivers drop the findings they cover (`src/waivers.ts`), and the findings are split into the change and the debt;
   - `src/lawchange.ts` notes a change that edits the law that judges it.
5. `src/output.ts` renders the report as text or as JSON, and escapes every character that `I-out-1` keeps out of the output. Exit 0 is a pass, 1 a failure, 2 an error.

`src/guard.ts` is a separate process. It ends the runners, program calls and temporary folders that would outlive the tool when the tool itself is killed.

## The source files

| File | What it holds |
|---|---|
| `src/bin.cts` | the installed entry and the refusal under Node's permission model |
| `src/cli.ts` | the main thread: signals, the worker, git calls, the step and memory watch, the write of the result |
| `src/work.ts` | the worker that runs one command |
| `src/main.ts` | the choice of command, the environment refusal, `internal` |
| `src/args.ts` | the arguments of every command |
| `src/environment.ts` | the supported Node and git, and the refusal of the rest |
| `src/setup.ts` | the front of a run that commands share: root, law, config, rule files, typing, the change |
| `src/law.ts` | reads and validates `law.yaml` |
| `src/config.ts` | reads and validates `.lawcheck/config.yaml` |
| `src/files.ts` | the git commands: the file list, the base, the change |
| `src/glob.ts` | the patterns, matched in time linear in the path |
| `src/types.ts` | the type of each file |
| `src/names.ts` | file names as bytes, and their escaped form in the output |
| `src/limits.ts` | the limits of a run, and the reading of a file within them |
| `src/rules.ts` | starts the runners, keeps the time of each call, validates what a rule returns |
| `src/runner.ts` | the runner process: loads one rule and answers the tool's calls |
| `src/readers.ts`, `src/uses.ts` | the uses of each file, and the findings and unresolved uses they give |
| `src/waivers.ts` | the waiver comments, and the findings they cover |
| `src/verdicts.ts` | the review key, `.lawcheck/verdicts`, `.lawcheck/.gitattributes`, the failure cache |
| `src/prompt.ts` | the prompt a reviewer gets, and the reading of its answer |
| `src/review.ts` | the state of each review, the checks before the first call, and the calls |
| `src/providers/` | one file per provider, `http.ts` for the HTTP request, `program.ts` for a program call, `index.ts` for the choice by name |
| `src/keys.ts` | the key written as `[key]` in everything Lawcheck prints or writes |
| `src/programs.ts` | finds and starts programs, and ends their process trees |
| `src/guard.ts` | the process that ends what outlives the tool |
| `src/progress.ts` | the current step of the run, shared with the main thread |
| `src/lawchange.ts` | the changes of the law, its rules and its waivers in a change |
| `src/check.ts` | the command `check` |
| `src/output.ts` | the report and the errors as text and as JSON |
| `src/init.ts`, `src/prime.ts`, `src/explain.ts`, `src/try.ts`, `src/docs.ts`, `src/doctor.ts` | the other commands |

`.lawcheck/law.yaml` draws the layers the code moves to: `core`, `output`, `adapters`, `steps` and `commands` as folders under `src/`. None of the files above has moved yet, and the law lists them ([decision 160](decisions.md#160-lawchecks-repository-keeps-its-own-law)).

## The plugin

The Claude Code plugin lives in `plugin/`, and `.claude-plugin/marketplace.json` publishes it. It ships without the tool and starts the `lawcheck` that the repository's `runner` setting names. `plugin/hooks/hooks.json` maps four events to `plugin/hooks/lawcheck-hook.mjs`:

- at the session start, the hook gives the agent the output of `lawcheck prime`;
- when the user sends a prompt, it records the state of the turn;
- after `Write`, `Edit` or `NotebookEdit`, it runs `lawcheck check ./<file>` and hands a breach to the agent;
- before the agent finishes, it runs `lawcheck check` on the files that changed in the turn and sends the agent back, at most three times, while they break the law.

`snapshot.mjs` lists the files of a turn with git, `state.mjs` keeps the state of a session, `start.mjs` finds and starts programs, `fit.mjs` cuts a text to the size Claude Code takes, and `names.mjs` holds its own copy of the file name escapes of `src/names.ts`.

## The tests

`npm test` runs the commit set: the unit, acceptance, contract and guard tests, the properties, security and limits tests, and the environments tests. The nightly set adds longer runs of the same layers, the shipped deadlines and the sabotage list. [tests/README.md](../tests/README.md) describes the layers, the labels in test names, and the rules of the suite guard.
