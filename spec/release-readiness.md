# Release readiness of the first publish

Checked on 2026-11-13 in the dev container, on the branch `release-ready`, for version 0.1.0, and again on 2026-11-15 on the branch `runes-1-1-0`, after Lawcheck moved to Runes 1.1.0 from npm. Nothing was published, tagged or pushed. Each item is one of three states: ready (true as it stands), fixed here (it was not true, and a commit of this branch made it true, with the check named), or blocked (it needs a decision or an event outside this repository).

## Blocked

| Item | What blocks it |
|---|---|
| The plugin install line against GitHub | `claude plugin marketplace add krzysztofdudek/Lawcheck` reads the default branch of the public repository. It was proved here against this checkout (below), and the GitHub form can be proved only after this branch is on `main` there. That push is the owner's. |
| The decision to publish | The README line "Work in progress: there is nothing to install yet." and the word "Work in progress." in the `description` of `package.json` stay until the owner decides. Text for the day is below. |

## Package

| Item | State | Evidence |
|---|---|---|
| The Runes dependency | fixed here | No longer blocked: `package.json` depends on `@chrisdudek/runes` exactly 1.1.0, and `package-lock.json` resolves it from registry.npmjs.org with its integrity, in place of the GitHub archive of the unreleased commit `b326704`. 1.1.0 moves no grammar pin, patch or runtime peer against that commit, so the 13 grammars and `scripts/grammar-licenses.txt` stay as they are; the package still ships no grammars, so Lawcheck keeps building and shipping them. On 2026-11-15, in a dev container removed and created again (`npm ci`, grammars built): `npm test` gave tests 349, pass 349, fail 0, 288 s; `npm run real` matched both repositories with the numbers of 1.1.0 (`spec/dependency-slice.md`, section 11); `npm pack` gave 59 files, 2.1 MB (24.5 MB unpacked); in an empty folder `npm install <tarball>` (0 vulnerabilities), `lawcheck --version` printed `0.1.0`, and `lawcheck check` on a small repository of three TypeScript files and a two-type law gave its `forbidden-use`, `1 unresolved use` (a missing generated file, `unfollowed`; `node:fs` and `lodash` leave the repository and are not counted) and exit 1. |
| Name `lawcheck` on npm | ready | `npm view lawcheck` shows the name held by the owner's account, version 0.0.0 from 2026-11-12, same repository and description. 0.1.0 is above it. |
| Version number | ready | 0.1.0 in `package.json`, `package-lock.json` and `plugin/.claude-plugin/plugin.json`. Whether 0.1.0 is the number of the first public release is the owner's. |
| Tarball contents | fixed here | `npm pack` held 72 files with the 13 `*.node-types.json` files, which `lawcheck doctor` and a `may_use` check do not read (run with the files deleted from an installed copy). The `files` list now leaves them out: 59 files, 2,134,245 bytes (2.1 MB; 24.5 MB unpacked). It holds `LICENSE`, `README.md`, `package.json`, `dist/*.js`, `dist/providers/*.js`, `docs/*.md` (12 pages), 13 `dist/grammars/*.wasm` and `dist/grammars/LICENSES.txt`. No test, spec, fixture, trial, script, plugin or TypeScript source. Proved by `tests/acceptance/package.test.ts`, which lists the tarball and fails on any other path. |
| Licences of the shipped grammars | ready | `dist/grammars/LICENSES.txt` is `scripts/grammar-licenses.txt`: 13 grammars, each with repository, commit and licence text. The same test checks that every shipped `.wasm` is named in it. |
| `npm pack` on a clean checkout | fixed here | `prepack` ran `npm run build`, which builds the grammars offline, so a fresh `npm ci` followed by `npm pack` stopped with "grammar typescript is not in the cache". `prepack` now runs `npm run grammars` first, which fills the cache from the network and checks every file against its pinned sha256. Proved in a copy of the tree without `node_modules`, `dist` and `.grammars`: `npm ci` then `npm pack` gave the tarball. `npm test` still builds offline. |
| `bin` from the tarball | ready | In a clean folder in the container: `npm init -y`, `npm install <tarball>` (4 packages, 0 vulnerabilities), `npx lawcheck --version` printed `0.1.0`, `npx lawcheck docs law` printed the page. On a small repository (two TypeScript files, one script rule): `init`, `explain`, `try`, `check --full --base main`, `check` and `doctor` ran with the output and exit codes the docs give. |
| Node engine range | ready | `engines.node` is `>=24`, the same as `lawcheck doctor` ("Lawcheck needs 24 or later"), the dev container (Node 24), the plugin's hooks and `docs/ci.md`. Runes asks for 22 or later, which 24 satisfies. |
| The suite | ready | `npm test` in a container removed and created again (`npm ci`, grammars built, then build and tests): tests 349, pass 349, fail 0, 290 s. It found one failure on the way, test 152, which pins the files of `plugin/`; it now expects `plugin/LICENSE`, and `spec/plugin-slice.md` section 4.1 lists the file. |
| Dependencies | ready | `@chrisdudek/runes` 1.1.0 from npm, `web-tree-sitter` 0.27.0, which is also the version Runes 1.1.0 asks for as an optional peer, and `yaml` ^2.9.1. `npm audit --omit=dev` found 0 vulnerabilities. The grammar tools are development dependencies and not in the tarball. |
| Package metadata | fixed here | `homepage`, `bugs` and `keywords` were missing and are added. `license`, `author`, `repository`, `bin` and `type` were present. |
| Licence and copyright | ready | `LICENSE` is MIT, "Copyright (c) 2026 Krzysztof Dudek", matching `license` and `author` of `package.json` and `plugin.json`. The grammars' licences are in the tarball. |

## Plugin

| Item | State | Evidence |
|---|---|---|
| Marketplace manifest | ready | `claude plugin validate .` on the host: "Validation passed". |
| Plugin manifest | ready | `claude plugin validate ./plugin`: "Validation passed", with one warning that the plugin has no icon. The warning belongs to the central plugin directory, not to installing from this marketplace, and an icon is a binary file the repository does not take. |
| Install lines | ready | Against this checkout, in a throwaway Claude Code configuration folder: `claude plugin marketplace add <checkout>` added `lawcheck-marketplace`, and `claude plugin install lawcheck@lawcheck-marketplace` installed version 0.1.0, enabled. The name in the README matches. |
| The two switches | fixed here | The README said they are switched off in `/config`. Claude Code reports them under `/plugin configure lawcheck@lawcheck-marketplace`; `claude plugin configure lawcheck@lawcheck-marketplace --values-stdin` saved one and listed it as set. The README now says so. `spec/plugin-slice.md` (sections 4.3 and 9) said `/config` too and now says the same as the README. |
| Licence in the installed folder | fixed here | Claude Code installs only `plugin/`, which had no licence file. `plugin/LICENSE` is a copy of `LICENSE`. Both validations pass with it. |
| Hooks need the command | ready, with a text for the README | The hooks start `lawcheck` (the default runner `global`) or the runner named in `.lawcheck/config.yaml`. The plugin does not install the tool, so the README must say how to install it. See below. |

## Reviewer providers

Checked on 2026-11-15 on the branch `providers`, after the six providers were added (`spec/questions.md`, entry 73). Every call to a real model is counted here; no address or key entered a file.

| Provider | State | Evidence |
|---|---|---|
| `ollama` | ready, with a limit | Ollama 0.40.16 on another machine, its address given in `LAWCHECK_REVIEWER_ENDPOINT` at run time, model `gemma4:12b-mlx`, from the dev container: 7 calls. `doctor --reviewer` answered its test call twice, in 7 and 2 seconds. `check --review` on R with F gave `src/core/refund.ts:2  error[clear-errors]`, exit 1, in 14 seconds. Two other `check --review` calls, one on F and one on a file that keeps the rule, ended as `reviewer-unreachable` at the 300 seconds of `reviewer.timeout`, with no verdict recorded. Two streamed calls of the same requests by hand showed why: on F the model answered a fail at line 2 in 882 tokens, and on the other file its thinking ran past 42,000 characters in 150 seconds without an answer. The timeout ended the call as section 6 says; a model that keeps thinking is the model's limit. These calls ran before the review's changes to the HTTP providers and were not repeated after them. |
| `codex` | ready, through an OpenAI-compatible route only | codex-cli 0.169.0 in a container, its `config.toml` naming a model provider at an OpenAI-compatible Responses endpoint, `model: claude-haiku-5-5`, a model that is not the vendor's: 5 calls. It was not run against the vendor's own service or with the vendor's sign-in. Two calls of `codex exec` by hand chose the arguments: with `--ignore-user-config` the call went to the vendor's own service and was refused with 401, and with the configuration read it answered (`spec/questions.md`, entry 74). Through Lawcheck, `doctor --reviewer` answered its test call and `check --review` on R with F gave the finding at line 2, exit 1. After the review's changes, one more `check --review` on F gave the same finding with an MCP server in `config.toml` that did not start. Offline, against a local fake of the Responses API, the arguments offered the model one tool, `request_user_input`. |
| `copilot-cli` | ready, through an OpenAI-compatible route only | Copilot CLI 1.0.111 in the same container, in its bring-your-own-key mode against an OpenAI-compatible chat completions endpoint, `claude-haiku-5-5`, a model that is not the vendor's: 5 calls. It was not run against the vendor's own service or with a GitHub sign-in. One call by hand showed that it reads the prompt on standard input and runs without `--model` when `COPILOT_MODEL` is set. Through Lawcheck with `model` set, `doctor --reviewer` answered and `check --review` on F gave the finding at line 2, exit 1; without `model`, `check --review` on a file that keeps the rule recorded a pass, exit 0. After the review's changes, one more `check --review` on F gave the finding with an MCP server in `mcp-config.json` that did not start. Offline, against a local fake of chat completions, the arguments offered the model no tool. |
| `openai` | not exercised live | No key on the machines of this check. Tests 184, 187, 188 and 189 run it against a local fake of OpenAI's documented chat completions. |
| `google` | not exercised live | No key on the machines of this check. Tests 185, 187, 188 and 189 run it against a local fake of Google's documented `generateContent`. |
| `gemini-cli` | not exercised live | No `gemini` program or sign-in on the machines of this check. Test 191 runs a fake of the documented headless mode; its arguments come from Gemini CLI 0.61.0 and none was run against a real `gemini`. |
| The measurement | not run for the new providers | `npm run stability` now takes `ollama`, `codex` and `copilot-cli` (test 194). Section 9 of `spec/reviewer-slice.md` fixes 10 runs of 30 calls per provider and no smaller run, so it was not run with them here; the next full measurement can include them. |

## Documents

| Item | State | Evidence |
|---|---|---|
| Docs pages against the commands | ready | `tests/acceptance/docs.test.ts` compares the topic list, the JSON and the pages with the commands. The walk through `docs/first-law.md` was run on the installed tarball: `explain`, the three `try` forms, `check --full --base main` with its debt block and exit 0, and `check` with its findings and exit 1 gave the lines and exit codes the page describes. Every code in `docs/codes.md` appears in `src/`, and every flag and variable the pages name is in the argument table or the source. |
| Pages that assume a published tool | ready | `docs/ci.md` ("Lawcheck is one of the project's dev dependencies") and the `runner` examples in `docs/config.md` are true once the package is on npm. |
| Public boundary | ready | No tracked file names a product other than Runes or speaks of moving from another tool (searched with `git grep`; `tests/acceptance/docs.test.ts` also refuses the migration wording in the docs). |
| Other install lines in the README | ready | `Run lawcheck prime at the start of every session and follow it.` and the `pnpm exec lawcheck prime` example match `lawcheck prime` and the runner table in `docs/config.md`. |

## The README on the day of publishing

Remove the line "Work in progress: there is nothing to install yet." and put this in its place, before "Coding agents" or after the first paragraph:

```
## Install

Lawcheck needs Node 24 or later and git 2.34 or later.

    npm install --global lawcheck

Then, at the root of a git repository:

    lawcheck init
    lawcheck docs first-law

To keep Lawcheck in a project instead, run `npm install --save-dev lawcheck`, set `runner` in `.lawcheck/config.yaml` (`lawcheck docs config`), and start it with `npx lawcheck`.
```

In `package.json`, drop "Work in progress." from `description`. The plugin's `description` carries no such word.

## Steps for the day, in order

1. Push `main`, so that the plugin lines work against GitHub, and run them once from a throwaway Claude Code configuration folder.
2. Replace the README line and the `description`, and change the GitHub repository description, which still says "Work in progress". Draft for the owner: "Checks code against the architecture and rules you write, and tells a coding agent which line breaks which rule." The owner makes that change.
3. From a clean clone: `npm ci`, `npm test`, `npm pack`, install the tarball in a clean folder and run `npx lawcheck --version` and a check on a small repository, as above.
4. Publish, and tag the commit. Both are the owner's.
