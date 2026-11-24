# The film

The loop at the top of the README and the narrated film on lawcheck.dev show real Claude Code sessions in a small shop repository. Every string in the recording area comes from a file of a session, from a run of Lawcheck on that session's files, or from a page of this repository. Captions and narration have no such source, so the check does not hold them to one.

## What is here

| Path | What it holds |
|---|---|
| `fixture/` | the shop repository and its law |
| `record.mjs` | records one session in a container, with a clean home, as text |
| `accept.mjs` | says whether a session may be used, and which accepted session had the shortest turn |
| `trim.mjs` | copies a record and keeps of its transcript only the session: every other line becomes its kind and SHA-256 |
| `pilot.json`, `pilot.mjs` | the 80 sessions of the pilot of 2026-11-23, one row each with the hash of its trimmed record |
| `takes/a09`, `takes/b04` | the two sessions the film shows, trimmed, with the hashes that `pilot.json` counts |
| `takes/a09-check`, `takes/b04-check`, `takes/b04-prime` | the output of Lawcheck on the files of those sessions |
| `edit.json` | the screens of the loop and of the narrated film: times, blocks, the source of each string, captions and narration |
| `check.mjs` | the truth and staleness check |
| `build.mjs` | writes the two HyperFrames projects into `film/dist/` |
| `render.mjs` | checks, builds and renders the loop to MP4, WebM and GIF |
| `rebuild.sh` | the same in a clean container, from FFmpeg and Chromium up |
| `hyperframes/` | the styles, the spec and the last review of the picture |

## Which sessions the film shows

Arm a had no law and no plugin; arm b had the law and the plugin. `accept.mjs` takes a session of arm a when a file of `src/core` imports from `src/api`, the tests pass and nothing outside `src/` and `tests/` changed: 8 of the 20 sessions. It takes a session of arm b when the plugin gave the agent its text at the start, no file of `src/core` imports from `src/api`, the check and the tests pass, the law is untouched, no waiver was added, and the agent's last message has a sentence that names the law and the import: 14 of the 60 sessions. Each of the other 46 is refused for that sentence alone. The film shows the shortest turn of each arm: `a09` and `b04`.

## What is published of a session

A transcript of Claude Code also holds Claude Code's own text (its system prompt, its tools and its listings) and the name of the machine that recorded it. `trim.mjs` keeps the prompt, the agent's messages, its tool calls and their results, the plugin's text and its stop line, and turns every other line into its kind and the SHA-256 of the line. `pilot.json` hashes each record as `trim.mjs` writes it, so the full records and the trimmed ones give the same hash. The full records stay with me.

No video, image or recording is committed here. `claude plugin marketplace add` clones this repository, so every megabyte of film would reach everyone who installs the plugin.

## The check

`node film/check.mjs` needs `npm run build` first, and `npm test` runs it. It fails when:

- a string on screen is not in the take, run or page that the edit names, or a terminal line is shown in a color the terminal did not print;
- a take differs from the record that `pilot.json` counts, or `accept.mjs` refuses it;
- this build of Lawcheck prints something else on the files of a take than the film shows;
- a screen stands less than one second plus one second for every three new words, or the loop lasts more than 30 seconds;
- a file of `takes/` holds a home folder other than `/home/dev`, a key, a token, an e-mail address, the name of the recording machine's virtual machine, a tailnet host name or the word tailnet, the name of the folder shared with my computer or a path of it, or a word listed in the variable `LAWCHECK_FILM_PRIVATE`, separated by commas. Set it to the names only the recording machine knows, such as its tailnet's name, before you add a take.

## When the output of Lawcheck changes

1. Run `node film/check.mjs --write`. It records the output of this build in `takes/*-check` and `takes/*-prime`.
2. Change `edit.json` where the check names a string that is no longer in the output, and keep every screen within its reading time.
3. Render the loop again before the release that changes the output.

## Render

One command builds the film from this folder in a clean container, and writes `loop.mp4`, `loop.webm` and `loop.gif` into the folder you name:

```text
docker run --rm -v "$PWD:/src:ro" -v "<a folder outside the repository>:/out" mcr.microsoft.com/devcontainers/javascript-node:24 sh /src/film/rebuild.sh
```

`rebuild.sh` installs FFmpeg and Chromium, copies the checkout without `node_modules` and `dist`, runs `npm ci` and `npm run build`, and then `node film/render.mjs`, which stops when `check.mjs` fails. HyperFrames has no Chrome of its own for Linux on ARM, so the container uses Debian's Chromium on every machine.

The narrated film waits for the voice. Each scene then lasts as long as its spoken line, within the reading time that `check.mjs` asks for.
