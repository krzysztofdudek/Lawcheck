# Weakenings of the suite

Every change that made the suite weaker, and why. The suite guard (`tests/guard`) reads this file: a weakening it finds passes only when the same change adds its row here, with an anchor that exists and an approver its configuration allows for that kind. Rows are only ever added; the guard refuses a change that edits or removes one.

Kinds and who approves them by default: `test-removed`, `expected-changed`, `docs-example-changed`, `sabotage-changed`, `sabotage-removed`, `harness-changed`, `finding-weakened` and `ratchet-grew` need a fresh reviewer agent (`reviewer <agent>`); `promise-changed`, `guard-changed`, `ci-changed` and `threshold-lowered` need the owner (`owner`). An anchor is `row <n>`, `I-<id>`, `S<report>-<n>`, `ruling <n>` of `spec/questions.md`, `Runes <version>`, or a path the change touches.

| Date | What | Kind | Reason | Anchor | Approved by |
|---|---|---|---|---|---|
