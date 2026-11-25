# Let a coding agent write the first law

Your coding agent can write the first [law](concepts.md#law) of your repository. It asks you before it forbids a [use](concepts.md#use) that the code already makes. Tell your coding agent: "Run `lawcheck docs agent-setup` and follow it." With the plugin for [Claude Code](plugin.md#the-setup-skill) or [Copilot CLI](copilot-cli.md#_7-write-the-first-law), type `/lawcheck:setup` to start the setup skill. With the plugin for [Codex](codex-cli.md#_7-write-the-first-law), type `$lawcheck:setup`. The agent does not start the skill by itself. The agent describes the folders of your repository as [types](concepts.md#type). It writes down which type uses which today. It changes only `.lawcheck/` and commits nothing. It ends with a law that `lawcheck check` passes, and with a count of the old code that breaks that law. Advice on the architecture, and a target architecture with a plan to reach it, come only with the setup skill that the plugins for Claude Code, Codex and Copilot CLI carry ([The setup skill](plugin.md#the-setup-skill)).

The rest of this page is for the agent. Do the steps in order. The parts below the steps hold what several steps use, under fixed headings.

The outputs below come from a repository with five files:

- `src/api/orders.ts` imports `src/core/price.ts` and `src/db/orders.ts`;
- `src/api/refunds.ts` imports `src/core/price.ts`;
- `src/core/price.ts` imports nothing;
- `src/core/report.ts` imports `src/api/orders.ts`;
- `src/db/orders.ts` imports `src/core/price.ts`.

## 1. Before anything

Run `lawcheck --version` and `lawcheck prime`. When the shell finds no `lawcheck`, tell the user to install it with `npm install --global lawcheck@alpha`, and stop. When `prime` prints a law, a law already governs this folder: do not start a second one. Tell the user that the law stands and that `lawcheck prime` says how to change it, and stop.

Change no file outside `.lawcheck/`. Commit nothing unless the user asks.

The shell commands of this page are for a POSIX shell, such as bash. On Windows, run them in Git Bash or WSL, not in PowerShell: PowerShell has no `cmp`, and its `cp` is another command.

This page runs `lawcheck check --full` to prove a candidate law and to count the old code that breaks it. Each such run is a deliberate audit of the whole code, run on purpose during this setup. It is no step for each later change, and no step of CI. CI judges only the change on purpose, so that people see findings only about what they change.

Keep to the budgets of this page: at most four questions to the user, and no [reviewer rule](concepts.md#reviewer-rule) unless the user asks for one. Script rules have no fixed number. Each one needs its evidence, as step 8 says.

## 2. Read what is written down

Read the README, the instruction files for agents (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules`, `.github/copilot-instructions.md`), architecture documents and decision records. Look for a tool that the repository already runs to check which code may use which: `eslint-plugin-boundaries` or `no-restricted-imports` in an ESLint config, `dependency-cruiser`, the tags of `nx.json`, `import-linter`, ArchUnit tests, `deptrac`, `packwerk`, `go-arch-lint`. One search over `git ls-files` finds most of them.

List each rule someone already wrote about which code may use which, or about what files must or must not do, with its file and line. The team has already decided these rules, so they are the first candidates in step 7 and step 8.

## 3. Choose the root

Put one law at the top of the repository. A rule between two packages works only when one law covers both. Read the workspace files to learn the packages: `workspaces` in `package.json`, `pnpm-workspace.yaml`, `go.work`, a Cargo workspace, `settings.gradle`, a `.sln`. Put a law in a package only when the user says that the packages of the repository have separate owners. Then tell the user what that costs. A check at the top of the repository stops with `not-initialized`. No restriction crosses between packages ([A monorepo](monorepo.md)).

## 4. Describe the files as types

Run `lawcheck init`, then write the types into `.lawcheck/law.yaml`:

- Take the names from the folders, the README and the instruction files, never from a textbook. A pattern's name, such as "hexagonal" or "clean architecture", is no reason for a type.
- Write at most twelve types at the top. Each one is a folder, or a kind of file, that the repository already sets apart. A small library with its code in one folder gets two or three types, such as the code and its tests. A repository of several parts, such as a backend and a frontend, gets a type at the top for each part. Inside a part, each folder whose files do one job gets a subtype, such as the routes, the models and the data access. Do not stop at one type per part, because step 5 measures the uses between those folders.
- Give each type one `about` sentence that says what its files do. Read two or three of its files first, so the sentence is true of them.
- Decide yourself for tests, generated code, vendored code and build scripts: a type of its own, or no type and why. Say each decision in the summary.
- Generated or vendored code inside a code folder, that no typed code uses, goes under `ignored`, so no type takes it. Name each pattern of `ignored` to the user ([The law file](law.md#ignored)). `ignored` holds nothing else.
- Generated or vendored code that typed code uses gets a type of its own, with no `may_use` list, and never a place under `ignored`. A `may_use` list can never allow a file with no type, so each use of such a file from a type with a list is a `forbidden-use`. Search the typed code for imports of each generated or vendored folder before you decide.
- Put the code files under `required`, by folder and extension, such as `src/**/*.ts`. A code file in a new folder there is then `untyped-file` until a type takes it ([The law file](law.md#required)). The law starts with no `untyped-file` finding, so a stylesheet or a JSON file that no type takes stays out of `required`. Put a folder under `required` only when a type takes a new file there by a pattern, such as `src/api/**`. A type that names single files takes no new file. A new file beside those files would be `untyped-file`, and no type could take it. Leave that folder out of `required`, or give the folder a type whose paths take it.
- A file that a parent type takes, and that other types use, gets a subtype of its own. A `may_use` list that names a parent allows every subtype below it. Naming the parent to allow that one file would open the whole parent.

Check how many files have a type with `lawcheck explain .`, in every run. At least nine in ten files of the languages Lawcheck reads have a type ([Languages and uses](languages.md)). Name each file left without a type in the summary.

## 5. Measure the uses between types

Do this step in every run, even where you think you know the uses: the table is the evidence for steps 6 and 7. Write the candidate, a law whose findings you count without keeping it. The candidate is the law of step 4, with a `may_use` list on every type, subtypes included, that names only the type itself. Measure it as [Measure a law that is not in force](#measure-a-law-that-is-not-in-force) says. Each row of the output is one pair of types, with the files and uses that cross between them. This table is the architecture the code has today.

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

Give each type a `may_use` list that names the type itself and every type that its rows of the table reach. This law has no `forbidden-use` finding. It already forbids every use between types that the code does not make today. Write it into `.lawcheck/law.yaml`. Then `lawcheck check --full --base HEAD` lists no `forbidden-use`.

- A row to `no type:` names a file that a type of this law uses and that no type takes. Give that file a type in step 4. A list can never allow a file without a type.
- A type whose list would name every other type, such as the tests or the entry point that wires the program, keeps no list. Say so in the summary.
- A parent type with no list restricts no file that only the parent takes: a new file in its folder, outside the folders of its subtypes, passes unchecked, even when the subtypes have lists. Name each parent with no list in the summary, and say that what its own files may use is open.
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

## 7. Find what could be tighter, with evidence

A use is a candidate to forbid only when the code or its documents give a reason. There are four kinds of reason:

- `written`: a rule of step 2 forbids it;
- `direction`: it goes against the main direction between two types, such as 40 files one way and 2 the other;
- `cycle`: two types use each other;
- `few`: three files or fewer make it.

In the example, `core -> api` is a `cycle` with `api -> core`, and it is `few`: one file of `core` makes it, where two files of `api` use `core`.

For each candidate, take its files and lines from the table, and the three ways of [A boundary the code already breaks](#a-boundary-the-code-already-breaks). Pick at most four candidates, in this order: `written`, then `cycle`, `direction` and `few`. Pick at most three when step 8 leaves rules with findings, because those rules share one question. Each candidate you pick is a question for the user in step 10. The user decides whether the code keeps that use, not you. Put the rest in the summary under "could be tightened later", one line each. Never propose a boundary that has no reason in the code and no word from the user.

## 8. Write the rules

Write a [script rule](script-rules.md) for each rule that has evidence, and for no other. The evidence is one of two things. One is a rule of step 2 that a script can judge, such as "no `console.log` in the core". The other is a convention that every file the rule would bind keeps today. A written rule counts whether or not the code keeps it today, and its findings go to the question of step 10. Only a convention needs every file to keep it. Never invent a rule. The law with its rules must still fit `lawcheck prime` unshortened. Write each rule in `.lawcheck/rules/<id>.mjs`, with its entry and `why` under `rules` in the law. Then put its id in the `rules` of every type whose files it judges. A rule that no type lists judges no file.

- A rule about code, such as a call, an import or a construct, reads the file's syntax tree with `await file.tree()` ([Script rules](script-rules.md#the-syntax-tree)). In the tree, a call is a node of its own. The same word in a comment or a string is not a call. So the rule reports nothing for that word in a comment or a string. Before you write a rule that reads the syntax tree, run `lawcheck explain <path> --tree` on a real file of that language, and write the rule from the node types and fields it prints, since they differ between languages.
- A rule about text, such as a header or a licence line, may read `file.lines`.
- A file in a language with no reader has no tree, so a rule about code reports nothing there. Say so in the summary.

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

Add no [reviewer rule](reviewer-rules.md). Each file it judges costs one model call. Without a reviewer in `.lawcheck/config.yaml`, a [plain check](concepts.md#plain-check) and CI fail with `not-reviewed`. You may offer one reviewer rule as text. Add it only when the user says yes and names the reviewer, because `.lawcheck/config.yaml` is the user's.

## 9. Prove each restriction bites

Do what [Prove each restriction bites](#prove-each-restriction-bites) says, for each list and each rule of the law.

## 10. Explain, and ask

Write one message in plain words. Say what a type is the first time you use the word. Give:

- the types with their file counts;
- who may use whom, as sentences, such as "the database code may use the core and nothing else";
- each rule with its reason;
- the debt: how many findings `lawcheck check --full --base HEAD` lists outside the change;
- what Lawcheck does not check here: the unresolved uses per language, the languages with no reader, the files with no type, the parent types with no list;
- the open decisions of steps 7 and 8, numbered. Each boundary gets a question of its own, and all the rules with findings share one question. Each question gives its options and what each option changes. A boundary question offers the three ways of [A boundary the code already breaks](#a-boundary-the-code-already-breaks), never only yes or no.

Ask all the questions in that one message, as its last part, with no next step and no offer after them. End your turn, and wait for the answers. A session started with a prompt, such as `claude -p`, has a person too, who answers in the next prompt. Apply each answer as [A boundary the code already breaks](#a-boundary-the-code-already-breaks) says. Prove each new restriction as in step 9. The way "keep it allowed" leaves the law as it is, and puts the candidate under "could be tightened later". With no candidate from step 7 and no question from step 8, skip the questions and go to step 11. The user may say that no one will answer. Only then, add what holds with zero findings, and list each question in the final message.

## 11. Finish

Check that all four hold:

- `lawcheck check --full --base HEAD` exits 0;
- `lawcheck doctor` exits 0;
- `git status --short` lists files under `.lawcheck/` and nothing else;
- the temporary folder of the measurement is deleted, with `rm -r` and its path.

End with one message to the user that stands on its own. Write each part out again, even when an earlier message said it. Never point back to that earlier message. The final message gives:

- what the law holds: how many types and rules, in plain words, and that it lives in `.lawcheck/law.yaml`;
- the debt: the count of findings outside the change, or that there is none;
- what the user decided, and what you decided yourself;
- what Lawcheck does not check here, and the list "could be tightened later";
- one next step: commit `.lawcheck/` in a change of its own.

Do not call the code or the law good or safe. Say what the check holds.

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

- **Keep it allowed.** The list keeps the type it uses, as the code does today. Nothing fails. Nothing stops a new use of the same kind, either. The summary lists it under "could be tightened later".
- **Forbid it now.** Take the type off the list. The files that use it become debt: `lawcheck check --full` lists them, and each one fails the first change that edits it until someone removes the use. Give the count of those files.
- **Make the exception visible.** Give the files that break the boundary a subtype of their own, with their paths written out. The subtype's `may_use` list still allows the use. Its `about` says that files leave this type and none join it. The rest of the type gets the boundary right away. `lawcheck explain --type <id>` shows how many files are still in the exception.

A fourth way, a waiver on each old use, is in [Bring a law into an existing repository](adopt-in-an-existing-repository.md#bring-in-a-may-use-list). It edits the code, so this procedure never takes it.

A script rule with findings in the old code can start as `status: advisory`: its findings are warnings until the team fixes them ([Bring a law into an existing repository](adopt-in-an-existing-repository.md)).

## Prove each restriction bites

A restriction that never fails proves nothing. For each type with a `may_use` list, write one probe file in that type's folder that uses one type its list does not name. For each rule, write one file that breaks it. Write the probes, check them and delete them in one shell command, so no probe outlives the check:

```text
$ lawcheck check src/db/lawcheck-probe.ts
```

```output
lawcheck: FAIL  1 error in 1 named file

src/db/lawcheck-probe.ts:1  error[forbidden-use]  db may not use api (src/api/orders.ts); its may_use is [db, core]
  why:  a type's may_use names every type its files may use

next: fix src/db/lawcheck-probe.ts:1
```

Each probe must fail with exit 1 and a finding of the expected code or rule. A probe that passes shows a list or a rule that does not hold what you meant. Fix the law, then try again. A probe is always a new file: never edit a file of the repository for a probe, not even for a moment. Two kinds of type get no probe: a type whose paths take no new file, such as a type of one named file, and a type whose list names every type it could use. The summary names each type with no probe.

## Never

- Edit the code, or add a waiver.
- Move a file into `ignored`, or out of its type, to avoid a finding. `ignored` is only for generated or vendored code that no typed code uses, and you name each of its patterns to the user. The exception subtype that the user chose in step 10 is not "out of its type": it is a subtype, and the rules of its parent still bind its files.
- Bind a rule to fewer types than the written rule names, to avoid a finding. Narrowing a rule hides debt that the user should see: bind it to every type it names, and put its findings in the question of step 10.
- Write `.lawcheck/config.yaml` unasked.
- Invent a type, a boundary or a rule that the folders, the documents or the user do not give.
- Go past the budgets: four questions, no reviewer rule unasked, no script rule without its evidence.
- Commit or push unasked.
- Write into `law.yaml` or `.lawcheck/rules/` anything the user has not said yes to, apart from what holds today with zero findings.

## If it goes wrong

- The measurement prints `type-overlap`: two types of one level take the same file. Narrow one of them with a `!` pattern ([Types for an existing project](types-for-a-project.md)).
- Every row is `no type:`: the types take too few files. Run `lawcheck explain .` and give the files a type.
- The table shows no row, but you expected some: the uses are unresolved, or the files are in a language with no reader. The last line of the table and the `not read:` lines say which.
- `lawcheck doctor` notes no base: the repository has no `origin/HEAD`. Use `--base HEAD` as this page does, and tell the user that CI needs a base ([CI and git hooks](ci.md)).

Next: [Lawcheck in Claude Code](claude-code.md)
