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
| `tree()` | a promise of the file's [syntax tree](#the-syntax-tree) |
| `uses()` | a promise of the file's [uses](#the-uses), the ones that `may_use` judges |
| `repo.filesOf(typeId)` | the sorted paths of every file of that type and its subtypes, at once; an unknown id throws |

Lawcheck reads the tree and the uses only when the rule calls `tree()` or `uses()`. A rule that calls neither makes Lawcheck parse nothing for it. A second call in the same call of `check` gives the same promise. On a file kept from an earlier call, `tree()` rejects with `tree() was called after its call of check ended`, and `uses()` with the same message about `uses()`.

In `path`, Lawcheck writes a backslash, a line feed, a carriage return and a byte that is not UTF-8 as `\\`, `\n`, `\r` and `\xHH`. Such a `path` no longer names the file on disk, so read the file's text from `text`. A final line end adds no empty line to `lines`. For an empty file, `lines` is an empty list.

## The syntax tree

This rule finds a call of `eval`. A string or a comment that holds `eval(x)` is no call, so the rule does not report it.

```js
export async function check({ files: [file] }) {
  const { root } = await file.tree();
  if (root === null) return [];
  const findings = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    const callee = node.type === 'call_expression' ? node.children.find((child) => child.field === 'function') : undefined;
    if (callee && file.text.slice(callee.start, callee.end) === 'eval') findings.push({ line: node.line, message: 'eval runs text as code' });
    stack.push(...node.children);
  }
  return findings;
}
```

The node types and fields come from the grammar of each language, and they differ between languages: a call is a `call_expression` in TypeScript and a `call` in Python. Before you write a rule that reads the tree, print the tree of a real file of the rule's language. This is `src/run.ts`:

```ts
const note = "eval(x)"; // eval(y)
eval(note);
```

```text
$ lawcheck explain src/run.ts --tree
```

```output
src/run.ts  typescript  20 nodes, 12 named
  program  line 1
    lexical_declaration  line 1
      variable_declarator  line 1
        name: identifier  line 1  "note"
        value: string  line 1
          string_fragment  line 1  "eval(x)"
    comment  line 1  "// eval(y)"
    expression_statement  line 2
      call_expression  line 2
        function: identifier  line 2  "eval"
        arguments: arguments  line 2
          identifier  line 2  "note"
```

Each line below the first is a named node, under its parent: its field before a colon, its type and its line. A node with no named node below it also shows its text, cut at 40 characters. The rule above follows this tree: it takes the child in the field `function` of a `call_expression`. The `comment` holds `eval(y)` as text, so the rule reports nothing there.

`explain --tree` leaves out the nodes that are not named, such as `const` and `;`. It stops at 12 levels and at 200 nodes, and says how many named nodes it left out. With `--json`, it gives every node, with the keys below. In place of `children`, each node there has `parent`: the index of its parent in the list, or null for the root. To see the tree of one construct, write it in a small file and explain that file. The file need not be tracked by git. For a file with no tree, `explain --tree` prints the reason that `absent` gives below.

`await file.tree()` gives an object with three keys:

| Key | Value |
|---|---|
| `language` | the language the reader parsed, such as `typescript` or `tsx`; null for a file with no reader |
| `root` | the root node, or null when the tree is absent |
| `absent` | null, or why the tree is absent |

Each node has these keys:

| Key | Value |
|---|---|
| `type` | the node's type in the grammar, such as `call_expression` or `comment` |
| `named` | false for a keyword or a punctuation mark such as `let` or `(`, true for the other nodes |
| `field` | the name its parent gives the node, such as `name` or `body`, or null |
| `start`, `end` | where the node starts and ends in `text`, so `text.slice(node.start, node.end)` is its text |
| `line` | the line of `start`, counted from 1, as in `lines` and in a finding |
| `column` | the column of `start` in its line, counted from 0 in UTF-16 code units, as JavaScript counts a string |
| `children` | the node's children, in the order of the text |

A node of type `ERROR` holds text that the grammar cannot read. Where the text lacks a token, the parser can add a node whose `start` equals its `end`. A Vue or Svelte file gets the tree of its script blocks. Lawcheck parses that file with every character outside the blocks turned into a space, so `start` and `end` still point into `text`.

The tree depends on the file's path and text. A header of C or C++ also depends on the other files of its folder, which decide its language ([Languages and uses](languages.md)). A plain check and `--full` give a rule the same tree for the same file.

The tree is absent in three cases:

| `absent` | When |
|---|---|
| `no-reader` | no reader reads the file's language ([Languages and uses](languages.md)), or a Vue or Svelte file has no script block |
| `too-large` | the parsed text holds more than 512 KiB, the limit of a file whose uses are read |
| `reader-failed` | Lawcheck cannot load the grammar of the language, or the parser fails on the file |

An absent tree stops nothing. The rule decides what to report for that file.

### The grammars

The node types and fields come from the grammar of each language. Lawcheck ships the grammars of Runes 1.2.0:

| `language` | Version of the grammar |
|---|---|
| `typescript`, `tsx` | 0.23.2, with four fixes from the grammar's own repository |
| `javascript` | 0.25.0 |
| `python` | 0.25.0 |
| `go` | 0.25.0 |
| `rust` | 0.24.2 |
| `java` | 0.23.5 |
| `kotlin` | 1.1.0 |
| `csharp` | a commit after 0.23.5, not released, that reads C# 14 |
| `c` | 0.24.2 |
| `cpp` | a commit after 0.23.4, not released |
| `php` | a commit after 0.24.2, not released |
| `ruby` | a commit after 0.23.1, not released |

Lawcheck sets the keys of the result and of a node. A version of Lawcheck that changes them says so in the changelog, under "Before you upgrade". The grammar sets the node types, the fields and the nesting. A new version of Lawcheck can take a new Runes with new grammars. The same code can then give other node types, other fields or other nesting. The changelog names each version of Lawcheck that changes a grammar, and this table shows the grammar versions.

## The uses

`await file.uses()` gives an object with two keys:

| Key | Value |
|---|---|
| `uses` | the uses the reader found, in the order of the file, or null when they are absent |
| `absent` | null, or why the uses are absent: `no-reader`, `too-large` or `reader-failed`, as for the tree |

A Vue or Svelte file with no script block has no uses, so its list is empty, while its tree is absent with `no-reader`.

Each use has `line` and `kind`. These are the same uses that `may_use` judges ([Languages and uses](languages.md)):

| `kind` | Other keys | Meaning |
|---|---|---|
| `file` | `file`, `type` | the use reaches a file of the repository; `file` is that file's path, written as `path` is, and `type` its type id, or null for a file with no type |
| `outside` | none | the use leaves the repository, such as an import of a package |
| `ambiguous` | `what`, `candidates` | the use could name several files; `candidates` lists them |
| `none` | `what`, `reason`, `candidates` | the readers found no file; `reason` is `unfollowed`, `unowned` or null, as in [Unresolved uses](languages.md#unresolved-uses) |

The list holds what `may_use` skips: a use of the file itself, and a use of a binary file.

The first call of `uses()` by a rule reads the uses of every file that the rule judges in that run, at once. Lawcheck reads the uses of each file once in a run. A file whose uses another rule already asked for is not read again, and every rule gets the same answer for it. The uses of a file do not depend on the other files of the run, so a plain check and `--full` give a rule the same uses.

A file of Java, Kotlin, C#, Ruby or Rust needs the declarations of every file of its language. In a large repository, that first call can then take seconds. A failure of the reader reaches these files:

- When the reader fails on a file the rule judges, that file gets `reader-failed`. Lawcheck reads the other files again without it.
- When the reader fails on anything else, such as a file the rule does not judge, every file that depends on it gets `reader-failed`.
- When a grammar does not load, every file of its language fails.
- When the reader fails on a file of Java, Kotlin, C#, Ruby or Rust that Lawcheck reads only for what it declares, every file of that language fails. Java and Kotlin count as one language here.

## The return value

`check` returns a list of [findings](concepts.md#finding), or a promise of one. A finding has these fields:

- `message` is a non-empty string of at most 4,096 characters. Lawcheck turns a line break in it into a space.
- `line` is optional. Its value is an integer from 1 to the number of lines of the file. A finding without `line`, or with a `line` of `null`, is about the whole file. A `line` that is any other value than an integer in that range, such as a string like `'2'`, a bigint or `1.5`, makes the rule `rule-crashed`, with a message that names the value.
- `file` is optional. Its one allowed value is the `path` of the call.

Lawcheck ignores other fields, whatever they hold. A rule that returns an empty list reports no finding. All the rules of one run may return 200,000 findings together, with 16 MiB of messages. A run past either limit stops with `too-many-findings`. The error names each rule with the number of findings it returned.

## Calls

Lawcheck calls `check` once for each file of the run whose type, or a type above it, lists the rule. It makes the calls in path order, one call at a time. A [plain `lawcheck check`](concepts.md#plain-check) passes the rule the files of the [change](concepts.md#change). With `--full`, Lawcheck passes it every file that the rule binds, changed or not. Keep nothing between calls in a rule. A rule that counts the files it has seen reaches one count in a plain check and another with `--full`, so its findings differ between the two.

Lawcheck does not load a rule that has no file to judge in the run.

## The runner

Lawcheck runs each script rule in a Node process of its own. This page calls that process the rule runner. Lawcheck's own folder is the folder where the `lawcheck` package is installed. The rule runner starts in this state:

- Node's flag `--permission` limits its reads to the root and to Lawcheck's own folder;
- `process.env` is empty, because the rule runner gets none of the caller's variables;
- its working directory is the root.

Lawcheck writes what the rule prints, on either stream, to its own standard error.

A rule has 30 seconds to load and 30 seconds for each call. A rule that takes longer is `rule-crashed`. All script rules of one run have 600 seconds together. The time Lawcheck takes to read a tree or the uses counts toward the 600 seconds of the run, and not toward the 30 seconds of any call. A rule that asks while Lawcheck reads for another rule does not lose that time either. A run that goes past the 600 seconds stops with `rules-too-slow`. Lawcheck reports that code at the file that each unfinished rule was judging.

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
- leaves a promise rejected with no handler, or a timer that throws, while its process runs.

A crash of the last kind names no judged file. When it comes during the load, the message adds the words `in its load`. After the last call, Lawcheck waits once, at most 2 seconds, for the work the rule left running. A timer counts as such work, whether or not the rule unrefs it. A job of `node:crypto` whose callback has not run counts too, such as a call of pbkdf2 or scrypt.

In the other cases, the message of `rule-crashed` names the judged file, or the load. Lawcheck names each crashed rule once in a run.

A rule may throw a value that JavaScript cannot turn into text, such as an object with no prototype, which has no method that gives its text. The message then holds the error that JavaScript raises for that value. A proxy can answer that attempt by throwing a value that is not an error, such as a string. For such a value, the message reads `a value with no string form`.

A call can leave work running, such as a timer, and the rule's process can then end or go 30 seconds without an answer. The message of that crash depends on the last call that answered:

- When that call left work running, the message ends with the words "after a call that left work running" and names no judged file. The work may come from an earlier call, so the file judged at that moment is not the cause.
- When that call left nothing running, the message names the file judged at that moment. An earlier call may have left work that ended before then.

The same rule crashes with the same message when it judges one file and when it judges many.

When Node cannot start the rule runner at all, Lawcheck stops with `runner-failed` and names no rule. The message holds Node's own error line. To fix it, reinstall Lawcheck.

## Trying a rule

```text
$ lawcheck try no-todo src/core/tax.ts
$ lawcheck try no-todo
```

With a file named, `lawcheck try` runs the rule on that file. Without one, it runs a script rule on every file whose type, or a type above it, lists the rule. `lawcheck try` records nothing in the repository. `lawcheck docs first-law` shows how to write a rule and try it, step by step.

Next: [Reviewer rules](reviewer-rules.md)
