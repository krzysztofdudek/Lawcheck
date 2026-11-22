# Script rules

A to-do comment without an issue number stays in the code for years. A [script rule](concepts.md#script-rule) finds it. The rule is an ES module in `.lawcheck/rules/<id>.mjs` that exports a function `check`. The law names the rule in `.lawcheck/law.yaml`, with its `why` and its `status` (`lawcheck docs law` has the keys). The folder that holds `.lawcheck/` is the [root of the law](concepts.md#law). This page calls it the root for short. Every path in the tables below starts there.

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

In `path`, Lawcheck writes a backslash, a line feed, a carriage return and a byte that is not UTF-8 as `\\`, `\n`, `\r` and `\xHH`. Such a `path` no longer names the file on disk, so read the file's text from `text`. A final line end adds no empty line to `lines`. For an empty file, `lines` is an empty list.

## The return value

`check` returns a list of [findings](concepts.md#finding), or a promise of one. A finding has these fields:

- `message` is a non-empty string of at most 4,096 characters. Lawcheck turns a line break in it into a space.
- `line` is optional. Its value is an integer from 1 to the number of lines of the file. A finding without `line` is about the whole file. A `line` of `null`, a string such as `'2'` or a bigint makes the rule `rule-crashed`, with a message that names the value.
- `file` is optional. Its one allowed value is the `path` of the call.

Lawcheck ignores other fields. A rule that returns an empty list reports no finding. All the rules of one run may return 200,000 findings together, with 16 MiB of messages. A run past either limit stops with `too-many-findings`. The error names each rule with the number of findings it returned.

## Calls

Lawcheck calls `check` once for each file of the run whose type, or a type above it, lists the rule. It makes the calls in path order, one call at a time. A [plain `lawcheck check`](concepts.md#plain-check) passes the rule the files of the [change](concepts.md#change). With `--full`, Lawcheck passes it every file that the rule binds, changed or not. Keep nothing between calls in a rule. A rule that counts the files it has seen reaches one count in a plain check and another with `--full`, so its findings differ between the two.

Lawcheck does not load a rule that has no file to judge in the run.

## The runner

Lawcheck runs each script rule in a Node process of its own. This page calls that process the rule runner. Lawcheck's own folder is the folder where the `lawcheck` package is installed. The rule runner starts in this state:

- Node's flag `--permission` limits its reads to the root and to Lawcheck's own folder;
- `process.env` is empty, because the rule runner gets none of the caller's variables;
- its working directory is the root.

Lawcheck writes what the rule prints, on either stream, to its own standard error.

A rule has 30 seconds to load and 30 seconds for each call. A rule that takes longer is `rule-crashed`. All script rules of one run have 600 seconds together. A run that goes past the 600 seconds stops with `rules-too-slow`. Lawcheck reports that code at the file that each unfinished rule was judging.

The rule runner refuses these actions:

- writing, renaming or deleting a file, or making a directory, through `node:fs`;
- reading through `node:fs` outside the root and Lawcheck's folder;
- starting a child process or a worker thread;
- loading a native add-on or WASI;
- using the network: opening a connection, listening on a port, sending over UDP or looking up a name in DNS. The rule runner closes `node:net`, `node:dgram`, `node:dns` and the globals `fetch` and `WebSocket` before the rule loads. `node:http`, `node:https` and `node:tls` open their connections through `node:net`, and fail the same way;
- importing `node:sqlite`. Node's permission model is the set of limits that `--permission` turns on. That model leaves `node:sqlite` open, so the rule runner starts Node without that module. No rule can open, attach or write a database through it. In a rule, `process.getBuiltinModule('node:sqlite')` returns `undefined`.

Each refused action throws an error inside the rule. A rule that does not catch that error is `rule-crashed`. The message of `rule-crashed` then says what the rule did, such as `reads <path> outside the root and Lawcheck's folder, and a rule may read nothing else`, `writes <path>, and a rule may write no file`, `uses the network, which is closed to script rules` or `imports node:sqlite, and a rule may not`.

A rule may import these modules:

- the `node:` built-ins;
- files below the root, such as `.lawcheck/rules/lib/`;
- packages installed in a `node_modules` folder below the root.

A rule fails to load when it imports one of these packages:

- a package in a `node_modules` above the root, as in a monorepo whose law sits in one package;
- a package reached through a symbolic link that leads outside the root.

Install each package the rule needs in a `node_modules` below the root.

The rule runner does not shut a rule off from your machine. A rule can still do these things:

- read every file under the root, `.git/` and ignored files such as `.env` included;
- read any file you can read, through a symbolic link under the root that git does not track;
- read a file elsewhere in the git work tree, through a tracked link. A tracked link that leads outside the work tree stops the run with `link-outside-root` before any rule starts;
- put what it read into its messages. Lawcheck prints those messages, and a CI job keeps them in its log.

A rule file is code of the repository. It runs with your rights, as the tests do. Run `lawcheck check` and `lawcheck try` only where you would run the tests of the change.

Lawcheck stops the run with `path-unsupported` when the path of the root, or of Lawcheck's own folder, holds a `*`. Node's permission model reads that `*` as a wildcard, which would let a rule read the folders beside the root. Outside Windows, a backslash in either path stops the run too, because the rule runner cannot load a rule from such a path.

## rule-crashed

Lawcheck reports `rule-crashed` and exits with code 2 when the rule:

- does not load, or exports no function `check`;
- throws or rejects;
- returns something other than a list of findings as above. A list with a message over 4,096 characters counts as such a return. So does a function, or another value that Lawcheck cannot pass out of the rule's process;
- takes more than 30 seconds to load, or more than 30 seconds for one call;
- ends its process before it answers, or sends a message that Lawcheck did not ask for;
- leaves a promise rejected with no handler, or a timer that throws, while its process runs. The message of `rule-crashed` then names no judged file. A failure during the load adds the words `in its load`. After the last call, Lawcheck waits once, at most 2 seconds, for what the rule left running.

In the other cases, the message of `rule-crashed` names the judged file, or the load. A rule may throw a value with no string form, such as an object with no prototype. The message then holds the error JavaScript gives for it. A proxy whose every trap throws something other than an error raises no such error. For such a value, the message reads `a value with no string form`. Lawcheck names each crashed rule once in a run.

When Node cannot start the rule runner at all, Lawcheck stops with `runner-failed` and names no rule. The message holds Node's own error line. To fix it, reinstall Lawcheck.

## Trying a rule

```text
$ lawcheck try no-todo src/core/tax.ts
$ lawcheck try no-todo
```

With a file named, `lawcheck try` runs the rule on that file. Without one, it runs a script rule on every file whose type, or a type above it, lists the rule. `lawcheck try` records nothing in the repository. `lawcheck docs first-law` shows how to write a rule and try it, step by step.

Next: [Reviewer rules](reviewer-rules.md)
