# Lawcheck: the `check` slice

The first working slice. A worker builds what this file says, and a reviewer ticks section 8. Quoted text output is exact, byte for byte. JSON is compared as parsed data. For every other message this file fixes the code, the place and the exit code, and the worker words one line.

## 1. Scope

In: `lawcheck check` in a git repository. It reads `.lawcheck/law.yaml`, gives each file one type, runs script rules, judges the change against a base, lists the rest as debt on request, honours line waivers, and prints text or JSON with exit code 0, 1 or 2.

Out, each with what this slice does where the design has it:

| Out | Here |
|---|---|
| rules judged by a model, `may_use`, language readers and syntax trees, the agent plugin, every other command | absent |
| a rule call that sees several files | one call per file |
| waivers for a range or a file (`lawcheck-waive-start`, `-end`, `-file`) | `waiver-unknown-rule` |
| the law keys `required` and `ignored`, the code `untyped-file` | `law-invalid` |
| `/` in a rule id | `law-invalid` |
| `check <paths>` and the flags `--strict`, `--staged`, `--rule`, `--type`, `--no-scripts`, `--no-color` | `usage` |
| settings files, colour | absent; the 30 seconds of section 3 are fixed |
| `column` in a finding | ignored, as any unknown field |
| the `note:` line when the change touches the law | absent |
| the base from a CI system's variables, or from a remote with another name than `origin` | the caller passes `--base` or `LAWCHECK_BASE` |
| `skipped_rules`, `new_waivers`, `reviews` and `waivers[].new` in the JSON document | absent; decision 16 |

## 2. The law file

`.lawcheck/law.yaml`, found by walking up from the current directory. The nearest directory that holds `.lawcheck/law.yaml` is the root, taken as its real path (`realpathSync`). Git and the rules run there, and every path is relative to it, with forward slashes. The root may lie below the top of the git work tree. A run then sees the files below the root alone.

Git runs at the root with settings that start no program the repository's config or attributes name: no `core.fsmonitor` program, no hook, no external diff, no `textconv`, and no `clean`, `smudge` or `process` filter (invariant `I-git-1`). The diff reads a copy of the index in a new temporary folder, removed after, since git diff writes the index again when the times of its files no longer match it, whatever `GIT_OPTIONAL_LOCKS` says; so a check leaves the index as it was. When no temporary folder can be made or the copy fails, the diff reads the index itself: the change is the same, and git may write the index again with fresh times. The change does not look into a submodule, whose own config would name its own programs; its files are not judged in any case. Settings the caller passes to git itself, such as `GIT_CONFIG_PARAMETERS` or `git -c` in an alias, are the caller's choice, not the repository's, and are outside this promise. A file whose content git takes through a filter, such as a file of Git LFS, is compared as its bytes on disk whenever git has to read it again, so a file whose time no longer matches the index can count as changed.

Every program Lawcheck starts, git and a reviewer program included, it looks up on `PATH` with relative and empty entries left out, and it hands `PATH` on without them, since such an entry names the folder a program starts in, the repository. On Windows it also sets `NoDefaultCurrentDirectoryInExePath` to `1` for itself and every program it starts, so `cmd.exe` does not look in the current folder before `PATH`. No program of the repository runs in place of the one named (invariant `I-start-1`).

The law may be read through a symbolic link, of the file or of `.lawcheck/`. A law read that way that is not valid gives one `law-invalid` at `.lawcheck/law.yaml`, whose message says so and quotes none of the file, since a link can lead to a file outside the repository, such as a token (invariant `I-secret-2`).

| In | Key | Required | Meaning |
|---|---|---|---|
| top | `lawcheck` | yes | `MAJOR.MINOR.PATCH`. Only its form is checked |
| top | `rules` | no | Map of rule id to rule |
| top | `types` | no | Map of type id to root type |
| rule | `why` | yes | One line, at most 200 characters, printed with the rule's findings |
| rule | `status` | no | `enforced` (default) or `advisory` |
| type | `about` | no | One line. Read and not used |
| type | `paths` | yes | Patterns, at least one without `!` |
| type | `content` | no | A JavaScript regular expression, flag `m`. The file belongs only when its text matches |
| type | `rules` | no | Rule ids |
| type | `types` | no | Subtypes, same shape |
| type | `waivers` | no | `true` or `false`. With `false` the type's files hold no waivers: a waiver marker in them is text (section 5). A type without the key takes its parent's value; a root type without it reads waivers |

**Values.** The file is a YAML mapping. `rules` and `types` take a mapping, and so does each rule and each type. `paths` and a type's `rules` take a sequence of strings. `lawcheck`, `why`, `about`, `status` and `content` take a string, and `why` and `about` a non-empty one without a line break. Anything else is `law-invalid` and names the key: a null (a key left empty), a string where a sequence belongs, a number, an empty file. A key that is absent is fine where the table does not require it.

Any other key is `law-invalid`; the message names the key, its rule or type, and the nearest known key within two edits. An id is kebab-case, `[a-z0-9]+(-[a-z0-9]+)*`. A type id is unique in the tree. A rule id equals no code of sections 5 and 6, nor `untyped-file`. A key that YAML reads as no string, such as `~`, `true` or `12`, is `law-invalid`; quoted, it is a string. A rule that no type lists never runs.

**Patterns** match the whole path, case-sensitive on every system. A pattern is segments joined by `/`.

- `*` is any run of characters without `/`, the empty run included, and `?` one such character. A leading dot in a name is a character like any other.
- `**` is a whole segment. Before the last segment it matches any number of directories, none included: `a/**/b.ts` matches `a/b.ts` and `a/x/y/b.ts`. As the last segment it matches every file below its directory at any depth, and not the directory's own path: `src/core/**` matches `src/core/a.ts` and `src/core/x/a.ts`, and no file named `src/core`.
- `{a,b}` is one of its alternatives. An alternative is not empty, holds no `/`, `{`, `}` or `,`, and may hold `*` and `?`.
- Other characters are literal, and there is no escape.
- A leading `!` excludes; the rest is a pattern.

A match costs time linear in the length of the path, whatever stars, braces and `**` the pattern holds.

A pattern is `law-invalid` when it is empty or `!` alone, holds an empty segment (a leading or trailing `/`, or `//`), holds a segment `.` or `..`, holds `**` beside other characters in one segment, or holds a brace that is nested, unclosed or unopened, or that holds a `/` or an empty alternative (`{}`, `{a,}`).

A file matches a list when it matches one plain pattern and no exclusion; order means nothing.

**The files** are the paths that `git ls-files -z --cached --others --exclude-standard` prints at the root (section 4 has every git command), each once, reduced to regular files that exist. The tool asks with `lstat`: a symlink is not a regular file, is in no count and has no type. Every listed path that is a regular file is judged or named as left out with its reason, whatever bytes its name holds (invariant `I-files-1`).

**Names.** A path is written in one form, in text and in JSON alike: its bytes read as UTF-8, with a backslash written as `\\`, a line feed as `\n`, a carriage return as `\r`, and each byte that is no part of valid UTF-8 as `\x` and two lowercase hexadecimal digits. So one finding stays one line, and its place maps back to the bytes on disk. Patterns are matched against the path in this form, and rules, `repo.filesOf` and the reviewer see it in this form. A path given on the command line is read in it too; `\t`, `\x` with two hexadecimal digits and `\u` with four stand for the tab, the byte and the character they name, as the text output writes them, and a backslash that starts none of these stands for itself. On Windows a backslash on the command line separates directories, and file names hold none of the escaped bytes.

**Other repositories.** A submodule, and a repository of its own inside the work tree, are listed by git as their directory and none of their files, so no file in them is judged. When a root type's paths reach below such a directory, the line after the first line of a run that does not end with exit 2 is `note: the paths of a type reach into <dir> (a submodule), <dir> (a repository of its own); Lawcheck does not look into another repository, so no file there is judged`, naming at most three and then `and <n> more`. It changes no count and no exit code. `explain` and `try` give the reason `it lies in <dir>, a submodule, which Lawcheck does not look into` (or `a repository of its own`) for a path below one.

**The text** of a file is its bytes decoded as UTF-8, without a byte-order mark; an invalid sequence becomes U+FFFD. There is no size limit: the 30 seconds of section 3 bound what a large file costs. A file is binary when its first 8,000 bytes hold a NUL byte. A binary file has no type.

**The type of a file.** The tool tests the file against the root types (`paths`, then `content`), then against the subtypes of the one that matched, and so on down. The deepest match is the file's type. The rules of every type on the way down bind the file; a rule listed twice, in one type or on the way down, binds once. Two types of one level matching one file are `type-overlap`. A file with no type is never judged. Every run types every file, and reads each file whose path matches a type; one it cannot read is `file-unreadable`.

**Rule files.** Rule `<id>` is `.lawcheck/rules/<id>.mjs`; without it, `rule-missing-file`. Any other file under `.lawcheck/rules/` outside `.lawcheck/rules/lib/` is `rule-file-without-entry`. Both checks read the files above and not the disk: a file git ignores is not there.

### The sample

Eight files: the law below, `.lawcheck/rules/no-console.mjs` (the example of section 3), `.lawcheck/rules/no-todo.mjs`, `README.md` holding `# Sample`, and four source files. `no-todo.mjs` reports each line that holds `TODO` and no `#` before a digit, with the message `TODO without an issue number`. Every file ends with a line end.

```yaml
lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.
  no-todo:
    why: A TODO without an issue number gets forgotten.
    status: advisory

types:
  source:
    about: Everything that ships.
    paths: ["src/**/*.ts", "!src/**/*.d.ts"]
    rules: [no-todo]
    types:
      library:
        about: Code the commands call.
        paths: ["src/core/**"]
        rules: [no-console]
      command:
        about: The command layer.
        paths: ["src/cli/**"]
  script:
    about: Executable helpers.
    paths: ["tools/**/*.{mjs,js}"]
    content: "^#!"
    rules: [no-todo]
```

`src/core/price.ts`:

```ts
export function price(net: number): number {
  console.log('pricing', net);
  return net * 1.23;
}
```

`src/core/tax.ts`:

```ts
// TODO round to cents
export const rate = 0.23;
```

`src/cli/main.ts`:

```ts
import { price } from '../core/price.js';
console.log(price(100));
```

`tools/release.mjs`:

```js
#!/usr/bin/env node
// TODO sign the tag
console.log('released');
```

## 3. The script rule contract

A rule file is an ES module that exports `check`:

```js
export function check({ files }) {
  const findings = [];
  for (const file of files) {
    file.lines.forEach((text, index) => {
      const call = text.match(/\bconsole\.(\w+)/);
      if (call) findings.push({ file: file.path, line: index + 1, message: `writes to the terminal with console.${call[1]}` });
    });
  }
  return findings;
}
```

**Input.** `check` receives one object with `files` and `repo`. `files` holds one file in this slice: `path` (in the form of section 2), `type` (its type id), `text` and `lines`. `lines` is the text split at `\n` and `\r\n`. A lone `\r` stays in its line, and a final line end adds no empty element, so an empty file has no lines. `repo.filesOf(typeId)` returns an array at once, with no promise: the paths of every file of that type and its subtypes, sorted. It throws on an unknown id. Sorting, here and in section 6, compares UTF-16 code units, as JavaScript's default sort does.

**Calls.** The tool calls `check` once for each file the rule binds and the run looks at, in the order of the paths, one call at a time. A rule keeps nothing between calls. The default run hands it the changed files alone and a full run all of them, so a rule that remembers earlier files answers differently in the two. The tool does not enforce this.

**Output.** A list of findings, or a promise of one. A finding has `message` (a non-empty string; each line break in it becomes one space, in text and in JSON) and may have `file` (the path of the call, nothing else) and `line` (an integer from 1 to the length of `lines`). A `line` that is no integer, `null`, a string or a bigint included, is named by its value and kind in the message of `rule-crashed`, and one outside the file by its number and the file's lines. Without `line` it is about the whole file. Other fields are ignored. Equal findings are not merged. The tool checks every finding it receives. The channel carries values as a structured clone, so `NaN` arrives as `NaN` and fails the check.

**The runner.** A rule with at least one file to judge in the run gets one Node process for that run. A rule with none is not loaded. The tool starts the process with `child_process.fork` on its own runner file, with these options:

| Option | Value |
|---|---|
| `execArgv` | `--permission`, `--allow-fs-read=<root>`, `--allow-fs-read=<package>`, and no other flag, whatever the tool itself was started with. Both are real paths: the root, and the directory that holds Lawcheck's `package.json` |
| `env` | `{}`. No variable of the caller reaches the rule, `NODE_OPTIONS` included |
| `cwd` | the root |
| `serialization` | `'advanced'` |
| `stdio` | no standard input; what the rule prints, on either stream, goes to the tool's standard error a line at a time, with the escapes of section 6 for text the tool does not own |

The runner first tells the tool that it started. A runner that ends before that, or whose process the system does not start (`EAGAIN`, `ENOENT`), is `runner-failed`, without a place and never at a rule file: Node could not start it, as with a flag it does not know or a runner file it cannot read; the message then carries the system's error. The tool then starts the runner once more, without a channel, which a sound runner ends at once, and the message is `the runner of script rules did not start: <line>`, `<line>` being the first line of what Node printed that starts with an error's name or `node: `, else its first line, else `it ended with <code> before it started`. One `runner-failed` stands for every rule of the run. The next line is `reinstall Lawcheck, then run lawcheck check`.

The tool sends the type of every file and the path of the rule file. The runner imports the rule file and answers. The tool then sends one call at a time, and the runner answers each with what `check` returned. After the last answer the tool kills the runner, and whatever the rule left running ends with it. When the tool ends in any other way, a signal that kills it included, its runners end too: a small guard process that the tool starts kills those still alive. A signal that the tool can catch ends it as `internal`. The tool allows 30 seconds for the load and 30 seconds for each call; past that it kills the runner.

**What the runner stops,** measured on Node 24.22.2. Node refuses the call with an error, and the rule is `rule-crashed`, when the rule:

- writes, renames or deletes a file, or makes a directory, through `node:fs`;
- reads through `node:fs` a path outside the root and the package;
- starts a child process or a worker thread;
- loads a native add-on or WASI.

Node refuses each of these in every form, at every path of the root (invariant `I-runner-1`). Node reads a `*` in a granted path as a wildcard over everything after it, and cannot load a module from a path that holds a backslash where `/` is the separator. So when the root or Lawcheck's folder holds a `*`, or such a backslash, the tool starts no runner and the run ends with `path-unsupported`, without a place, naming the path. Node also follows a link, so a link under the root that leads elsewhere lets a rule read there. The threat is content that comes from git, which a pull request can carry. Before it starts a runner the tool resolves every link git tracks under the root and in its submodules, by the bytes of its name, so a name with a line break or bytes that are not UTF-8 counts like any other. A link that leads outside the git work tree and Lawcheck's folder ends the run with `link-outside-root`, placed at the link, naming where it leads; a link that leads elsewhere inside the work tree, such as `pkg/LICENSE` to `../LICENSE` with the law in `pkg/`, is allowed. A target is inside a folder only when the folder is a whole leading part of its path, so `/x/s2` is not inside `/x/s`. Links git does not track, ignored ones included, are the local user's own and are outside this promise, and git carries no hard link, so a clone holds none that the repository chose. The rule is `rule-crashed` when the refusal reaches it as a thrown error or a rejected promise. A call with a callback, such as `fs.writeFile(path, data, callback)`, hands the refusal to the callback instead, and the rule goes on; the file is still not written.

A rule imports what it can read: `node:` built-ins, files below the root such as `.lawcheck/rules/lib/`, and packages in a `node_modules` below the root. A package in a `node_modules` above the root, where a monorepo hoists it, or behind a link that leads outside the root, cannot be read, so such a rule does not load.

When the load reads a package in a `node_modules` outside the root, the next line is `install <package> in a node_modules below the root, then run lawcheck check`. When Node refuses, the message names what the rule did, never a flag of the runner's command line, which the user cannot pass: `reads <path> outside the root and Lawcheck's folder, and a rule may read nothing else`; `writes <path>, and a rule may write no file`; `starts a program, and a rule may start none`; `starts a worker thread, and a rule may start none`; `loads a native add-on, and a rule may load none`; `starts WASI, and a rule may not`. `<path>` is the path Node names.

A rule that hangs or dies takes its own process with it and nothing else. `process.env` is empty in a rule. `process.send` is absent in a rule, so the channel to the tool carries only the runner's answers; a message the tool did not ask for ends the rule as `rule-crashed`.

**What the runner does not stop.** It is no sandbox, and this slice has no flag that skips script rules. A rule can:

- read every file under the root, `.git/` and files git ignores, such as `.env`, included;
- read any file the user can read, through a link under the root that git does not track, or a tracked link that leads elsewhere inside the git work tree; a tracked link that leads outside the work tree stops the run before any rule starts (above);
- open network connections: `fetch`, `node:net` and `node:http` work under `--permission` on Node 24;
- write a file wherever the user can, through `node:sqlite`;
- signal the user's processes with `process.kill`;
- put what it read into its messages and its printed lines, which end in the output and in a CI log.

A rule file is code of the repository and runs with the user's rights, as the repository's tests and build scripts do. Run `lawcheck check` on a change only where you would run that change's tests.

**A broken rule** is `rule-crashed`: the module does not load, exports no function `check`, throws or rejects, returns anything but the list above or a value the channel cannot carry (a function, for one), passes 30 seconds in its load or in one call, its runner ends before answering, or it fails in the background: a promise rejects with no handler, or a timer throws. The runner waits one turn of the event loop after the load and after each call before it answers, so a rejection left behind by the load or by a call fails that load or call, with the message `fails in the background in its load: <error>` or `fails in the background after its call on <file>: <error>`, and the result for a file is the same whether it is judged alone or with others (invariant `I-rules-1`). A failure that comes later, from a timer, fails the next call, still named after the call it came after; one that comes after the last answer is not seen. The tool stops that rule and runs the others, so one run names each broken rule once, with the rule file as the place and the judged file, or the load, in the message.

## 4. `check`

`lawcheck check [--full] [--base <ref>] [--json]`.

**Arguments.** `lawcheck --version` prints `0.1.0`, the package version. `lawcheck --help` and `lawcheck check --help` print the usage, whose first line is `usage: lawcheck check [--full] [--base <ref>] [--json]`. All three exit 0. Anything else outside the line above is `usage`: no argument at all, another command, a word after `check` that is no flag, an unknown flag, a flag given twice, `--base` as the last argument or before an argument that starts with `-`, and the form `--base=<ref>`. `--json` anywhere among the arguments selects JSON, for a `usage` error too.

**The base** is the first of `--base`, the variable `LAWCHECK_BASE` when it is not empty, and `origin/HEAD` where the clone has it, printed as its target (`origin/main`). A base that resolves to no commit or shares no history with HEAD is `base-unreachable`. With no base, every file counts as changed, except for a plain check in a CI job. A job is in CI when the variable `CI` is set and is not empty, `0`, `false`, `no` or `off`, any case; without `CI`, when one of `GITHUB_ACTIONS`, `GITLAB_CI`, `TF_BUILD`, `JENKINS_URL`, `BUILDKITE`, `CIRCLECI`, `TRAVIS`, `BITBUCKET_BUILD_NUMBER`, `TEAMCITY_VERSION`, `APPVEYOR`, `DRONE`, `CODEBUILD_BUILD_ID`, `BUILD_ID` or `WOODPECKER` is set to such a value. There a plain check with no base is `base-unreachable` with the message `no base in this CI job: no --base, no LAWCHECK_BASE and no origin/HEAD, and a plain check without one would count every file as changed` and the next line `pass --base origin/<the branch the change goes into> or set LAWCHECK_BASE, with the history fetched (<fetch>); or judge every file with lawcheck check --full`, `<fetch>` being `fetch-depth: 0 in actions/checkout, GIT_DEPTH: 0 in GitLab CI, fetchDepth: 0 in Azure Pipelines` (question 87). `--full` judges every file and needs no base, so it runs in CI as elsewhere, and so does `check <paths>`. In a repository with no commit yet, a base is `base-unreachable`, and without one every file counts as changed.

`base-unreachable` says why, in the cases a CI job meets most:

| The case | The message | The next line |
|---|---|---|
| the clone is shallow (`git rev-parse --is-shallow-repository` prints `true`) | the base names no commit here, `and this clone is shallow`; or it shares no history with HEAD `in this clone, which is shallow` | `fetch the history: <command> (<fetch>), then run lawcheck check`, where `<command>` is `git fetch --unshallow <remote> +refs/heads/<branch>:refs/remotes/<remote>/<branch>` for a base `<remote>/<branch>` of a remote that `git remote` lists, else `git fetch --unshallow` |
| the clone is whole, the base is `<remote>/<branch>` of a remote whose fetch lines name no `refs/heads/*`, as a clone made with one branch has | `the base '<base>' names no commit here; this clone did not fetch that branch` | `fetch the branch: git fetch <remote> +refs/heads/<branch>:refs/remotes/<remote>/<branch> (<fetch>), then run lawcheck check` |
| the base is forty or sixty-four zeros, the "before" of a push that made a branch | `the base '<base>' is git's commit of zeros, which a push of a new branch names as the commit before it` | `pass --base with the branch the new one was made from, such as origin/main, then run lawcheck check` |
| the base ends in `/`, as `origin/${{ github.base_ref }}` reads on a push | `the base '<base>' names no commit here: the branch name after the last / is empty, as when the variable that should hold it is empty` | the plain one below |
| the base came from `origin/HEAD` | `the base '<base>', which origin/HEAD names, names no commit here`, or `shares no history with HEAD` | `pass --base with a branch or a commit that exists here, or point origin/HEAD at one with git remote set-head origin --auto` |

Otherwise the message is `the base '<base>' names no commit here` or `the base '<base>' shares no history with HEAD`, and the next line `pass --base with a branch or a commit that exists here`.

**Git.** Every git command runs at the root, with the tool's environment and `GIT_OPTIONAL_LOCKS=0`, and the tool reads its output as bytes. These are all of them, in order:

| For | Command | Reading |
|---|---|---|
| the filters | `git config -z --name-only --get-regexp ^filter\.`, once for each folder git runs in, before the first other command | each `filter.<name>.clean`, `smudge` and `process` it names is set to nothing for the commands below (section 2); another exit than 0: none |
| the version | `git --version` | older than 2.34: `unsupported-environment` (`spec/environments.md`, section 3); git does not start or prints no version: the next row decides |
| the work tree | `git rev-parse --is-inside-work-tree` | git does not start, exits with another code than 0, or prints another word than `true`: `no-git` |
| the files | `git ls-files -z --cached --others --exclude-standard` | section 2 |
| HEAD | `git rev-parse --verify --quiet HEAD^{commit}` | exit 1: no commit yet |
| the default base | `git symbolic-ref --quiet --short refs/remotes/origin/HEAD` | run when neither `--base` nor `LAWCHECK_BASE` names a base; exit 1: no base |
| the base | `git rev-parse --verify --quiet --end-of-options <base>^{commit}` | another exit than 0: `base-unreachable` |
| the merge base | `git merge-base HEAD <the base's commit>` | exit 1: `base-unreachable` |
| why the base cannot be reached | `git rev-parse --is-shallow-repository`, `git remote`, and `git config --get-all remote.<remote>.fetch`, only when the base cannot be reached | the table below |
| the change | `git rev-parse --git-path index`, then `git diff --no-ext-diff --no-textconv --ignore-submodules=all -z --name-only --no-renames --relative <merge base> --`, then `git ls-files -z --others --exclude-standard` | below |
| edits git's diff hides | `git ls-files -v -z`; for the files it tags with a lowercase letter (assume-unchanged) or `S` (skip-worktree), `git rev-parse --show-prefix`, `git hash-object --stdin-paths` with each path written in C quotes from the top of the work tree, so any byte and a root below the top are read right, and `git ls-tree -r -z <merge base>` | such a file whose content on disk differs from its blob in the merge base, or that the merge base lacks, is in the change |
| the links | `git rev-parse --show-toplevel`, then `git ls-files -z --stage` at the root and again in each checked-out submodule it lists (an entry of mode `160000`), when a script rule is to run | the top of the work tree, and the entries of mode `120000`, the links git tracks under the root and in its submodules (section 3); git 2.34 refuses `--recurse-submodules` with `--stage`, so each submodule is asked in its own folder |

Any other failure of a git command is `internal`. With `-z` git ends each path with a NUL byte and quotes nothing, so a name with a letter outside ASCII, a space or a tab arrives as it is. `ls-files` at the root and `diff --relative` both print paths relative to the root and leave out everything outside it. The tool compares the paths of the two as equal strings, wherever the root lies in the git tree.

**The change** is every path of the last two commands that is among the files of section 2. `git diff` here compares the merge base with the working tree, so:

- a file committed on this branch, staged, modified or untracked and not ignored is in the change;
- a deleted file is not: git names it, and the files of section 2 do not hold it;
- a file git marks assume-unchanged or skip-worktree is in the change when its content on disk differs from the merge base, though `git diff` trusts the index for it and does not name it;
- a renamed or moved file is gone under its old path and changed under its new one, edited or not, because the new path may give it another type;
- a change of the file's mode alone counts, as git reports it;
- a file staged and then put back in the working tree to what the merge base holds is not in the change.

**By default** the rules run on the changed files alone. A finding of an `enforced` rule is an error, of an `advisory` rule a warning. One error fails the run. The change counts per file: an error on a line the change left alone fails the run too.

**`--full`** runs the rules on every file. Findings in changed files count as above. Findings in the other files are debt: warnings whatever the rule's status, with no influence on the exit code.

## 5. Waivers

```
console.warn('no campaign'); // lawcheck-waive no-console -- the pricing team reads this warning until 2.0
```

- The form is `lawcheck-waive <rule id> -- <reason>`, anywhere in a line of a file that has a type. The tool reads lines, the `lines` of section 3, and parses no comments.
- The marker is the first `lawcheck-waive` in the line. A second one on the line is text. After the marker come whitespace, the rule id (a run of characters that are not whitespace), whitespace, `--` and the reason.
- With a letter or digit (`\p{L}` or `\p{N}`) before the marker on its line, the waiver covers that line. Otherwise the line stands alone, valid or not, and covers the next line that does not stand alone. At the end of the file it covers nothing.
- A file whose type has `waivers: false` (section 2) holds no waivers: the tool does not look for the marker in it, so a page or a test that writes about waivers can have a type. Its findings are never waived.
- A closing `*/` or `-->` at the end of the line is cut off before the tool looks for the `--`, so `<!-- lawcheck-waive no-console -->` has no reason. The reason is the rest of the line after that `--`, trimmed.
- A waiver drops every finding of its rule on the covered line, with nobody's approval. A whole-file finding cannot be waived.
- A waiver with a known rule and a reason is counted, used or not: in the first line for the changed files, in the debt heading for the others. In JSON, `waivers` lists the waivers of the changed files without `--full`. With `--full` it lists those of every file that has a type, the ones outside the change with `debt` true.

| Code | When | Severity |
|---|---|---|
| `waiver-unknown-rule` | whitespace and a rule id of the law do not follow the marker: the id is missing, is no rule, or the word goes on, as in `lawcheck-waive-file` | error |
| `waiver-without-reason` | the rule is known, and no `--` follows it or nothing follows the `--` | error |
| `waiver-unused` | a counted waiver dropped nothing | warning |

A line gets one of the first two at most, and those waive nothing. All three sit on the waiver's line and cannot be waived. Outside the change they are debt, so warnings.

## 6. Output and exit codes

Exit 0: no error. Exit 1: at least one error, so the code breaks the law. Exit 2: Lawcheck could not conclude, and it prints the errors and no findings. The tool ends with no other code: it catches every failure of its own and reports it as `internal`, so exit 1 never means a fault of the tool.

Text goes to standard output without colour, with two spaces between the parts of a line and no alignment. The lines, with `<...>` for a part that varies:

```
lawcheck: <verdict>  <counts><n> changed files (against <base>)<waivers>
lawcheck: PASS  nothing changed against <base>
<place>  <severity>[<code>]  <message>
  why:  <why>
debt (outside this change): <f> findings in <n> files<waivers>
next: <text>
```

- `<verdict>` is `PASS` or `FAIL`. The square brackets around `<code>` are printed.
- `<counts>` is `<e> errors, <w> warnings in `. A count of zero is left out together with its word, and the comma with it; when both are zero the whole part is left out. A count of 1 takes the singular, here and in every other count.
- `<n>` counts the changed files, with a type or without. When it is zero the first line is the second form. With no base, `<n> files (no base: every file counts as changed)` stands where `<n> changed files (against <base>)` would.
- `<waivers>` is `, <k> waivers`, left out when `k` is zero.
- `<place>` is `<file>:<line>`, or `<file>` for a whole-file finding. An error of exit 2 without a place starts at `<severity>`.
- `<severity>` is `error` or `warning`. The code is the rule id or a code of sections 5 and 6. Each of those codes has one fixed `why`, which the worker words where this file quotes none.
- Findings are sorted by file, line (whole-file first) and code, and equal ones stay in the order the rule gave them. `why:` follows the first finding of each code in a run.
- The debt block comes with `--full` alone. Without debt findings its heading reads `debt (outside this change): none<waivers>`.
- `next:` comes when the run fails. A blank line stands before the findings, the debt heading and `next:`.
- At most 50 finding lines are printed, the change and the debt counted together and no `why:` line counted. Where the 51st would stand, one line ends the findings: `... <n> more findings (--json lists all)`, with `n` the findings of both blocks left unprinted. The debt heading still prints, with its full count, also when no debt line is left under it.

**Text the tool does not own.** File names, the messages of rules and reviewers, the base, the ids and `about` texts of the law, the values of the config, and the text that git, a reviewer endpoint or a reviewer program prints can hold any character. In the text output of every command the tool writes these characters as escapes, so one finding or error stays one line and a terminal or a CI log reads no control sequence in it:

- a line feed inside such text as `\n`, a carriage return as `\r`, a tab as `\t`;
- every other character below U+0020, and U+007F, as `\x` and two lowercase hexadecimal digits;
- U+0080 to U+009F, U+2028, U+2029, and every format character (Unicode category Cf, such as U+200B, U+200E, U+202E, U+2066, U+FEFF and the tag characters) except U+200C and U+200D, which scripts and emoji sequences need, as `\u` and four lowercase hexadecimal digits for each UTF-16 unit.

A line that starts, after white space, with `::` (a command of GitHub Actions) or `##[` (one of Azure Pipelines) has that first `:` or `#` written as `\x3a` or `\x23`, and every `##vso[` in a line is written as `\x23#vso[`. The tool escapes nothing else, a backslash included. In `--json` a string holds the text as it is, line breaks of messages aside; the document writes U+007F to U+009F and the other characters of the last item as `\u` escapes, so the parsed data is the same and the printed document holds none of them raw (invariant `I-out-1`).

**A passing run.** In the sample, on a branch `work` made from `main`, append `console.log('done');` to `src/cli/main.ts`. `lawcheck check --base main` exits 0:

```
lawcheck: PASS  1 changed file (against main)
```

**A failing run.** Instead, add `src/core/discount.ts`:

<!-- example: check-d -->
```ts
export function discount(net: number): number {
  console.log('discount', net);
  // TODO campaign codes
  console.warn('no campaign'); // lawcheck-waive no-console -- the pricing team reads this warning until 2.0
  return net;
}
```

`lawcheck check --full --base main` exits 1:

<!-- example: check-failing-run -->
```
lawcheck: FAIL  1 error, 1 warning in 1 changed file (against main), 1 waiver

src/core/discount.ts:2  error[no-console]  writes to the terminal with console.log
  why:  Only the command layer writes to the terminal.
src/core/discount.ts:3  warning[no-todo]  TODO without an issue number
  why:  A TODO without an issue number gets forgotten.

debt (outside this change): 3 findings in 3 files
src/core/price.ts:2  warning[no-console]  writes to the terminal with console.log
src/core/tax.ts:1  warning[no-todo]  TODO without an issue number
tools/release.mjs:2  warning[no-todo]  TODO without an issue number

next: fix src/core/discount.ts:2
```

**Exit 2.** The tool goes down this table, stops at the first row with errors and prints all of them in the same grammar under `lawcheck: ERROR  <n> errors`; an `unsupported-environment` error is always alone, and its message stands in that first line in place of the count. Its `next:` is one instruction that can succeed. `internal` can come at any step and ends the run at once.

| Code | When | Place |
|---|---|---|
| `usage` | section 4 | none |
| `unsupported-environment` | `spec/environments.md`, section 3: the Node, the runtime, the install or the git is one Lawcheck does not support | none |
| `not-initialized` | no `.lawcheck/law.yaml` here or above. When git lists laws below the directory, as at the top of a monorepo, the message ends `; the laws below it are in <folders>`, at most three and `, and <n> more`, and the next line is `cd <the first>, where a law is, then run lawcheck check` | none |
| `no-git` | git cannot be started, refuses the repository, or the root is outside a git work tree; the message carries the first line git printed. When git refuses a repository owned by another user (`detected dubious ownership in repository at '<path>'`), the next line is `let git trust the repository: git config --global --add safe.directory <path>, then run lawcheck check`, with `<path>` in single quotes when it holds a character outside letters, digits and `@%+=:,./\-`. When git says `not a git repository` and the root or a folder above it holds `.git`, it is `repair the repository at <that folder>, so that git status works there, then run lawcheck check`. Otherwise `run lawcheck check inside a git work tree, with git on the PATH` | none |
| `law-invalid` | the law cannot be read, does not parse or breaks section 2: a key, a value, an id, a pattern, an expression, a rule that a type lists and the law lacks; one line per problem | `.lawcheck/law.yaml:<line>` |
| `rule-missing-file`, `rule-file-without-entry` | section 2 | the rule's line in the law; the file |
| `file-unreadable` | a file whose path matches a type cannot be read; one line per file | the file |
| `type-overlap` | one line per file, naming both types | the file |
| `base-unreachable` | section 4 | none |
| `path-unsupported` | section 3: a script rule is to run and the runner cannot keep it inside the root | none |
| `link-outside-root` | section 3: a script rule is to run and a link git tracks leads outside the git work tree and Lawcheck's folder | the link |
| `runner-failed` | section 3: the runner of script rules ends before it starts | none |
| `rule-crashed` | section 3 | the rule file |
| `internal` | any other failure, a bug of Lawcheck included; the message is the first line of the error | none |

With `statuss: advisory` in the sample's `no-todo`:

<!-- example: check-law-invalid -->
```
lawcheck: ERROR  1 error

.lawcheck/law.yaml:8  error[law-invalid]  unknown key 'statuss' in rule 'no-todo' (did you mean 'status'?)
  why:  a misspelled key changes the law without a word

next: fix .lawcheck/law.yaml, then run lawcheck check
```

`lawcheck check --base nope` in the sample:

```
lawcheck: ERROR  1 error

error[base-unreachable]  the base 'nope' names no commit here
  why:  without its base a change cannot be told from debt

next: pass --base with a branch or a commit that exists here
```

**`--json`** prints one document to standard output and nothing else: `JSON.stringify(document, null, 2)` and a line end, with the keys in the order shown. The failing run, with its three debt findings left out here:

```json
{
  "schema": "lawcheck-check/0",
  "result": "fail",
  "scope": { "mode": "full", "base": "main", "files": 1 },
  "summary": { "errors": 1, "warnings": 1, "debt": 3, "waivers": 1 },
  "findings": [
    { "code": "no-console", "rule": "no-console", "severity": "error", "blocking": true, "debt": false,
      "file": "src/core/discount.ts", "line": 2, "type": "library",
      "message": "writes to the terminal with console.log",
      "why": "Only the command layer writes to the terminal." },
    { "code": "no-todo", "rule": "no-todo", "severity": "warning", "blocking": false, "debt": false,
      "file": "src/core/discount.ts", "line": 3, "type": "library",
      "message": "TODO without an issue number",
      "why": "A TODO without an issue number gets forgotten." }
  ],
  "waivers": [
    { "file": "src/core/discount.ts", "line": 4, "rule": "no-console", "debt": false, "waived": 1,
      "reason": "the pricing team reads this warning until 2.0" }
  ],
  "next": { "command": null, "text": "fix src/core/discount.ts:2" }
}
```

`scope.mode` is `change` or `full`, `scope.base` null without a base, `scope.files` the count of changed files. `summary.errors` and `summary.warnings` count the findings of the change, `summary.debt` the debt findings, `summary.waivers` the waivers with `debt` false. `rule` is null for a code of section 5, and `line` absent for a whole-file finding. `findings` holds every finding, past 50 too, the change before the debt. `waived` is the number of findings the waiver dropped. `next` is null when the run passes. `next.command` is the command the next line asks to run first, and null whenever its first step is no command, such as installing Node, fixing a file or passing a base: a command an error names, such as git's `git config --global --add safe.directory <path>` or `git fetch …`; else a next line that is itself a `lawcheck` command; else the command after the colon of `run lawcheck <command> as its usage line says: <command>`. Exit 2 prints `{ "schema": "lawcheck-error/1", "errors": [{ "code", "file", "line", "message", "why" }], "next": { "command", "text" } }`, with `file` and `line` null where there is no place.

## 7. Decisions taken here

1. **A file keeps one type, and an overlapping set is not a type.** Sets narrowed by content, such as "files that throw", give a file more than one type and miss their files most often. A type says what a file is. Where a rule looks inside its types, a script settles by reading the file.
2. **Patterns are whole-path globs with braces and exclusions**, where the design said gitignore syntax. A real law needs braces and exclusion lists. Gitignore has no braces, and its result depends on line order.
3. **One call per file**, where a rule could be handed all files at once. A finding then depends on the file, its type and the rule, so the default mode gets for a changed file what a full run gets. That holds for a rule that keeps nothing between calls, as a rule that reads one file at a time does; one process serves all calls of a rule, so the tool cannot enforce it.
4. **`repo.filesOf` tells a rule another file's type.** A rule that asks whether an imported file is of some type would otherwise read the law file and match its patterns itself.
5. **The runner promises what Node's permission flag keeps, and names the rest.** An earlier draft closed the network with a list of refused modules. On Node 24.22.2 a rule got through each time: by a built-in outside the list, and by a hook the rule registers itself from a CommonJS helper, which also passed a list of allowed modules. So this slice promises no closed network, and section 3 lists what stays open. The flag still stops the rule that writes a file or starts a program by mistake, and such a rule would make a check depend on more than the files.
6. **No `--no-scripts` yet.** The design answers a stranger's pull request with it. Until it exists, the answer is in section 3: do not run the check where you would not run the tests.
7. **The files and the change come from git, by the commands of section 4**, hence the code `no-git`. The change is what `git diff` reports, so the tool reads no blob and compares no bytes itself.
8. **A renamed file counts as changed.** Its new path may match another type, and with another type other rules bind it.
9. **The root may lie below the top of the git tree.** `ls-files` at the root and `diff --relative` give the same paths there, so it costs one flag, and a repository of several packages can keep a law in one of them.
10. **In CI the caller names the base.** A CI checkout may record no `origin/HEAD`. A run without a base then counts every file as changed and says so in its first line.
11. **A symlink and a binary file have no type.** A symlink's target may lie outside the repository, and a line rule has nothing to say about bytes.
12. **A waiver is read as text**, because without language readers the tool cannot tell a comment from a string.
13. **Every waiver in the files of a run is counted**, where the design counts those a change adds; that needs each file's content at the base. The owner's ruling holds: a waiver with a reason works without approval and is counted.
14. **Exit 2 prints no findings.** Whoever sees it repairs what the error names and leaves the code alone.
15. **`internal` catches every other failure**, where the design keeps its list of codes closed. Node ends with 1 on an uncaught error, and 1 means the code breaks the law.
16. **The JSON document is `lawcheck-check/0`.** It lacks four keys of the design's `lawcheck-check/1` and gives a waiver `debt` and `waived`, so it does not carry that name. `lawcheck-error/1` is the design's.
17. **The 30 seconds are fixed**, since settings files are outside this slice.
18. **Two spaces, no alignment, no colour**, so tests compare output byte for byte.

## 8. Acceptance tests

S is the sample in a new git repository: one commit on `main` with the eight files, then a new branch `work`, no remote. Each test starts from a fresh S on `work` and runs `lawcheck check --base main` unless it names a command. "Add" makes a file and commits nothing. "One at a time" starts each case from a fresh S. D is `src/core/discount.ts` of section 6. Tests 21 to 28 add D and replace `check` in `no-console.mjs` with the function described. A test that replaces a rule file, as tests 21 to 30 do, makes the replacement a second commit on `main` before `work` is made, so the rule file is not in the change. "Crashes" means exit 2 with `.lawcheck/rules/no-console.mjs  error[rule-crashed]` and no finding line.

| # | Do | See |
|---|---|---|
| 1 | nothing | `lawcheck: PASS  nothing changed against main`, exit 0 |
| 2 | the passing run of section 6 | its output, exit 0 |
| 3 | the failing run of section 6 | its output, exit 1 |
| 4 | add D | test 3's output without the debt block, exit 1 |
| 5 | add D and commit it | as test 4 |
| 6 | append `// end` to `src/core/price.ts` | `src/core/price.ts:2  error[no-console]  writes to the terminal with console.log`, exit 1 |
| 7 | append `// end` to `src/core/tax.ts` | `lawcheck: PASS  1 warning in 1 changed file (against main)`, the warning with its `why:`, no `next:`, exit 0 |
| 8 | append `// TODO flags` to `src/cli/main.ts` | one finding, `src/cli/main.ts:3  warning[no-todo]  TODO without an issue number` |
| 9 | add `tools/notes.mjs` holding `// TODO later`, and `tools/ship.js` holding `#!/usr/bin/env node` then `// TODO later` | one finding, at `tools/ship.js:2`; `2 changed files` |
| 10 | add `src/core/api.d.ts` holding `console.log(1);` | `lawcheck: PASS  1 changed file (against main)` |
| 11 | add `src/core/gen.ts` holding `console.log(1);` and `.gitignore` holding `src/core/gen.ts` | as test 10 |
| 12 | add `src/core/żółw.ts` holding `console.log(1);` | `src/core/żółw.ts:1  error[no-console]  writes to the terminal with console.log`, exit 1 |
| 13 | one at a time: `git mv src/core/price.ts src/core/cost.ts`; `git rm src/core/price.ts`; append `// end` to `src/core/price.ts` and `git add` it | `lawcheck: FAIL  1 error in 1 changed file (against main)` with `src/core/cost.ts:2  error[no-console]`, exit 1; test 1's output, exit 0; as test 6 |
| 14 | in a new git repository, one commit on `main` holds the eight files under `pkg/` and a file `top.txt`; on a new branch `work` add D as `pkg/src/core/discount.ts`, append `x` to `top.txt`, and run `lawcheck check --full --base main` inside `pkg/src` | test 3's output, exit 1 |
| 15 | add `src/core/link.ts`, a symlink to `price.ts`, and `src/core/blob.ts` holding `console.log(1);` and a NUL byte. Then, in a fresh S, `chmod 000 src/core/price.ts` (this case is skipped when the tests run as root) | `lawcheck: PASS  1 changed file (against main)`, exit 0; then exit 2 with `src/core/price.ts  error[file-unreadable]` |
| 16 | one at a time, in the law: a root type `core` with `paths: ["src/core/**"]`; under `source`, a subtype `pricing` with `paths: ["src/core/p*.ts"]` | exit 2 each; `error[type-overlap]` at `src/core/price.ts` and at `src/core/tax.ts`, each naming `source` and `core`; one line, at `src/core/price.ts`, naming `library` and `pricing` |
| 17 | the `statuss` example of section 6 | its output, exit 2 |
| 18 | one at a time, in the law: `may_use: [command]` on `library`; `rules: [no-such]` on `script`; a second type `library`; `status: strict`; `content: "("`; no `lawcheck` key; `paths: "src/**/*.ts"` on `source`; `about:` with no value on `source`; a rule `style/no-tabs`; in `paths` of `source`, the pattern `src/**core/*.ts`, `src/core/`, `../src/**` or `src/{core,{cli,io}}/**` | each: exit 2 with `error[law-invalid]` |
| 19 | `statuss: advisory` in `no-todo` and `may_use: [command]` as the last key of `library`, together | `lawcheck: ERROR  2 errors`, two `error[law-invalid]` lines, at `.lawcheck/law.yaml:8` and `.lawcheck/law.yaml:20`, exit 2 |
| 20 | one at a time: delete `rules/no-todo.mjs`; add `rules/extra.mjs`; add `rules/lib/util.mjs`; add `rules/.no-todo.mjs.swp` and `.gitignore` holding `*.swp`; add to the law a rule `spare` that no type lists, whose file throws on load | `error[rule-missing-file]` at `.lawcheck/law.yaml:6`, exit 2; `error[rule-file-without-entry]` at `.lawcheck/rules/extra.mjs`, exit 2; exit 0; exit 0; exit 0 |
| 21 | one at a time: throws; returns `{}`; returns `[{ line: 1 }]`; returns `[{ file: 'README.md', message: 'x' }]`; returns `[{ message: 'x', line: 0 }]`; returns `[{ message: 'x', line: NaN }]`; returns `[{ message: 'x', line: 7 }]`; returns `[{ message: 'x', extra: () => 1 }]`; calls `process.exit(0)`; `check` is not exported | each crashes |
| 22 | throws; also append `// end` to `src/core/price.ts`. Then the same with `check` of `no-todo.mjs` throwing too | `lawcheck: ERROR  1 error` and one `error[rule-crashed]` line; then `lawcheck: ERROR  2 errors` and two lines, `.lawcheck/rules/no-console.mjs` first |
| 23 | without D: `no-console.mjs` holds `throw new Error('x')` alone; append `// end` to `src/cli/main.ts`. Then the same with `--full` | `lawcheck: PASS  1 changed file (against main)`, exit 0; then crashes |
| 24 | one at a time: `check` runs `while (true) {}`; the module runs `while (true) {}` at its top level | each crashes within 40 seconds |
| 25 | an `async` function awaits a timer, then returns the findings of the original | as test 4 |
| 26 | the test keeps S in a folder `s` of its temporary folder and writes `outside.txt` beside `s`. One at a time, first runs: `writeFileSync('out.txt', 'x')`; `execSync('echo x')`; `new Worker('1', { eval: true })`; `readFileSync('../outside.txt')` | each crashes; `out.txt` does not exist |
| 27 | returns `[{ message: String(process.env.SECRET) + ' ' + String(process.env.NODE_OPTIONS) }]`; run `SECRET=abc NODE_OPTIONS=--no-warnings lawcheck check --base main` | `src/core/discount.ts  error[no-console]  undefined undefined` |
| 28 | returns `[{ message: readFileSync('README.md', 'utf8').trim() }]` | `src/core/discount.ts  error[no-console]  # Sample` |
| 29 | `check` of `no-todo.mjs` returns `[{ message: repo.filesOf('source').join(' ') }]`; append `// end` to `src/cli/main.ts`. Then the same with `filesOf('nope')` | `src/cli/main.ts  warning[no-todo]  src/cli/main.ts src/core/price.ts src/core/tax.ts`; then `error[rule-crashed]` at `.lawcheck/rules/no-todo.mjs` |
| 30 | add `src/core/crlf.ts` holding `ab\r\ncd\r\n`; `check` of `no-console.mjs` returns `[{ message: files[0].lines.length + ' ' + files[0].lines[0].length + '\nsecond line' }]` | `src/core/crlf.ts  error[no-console]  2 2 second line` |
| 31 | add D with a new line 2, `  // lawcheck-waive no-console -- support reads this line` | `lawcheck: PASS  1 warning in 1 changed file (against main), 2 waivers`; one finding, at `src/core/discount.ts:4`; exit 0 |
| 32 | as test 31, line 2 cut after `no-console` | `lawcheck: FAIL  2 errors, 1 warning in 1 changed file (against main), 1 waiver`; `error[waiver-without-reason]` at line 2, `error[no-console]` at line 3; exit 1 |
| 33 | one at a time, as test 31 with line 2 changed: `no-such` for `no-console`; `lawcheck-waive-file` for `lawcheck-waive`; cut after `lawcheck-waive` | each: `error[waiver-unknown-rule]` at line 2, `error[no-console]` at line 3, no `waiver-without-reason`, exit 1 |
| 34 | add D with a new line 5, `  // lawcheck-waive no-console -- nothing here` | `lawcheck: FAIL  1 error, 2 warnings in 1 changed file (against main), 2 waivers`; `warning[waiver-unused]` at line 5 |
| 35 | add `src/core/both.ts` holding three lines: `<!-- lawcheck-waive no-console -- a demo of two waivers -->`, `/* lawcheck-waive no-todo -- tracked on the board */`, `console.log('x'); // TODO later`. Then the same with `--json` | `lawcheck: PASS  1 changed file (against main), 2 waivers`, exit 0; then `waivers` holds the reasons `a demo of two waivers` and `tracked on the board`, each with `waived` 1 |
| 36 | append `// end` to `src/core/price.ts`, `src/core/tax.ts` and `tools/release.mjs`; run `lawcheck check --full --base main`. Then the same in an S whose `main` got, before `work` was made, a second commit that appends `// TODO later lawcheck-waive no-todo -- a demo` to `src/cli/main.ts` | `lawcheck: FAIL  1 error, 2 warnings in 3 changed files (against main)` and `debt (outside this change): none`, exit 1; then the same first line and `debt (outside this change): none, 1 waiver` |
| 37 | in an S whose `main` got, before `work` was made, a second commit that appends to `src/core/tax.ts` the lines `// lawcheck-waive no-such -- x` and `// lawcheck-waive no-todo -- nothing here`: `lawcheck check --full --base main` | `lawcheck: PASS  nothing changed against main`; `debt (outside this change): 5 findings in 3 files, 1 waiver`; `src/core/tax.ts:3  warning[waiver-unknown-rule]` and `src/core/tax.ts:4  warning[waiver-unused]`; exit 0 |
| 38 | `lawcheck check --base nope`; `LAWCHECK_BASE=main lawcheck check`; `LAWCHECK_BASE=nope lawcheck check --base main`; after `git checkout --orphan lone` and `git commit -m lone`, `lawcheck check --base main`; in a fresh S, a commit on `main` that appends `// later` to `src/core/price.ts`, then `lawcheck check --base main` on `work` | the output of section 6, exit 2; as test 1; as test 1; exit 2 with `error[base-unreachable]`; as test 1, because the change is taken against the merge base |
| 39 | `lawcheck check`; `LAWCHECK_BASE= lawcheck check`; `lawcheck check` in a new git repository that holds the eight files and no commit; `lawcheck check --base main` there | the first three: `lawcheck: FAIL  1 error, 2 warnings in 8 files (no base: every file counts as changed)`, exit 1; the last: exit 2 with `error[base-unreachable]` |
| 40 | with `main` checked out in S, clone S; in the clone make branch `work`, run `lawcheck check` | `lawcheck: PASS  nothing changed against origin/main` |
| 41 | the failing run with `--json`. Then the passing run with `--json` | the document of section 6 plus three findings with `"debt": true`, `"severity": "warning"`, `"blocking": false`, exit 1; then `"result": "pass"`, `"findings": []`, `"next": null`, exit 0 |
| 42 | `lawcheck check` in a git repository without `.lawcheck/`; in a copy of S's files outside git; in S with a `PATH` that holds no `git` | exit 2 each: `not-initialized`, `no-git`, `no-git` |
| 43 | `lawcheck`; `lawcheck fix`; `lawcheck check src`; `lawcheck check --base`; `lawcheck check --base=main`; `lawcheck check --full --full`; `lawcheck check --base --json`; `lawcheck check --json --bogus`; `lawcheck check --bogus --json` | exit 2 with `usage` each; the last three as a `lawcheck-error/1` document |
| 44 | `lawcheck --version`; `lawcheck --help`; `lawcheck check --help` | `0.1.0`; twice a first line `usage: lawcheck check [--full] [--base <ref>] [--json]`; exit 0 each |
| 45 | add `src/core/many.ts` holding 60 lines of `console.log(1);`; run without a flag, with `--json`, with `--full`. Then the same file with 49 lines and `--full` | 50 finding lines, then `... 10 more findings (--json lists all)`; 60 findings; 50 finding lines, `... 13 more findings (--json lists all)`, then `debt (outside this change): 3 findings in 3 files` with no finding line under it; then 49 lines of the change, the debt heading, `src/core/price.ts:2  warning[no-console]  writes to the terminal with console.log`, `... 2 more findings (--json lists all)` |

The unit tests carry two things no row above reaches. `tests/unit/cli.test.ts` hands the top-level handler a command that throws and sees exit 2 with `error[internal]`. `tests/unit/files.test.ts` hands the reader of git's output paths with an invalid UTF-8 byte, a line feed, a carriage return and a backslash, and sees each kept in the form of section 2.

Besides these 45 tests, the tool was accepted against an external trial: a law of twelve script rules, run with `--full` on a real repository. The trial's fixture is kept outside this repository. The run ended with exit 0 and no error, and the twelve rules found 2, 22, 1, 2, 142, 1, 6, 6, 105, 41, 60 and 9 findings, as expected.

### Invariants

Promises that hold for every input, each tied by its id to a test of the security suite or to a property under `tests/properties/` and the examples beside it.

| Id | Promise | Test |
|---|---|---|
| I-out-1 | No text output of any command holds a character below U+0020 other than the line feed, U+007F, U+0080 to U+009F, U+2028, U+2029, or a format character (category Cf) other than U+200C and U+200D; no line starts, after white space, with `::` or `##[`, and none holds `##vso[`; one finding or error is one line. No JSON document holds U+007F to U+009F or the others of that list raw (section 6). | tests/security/output.test.ts |
| I-runner-1 | A script rule reads nothing outside the root and Lawcheck's folder, at every path of the root, and through no link git tracks reaches anything outside the git work tree; where the runner cannot keep that, no rule runs (section 3). | tests/security/runner.test.ts |
| I-git-1 | No command starts a program that the repository's git config or attributes name: a `core.fsmonitor` program, a hook, an external diff, a `textconv`, a `clean`, `smudge` or `process` filter (section 2). | tests/security/git-programs.test.ts |
| I-start-1 | No program Lawcheck or its hooks start, nor any program those start by a bare name, is taken from the repository through a relative or empty `PATH` entry or, on Windows, the current folder (section 2). | tests/security/start.test.ts |
| I-git-2 | Every git command a run sends is one git 2.34, the oldest git Lawcheck runs with, accepts; the link guard reads each submodule in its own folder (sections 2 and 4). | tests/security/old-git.test.ts |
| I-secret-2 | An error about a law or a config read through a symbolic link quotes none of the file (section 2). | tests/security/linked.test.ts |
| I-files-1 | Every path that `git ls-files -z` lists at the root and a type's pattern matches is judged, or named as left out with its reason, whatever bytes its name holds; its name in the output maps back to the bytes on disk, and `explain` gives the true reason for it (section 2). | tests/properties/names.test.ts |
| I-glob-1 | A pattern compiles or gets a named problem, matches as the reading of section 2 does, and costs time linear in the path (section 2). | tests/properties/glob.test.ts |
| I-lines-1 | For any text of a file, every line separator, NUL, a byte-order mark and waiver markers included, every finding's line lies inside the file's `lines`, a type with `waivers: false` waives nothing, and the text and JSON forms of a report agree (sections 2, 3 and 5). | tests/properties/contents.test.ts |
| I-law-1 | Any text as `law.yaml` gives `law-invalid` at a line of the file, or a law that `explain` prints back (section 2). | tests/properties/law.test.ts |
| I-rules-1 | Any value a rule returns, throws or rejects with, at once or in the background, gives findings or a `rule-crashed` that names its cause, and the result for a file is the same whether it is judged alone or with others (section 3). | tests/properties/rules.test.ts |
| I-git-2 | A check changes nothing in git; the findings of a change equal those of `--full` for the changed files; the output is the same from any directory below the root and on a second run, whatever state the repository is in (section 4). | tests/properties/git-states.test.ts |
| I-args-1 | Any arguments give `usage` or a run, never `internal` (section 4). | tests/properties/arguments.test.ts |

## 9. Repository layout

TypeScript on Node 24, ES modules. One runtime dependency, `yaml`; for development `typescript` and `@types/node`. Test runner: Node's built-in `node --test`.

```
.devcontainer/devcontainer.json   image mcr.microsoft.com/devcontainers/javascript-node:24; postCreateCommand: npm ci
package.json                      "type": "module", bin lawcheck -> dist/bin.cjs, engines node >=24, version 0.1.0
tsconfig.json                     src/ -> dist/
spec/check-slice.md
src/
  cli.ts        arguments, exit codes, the handler that turns every other failure into internal
  law.ts        reads and validates law.yaml
  glob.ts       patterns
  files.ts      the git commands: the file list, the base, the change
  types.ts      the type of each file
  waivers.ts
  rules.ts      starts the runners, keeps the 30 seconds, validates what returns
  runner.ts     the runner process: loads the rule, makes the calls
  guard.ts      ends the runners that outlive the tool
  check.ts      the command
  output.ts     text and JSON
tests/
  unit/         one file per source file
  acceptance/   one test per row of section 8, named by its number; each runs dist/cli.js in a mktemp -d folder and removes it
  sample/       the eight files of the sample
```

`npm run build` compiles. `npm test` builds and runs the unit tests and tests 1 to 45, and needs no network. Both run inside the dev container.
