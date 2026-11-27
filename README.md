# Lawcheck

[![Claude Code imports the HTTP handlers into the business logic, and the tests pass. Lawcheck names the line. With the same prompt, the law and the plugin, the agent keeps the layers apart.](https://github.com/krzysztofdudek/Lawcheck/releases/download/v0.1.0-alpha.6/loop.gif)](https://lawcheck.dev)

Lawcheck checks every edit your coding agent makes against the architecture rules you write down. It runs after each edit, at the end of the agent's turn and in CI, with one law for twelve languages. It is free and open source under the MIT license, and it runs on your machine. It calls an AI model only for a rule written in prose, and only when you run `lawcheck check --review`, through a provider you pick and pay for yourself, or a local Ollama.

## Why not `CLAUDE.md` or your linter

You can write a rule such as "the business logic must not import the HTTP layer" in three places:

- `CLAUDE.md` or `AGENTS.md`. The agent reads the rule, and nothing checks the code against it. On 2026-11-24, the issues page of Claude Code showed 204 issues for [the query "ignores CLAUDE.md" is:issue created:<=2026-11-24](https://github.com/anthropics/claude-code/issues?q=%22ignores+CLAUDE.md%22+is%3Aissue+created%3A%3C%3D2026-11-24).
- Your linter. eslint-plugin-boundaries, import-linter or ArchUnit holds the rule for one language and runs in CI. Inside the agent's turn it runs only through a hook you write.
- The law of Lawcheck. One file holds the rule for TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C, C++, PHP and Ruby. The plugin checks each file the agent edits and hands the agent the file and line. Before the turn ends it checks again, and it sends the agent back, up to three times, while the code breaks the law. A CI job checks the same law with no key and no network.

## A law, a rule and a finding

The law is a file in the repository. It names the kinds of files, which kind may use which, and the rules each kind keeps:

```yaml
lawcheck: 0.1.0

rules:
  no-clock:
    why: The core takes the time as an argument.

types:
  api:
    about: The HTTP handlers.
    paths: ["src/api/**"]
  core:
    about: The business logic.
    paths: ["src/core/**"]
    may_use: [core]
    rules: [no-clock]
```

A script rule is a JavaScript file in `.lawcheck/rules/`. This one, `no-clock.mjs`, returns a finding for each line that reads the clock:

```js
export function check({ files: [file] }) {
  const findings = [];
  file.lines.forEach((text, i) => {
    if (/\bDate\.now\(|\bnew Date\(\)/.test(text)) {
      findings.push({ line: i + 1, message: 'reads the clock' });
    }
  });
  return findings;
}
```

An import of a handler into the business logic fails the check, and so does a read of the clock:

```text
$ lawcheck check src/core/discount.ts
lawcheck: FAIL  2 errors in 1 named file

src/core/discount.ts:1  error[forbidden-use]  core may not use api (src/api/orders.ts); its may_use is [core]
  why:  a type's may_use names every type its files may use
src/core/discount.ts:4  error[no-clock]  reads the clock
  why:  The core takes the time as an argument.

next: fix src/core/discount.ts:1
```

## What I measured

I build software with coding agents, and I read their code only where a mistake costs a lot or I cannot undo it. In the code I do not read, an agent can skip a rule in `CLAUDE.md`. I have enforced rules of this kind on every change in real client work for many months, with [Yggdrasil](https://github.com/krzysztofdudek/Yggdrasil), an older tool of mine.

On 2026-11-23 I gave Claude Code the same prompt in 80 sessions of a small shop repository. In 20 of them no rule was written anywhere, and the agent made the business logic import from the HTTP handlers in 8. In each of the 8, all 10 tests passed ([one of the changes](film/takes/a09/change.diff)). In the 60 sessions with the law and the plugin, it did that in none. That was one prompt, one repository and one model, and [film/pilot.json](film/pilot.json) lists every session. I did not run sessions with the rule only in `CLAUDE.md`, so the pilot does not compare the two. It measured that one breach of the layers, and no other kind of rule.

## Try it

Lawcheck is an alpha. It needs Node 24 or later and git 2.34 or later.

```text
npm install --global lawcheck@alpha
lawcheck init
claude plugin marketplace add krzysztofdudek/Lawcheck
claude plugin install lawcheck@lawcheck-marketplace
```

`lawcheck init` creates an empty law, `.lawcheck/law.yaml`, at the root of your repository. Then you describe your folders as types in it: `lawcheck docs quick-start` walks you to a first finding with no model and no key. After you install the plugin, start a new agent session, so the agent gets the law.

In your own repository, your agent can write the first law. Type `/lawcheck:setup` in Claude Code (`$lawcheck:setup` in Codex). It starts from the rules in your `CLAUDE.md`, `AGENTS.md` and linter config, and asks you before it forbids a use the code already makes. It changes nothing outside `.lawcheck/`, except a CI job you ask for.

Codex and GitHub Copilot CLI install the same plugin with their own two commands: `lawcheck docs codex-cli` and `lawcheck docs copilot-cli`. Any other agent gets one line in its instructions file, `Run lawcheck prime at the start of every session and follow it.`, and then nothing sends it back. The hooks are plain scripts in [plugin/hooks](plugin/hooks), and `lawcheck docs plugin` says what each one does. A script rule is your repository's own code: it can read every file under the root, and it cannot open a network connection.

## In CI

`lawcheck check --base origin/main` judges the files a branch changes, so people see findings only about what they change. When you run `--review`, Lawcheck records the verdicts of the rules written in prose in `.lawcheck/verdicts`. The branch commits that file, so the CI job calls no model, unless you set it up to review. `lawcheck docs ci` has the whole job.

## One law holds uses, rules, debt and waivers

- Uses. Lawcheck reads imports and other uses in twelve languages: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C, C++, PHP and Ruby. A use that Lawcheck resolves to a file `may_use` does not allow is a finding. A use that Lawcheck cannot pin to one file is a finding only when `may_use` forbids every file it could name. A form of use that no reader reads gives no finding and no count, and Limits names some.
- Script rules. A rule is a JavaScript module that gets one file at a time and returns findings, each with its line when it has one. It can read the file's syntax tree in each of the twelve languages, so it holds what an import boundary cannot say, such as `fetch` called only in the API layer. [Write the first one](docs/first-law.md).
- Rules written in prose. A model judges a rule written in prose, one file at a time. Lawcheck records each pass under a hash of what the model read, the file, the rule and its context files among them. A later check reads that pass in place of a call, and a change to any of them calls for a new review. You pick one of nine providers: `anthropic`, `openai`, `google`, `openai-compatible`, a local `ollama`, or the `claude-code`, `codex`, `gemini-cli` and `copilot-cli` programs with their own sign-in.
- Debt. `check` judges the files a change touches. `--full` is a deliberate audit of the whole code, run on purpose, and lists the older breaches as debt. Debt is a warning and does not fail the run, unless you pass `--strict`.
- Waivers. `lawcheck-waive <rule> -- <reason>` drops one rule on one line, and the reason stays in the code. `check` prints a note on a change that adds a waiver or edits the law. Each note names up to five items and counts the rest, and `--json` lists them all. The plugin tells you at the end of a turn in which the agent added a waiver or changed the law.

## Limits

- After three returns the plugin lets the agent finish and tells you that the check still fails.
- A pull request can edit its own law. In CI, your team chooses which law judges it: the change's own, the base's or both (`lawcheck docs ci`).
- Lawcheck does not read every form of use. It misses an `import()` of a variable, `importlib.import_module`, reflection, and a Java call written by its full name with no import, such as `com.shop.Util.run()`. It neither judges nor counts a use it does not read. `lawcheck docs languages` lists the forms for each language.

## More

The documentation is at https://docs.lawcheck.dev and in the terminal: `lawcheck docs`. Lawcheck's own law is in [.lawcheck/](.lawcheck): 10 rules over 20 types, and `npm test` checks the code against it. [The contributing guide](CONTRIBUTING.md) says how to report a bug, and [the security policy](SECURITY.md) how to report a vulnerability privately.
