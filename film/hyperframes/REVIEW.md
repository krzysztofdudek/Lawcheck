# Review of the draft loop, 2026-11-23

The draft renders the loop from the takes `a09` and `b04` on the output of Lawcheck 0.1.0-alpha.4 plus `main`. The narrated film is built and checked, and it waits for the voice.

## Creative calls

- The storyboard is section 6 of the landing design of 2026-11-23: the import first, then the law, the finding, the same prompt with the law and the plugin, and the install line.
- The takes are the accepted sessions with the shortest turn (`node film/accept.mjs`).
- The reading time of F3 decides what each screen holds, and the loop is 28.9 s against a limit of 30. So the loop drops three things from the storyboard: the `about` line of the law in L2, the FAIL line and the lines `why:` and `next:` in L3 (a `⋯` marks each cut), and the `PASS` line in L4.
- Every screen stands whole from its first frame: no fades and no staged reveal. A GIF that does not play shows the whole first screen, the gold outline included.
- A long line of output wraps at 48 columns, at a gap of two spaces when one falls in the second half of the line. No line of output is cut inside; only the prompt in N1 is.
- The cards and captions say what each arm had: 8 of the 20 sessions without a law made the import, and none of the 60 with the law and the plugin.
- In the narrated film, N1 shows the start of the prompt with a `⋯`, N4 shows lines 7 to 10 of the law, and N5 shows the FAIL line and the finding. N5 and N8 have no caption, because the narration says it.

## What was measured

- `hyperframes check`: no error in either project. The one warning kept is `film_silent`: the loop is silent by the owner's ruling, and the narrated film gets its voice after the output is frozen.
- `node film/check.mjs`: every string on screen against its source, the output of this build, the reading time of every screen and the private names in the takes.
- The GIF through the viewer's script of the film criteria: 1200 x 675 and no sound. At 358 px a line of code is about 13 px high.
- The phone sheet of `snapshot --review` at 360 px, and the seams: no empty frame at a cut.

## What nobody checked

- The motion in a player by eye; only frames were read.
- The GIF on github.com and on the npm page.
- A render with HyperFrames' own Chrome. The container uses Debian's Chromium in screenshot mode on every machine.
- The narrated film with a voice.

## Weakest shot

L4 shows only the agent's own sentence. In the loop no output of Lawcheck stands beside it, and the narrated film shows the `PASS` line in N6. With a second more in the loop, the `PASS` line would come back.
