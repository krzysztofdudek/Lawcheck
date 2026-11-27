# Lawcheck

Write your architecture rules once, and stop reading your agent's code to enforce them. Lawcheck holds your coding agent to your rules while it writes, before it ends its turn, and in CI. The structure stays as you agreed, so what is left for you to check is behaviour, and your tests do that. I work this way: the less of the agent's code I read, the sooner I deliver to my clients. One law reads imports and other uses in twelve languages. It is free and open source under the [MIT license](LICENSE), and it runs on your machine. It calls an AI model only for a rule written in prose, and only when you run `lawcheck check --review`. You pick the provider and pay for it yourself, or run a local Ollama.

## Why not `CLAUDE.md` or your linter

You can write a rule such as "the business logic must not import the HTTP layer" in three places:

- `CLAUDE.md` or `AGENTS.md`. The agent reads the rule. Nothing checks the code against it, so you do, by reading the code.
- Your linter. eslint-plugin-boundaries, import-linter or ArchUnit hold the rule for one language, in CI. Inside the agent's turn they run only through a hook you write yourself.
- The law of Lawcheck. One file holds the rule for TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C, C++, PHP and Ruby. The plugin checks each file the agent edits and hands it the file and line. Before the turn ends it checks again, and sends the agent back, up to three times, until the code keeps the law. CI checks the same law, with no key and no network.

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

## How I work

I build software with coding agents, and I read their code only where a mistake costs a lot or cannot be undone. In the rest of the code the rules hold the structure, and the tests check the behaviour. I have worked this way in real client work for many months, with [Yggdrasil](https://github.com/krzysztofdudek/Yggdrasil), an older tool of mine.

Without a rule that is checked, an agent breaks it quietly. In a small pilot, 8 of 20 Claude Code sessions with no rule written down made the business logic import the HTTP handlers, and all 10 tests still passed ([one of the changes](film/takes/a09/change.diff)).

## Try it

Lawcheck needs Node 24 or later and git 2.34 or later.

1. Install the tool: `npm install --global lawcheck`.
2. Add the plugin to your agent, then start a new agent session: `claude plugin marketplace add krzysztofdudek/Lawcheck` and `claude plugin install lawcheck@lawcheck-marketplace`.
3. Create the law at the root of your repository: `lawcheck init` creates an empty `.lawcheck/law.yaml`. Then type `/lawcheck:setup` in Claude Code (`$lawcheck:setup` in Codex), and the agent describes your folders as types. It starts from the rules in your `CLAUDE.md`, `AGENTS.md` and linter config, asks you before it forbids a use the code already makes, and changes nothing outside `.lawcheck/`. To practise first on a new repository with no agent, `lawcheck docs quick-start` walks you to a finding by hand.
4. Check: `lawcheck check --base main`. It judges the files your branch changed, and `lawcheck check --full` lists older breaches as debt that does not fail the run. If your code already keeps the law, the check passes; to see a finding, import a file the law forbids, such as an HTTP handler into the business logic. None of this needs a model or a key.

Codex and GitHub Copilot CLI install the same plugin with their own two commands: `lawcheck docs codex-cli` and `lawcheck docs copilot-cli`. Any other agent gets one line in its instructions file, `Run lawcheck prime at the start of every session and follow it.`, and then nothing sends it back. The hooks are plain scripts in [plugin/hooks](plugin/hooks), and `lawcheck docs plugin` says what each one does. A script rule is your repository's own code: it can read every file under the root, and it cannot open a network connection.

## In CI

`lawcheck check --base origin/main` judges the files a branch changes, so people see findings only about what they changed. The verdicts of rules written in prose are saved in `.lawcheck/verdicts` when you review, and the branch commits them, so the CI job calls no model unless you set it up to review. `lawcheck docs ci` has the whole job.

## One law holds uses, rules, debt and waivers

- Uses. Lawcheck reads imports and other uses in twelve languages: TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C, C++, PHP and Ruby. A use of a file that `may_use` does not allow is a finding. A use that could name several files is a finding only when `may_use` forbids all of them.
- Script rules. A rule is a JavaScript module that gets one file at a time and returns findings, each with its line when it has one. It can read the file's syntax tree in each of the twelve languages, so it holds what an import boundary cannot say, such as `fetch` called only in the API layer. [Write the first one](docs/first-law.md).
- Rules written in prose. A model judges them, one file at a time, and Lawcheck saves each pass. A later check reads the saved pass instead of calling the model, until the file or the rule changes. You pick one of nine providers: `anthropic`, `openai`, `google`, `openai-compatible`, a local `ollama`, or the `claude-code`, `codex`, `gemini-cli` and `copilot-cli` programs with their own sign-in.
- Debt. `check` judges the files a change touches. `--full` audits the whole code and lists older breaches as debt, which does not fail the run unless you pass `--strict`.
- Waivers. `lawcheck-waive <rule> -- <reason>` drops one rule on one line, and the reason stays in the code. `check` notes every change that adds a waiver or edits the law, and the plugin tells you when the agent did either.

## Limits

- After three returns the plugin lets the agent finish and tells you that the check still fails.
- A file the agent writes through the shell, not its edit tool, is checked before the agent finishes, not right after it is written.
- A pull request can edit its own law. In CI, your team chooses which law judges it: the change's own, the base's or both (`lawcheck docs ci`).
- Lawcheck does not read every form of use. It misses an `import()` of a variable, `importlib.import_module`, reflection, and a Java call written by its full name with no import, such as `com.shop.Util.run()`. It neither judges nor counts a use it does not read. `lawcheck docs languages` lists the forms for each language.

## More

The documentation is at https://docs.lawcheck.dev and in the terminal: `lawcheck docs`. Lawcheck's own law is in [.lawcheck/](.lawcheck): 10 rules over 20 types, and `npm test` checks the code against it. [The contributing guide](CONTRIBUTING.md) says how to report a bug, and [the security policy](SECURITY.md) how to report a vulnerability privately.
