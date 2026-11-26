# Script rules

A to-do comment without an issue number stays in the code for years. A [script rule](concepts.md#script-rule) can find one. The rule is a JavaScript module (an ES module) in `.lawcheck/rules/<id>.mjs`. It exports a function `check`. The law names the rule in `.lawcheck/law.yaml`, with its `why` and its `status` (`lawcheck docs law` has the keys). The folder that holds `.lawcheck/` is the [root of the law](concepts.md#law). This page calls it the root for short. Every path in the tables below starts there.

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
| `files` | a list that holds the one file of the call; the file has the keys below |
| `path` | the file's path from the root, as Lawcheck prints it |
| `type` | the file's type id; under `lawcheck try`, null for a file with no type |
| `text` | the file's text |
| `lines` | the text split at `\n` and `\r\n` |
| `tree()` | a promise of the file's [syntax tree](#the-syntax-tree) |
| `uses()` | a promise of the file's [uses](#the-uses), the ones that `may_use` judges |
| `repo.filesOf(typeId)` | the sorted paths of every file of that type and its subtypes, returned directly and not as a promise; an unknown id throws |

Lawcheck reads the tree and the uses only when the rule calls `tree()` or `uses()`. For a rule that calls neither, Lawcheck parses nothing. In one run Lawcheck parses a file once, and every rule that calls `tree()` on it gets that tree, while the trees it keeps stay within their bound: a third of the memory a run may hold, and at most a quarter of what the system can give as the run starts. Once the kept trees reach that bound, or the memory guard asks for their memory, Lawcheck parses the file again for each rule that asks. On a check of many files it parses several files at once, on up to four threads and never more than the machine has processors. It starts no thread on one processor, or when the system can give less than 1 GiB as the run starts. Within one call of `check`, a second call of `tree()` or `uses()` returns the promise of the first. A rule may keep a file from an earlier call of `check`. On that file, `tree()` rejects with `tree() was called after its call of check ended`. `uses()` rejects with the same message, with `uses()` in place of `tree()`.

In `path`, Lawcheck writes a backslash, a line feed, a carriage return and a byte that is not UTF-8 as `\\`, `\n`, `\r` and `\xHH`. A `path` written that way no longer names the file on disk, so read the file's text from `text`.

A final line end adds no empty line to `lines`. For an empty file, `lines` is an empty list.

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

The tree is made of nodes. Each node is one piece of the code, such as a call, a name or a string. The grammar of each language sets the types and the fields of its nodes, so they differ between languages. A call is a `call_expression` in TypeScript and a `call` in Python. Before you write a rule that reads the tree, print the tree of a real file in the rule's language. This is `src/run.ts`:

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

`explain --tree` prints only the named nodes. A named node is any node other than a keyword or a punctuation mark, such as a call or a string. A keyword or a punctuation mark, such as `const` or `;`, is not named. Each line below the first is one named node, under its parent. The line shows the node's field and a colon, then its type and its line. The field is the name that the parent gives the node, such as `function`, and some nodes have none. A node with no named node below it also shows its text, cut at 40 characters.

The rule above follows this tree. It takes the child in the field `function` of a `call_expression`. The `comment` holds `eval(y)` as text, so the rule reports nothing there.

`explain --tree` stops at 12 levels and at 200 nodes. It says how many named nodes it left out. With `--json`, it gives every node, named or not, with the keys below. In place of `children`, each node in that output has `parent`: the index of its parent in the list, or null for the root. To see the tree of one construct, write it in a small file and explain that file. Git need not track the file. For a file with no tree, `explain --tree` prints the reason that the key `absent` gives below.

`await file.tree()` gives an object with three keys:

| Key | Value |
|---|---|
| `language` | the language the [reader](concepts.md#use) parsed, such as `typescript` or `tsx`; null for a file with no reader |
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

A node of type `ERROR` holds text that the grammar cannot read. Where the text lacks a token, such as a closing bracket, the parser can add an empty node: its `start` equals its `end`.

A Vue or Svelte file gets the tree of its script blocks. Lawcheck parses that file with every character outside the blocks turned into a space. `start` and `end` therefore still point into `text`.

The tree of a file depends on its path and its text. The tree of a C or C++ header also depends on the other files of its folder: they decide whether Lawcheck reads it as C or as C++ ([Languages and uses](languages.md)). A [plain check](concepts.md#plain-check) and `--full` give a rule the same tree for the same file.

The tree is absent in three cases:

| `absent` | When |
|---|---|
| `no-reader` | no reader reads the file's language ([Languages and uses](languages.md)), or a Vue or Svelte file has no script block |
| `too-large` | the parsed text holds more than 512 KiB; Lawcheck reads the uses of no file larger than that either |
| `reader-failed` | Lawcheck cannot load the grammar of the language, or the parser fails on the file |

An absent tree stops nothing. The rule decides what to report for that file.

### The grammars

The node types and fields come from the grammar of each language. Lawcheck takes its grammars from the package Runes. Lawcheck ships the grammars of Runes 1.2.0:

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

Lawcheck sets the keys of the object that `tree()` gives and the keys of each node. A version of Lawcheck that changes them says so in the changelog, under "Before you upgrade". The grammar sets the node types, the fields and the nesting. A new version of Lawcheck can take a new Runes with new grammars. Your rule can then see other node types, other fields or other nesting for the same code. The changelog names each version of Lawcheck that changes a grammar. This table shows the grammar versions.

## The uses

`await file.uses()` gives an object with two keys:

| Key | Value |
|---|---|
| `uses` | the uses the reader found, in the order of the file, or null when they are absent |
| `absent` | null, or why the uses are absent: `no-reader`, `too-large` or `reader-failed`, as for the tree |

A Vue or Svelte file with no script block gets an empty list of uses. Its tree is absent with `no-reader`.

The list holds the uses that `may_use` judges ([Languages and uses](languages.md)). Each use has the keys `line` and `kind`:

| `kind` | Other keys | Meaning |
|---|---|---|
| `file` | `file`, `type` | the use reaches a file of the repository. `file` is that file's path, written as `path` is. `type` is the file's type id, or null for a file with no type |
| `outside` | none | the use leaves the repository, such as an import of a package |
| `ambiguous` | `what`, `candidates` | the use could point to any of several files; `candidates` lists them |
| `none` | `what`, `reason`, `candidates` | the readers found no file; `reason` is `unfollowed`, `unowned` or null, as in [Unresolved uses](languages.md#unresolved-uses) |

The list also holds two kinds of use that `may_use` skips: a use of the file itself, and a use of a binary file.

The first call of `uses()` by a rule makes Lawcheck read the uses of every file that the rule judges in that run, in one pass. Lawcheck reads the uses of each file once in a run. If another rule already asked for the uses of a file, Lawcheck does not read that file again. Every rule gets the same uses for a file. The uses of a file do not depend on the other files of the run. A plain check and `--full` therefore give a rule the same uses.

To read the uses of a file of Java, Kotlin, C#, Ruby or Rust, Lawcheck reads what every file of that language declares. The first call of `uses()` therefore takes longer the more files of that language the repository holds.

When the reader fails, these files get `reader-failed`:

- When the reader fails on a file the rule judges, that file gets `reader-failed`. Lawcheck reads the other files again without it.
- When the reader fails on anything else, such as a file the rule does not judge, every file whose uses depend on that thing gets `reader-failed`.
- When a grammar does not load, every file of its language gets `reader-failed`.
- When the reader fails on a file of Java, Kotlin, C#, Ruby or Rust that Lawcheck reads only for what it declares, every file of that language gets `reader-failed`. Java and Kotlin count as one language here.

## The return value

`check` returns a list of [findings](concepts.md#finding), or a promise of one. A finding has these fields:

- `message` is a non-empty string of at most 4,096 characters. Lawcheck turns a line break in it into a space. A finding with no `message`, or an empty one, makes the rule [`rule-crashed`](#rule-crashed). So does a `message` that is not a string, such as the number `42`, and the message of the crash then names that value.
- `line` is optional. When present, it is an integer from 1 to the number of lines of the file. A finding without `line`, or with a `line` of `null`, is about the whole file. Any other value of `line`, such as a string like `'2'`, a bigint or `1.5`, makes the rule [`rule-crashed`](#rule-crashed). The message names the value.
- `file` is optional. Its one allowed value is the `path` of the call.

Lawcheck ignores other fields, whatever they hold. A rule that returns an empty list reports no finding. Together, the rules of one run may return at most 200,000 findings and 16 MiB of messages. A run past either limit stops with `too-many-findings`. The error names each rule with the number of findings it returned.

## Calls

Lawcheck calls `check` once for each file of the run whose type, or a type above it, lists the rule. It makes the calls in path order, one call at a time. A [plain `lawcheck check`](concepts.md#plain-check) passes the rule the files of the [change](concepts.md#change). With `--full`, Lawcheck passes it every file that the rule binds, changed or not. Keep no state in a rule from one call to the next. For example, a rule that counts the files it has seen reaches one count in a plain check and another with `--full`. Its findings then differ between the two.

Lawcheck does not load a rule that has no file to judge in the run.

## The runner

Lawcheck runs script rules in Node processes. This page calls such a process the rule runner. Lawcheck's own folder is the folder where the `lawcheck` package is installed. The rule runner starts in this state:

- Node's flag `--permission` limits its reads to the root and to Lawcheck's own folder;
- `process.env` is empty, because the rule runner gets none of the caller's variables;
- its working directory is the root.

A check starts one rule runner. The runner takes one whole rule after another, and each rule judges all its files there, in order. While rules still wait, Lawcheck starts more runners, never more than the machine has processors. `lawcheck try` runs its rule in a runner of its own.

A runner takes the next rule only when the rule before it left nothing that the next one could meet. A rule that leaves any of these is the last rule of its runner, and the next rule gets a fresh one: a timer or other work still running, a changed global or built-in object, a changed export of a built-in module, a variable in `process.env`, another working directory, a listener on the process object, a loaded CommonJS module, or a printed line. Lawcheck looks for such a change in these places: the globals, the process object, `Buffer` and each built-in module the rule imported, and the functions, their prototypes and the plain objects that those hold, where a global that Node defines through a getter counts by its getter alone; the methods of `console`; the functions of standard output and standard error and of each prototype the two inherit from, such as a replaced function that writes to one; a callback that takes the uncaught exceptions of the process; a hook that the rule adds for the loading of modules; and whether source maps are on. A change anywhere else stays in the runner, and the next rule of that runner meets it. No ordinary rule makes one. These are the ones known:

- a property set on a method of a built-in prototype, such as `Array.prototype.push`;
- a change to an object two levels inside a built-in module, such as `util.inspect.defaultOptions` or `fs.promises`;
- a value set through a setter, such as `events.defaultMaxListeners` or `process.exitCode`;
- a property set on a class inside a built-in object, such as `Intl.NumberFormat.prototype` or `WebAssembly.Memory.prototype`;
- a property set on a global that Node defines through a getter, such as `crypto` or `performance`, and a mark of `performance`;
- a subscription to a channel of `node:diagnostics_channel`;
- the state of a module imported by a `data:` URL, which every rule of the runner that imports the same URL shares.

Each rule loads its own copies of the modules it imports. Two rules that import the same helper each get that helper with its own state. An import whose URL already has a query or a fragment, such as `./helper.mjs?v=2`, has a copy for each rule too, and so does an import that ends with another rule's id, such as `./other.mjs?rule=other`. To keep the copies apart, the URL of a rule's module and of each file it imports ends with `?rule=<id>`, so `import.meta.url` holds that ending. `fileURLToPath(import.meta.url)`, `import.meta.dirname`, `import.meta.filename` and `new URL('./x', import.meta.url)` give the same paths as without it.

When a rule ends with anything but findings in a runner that other rules used, Lawcheck runs that rule once more in a runner of its own and reports the result of that run. This covers a throw, a wrong return, a failure in the background and a runner that ended. So `rule-crashed` names the rule that crashes alone, in the words below, and the other rules of the check are judged as usual. A rule that passes its 30 seconds is not run again.

Lawcheck writes what the rule prints, on either stream, to its own standard error. It drops what a rule prints in that second run, because you have read it from the first. A print waits until Lawcheck has taken it, so the rule runner holds none of what the rule prints, however much that is. The time a print waits counts toward the rule's 30 seconds. Lawcheck exits once its caller has taken every line from that stream, so a caller that reads it late loses none. A run that a signal, `memory-too-large` or `step-too-slow` ends does not wait for that.

A rule has 30 seconds to load and 30 seconds for each call. A rule that takes longer is `rule-crashed`. All script rules of one run have 600 seconds together. The time Lawcheck takes to read a tree or the uses counts toward the 600 seconds of the run. It does not count toward the 30 seconds of any call. A rule can ask for a tree or the uses while Lawcheck reads for another rule, and that wait does not count toward its 30 seconds either. A run that goes past the 600 seconds stops with `rules-too-slow`. Lawcheck reports that code at the file that each unfinished rule was judging.

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

Lawcheck stops the run with `path-unsupported` when the path of the root, or of Lawcheck's own folder, holds a `*`. Node's permission model reads that `*` as a wildcard, and a rule could then read the folders beside the root. Outside Windows, a backslash in either path stops the run too, because the rule runner cannot load a rule from a path with a backslash.

## rule-crashed

Lawcheck reports `rule-crashed` and exits with code 2 when the rule:

- does not load, or exports no function `check`;
- throws or rejects;
- returns something other than a list of findings as above. A list with a message over 4,096 characters counts as a wrong return. So does a function, or another value that Lawcheck cannot pass out of the rule's process;
- takes more than 30 seconds to load, or more than 30 seconds for one call;
- ends its process before it answers, or sends a message that Lawcheck did not ask for;
- leaves a promise rejected with no handler, or a timer that throws, while its process runs.

A rejected promise with no handler, or a timer that throws, gives a `rule-crashed` that names no judged file. When either comes during the load, the message adds the words `in its load`.

After the last call, Lawcheck waits once, at most 2 seconds, for the work the rule left running. A timer counts as such work, whether or not the rule called its `unref()`. A job of `node:crypto` whose callback has not run counts too, such as a call of pbkdf2 or scrypt.

For every other kind of crash in the list above, the message of `rule-crashed` names the judged file, or the load. Lawcheck names each crashed rule once in a run.

When the rule throws, rejects or fails in the background, the message of `rule-crashed` holds the first line of what the rule threw. It shows at most 4,096 characters of that line, the same limit as a finding's message. A longer line is cut there, and the message ends with the count of the characters left out, as in `… (cut: 96,178 more characters)`. When the first line is empty, the message holds the first line that has text. An error with no message reads "an error with no message". A thrown object that is not an error but holds a string `message`, such as `{ code: 'E_X', message: 'no config' }`, gives that message.

A rule may throw a value that JavaScript cannot turn into text. An object with no prototype is one: it has no method that gives its text. The message of `rule-crashed` then holds the error that JavaScript raises when it tries. A proxy object can answer that try by throwing a value that is not an error, such as a string. In that case the message reads `a value with no string form`.

A call can leave work running, such as a timer. The rule's process can then end, or go 30 seconds without an answer. The message of that crash depends on the last call that answered:

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
