# Rows no test carries

The rail `spec-map.test.ts` accepts a row of an acceptance table without a test only when it is listed here, with the reason and the person or step that runs it. A row listed here that a test carries, or that is in no spec table, fails the rail.

| # | Why no test carries it | Who runs it |
|---|---|---|
| 79 | it is `npm test` itself (reviewer slice) | the suite's own run |
| 94 | it is `npm test` itself (dependency slice) | the suite's own run |
| 95 | `npm run real` needs the network and runs outside `npm test` | the reviewer of a release, with `npm run real` |
| 141 | it is `npm test` itself (commands slice) | the suite's own run |
| 153 | `claude plugin validate` runs on the host with the Claude Code program | the reviewer, by hand (question 58) |
| 180 | the README and the plugin's files are read by a person for the wording and for names of other tools | the reviewer, by reading (question 58) |
| 182 | the agent trial runs on the host through the owner's subscription | the reviewer, with `npm run agent-trial` (question 58) |
| 183 | it is `npm test` itself (plugin slice) | the suite's own run |
