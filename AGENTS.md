# Agents in this repository

Lawcheck checks its own code, and the build of this checkout is the judge.

- On a fresh clone, run `npm ci`, then `npm run grammars`, which downloads the grammars the readers load, then `npm run build`.
- At the start of every session, run `node dist/cli.js prime` and follow it. Where the primer says `lawcheck`, run `node dist/cli.js`.
- After you edit a file under `src/`, run `npm run build` again before `node dist/cli.js check`, because the check runs the build, not the source.
- `node dist/cli.js check --review` asks the reviewer rules through `claude-code`, so it needs a `claude` program that is signed in. CI reads the committed `.lawcheck/verdicts` and calls no model.
