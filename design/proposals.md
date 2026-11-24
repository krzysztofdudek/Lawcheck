# Proposals

Each section is a gap in the law that a finding named, where the fix changes what a user writes or runs. It says what a user meets today, the options with what each costs a user, and the recommendation. The owner chooses; the choice then becomes an entry of [decisions.md](decisions.md) and its section leaves this file.

## Which outside modules a type may import

Finding T1.

`may_use` lists types of the repository. A use that the readers count as outside the repository, such as `import { readFileSync } from 'node:fs'` or an installed package, is never judged: `judgeUses` in `src/uses.ts` skips it, and `answerOf` in `src/readers.ts` keeps no name for it. A script rule's `file.uses()` gives it as `kind: 'outside'` with no other key. So a law cannot say that `core` imports nothing of `node:fs`, or that only the database adapter imports `pg`. Lawcheck's own law says it with a script rule, `.lawcheck/rules/layer-imports.mjs`, which reads import lines with a regular expression and keeps a table of what each type may import from outside.

Each option starts with the same step: the readers keep the name of an outside use. In TypeScript and JavaScript the name is the import's specifier (`node:fs`, `@aws-sdk/client-s3`), in Python the module, in Go the import path, in Rust the crate, in C and C++ the header. In Java, Kotlin, C# and PHP an outside use can be a simple name that only an import of a whole package gives (`List` under `import java.util.*;`), so its name is that import.

### A. A key `may_use_outside` on a type

```yaml
core:
  paths: ["src/core/**"]
  may_use: [core]
  may_use_outside: [yaml, "node:crypto"]
```

The key lists names, and `*` in a name matches any run of characters (`node:*`, `@aws-sdk/*`). A type without the key takes the list of the nearest type above it, as with `may_use`. With no list in force, no outside use is judged, as today. With one, an outside use whose name no entry matches is `forbidden-use`, such as `core may not use node:fs, which is outside the repository; its may_use_outside is [yaml, node:crypto]`. `prime` and `explain` print the list next to `may_use`.

What it costs a user: one more key in the law. Each name is written in the form its language's reader gives, so `docs/languages.md` needs a table of those forms. A package used through subpaths needs two entries, such as `lodash` and `lodash/*`. A law without the key works as before. Every earlier Lawcheck stops with `law-invalid` on a law that uses the key, since it refuses a key of a type it does not know (`TYPE_KEYS` in `src/law.ts`), so a team moves each machine and its CI to the new version before it writes the key. An entry cannot take a name out of a pattern: a type that may import every `node:` module but `node:child_process` lists the others one by one.

### B. Named groups of outside modules in `may_use`

```yaml
outside:
  disk: ["node:fs", "node:fs/*"]
types:
  adapters:
    may_use: [adapters, core, disk]
```

A top-level key `outside` names groups of outside modules, and `may_use` lists a group's id next to the type ids. An outside use is judged only when a group takes its name. A use that no group takes stays free.

What it costs a user: one list holds both kinds of use, and a group written once serves every type. A team can only guard doors it names, though. To say that `core` imports nothing from outside but `yaml`, it needs a group `everything: ["*"]` and a rule for which group takes a name that two groups match. Group ids and type ids share one set of names. As with A, every earlier Lawcheck stops with `law-invalid` on a law that uses the key `outside` (`TOP_KEYS` in `src/law.ts`).

### C. No new key: the name reaches script rules

`file.uses()` gives `what` on an outside use, and a docs page gives a script rule of about ten lines that holds the allowed names of each type.

What it costs a user: every team writes and keeps that rule, and its messages. `prime` does not show the list, so an agent learns it only from a failed check.

### Recommendation

A, built after alpha.5. An agent reads the list at the start of a session through `prime`, before it writes the import, and a breach is the same `forbidden-use` that a wrong use of a type gives. The rows of Lawcheck's own rule `layer-imports` then become lists in the law. Its doors stay in a script rule: a door says that only one file of `src` imports a module, such as `node:child_process` in `src/adapters/processes.ts`, and a list of A can say it only by naming every other `node:` module in place of `node:*`.

## A change judged by the law of its base

Findings T7 and R-10.

`check` reads `.lawcheck/` from the work tree, so a change that edits the law is judged by the law it carries. A commit that takes `no-console` off a type and adds `console.log` passes and prints `note: this change edits the law that judges it: takes the rule no-console off the type library` (decision 78, `src/lawchange.ts`). The section "A change to the law" of `docs/ci.md` gives a CI step that checks a second time with the base's law. It removes `.lawcheck/rules`, checks out the base's `law.yaml` and rules, and runs `check` again. The step changes the checkout, so it suits a CI job. A git hook and a local run judge by the branch's law, as the same page says.

In Lawcheck's own repository the suite guard already answers R-10. Any change under `.lawcheck/` is the kind `law-changed` (`paths.law` in `tests/guard/config.json`), so it lands only with a row in `tests/weakenings.md` that a fresh reviewer approves. The test `R-10` in `tests/acceptance/self-law.test.ts` takes the rules off a type and breaks them in the same commit: the check passes, and the guard refuses the commit until the row is there. That part needs no choice. What is left is an answer of the tool for every repository.

### A. `check --law-from <ref>`

Lawcheck reads `law.yaml`, `config.yaml` and the rules from that commit through git, as `src/lawchange.ts` already reads the base's law to name a change of the law. It writes the rules into `.lawcheck/.local/`, so the runner loads them inside the root and the promise I-runner-1 holds, and it judges the work tree with them. Nothing in the checkout changes. The second check of the CI step becomes one line, `lawcheck check --base "$base" --law-from "$base"`, and a pre-push hook can run the same line.

What it costs a user: one more option to learn. A rule of the base still reads the branch's copy of every file outside `.lawcheck/`, as the CI step does today. The verdicts come from the work tree, and a pass is keyed by the rule's text, so a pass recorded under the branch's text of a reviewer rule does not count for the base's text.

### B. A change that edits the law is judged by both laws

When the change touches `.lawcheck/`, `check` also judges it with the base's law, and a finding of that law fails the run.

What it costs a user: nothing to learn, and a hook catches it too. A change that loosens a rule and uses the room it made fails everywhere, so the change of the law must land first, on its own, as `docs/ci.md` advises today. A team that grows its law together with its code meets that failure on every such change, and each of those runs judges the change twice.

### C. Keep the note and the CI step

A decision records that the note says it and the CI step catches it.

What it costs a user: every team copies the shell lines of the step, and a hook or a local run never catches a loosened law.

### Recommendation

A, built after alpha.5. Today's default stays, so no change that edits the law and the code together starts to fail. One option replaces shell lines that change the checkout, and a hook can use it.

### Built

The owner chose A for alpha.5. It is built as `check --law-from <ref>`, and the workflow of `docs/ci.md` uses it. The decision "A change judged by the law of its base" in `design/decisions.md` records what a rule of the commit reads and the errors of the option.
