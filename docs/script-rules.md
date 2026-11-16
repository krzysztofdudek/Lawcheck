# Script rules

A script rule is `.lawcheck/rules/<id>.mjs`, an ES module that exports a function `check`. Its entry in the law holds its `why` and `status`.

```js
export function check({ files }) {
  const findings = [];
  for (const file of files) {
    file.lines.forEach((text, index) => {
      if (text.includes('TODO') && !/#\d/.test(text)) findings.push({ line: index + 1, message: 'TODO without an issue number' });
    });
  }
  return findings;
}
```

## What check receives

One object with `files` and `repo`.

- `files` holds one file per call: `path` (from the root), `type` (its type id), `text` and `lines`. Under `lawcheck try`, a file with no type has `type` null.
- `path` is the file's path as Lawcheck prints it: a backslash, a line feed, a carriage return and a byte that is not UTF-8 are written `\\`, `\n`, `\r` and `\xHH`, so read the file through `text`, not through `path`.
- `lines` is the text split at `\n` and `\r\n`. A final line end adds no empty line, so an empty file has no lines.
- `repo.filesOf(typeId)` returns at once the sorted paths of every file of that type and its subtypes. It throws on an unknown id.

## What it returns

A list of findings, or a promise of one. A finding has:

- `message`, a non-empty string of at most 4,096 characters; a line break in it becomes a space;
- `line`, optional, an integer from 1 to the number of lines; without it the finding is about the whole file. `null`, a string such as `'2'` and a bigint are refused, and the message names the value;
- `file`, optional, and only the path of the call.

Other fields are ignored.

## Calls

Lawcheck calls `check` once for each file the rule binds in the run, in path order, one call at a time. A plain check hands it the changed files, and `--full` every file. A rule keeps nothing between calls: a rule that remembers earlier files answers differently in the two modes.

A rule with no file to judge in a run is not loaded.

## The runner

Each rule runs in its own Node process, started with `--permission`, read access to the root and to Lawcheck's own folder, no variable of the caller (`process.env` is empty), and the root as its working directory. What the rule prints goes to standard error. A rule has 30 seconds to load and 30 seconds per call.

The runner stops these, and the rule is `rule-crashed` when the refusal reaches it as an error:

- writing, renaming or deleting a file, or making a directory, through `node:fs`;
- reading through `node:fs` outside the root and Lawcheck's folder;
- starting a child process or a worker thread;
- loading a native add-on or WASI;
- importing `node:sqlite`, which Node's permission model does not confine, so a rule cannot open, attach or write a database through it. `process.getBuiltinModule('node:sqlite')` returns `undefined`.

A rule imports `node:` built-ins, files below the root such as `.lawcheck/rules/lib/`, and packages installed in a `node_modules` below the root. A package hoisted to a `node_modules` above the root, as a monorepo with the law in one package does, or reached through a link that leads outside the root, cannot be read, so the rule does not load. Install what the rule needs below the root.

When the runner stops a rule, the message says what the rule did, such as `reads <path> outside the root and Lawcheck's folder, and a rule may read nothing else`, `writes <path>, and a rule may write no file` or `imports node:sqlite, and a rule may not`.

The runner is no sandbox. A rule can still:

- read every file under the root, `.git/` and ignored files such as `.env` included;
- read any file the user can, through a symbolic link under the root that git does not track, or a tracked one that leads elsewhere in the git work tree. A tracked link that leads outside the work tree stops the run with `link-outside-root` before any rule starts;
- open network connections;
- signal the user's processes;
- put what it read into its messages, which end up in the output and in a CI log.

A rule file is code of the repository and runs with your rights, as the tests do. Run `lawcheck check` and `lawcheck try` only where you would run the change's tests.

## rule-crashed

A rule is `rule-crashed`, exit 2, at its file when it:

- does not load, or exports no function `check`;
- throws or rejects;
- returns anything but a list of findings as above, a message over 4,096 characters included, or a value the channel cannot carry, such as a function;
- passes 30 seconds in its load or in one call;
- ends its process before answering, or sends a message nobody asked for;
- leaves a promise rejected with no handler, or a timer that throws, while its process lives: the message names the load, or no file. After the last call Lawcheck waits once, at most 2 seconds, for what the rule left running.

The message names the judged file, or the load. A thrown or rejected value that has no string form, such as an object with no prototype, is named by the reason JavaScript gives for that. One run names each broken rule once.

A runner that Node cannot start at all is `runner-failed` instead, with Node's own line in the message, and no rule is blamed. Reinstalling Lawcheck is the fix.

## Trying a rule

```text
$ lawcheck try no-todo src/core/tax.ts
$ lawcheck try no-todo
```

Without a target, a script rule runs on every file it binds through its type. `lawcheck docs first-law` shows the loop of writing and trying a rule.
