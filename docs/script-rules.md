# Script rules

A to-do comment without an issue number stays in the code for years. A script rule finds it. The rule is an ES module in `.lawcheck/rules/<id>.mjs`. The module exports a function `check`. The entry of the rule in the law holds its `why` and `status` (`lawcheck docs law`).

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

## The argument of check

`check` gets one object with the keys `files` and `repo`.

| Key | Value |
|---|---|
| `files` | a list that holds the one file of the call |
| `path` | the file's path from the root, as Lawcheck prints it |
| `type` | the file's type id; under `lawcheck try`, null for a file with no type |
| `text` | the file's text |
| `lines` | the text split at `\n` and `\r\n` |
| `repo.filesOf(typeId)` | the sorted paths of every file of that type and its subtypes, at once; an unknown id throws |

In `path`, Lawcheck writes a backslash, a line feed, a carriage return and a byte that is not UTF-8 as `\\`, `\n`, `\r` and `\xHH`. Read the file through `text`. A final line end adds no empty line to `lines`. An empty file has no lines.

## The return value

`check` returns a list of findings, or a promise of one. A finding has these fields:

- `message`, a non-empty string of at most 4,096 characters. Lawcheck turns a line break in it into a space;
- `line`, optional, an integer from 1 to the number of lines. A finding without it is about the whole file. Lawcheck refuses `null`, a string such as `'2'` and a bigint. The message names the value;
- `file`, optional. Its one allowed value is the path of the call.

Lawcheck ignores other fields. An empty list means no finding. One run takes at most 200,000 findings, with 16 MiB of messages, from all rules together. A run over that stops with `too-many-findings`. The error names each rule with its count.

## Calls

Lawcheck calls `check` once for each file that the rule binds in the run. It makes the calls in path order, one call at a time. A plain check hands the rule the changed files. `--full` hands it every file. Write a rule that keeps nothing between calls. A rule that remembers earlier files answers differently in the two modes.

Lawcheck does not load a rule that has no file to judge in the run.

## The runner

Lawcheck runs each rule in a Node process of its own. The process starts with these settings:

- `--permission`, with read access to the root and to Lawcheck's own folder;
- no variable of the caller, so `process.env` is empty;
- the root as its working directory.

Lawcheck relays what the rule prints to standard error.

A rule has 30 seconds to load and 30 seconds for each call. All script rules of one run have 600 seconds together. A run past them stops with `rules-too-slow`, at the file of each rule that had not finished.

The runner stops these actions. The rule is `rule-crashed` when the refusal reaches it as an error:

- writing, renaming or deleting a file, or making a directory, through `node:fs`;
- reading through `node:fs` outside the root and Lawcheck's folder;
- starting a child process or a worker thread;
- loading a native add-on or WASI;
- importing `node:sqlite`. Node's permission model is the set of limits that `--permission` turns on, and it does not cover that module. The runner blocks the import. A rule cannot open, attach or write a database through it. `process.getBuiltinModule('node:sqlite')` returns `undefined`.

A rule may import `node:` built-ins, files below the root such as `.lawcheck/rules/lib/`, and packages installed in a `node_modules` below the root. The runner cannot read a package in a `node_modules` above the root. A monorepo with the law in one package may put the packages there. The runner cannot read a package reached through a link that leads outside the root either. In both cases, the rule does not load. Install what the rule needs below the root.

The runner gives a stopped rule a message that says what the rule did, such as `reads <path> outside the root and Lawcheck's folder, and a rule may read nothing else`, `writes <path>, and a rule may write no file` or `imports node:sqlite, and a rule may not`.

The runner is no sandbox. A rule can still do these things:

- read every file under the root, `.git/` and ignored files such as `.env` included;
- read any file the user can read, through a symbolic link under the root that git does not track;
- read a file elsewhere in the git work tree, through a tracked link. A tracked link that leads outside the work tree stops the run with `link-outside-root` before any rule starts;
- do what Node's permission model leaves open, such as opening a network connection;
- put what it read into its messages. The messages end up in the output and in a CI log.

A rule file is code of the repository. It runs with your rights, as the tests do. Run `lawcheck check` and `lawcheck try` only where you would run the tests of the change.

A root or a Lawcheck folder whose path holds a `*` stops the run with `path-unsupported`. Outside Windows, a backslash in that path does the same. The runner cannot confine a rule in such a folder.

## rule-crashed

Lawcheck reports `rule-crashed` with exit 2, at the file of the rule, when the rule:

- does not load, or exports no function `check`;
- throws or rejects;
- returns anything but a list of findings as above. A list with a message over 4,096 characters counts as such a return. So does a value that Lawcheck cannot pass out of the rule's process, such as a function;
- takes more than 30 seconds to load, or more than 30 seconds for one call;
- ends its process before it answers, or sends a message that Lawcheck did not ask for;
- leaves a promise rejected with no handler, or a timer that throws, while its process lives. The message then names the load, or no file. After the last call, Lawcheck waits once, at most 2 seconds, for what the rule left running.

The message names the judged file, or the load. A thrown or rejected value may have no string form, such as an object with no prototype. The message then gives the reason that JavaScript gives for that. A value may not even give that reason, such as a proxy whose every trap throws something that is not an error. The message then reads `a value with no string form`. One run names each broken rule once.

A runner that Node cannot start at all is `runner-failed` instead. The message holds Node's own line, and Lawcheck blames no rule. Reinstalling Lawcheck fixes it.

## Trying a rule

```text
$ lawcheck try no-todo src/core/tax.ts
$ lawcheck try no-todo
```

Without a target, a script rule runs on every file that it binds through its type. `lawcheck try` records nothing in the repository. `lawcheck docs first-law` shows how to write a rule and try it, step by step.

Next: [Reviewer rules](reviewer-rules.md)
