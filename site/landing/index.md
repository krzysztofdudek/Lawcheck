---
title: "Lawcheck: architecture and rule checks for coding agents"
summary: "Write your architecture rules once, and stop reading your agent's code to enforce them. Lawcheck checks them in the hooks of coding agents and in CI."
skip: Skip to content
heroNote: "The animation shows real output of Lawcheck 0.1.0 on a sample repository. The agent's code in it is an example."
facts:
  - { label: When it checks, text: "While the agent writes code, again before it finishes, and in CI." }
  - { label: Where, text: "One law reads imports and other uses in twelve languages, from TypeScript and Python to Go and Java. Limits names the forms it misses." }
  - { label: Price, text: "Free and open source under the MIT license. It runs on your machine." }
  - { label: AI model, text: "Only for rules written in prose, when you run `--review`, through a provider you pick and pay for, or a local Ollama." }
why:
  heading: "Three places can state a rule. One checks it inside the agent's turn."
  head: ["`CLAUDE.md` or `AGENTS.md`", "Your linter", "The law of Lawcheck"]
  rows:
    - { label: States the rule, cells: [{ pro: The agent reads it }, { pro: For one language }, { pro: "For twelve languages, in one file" }] }
    - { label: Checks while the agent works, cells: [{ con: Claude Code does not check the code against it }, { con: "Only through a hook you write; the Lawcheck plugin is such a hook" }, { pro: "While it writes code, and before it finishes it sends the agent back, up to three times" }] }
    - { label: Checks in CI, cells: [{ con: "No" }, { pro: "Yes" }, { pro: "Yes, with no key and no network unless you set it up to review" }] }
  note: "Linters named in the docs: eslint-plugin-boundaries, import-linter, ArchUnit and others ({link})."
  link: { text: the whole comparison, page: other-tools }
law:
  heading: You write the law. Lawcheck names the line that breaks it.
  law: { title: The law, file: .lawcheck/law.yaml }
  rule: { title: A script rule, file: .lawcheck/rules/no-clock.mjs }
  finding: { title: A finding, file: terminal }
  hint: Point at an error to see the line of the law it breaks.
try:
  heading: From install to your first check. No model, no key.
  install: Install the tool
  plugin: Add the plugin to your agent, then start a new agent session
  agents: { claude: Claude Code, codex: Codex, copilot: Copilot CLI, other: Another agent }
  notes:
    claude: The plugin gives the agent the law when a session starts.
    codex: "Codex runs the hooks of a plugin after you trust them in /hooks."
    copilot: Copilot CLI checks before the agent ends its turn.
    other: Any other agent gets one line in its instructions file, and then nothing sends it back.
  law: "Create the law: your agent describes your folders as types"
  lawCommands: ["lawcheck init", "/lawcheck:setup"]
  lawNote: "`lawcheck init` creates an empty law. Then type `/lawcheck:setup` to your agent (`$lawcheck:setup` in Codex). It starts from your `CLAUDE.md`, `AGENTS.md` and linter config, asks before it forbids a use the code already makes, and changes nothing outside `.lawcheck/`. To practise by hand on a new repository first: `lawcheck docs quick-start`."
  check: Check
  checkCommand: lawcheck check --base main
  hooks: "The hooks are plain scripts in [plugin/hooks](https://github.com/krzysztofdudek/Lawcheck/tree/main/plugin/hooks)."
  checkNote: "It judges the files your branch changed; `lawcheck check --full` lists older breaches as debt that does not fail the run. If your code already keeps the law, the check passes: to see a finding, import a file the law forbids, such as an HTTP handler into the business logic."
ci:
  heading: The same law stops the pull request.
  command: lawcheck check --base origin/main
  note: "It judges the files a branch changes, so people see findings only about what they change. Verdicts of the rules in prose are committed in `.lawcheck/verdicts`, so the job calls no model, unless you set it up to review. {link}."
  link: { text: The whole job, page: ci }
  check: lawcheck
  output: ["lawcheck: FAIL  1 error in 2 changed files (against origin/main)", "src/core/discount.ts:1  error[forbidden-use]  core may not use api (src/api/orders.ts); its may_use is [core]"]
holds:
  kicker: One law holds
  heading: Uses, rules, debt and waivers.
  cards:
    - { title: Uses, text: "Imports and other uses in twelve languages. A use `may_use` forbids is a finding.", page: languages }
    - { title: Script rules, text: "A JavaScript file that gets one file and returns findings. It can read the syntax tree.", page: script-rules }
    - { title: Rules in prose, text: "A model you pick judges them on `--review`. A recorded verdict saves the next call.", page: reviewer-rules }
    - { title: Debt, text: "A check judges the change. `--full` lists older breaches as debt, which does not fail the run.", page: adopt-in-an-existing-repository }
    - { title: Waivers, text: "One rule off on one line, with the reason in the code. The plugin tells you when the agent adds one.", page: waivers }
measured:
  before: "In a small pilot, with no rule written down, Claude Code made the business logic import the HTTP handlers in"
  count: 8 of 20
  after: "sessions, and all 10 tests still passed."
tutorial:
  kicker: The tutorial
  heading: "{count} chapters, each a real session."
  chapter: "Chapter {n}"
  titles:
    quick-start: Quick start
    forbid-a-use: Forbid a use
    write-a-script-rule: Write a script rule
    write-a-reviewer-rule: Write a rule in prose
    ci: CI
limits:
  heading: What it does not do.
  items:
    - "A pull request can edit its own law. In CI, your team chooses which law judges it: the change's own, the base's or both."
    - "Lawcheck does not read every form of use. It misses an `import()` of a variable, `importlib.import_module`, reflection, and a Java call written by its full name with no import. {link}."
  link: { text: The forms for each language, page: languages }
footer:
  license: MIT license
  ahead: "This page already describes the next release. The changelog lists under Unreleased what {version} does not have."
  docs: { text: Documentation, page: index }
  github: GitHub
  npm: npm
  author: Made by Krzysztof Dudek
copy: Copy
copied: Copied
notFound:
  heading: This address has no page.
  text: The documentation is at docs.lawcheck.dev.
  docs: { text: Documentation, page: index }
  home: Lawcheck home
---
