# Spec of the film

`node film/build.mjs` writes HyperFrames projects from `film/edit.json` into `film/dist/`: `loop` and one for each chapter of the tutorial, named by its docs page. Change the edit, the styles in `film.css` or the build, never the files in `film/dist/`, because the next build replaces them.

GOAL: after one silent loop, a developer who writes code with an agent has seen the import that slipped past the tests, the law that forbids it, the finding with its file and line, and the same prompt with the plugin. After one chapter, the developer can repeat its steps from the frames alone: each command, the prompt and the lines of a file stand on screen whole.

OUTPUT: HyperFrames, 1920 x 1080, 30 fps. The loop is also a GIF of 1200 x 675 at 12 fps, with one palette made from `brand/tokens.json`. A chapter is an MP4 with its subtitles in WebVTT and a still of its first screen.

TIME: the loop is 28.9 s, 867 frames, with no sound. A chapter lasts 40 to 60 s. Its only sound is the narration in the voice Lektor: each frame's sentences start 0.4 s after the frame and end at least 0.3 s before the next, with 0.35 s between two sentences.

LOOK:

- The ground is `ground` of the dusk palette, flat, with no texture.
- Text is `text`. Quiet parts (the prompt sign and the gutter) are `textQuiet`; labels and the mark of skipped lines are `textMuted`.
- Gold (`brand`) marks one line per screen with an outline of 3 px, and the tick before a label.
- Red and green appear only where the terminal of the take printed them. Lawcheck prints no color.
- Terminal text, files and panels are JetBrains Mono at 52 px on a line of 72 px, at most 48 columns, in a box of `code` with a 2 px edge of `lineLit` and a radius of 28 px.
- Captions are Inter 600 at 56 px, one line, centred above the bottom edge, never over the recording. In a chapter the caption names the step at the top, and the bottom 190 px stay empty for the subtitles a player draws.
- Cards are Inter 600 at 76 px, with a small line of Inter 400 at 48 px and a gold bar of 120 x 4 px above.
- The smallest text is 46 px on a line of 66 px, which is 12 px of line at a phone width of 358 px.

OBJECTS: a file of the take with its path as a label, a terminal with the command and its output, a panel with the words of the agent or of the documentation, a card with a count and the set it was counted on.

MOTION:

- A screen cuts to the next one with no transition. Its blocks, its caption and its gold outline stand whole from its first frame, so a GIF that does not play still shows a whole screen, and no frame between two screens is empty.
- Nothing moves while it is read: no fade, no zoom, no drift, no typing of text that the take did not type.

SHOTS: one per screen of `film/edit.json`. The edit holds the time, the blocks and the caption of each, and `film/check.mjs` checks that every string on screen comes from its take, run or page, and that each screen stands long enough to be read.

BANNED:

- glow, gradients, grain, particles, music and a moving logo;
- a word in the recording area that the take, the run or the page does not hold;
- the name Lawcheck in the first fifth of the loop;
- a line of output shortened inside the line; a skipped line shows the mark `⋯` in `textMuted`.

The dark ground and the mark in the top right corner are the brand's own, so the defaults of HyperFrames that ban them do not apply here.

QA: one frame in the middle of each screen at 1920 px and at 358 px; the frame at 0 s holds the import; the last frame of the loop leads back to the first one.
