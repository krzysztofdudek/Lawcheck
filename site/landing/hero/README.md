# Where the strings of the hero come from

`hero.mjs` draws the hero. The landing page plays it, and `film/render.mjs` renders it to the GIF at the top of the README. Under the hero, the landing page says: "The animation shows real output of Lawcheck 0.1.0-alpha.6 on a sample repository. The agent's code in it is an example."

## Output of Lawcheck

I ran Lawcheck 0.1.0-alpha.6 on the shop repository of `film/fixture/shop`, with the law and the script rule `no-clock.mjs` of the README. I added three files: `src/core/loyalty.ts`, whose line 1 imports `../api/format.ts` and whose line 9 calls `new Date()`, `src/api/money.py`, and `src/core/pricing.py`, whose line 1 imports `src.api.money`. `lawcheck check --base main` printed these three findings:

```text
src/core/loyalty.ts:1  error[forbidden-use]  core may not use api (src/api/format.ts); its may_use is [core]
src/core/loyalty.ts:9  error[no-clock]  reads the clock
src/core/pricing.py:1  error[forbidden-use]  core may not use api (src/api/money.py); its may_use is [core]
```

The hero shows each line up to its first closing parenthesis, so the two lines of `forbidden-use` end before `; its may_use is [core]`. The failed pull request shows the first line the same way.

## Written in the form of real output

- `lawcheck: PASS` after the fix: the start of the line a passing check prints.
- `lawcheck: PASS  3 changed files (against origin/main)` on the pull request that passes: the line of a passing check against a base. `docs/ci.md` shows the same line.

## Examples

- The agent's code: the import of `../api/format.ts`, `new Date()`, and the fixed lines `import { formatMoney } from "./money.ts";` and `const today = now;`.
- The review of the rule in prose: "the model reads loyalty.ts" and "loyalty.ts follows the rule" draw a review. They are no output of Lawcheck.
- The pull request "Add a loyalty discount".

## From the pilot and the README

- 8 of 20 sessions, 10 tests and the date 2026-11-23: `film/pilot.json`. The import on that screen is line 1 of `film/takes/a09/files/src/core/price.ts`.
- The commands of the last screen: the steps of "Try it" in the README.
