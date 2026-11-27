# Let a coding agent write the first law

Your coding agent can write the first [law](concepts.md#law) of your repository. It asks you before it forbids a [use](concepts.md#use) that the code already makes. Tell your coding agent: "Run `lawcheck docs agent-setup` and follow it." With the plugin for [Claude Code](plugin.md#the-setup-skill) or [Copilot CLI](copilot-cli.md#_7-write-the-first-law), type `/lawcheck:setup` to start the setup skill. With the plugin for [Codex](codex-cli.md#_7-write-the-first-law), type `$lawcheck:setup`. The agent can also start the skill itself when you ask it for a law. The law the setup skill writes can forbid correct new code, or leave out a boundary that your project wrote down. Its advice can miss a boundary between your packages. Its target can forbid more than you asked, or miss a problem you named. Read each type, list and rule it writes before you commit `.lawcheck/`. The agent describes the folders of your repository as [types](concepts.md#type). It writes down which type uses which today. It changes nothing outside `.lawcheck/`, except a CI job you ask for. It commits nothing unless you ask. It ends with a law that `lawcheck check` passes, and with a count of the old code that breaks that law. Advice on the architecture, and a target architecture with a plan to reach it, come only with the setup skill that the plugins for Claude Code, Codex and Copilot CLI carry ([The setup skill](plugin.md#the-setup-skill)).

The rest of this page is for the agent. Do the steps in order. The parts below the steps hold what several steps use, under fixed headings. Write nothing to the user except the questions of steps 3 and 10 and the final message of step 11 ([The words for the user](#the-words-for-the-user)).

The outputs below come from a repository with five files:

- `src/api/orders.ts` imports `src/core/price.ts` and `src/db/orders.ts`;
- `src/api/refunds.ts` imports `src/core/price.ts`;
- `src/core/price.ts` imports nothing;
- `src/core/report.ts` imports `src/api/orders.ts`;
- `src/db/orders.ts` imports `src/core/price.ts`.

## 1. Before anything

Run `lawcheck --version` and `lawcheck prime`. When the shell finds no `lawcheck`, give the user the two ways to install it, and let the user choose and run one:

- `npm install --global lawcheck` puts one `lawcheck` program on this machine, for every repository.
- `npm install --save-dev lawcheck` pins the version in this project's `package.json`, for the whole team and CI. Then run each `lawcheck` of this page as `npx --no-install lawcheck`, and write the line `runner: npx` into `.lawcheck/config.yaml` after `lawcheck init` ([Settings](config.md#runner)).

Once the user says it is installed, go on with what the user asked for. Never ask the user to send the request again.

When `prime` prints a law, a law already governs this folder: do not start a second one. Tell the user that the law stands and that `lawcheck prime` says how to change it, and stop.

Change no file outside `.lawcheck/`, except for [a CI job the user asks for](#a-ci-job-the-user-asks-for). Commit nothing unless the user asks.

The shell commands of this page are for a POSIX shell, such as bash. On Windows, run them in Git Bash or WSL, not in PowerShell: PowerShell has no `cmp`, and its `cp` is another command.

Each `lawcheck check --full` of this page is a deliberate audit of the whole code, run on purpose to prove a candidate law and to count the old code that breaks it. It is no step for each later change, and no step of CI, which judges only the change on purpose.

The user answers at most two messages of questions: the one of step 3 and the one of step 10. One message may hold many numbered questions. Add no [reviewer rule](concepts.md#reviewer-rule) unless the user asks for one.

## 2. Read what is written down

Read the README, the instruction files for agents (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, `.github/copilot-instructions.md`), architecture documents and decision records. Look for a tool that the repository already runs to check which code may use which: `eslint-plugin-boundaries` or `no-restricted-imports` in an ESLint config, `dependency-cruiser`, the tags of `nx.json`, `import-linter`, ArchUnit tests, `deptrac`, `packwerk`, `go-arch-lint`. One search over `git ls-files` finds most of them.

List each rule someone already wrote about which code may use which, or about what files must or must not do, with its file and line and its words quoted. These written rules are the only source of the questions of step 7 and the rules of step 8.

## 3. Choose the root

The root is the folder that holds `.lawcheck/`. The law judges only the files below it. Count the package manifests that git lists outside vendored folders: `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `composer.json`, `Gemfile`, and the project files of C#, Java and Kotlin. Ask the user before `lawcheck init` when either holds:

- there is more than one manifest;
- every code file sits below one folder, such as `src/` or `backend/`.

Otherwise put the law at the top and ask nothing. The question gives the options that fit, with what each changes:

- **One law at the top.** One check covers every package. A `may_use` list can forbid a use between two packages.
- **One law in each package.** Each package has its own law and its own check, for packages with separate owners. No restriction crosses between packages. A check at the top of the repository stops with `not-initialized` ([A monorepo](monorepo.md)).
- **One law in one folder**, such as `backend/`. Lawcheck judges no file outside that folder.

After the answer, run `lawcheck init` in each folder the user chose, and do steps 4 to 11 for each law. When the user said that no one will answer, put one law at the top, and say so in the final message.

## 4. Describe the files as types

Run `lawcheck init`, then replace the whole text of `.lawcheck/law.yaml` with your types. The type `source` in the comment that `init` writes is an example, not a type of this repository.

- A type is a unit of the code: a package, a project, an app or a layer, such as `src/api/`, with every file below its folder. Take the names from the folders, the README and the instruction files, never from a textbook. A pattern's name, such as "hexagonal" or "clean architecture", is no reason for a type.
- The units are the types at the top of `types`. Write no parent type: no type over most of the code, such as one named backend, app, server or after the main package, and no type that only groups other types.
- Never split a unit into smaller types by its subfolders, such as its models, its database scripts and its data. Each part would get its own copy of today's uses, and correct new code would fail.
- A folder of tests is a unit of its own: each folder named `tests/`, `test/`, `__tests__/` or `spec/`, at the top or inside a package. All of them go into one type, named tests, with `paths` such as `["tests/**", "**/tests/**"]`. Each other type leaves them out with a pattern such as `"!**/tests/**"`.
- A test file beside the code, such as `src/db/orders_test.go` or `src/db/orders.spec.ts` in the folder `src/db/`, stays in the type of that folder.
- Never make a type of files from several folders, other than the tests, such as every `__init__.py` or every helper. Never put folders of different jobs into one type, such as the controllers with the database code.
- Files that are not code in a language Lawcheck reads, such as images, styles, data, notes or shell scripts, get no type. When code imports some of them, one type, named assets, takes those files, with no list. Say why in the final message.
- Give each type one `about` sentence that says what its files do. Read two or three of its files first, so the sentence is true of them.
- Decide yourself for generated code, vendored code and build scripts, and say each decision in the final message.
- Generated or vendored code inside a code folder, that no typed code uses, goes under `ignored`, so no type takes it. Name each pattern of `ignored` to the user ([The law file](law.md#ignored)). `ignored` holds nothing else.
- Generated or vendored code that typed code uses gets a type of its own, with no `may_use` list, and never a place under `ignored`. Search the typed code for imports of each generated or vendored folder before you decide.
- Put the code files under `required`, by folder and extension, such as `src/**/*.ts`. A code file there that no type takes is then `untyped-file` ([The law file](law.md#required)). The law starts with no `untyped-file` finding. So leave out of `required` a stylesheet or a JSON file that no type takes, and a folder whose type names single files.

Check how many files have a type with `lawcheck explain .`, in every run. At least nine in ten files of the languages Lawcheck reads have a type ([Languages and uses](languages.md)). Use units for that, never a parent or a type that takes everything. Name each file left without a type in the final message.

## 5. Measure the uses between types

Do this step in every run, even where you think you know the uses: the table is the evidence for steps 6 and 7. Write the candidate, a law whose findings you count without keeping it. The candidate is the law of step 4, with a `may_use` list on every type that names only the type itself. Measure it as [Measure a law that is not in force](#measure-a-law-that-is-not-in-force) says. Its table is the architecture the code has today.

The candidate for the example repository:

```yaml
lawcheck: 0.1.0

required: ["src/**"]

types:
  api:
    about: The HTTP handlers.
    paths: ["src/api/**"]
    may_use: [api]
  core:
    about: Prices and reports, with no input or output.
    paths: ["src/core/**"]
    may_use: [core]
  db:
    about: The database access.
    paths: ["src/db/**"]
    may_use: [db]
```

Its table:

```output
api -> core  2 files  2 uses
  src/api/orders.ts:1
  src/api/refunds.ts:1
api -> db  1 file  1 use
  src/api/orders.ts:2
core -> api  1 file  1 use
  src/core/report.ts:1
db -> core  1 file  1 use
  src/db/orders.ts:1
unresolved uses: none
```

## 6. Write the lists that hold today

Give each type a `may_use` list that names the type itself and every type that its rows of the table reach, and no other type. This law has no `forbidden-use` finding. It forbids every use between types that the code does not make today. Keep a row that a written rule forbids: its question of step 7 decides it. Write the law into `.lawcheck/law.yaml`. Then `lawcheck check --full --base HEAD` lists no `forbidden-use`.

- A row to `no type:` names a file that a type of this law uses and that no type takes. Give that file a type in step 4. A list can never allow a file without a type.
- A type whose list would name every other type, such as the entry point that wires the program, keeps no list. Say so in the final message.
- A parent type with no list restricts no file that only the parent takes: a new file in its folder, outside the folders of its subtypes, passes unchecked, even when the subtypes have lists. This is one more reason to write no parent type.
- A type in a language with no reader keeps no list, because Lawcheck cannot read its uses (`uses-not-read`).

The law for the example repository:

```yaml
lawcheck: 0.1.0

required: ["src/**"]

types:
  api:
    about: The HTTP handlers.
    paths: ["src/api/**"]
    may_use: [api, core, db]
  core:
    about: Prices and reports, with no input or output.
    paths: ["src/core/**"]
    may_use: [core, api]
  db:
    about: The database access.
    paths: ["src/db/**"]
    may_use: [db, core]
```

## 7. Find the written rules the code breaks

A row of the table that a rule of step 2 forbids is a written rule that the code breaks. Every such row is a question of step 10, with no exception and no limit: they all go into that one message, as numbered questions. The user decides whether the code keeps that use, not you. Never leave one out and never decide it yourself. For each, take the rule's file, line and words, the row's files and lines, and the three ways of [A boundary the code already breaks](#a-boundary-the-code-already-breaks).

Ask nothing about a use that no written rule forbids, such as a cycle, or a use that few files make. Such a use stays in its list. Only the advice of the setup skill proposes to forbid it, when the user asks for advice.

## 8. Write the rules

Write a [script rule](script-rules.md) only for a rule of step 2 that a script can judge, such as "no `console.log` in the core". Before you write one, copy the file and line of the project's own text that states it, with its words. No quote, no rule. A habit that every file keeps, a folder layout or a test layout is no written rule, and a correct new change breaks a rule made from it, such as a new command that prints. A written rule counts whether or not the code keeps it today, and its findings go to the question of step 10. The law with its rules must still fit `lawcheck prime` unshortened. Write each rule in `.lawcheck/rules/<id>.mjs`, with its entry and `why` under `rules` in the law. The `why` gives the reason that the text gives: what the rule protects, or what breaks without it. Then put the rule's id in the `rules` of every type whose files it judges. A rule that no type lists judges no file.

- A rule about code, such as a call, an import or a construct, reads the file's syntax tree with `await file.tree()` ([Script rules](script-rules.md#the-syntax-tree)). In the tree, a call is a node of its own, so the rule reports nothing for the same word in a comment or a string. Before you write a rule that reads the syntax tree, run `lawcheck explain <path> --tree` on a real file of that language, and write the rule from the node types and fields it prints, since they differ between languages.
- A rule about text, such as a header or a licence line, may read `file.lines`.
- A file in a language with no reader has no tree, so a rule about code reports nothing there. Say so in the final message.

This rule finds a call of `console` in the files it judges, and not the word in a comment:

```js
export async function check({ files: [file] }) {
  const { root } = await file.tree();
  if (root === null) return [];
  const findings = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    const callee = node.type === 'call_expression' ? node.children.find((child) => child.field === 'function') : undefined;
    const name = callee === undefined ? '' : file.text.slice(callee.start, callee.end);
    if (name.startsWith('console.')) findings.push({ line: node.line, message: `writes to the terminal with ${name}` });
    stack.push(...node.children);
  }
  return findings;
}
```

Count its findings with `lawcheck try <rule> '<pattern>'`. In the example repository, the rule is `no-console`, with the `why` "Only the handlers write to the terminal." `src/core/price.ts` names `console.log` in a comment, and `src/core/report.ts` calls it on line 4:

```text
$ lawcheck try no-console 'src/core/**'
```

```output
lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 2 files

src/core/report.ts:4  error[no-console]  writes to the terminal with console.log
  why:  Only the handlers write to the terminal.
```

Then decide by the count:

- zero findings: add the rule, enforced;
- findings: the rule waits for the user. Every rule with findings goes into one question of step 10. That question lists each rule with its count of findings. For each rule, the user picks one answer: keep it enforced, so its findings become [debt](concepts.md#debt); make it `status: advisory`, so its findings are warnings; or leave it out.

Add a [reviewer rule](reviewer-rules.md) only when the user asks for one and names the reviewer. Each file it judges costs one model call, and `.lawcheck/config.yaml`, which sets the reviewer, is the user's.

## 9. Prove each restriction bites

Do what [Prove each restriction bites](#prove-each-restriction-bites) says, for each list and each rule of the law.

## 10. Explain, and ask

Write one message, as [The words for the user](#the-words-for-the-user) says. Give the parts **The law** and **Debt** of the final message of step 11. Then give the open decisions of steps 7 and 8, numbered, as the last part. Each broken written rule gets a question of its own, and all the rules with findings share one question. Each question gives its options and what each option changes. A boundary question offers the three ways of [A boundary the code already breaks](#a-boundary-the-code-already-breaks), never only yes or no.

Put no next step and no offer after the questions. End your turn, and wait for the answers. A session started with a prompt, such as `claude -p`, has a person too, who answers in the next prompt. Apply each answer as [A boundary the code already breaks](#a-boundary-the-code-already-breaks) says. Prove each new restriction as in step 9. With no question from steps 7 and 8, skip this message and go to step 11. The user may say that no one will answer. Only then, add what holds with zero findings, and list each question in the final message.

## 11. Finish

Check that all four hold:

- `lawcheck check --full --base HEAD` exits 0;
- `lawcheck doctor` exits 0;
- `git status --short` lists files under `.lawcheck/` and nothing else, apart from the files that the user's install of Lawcheck changed;
- the temporary folder of the measurement is deleted, with `rm -r` and its path.

End with one final message that stands on its own. Start it with the label **The law**, with no sentence before it. It has the parts below, under these labels, every time. Write each part out again, even when an earlier message said it. Never point back to an earlier message.

1. **The law**: open with "The law is the file `.lawcheck/law.yaml`. It says which folders of the code may use which." Then the count of types and rules, each type with what its files do and their count, who may use whom in sentences, such as "the database code may use the core and nothing else", and each rule with its reason and the file and line it comes from.
2. **Debt**: open with "Debt is old code that breaks the law. It fails a check only when a change edits its file." Then copy the counts of the line `debt (outside this change):` that the last `lawcheck check --full --base HEAD` printed. That line counts every finding of the law, never those of one boundary.
3. **You decided**: each answer of the user, or "nothing".
4. **I decided**: each choice you took alone, such as the root, generated code or a type with no list.
5. **Not checked**: the unresolved uses per language, the languages with no reader, the files with no type, the types with no list, and the types that no test file proved.
6. **Next step**: commit `.lawcheck/` in a change of its own.

Every reply after the user's last answer is this final message, whole, from **The law** on. That holds after an answer to a question, and after "no", "not now", "thanks" or "I'll think about it". Never reply with a sentence of acknowledgment.

Do not call the code or the law good or safe. Say what the check holds.

## The words for the user

The user reads two kinds of message from you: the questions of steps 3 and 10, and the final message. Write nothing else: no note on what you read, run, measured or found, and no line before a question. In Claude Code, every text between two tool calls reaches the user as a message, so put no text between tool calls.

Each message is read alone. When a message uses one of these words, explain it in that message, in the sentence where it first appears:

- the law: the file `.lawcheck/law.yaml`, which says which folders of the code may use which;
- a type: a group of files of the law, most often one folder;
- a use: an import, or another reference from one file to another;
- debt: old code that breaks the law, which fails a check only when a change edits its file;
- a script rule: a small program in `.lawcheck/rules/` that checks each file for one thing.

Never write "probe", "candidate" or `lawcheck doctor` to the user, and write "CI" only when the user asked for a CI job. Write "a test file that breaks the rule" and "a draft of the law". Each sentence holds one idea and names one concrete thing: a number, a file, a command or a type. Never join two facts in one sentence, as "It passes the check, and there is one question." does. Write no sentence that only acknowledges, only says what comes next, or only reassures, such as a lone "ok" or "you can commit it yourself".

## Measure a law that is not in force

A candidate is a law whose findings you count without keeping it. It may differ from `.lawcheck/law.yaml` only in its types and their `may_use` lists, so the rule files still match it.

1. Make a folder in the system's temporary directory with `mktemp -d`, and note the path it prints. Each shell command may start a new shell, so write that path into each command that needs it, as `KEEP=<path>`.
2. Save the script below in that folder as `uses.mjs`, once.
3. Write the candidate into that folder as `candidate.yaml`, never into the repository.
4. Run the command below as one shell command. It keeps the law, puts the candidate in its place, counts the uses and puts the law back, even when the check fails.

```js
let text = '';
for await (const chunk of process.stdin) text += chunk;
const report = JSON.parse(text);
if (report.schema !== 'lawcheck-check/0') {
  for (const error of report.errors ?? []) console.log(`${error.code}  ${error.file ?? ''}:${error.line ?? ''}  ${error.message}`);
  process.exit(2);
}
const rows = new Map();
for (const finding of report.findings) {
  if (finding.code === 'uses-not-read') console.log(`not read: ${finding.message}`);
  if (finding.code !== 'forbidden-use') continue;
  const untyped = /may not use (.+), which has no type;/.exec(finding.message);
  const typed = /may not use (\S+) \(/.exec(finding.message);
  const to = untyped ? `no type: ${untyped[1]}` : typed ? typed[1] : 'several types';
  const key = `${finding.type} -> ${to}`;
  const row = rows.get(key) ?? { files: new Set(), uses: [] };
  row.files.add(finding.file);
  row.uses.push(`${finding.file}:${finding.line}`);
  rows.set(key, row);
}
const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
for (const [key, row] of [...rows].sort(([a], [b]) => (a < b ? -1 : 1))) {
  console.log(`${key}  ${count(row.files.size, 'file')}  ${count(row.uses.length, 'use')}`);
  if (row.files.size <= 3) for (const use of row.uses) console.log(`  ${use}`);
}
const unresolved = {};
for (const use of report.unresolved) {
  const kind = use.file.includes('.') ? use.file.slice(use.file.lastIndexOf('.')) : use.file;
  unresolved[kind] = (unresolved[kind] ?? 0) + 1;
}
const kinds = Object.entries(unresolved).map(([kind, n]) => `${kind} ${n}`).join(', ');
console.log(`unresolved uses: ${kinds === '' ? 'none' : kinds}`);
```

```text
$ cp .lawcheck/law.yaml "$KEEP/law.yaml" && cp "$KEEP/candidate.yaml" .lawcheck/law.yaml; lawcheck check --full --base HEAD --json | node "$KEEP/uses.mjs"; cp "$KEEP/law.yaml" .lawcheck/law.yaml && cmp "$KEEP/law.yaml" .lawcheck/law.yaml
```

Each row names the type of the file, the type it uses, and the count of files and uses. A row with three files or fewer lists each use by file and line. A use of a file with no type shows as `no type:` and the file. A line `not read:` names a type whose files Lawcheck cannot read for uses.

Lines that start with an error code mean the candidate is no valid law. Fix the candidate, never the code. Keep the folder for later measurements, and delete it in step 11.

## A boundary the code already breaks

A `may_use` list has no advisory status. A use that a list forbids is an error in every change that edits its file, on a line the author of that change may not have touched. So for each use the user may want to forbid, give three ways, and let the user choose:

- **Keep it allowed.** The list keeps the type it uses, as the code does today. Nothing fails. Nothing stops a new use of the same kind, either.
- **Forbid it now.** Take the type off the list. The files that use it become debt: `lawcheck check --full` lists them, and each one fails the first change that edits it until someone removes the use. Give the count of those files.
- **Make the exception visible.** Give the files that break the boundary a subtype of their own, with their paths written out. The subtype's `may_use` list still allows the use. Its `about` says that files leave this type and none join it. The rest of the type gets the boundary right away. `lawcheck explain --type <id>` shows how many files are still in the exception.

## Prove each restriction bites

A restriction that never fails proves nothing. Prove each one in a copy of the repository in the folder of the measurement, never in the user's files. Make the copy once, with `git clone --quiet "$(git rev-parse --show-toplevel)" "$KEEP/copy"`. Before each proof, put the law into the copy, with `rm -rf "$KEEP/copy/.lawcheck" && cp -R .lawcheck "$KEEP/copy/.lawcheck"`, run in the root. For a root below the top of the repository, use the same folder of the copy.

For each type with a `may_use` list, write one probe file into the copy, in that type's folder, that uses one type its list does not name. For each rule, write one file there that breaks it. Then check each probe in the copy, in the same shell command:

```text
$ lawcheck check src/db/lawcheck-probe.ts
```

```output
lawcheck: FAIL  1 error in 1 named file

src/db/lawcheck-probe.ts:1  error[forbidden-use]  db may not use api (src/api/orders.ts); its may_use is [db, core]
  why:  a type's may_use names every type its files may use

next: fix src/db/lawcheck-probe.ts:1
```

Each probe must fail with exit 1 and a finding of the expected code or rule. A probe that passes shows a list or a rule that does not hold what you meant. Fix the law, then try again. With Lawcheck installed through `npx`, run it in the copy by the full path of `node_modules/.bin/lawcheck` in the repository. Never write a probe into the repository, and never edit a file of the repository for one, not even for a moment. Two kinds of type get no probe: a type whose paths take no new file, such as a type of one named file, and a type whose list names every type it could use. The final message names each type with no probe.

## A CI job the user asks for

Write no CI job unless the user asks for one. When they do, write it after step 11. Run `lawcheck docs ci` before you write it. Then ask the user which law judges a change in CI: the change's own law, the law of the base, or both. Say what each choice catches and misses, as its part [The law that judges a change](ci.md#the-law-that-judges-a-change) says. The choice is the user's, so take none by default. Then write the job of that page with the lines for their choice.

## Never

- Edit the code, or add a waiver.
- Move a file into `ignored`, or out of its type, to avoid a finding. `ignored` is only for generated or vendored code that no typed code uses, and you name each of its patterns to the user. The exception subtype that the user chose in step 10 is not "out of its type": it is a subtype, and the rules of its parent still bind its files.
- Bind a rule to fewer types than the written rule names, to avoid a finding. Narrowing a rule hides debt that the user should see: bind it to every type it names, and put its findings in the question of step 10.
- Write `.lawcheck/config.yaml` unasked. A user who chooses to install Lawcheck into the project asks with that choice for one line there, `runner: npx` ([Before anything](#_1-before-anything)), and for no other.
- Invent a type, a boundary or a rule that the folders, the documents or the user do not give.
- Go past the budgets: two messages of questions, no reviewer rule unasked, no script rule without its quote.
- Commit or push unasked.
- Write into `law.yaml` or `.lawcheck/rules/` anything the user has not said yes to, apart from what holds today with zero findings.

## If it goes wrong

- The measurement prints `type-overlap`: two types of one level take the same file. Narrow one of them with a `!` pattern ([Types for an existing project](types-for-a-project.md)).
- Every row is `no type:`: the types take too few files. Run `lawcheck explain .` and give the files a type.
- The table shows no row, but you expected some: the uses are unresolved, or the files are in a language with no reader. The last line of the table and the `not read:` lines say which.
- `lawcheck doctor` notes no base: the repository has no `origin/HEAD`. Use `--base HEAD` as this page does, and tell the user that CI needs a base ([CI and git hooks](ci.md)).

Next: [Lawcheck in Claude Code](claude-code.md)
