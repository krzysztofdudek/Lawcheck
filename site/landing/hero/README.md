# Where the strings of the hero come from

`hero.mjs` draws the hero. The landing page plays it, and `film/render.mjs` renders it to the GIF at the top of the README. Under the hero, the landing page says: "The animation shows real output of Lawcheck 0.1.0 on a sample repository. The agent's code in it is an example."

## Output of Lawcheck

I ran Lawcheck 0.1.0 on the shop repository of `film/fixture/shop`, with the law and the script rule `no-clock.mjs` of the README, and with two Python files that keep the law, `src/api/money.py` and `src/core/pricing.py`. On a branch I added `src/core/loyalty.ts`, whose line 1 imports `../api/format.ts` and whose line 9 calls `new Date()`. `lawcheck check --base main` printed these two findings:

```text
src/core/loyalty.ts:1  error[forbidden-use]  core may not use api (src/api/format.ts); its may_use is [core]
src/core/loyalty.ts:9  error[no-clock]  reads the clock
```

The hero shows these lines as they are. The failed pull request shows the first one.

Then I made the fix the hero shows: `formatMoney` moved to `src/core/money.ts`, `src/api/format.ts` exports it from there, and `loyalty.ts` imports `./money.ts` and takes the time as an argument. `lawcheck check --base main` printed:

```text
lawcheck: PASS  3 changed files (against main)
```

## Written in the form of real output

- `lawcheck: PASS` after the fix: the start of the line above.
- `lawcheck: PASS  3 changed files (against origin/main)` on the pull request that passes: the line above, with the base a CI job names.

## Versions

The note under the hero names 0.1.0 by hand, because it names the version these lines were printed by. A new release changes it only after the lines above are printed again by that release.

## Examples

- The agent's code: the import of `../api/format.ts`, `new Date()`, and the fixed lines `import { formatMoney } from "./money.ts";` and `const today = now;`.
- The review of the rule in prose: "the model reads loyalty.ts" and "loyalty.ts follows the rule" draw a review. They are no output of Lawcheck.
- The pull request "Add a loyalty discount".

## From the pilot and the README

- 8 of 20 sessions, 10 tests and the date 2026-11-23: `film/pilot.json`. The import on that screen is line 1 of `film/takes/a09/files/src/core/price.ts`.
- The commands of the last screen: the steps of "Try it" in the README.
