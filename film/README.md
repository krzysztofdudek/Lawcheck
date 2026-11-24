# The film

The loop at the top of the README and the five chapters of the tutorial on the docs site show real Claude Code sessions in a small shop repository. Every string in the recording area comes from a file of a session, from a run of Lawcheck on that session's files, or from a page of this repository. Captions and subtitles have no such source, so the check does not hold them to one. The loop is silent. Each chapter is narrated in the voice Lektor, and every narrated sentence cites what its frame or a docs page shows.

## What is here

| Path | What it holds |
|---|---|
| `fixture/` | the shop repository and its law |
| `fixture/chapters/<page>/` | where each chapter starts: its law, its files on `main` and on its branches, its prompt and the commands its recording types |
| `shop.mjs` | builds the repository a chapter starts from, for a recording and for the check |
| `registry.mjs` | an npm registry for a recording, which serves the packed build under the tag `alpha` |
| `record.mjs` | records one session or one chapter in a container, with a clean home, as text |
| `accept.mjs` | says whether a session or a chapter's take may be used, and which accepted session had the shortest turn |
| `trim.mjs` | copies a record and keeps of its transcript only the session: every other line becomes its kind and SHA-256 |
| `pilot.json`, `pilot.mjs` | the 80 sessions of the pilot of 2026-11-23, one row each with the hash of its trimmed record |
| `takes/a09`, `takes/b04` | the two sessions the film shows, trimmed, with the hashes that `pilot.json` counts |
| `takes/a09-check`, `takes/b04-check`, `takes/b04-prime` | the output of Lawcheck on the files of those sessions |
| `takes/<chapter take>`, `takes/<chapter run>` | the take of each chapter, trimmed, and the output of Lawcheck on its files |
| `edit.json` | the screens of the loop and of each chapter: times, blocks, the source of each string, captions, subtitles and the narration, with the voice that speaks it |
| `check.mjs` | the truth and staleness check |
| `voice.mjs` | speaks the narration of each chapter with a speech service, one file per frame, into a folder outside the repository |
| `build.mjs` | writes a HyperFrames project for the loop and for each chapter into `film/dist/`, each chapter's subtitles, and with `--voice <folder>` the narration that `voice.mjs` spoke |
| `render.mjs` | checks, builds and renders the loop to MP4, WebM and GIF, and each chapter with its narration to MP4, WebVTT and a still |
| `published.json` | the chapters that a release holds as attachments, with the hash of each file; the docs site shows these |
| `rebuild.sh` | the same in a clean container, from FFmpeg and Chromium up |
| `hyperframes/` | the styles, the spec and the last review of the picture |

## Which sessions the film shows

Arm a had no law and no plugin; arm b had the law and the plugin. `accept.mjs` takes a session of arm a when a file of `src/core` imports from `src/api`, the tests pass and nothing outside `src/` and `tests/` changed: 8 of the 20 sessions. It takes a session of arm b when the plugin gave the agent its text at the start, no file of `src/core` imports from `src/api`, the check and the tests pass, the law is untouched, no waiver was added, and the agent's last message has a sentence that names the law and the import: 14 of the 60 sessions. Each of the other 46 is refused for that sentence alone. The film shows the shortest turn of each arm: `a09` and `b04`.

## The chapters

Each chapter of the tutorial is one recording of `record.mjs --chapter <page>` in the repository that `fixture/chapters/<page>/` describes, with Lawcheck packed from the commit that becomes the release and the plugin from this repository's `main`. The recording types the chapter's commands, and Claude Code gets the chapter's one prompt. The first chapter has no prompt: as its page does, it makes a new repository and types the page's files into it. The chapter of `ci` then types the job's command in a second container with no network and no key. The first chapter types `npm install --global lawcheck@alpha` against `registry.mjs`, which serves the packed build under that tag, so that the recording installs the build that becomes the release. `take.json` names the commit.

`accept.mjs` takes a chapter's take when:

- `quick-start`: the install command and `lawcheck init` exit 0, the files `src/cli/print.ts`, `.lawcheck/law.yaml` and `src/core/receipt.ts` are the blocks of the quick start, typed in the terminal, and `lawcheck check` fails with one `forbidden-use` at `src/core/receipt.ts:1`;
- `forbid-a-use`: the session passes what a session of arm b passes;
- `write-a-script-rule`: the rule asks for the syntax tree and imports nothing from outside `.lawcheck/rules/`, `lawcheck explain --rule no-fetch` shows `core` alone, `lawcheck try no-fetch` finds `src/core/cart.ts:3` and nothing else, and the session changed no file of `src/`;
- `write-a-reviewer-rule`: the settings name `claude-code` with no key, the rule is a file of prose that the law lists on `core`, `lawcheck try` finds `src/core/refund.ts:2`, `lawcheck check --review` passes with a reviewer call and writes `.lawcheck/verdicts`, and the plain check after it passes with no call;
- `ci`: the workflow is the block `ci-workflow` of `docs/ci.md`, and with no network and no key the job's command passes on `refund` and fails with `forbidden-use` and exit 1 on `discount`;

and no file holds a waiver. A chapter starts from what the page before it teaches, not from the take before it, except that `ci` starts on the branch that the take of `write-a-reviewer-rule` left, with its recorded pass.

Lawcheck's version, Claude Code's version and the model stay in `take.json`. No screen, caption, subtitle or narrated sentence shows them, so a chapter stays true across releases.

## The narration

An agent writes the narration. Each segment of a chapter in `edit.json` has its `narration`: the sentences spoken while its frame stands. A sentence follows its frame and says nothing that the frame, its caption or its subtitle does not show. It cites what it follows in `shows`: strings of its frame, or, with `page`, strings of that page of `docs/`. `check.mjs` finds each cited string where the sentence says. A sentence whose every cited string is only in its caption or its subtitle, and on no screen, names `ties`: each tie has a `text` and a `from`, a file of the repository, a run or a file of a take, and `check.mjs` finds the text in that source. `film/edit.json` ties nothing, since it holds the caption and the subtitle. A sentence ends with `.`, `!`, `?` or `…`, because the speech engine reads that as intonation, and says its numbers in words.

`voice` in `edit.json` names the voice and how it speaks: the language, the speed, the pause between two sentences, and how long after the start of a frame the narration starts (`lead`) and how long before its end it stops (`tail`).

1. `LAWCHECK_FILM_VOICE=<address> node film/voice.mjs --out <folder>` speaks every frame whose words or voice changed. The address is that of a speech service with the audio API of OpenAI, such as VoiceStudio, and it never enters the repository. Each sentence is spoken alone and the sentences of a frame are joined with the pause, because the engine sometimes runs two sentences into one breath. It writes `<folder>/<page>/<segment>.wav` and `voice.json`, transcribes each file back and prints each frame whose transcript has other words, and fails when a frame's voice is longer than the frame leaves it. `--only <page>` or `--only <page>/<segment>` speaks those again.
2. `node film/render.mjs --out <folder> --voice <folder>` mixes the voice of each frame in from `lead` after the frame starts. It refuses a voice spoken from other words or settings than the edit holds now, a frame with no voice, and a voice that does not fit its frame. It refuses to render a narrated chapter without `--voice`.

The voice is not committed: it is a recording. When the chapters are recorded again, a segment that keeps its narration keeps its words, and `voice.mjs` speaks again only what changed.

## Where the chapters live

The rendered chapters are attachments of a GitHub release, never files of this repository. `published.json` lists them with the release that holds them, the hash of each file and the subtitles as text. The build of the landing page downloads each file, checks its hash and serves it under `/film/`; the docs site shows a chapter above the page it teaches and plays it from there. A release that brings new chapters:

1. renders them with `node film/render.mjs --out <folder> --only chapters`, which writes the files and `chapters.json`;
2. attaches the `.mp4`, `.vtt` and `.jpg` files to the release;
3. copies the entries of `chapters.json` into `published.json`, each with `release` set to the release's tag, and deploys the landing page and the docs again.

`LAWCHECK_FILM_DIR=<folder>` makes both sites take the chapters from a folder that `render.mjs` wrote, for a preview before a release holds them.

## What is published of a session

A transcript of Claude Code also holds Claude Code's own text (its system prompt, its tools and its listings) and the name of the machine that recorded it. `trim.mjs` keeps the prompt, the agent's messages, its tool calls and their results, the plugin's text and its stop line, and turns every other line into its kind and the SHA-256 of the line. `pilot.json` hashes each record as `trim.mjs` writes it, so the full records and the trimmed ones give the same hash. The full records stay with me.

No video, image or recording is committed here. `claude plugin marketplace add` clones this repository, so every megabyte of film would reach everyone who installs the plugin.

## The check

`node film/check.mjs` needs `npm run build` first, and `npm test` runs it. It fails when:

- a string on screen is not in the take, run or page that the edit names, or a terminal line is shown in a color the terminal did not print;
- a take differs from the record that `pilot.json` counts or the hash its chapter records, or `accept.mjs` refuses it;
- this build of Lawcheck prints something else on the files of a take than the film shows;
- a screen stands less than one second plus one second for every three new words, its subtitle counted, the loop lasts more than 30 seconds, or a chapter lasts less than 40 or more than 60;
- a screen, a caption, a subtitle or a narrated sentence shows a number with a point, a version after `@`, a version written as `v` and a number, or the name of a model;
- a segment of a chapter has no narration, or a narrated sentence ends without `.`, `!`, `?` or `…`, holds two sentences, has a digit, cites nothing, cites a string that its frame or its page does not show, or cites only its caption or subtitle without a tie that its source backs;
- a file of `takes/` holds a home folder other than `/home/dev`, a key, a token, an e-mail address, the word orbstack, a host name under ts.net, the word tailnet, the word clientbox, a path under /mnt/mac, or a word listed in the variable `LAWCHECK_FILM_PRIVATE`, separated by commas. Set it to the names only the recording machine knows, such as its tailnet's name, before you add a take. A run without it, such as the one in CI, says that those names were not looked for.

## When the output of Lawcheck changes

1. Run `node film/check.mjs --write`. It records the output of this build for every run of `edit.json`.
2. Change `edit.json` where the check names a string that is no longer in the output, and keep every screen within its reading time.
3. Render the loop and the chapters again before the release that changes the output. A chapter whose take this build would no longer accept is recorded again.

## Render

One command builds the film from this folder in a clean container, and writes `loop.mp4`, `loop.webm` and `loop.gif`, and for each chapter its `.mp4`, `.vtt` and `.jpg` with `chapters.json`, into the folder you name:

```text
docker run --rm -v "$PWD:/src:ro" -v "<a folder outside the repository>:/out" -v "<the folder voice.mjs wrote>:/voice:ro" mcr.microsoft.com/devcontainers/javascript-node:24 sh /src/film/rebuild.sh
```

`rebuild.sh` installs FFmpeg and Chromium, copies the checkout without `node_modules` and `dist`, runs `npm ci` and `npm run build`, and then `node film/render.mjs --voice /voice`, which stops when `check.mjs` fails or a narrated frame has no voice that fits it. HyperFrames has no Chrome of its own for Linux on ARM, so the container uses Debian's Chromium on every machine.
