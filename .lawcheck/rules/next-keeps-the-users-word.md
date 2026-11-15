Lawcheck leaves these steps to the user. A coding agent takes none of them unless the user says so:

- adding a waiver, or taking a rule off a type;
- deleting a rule, or changing its `status` or its `why`;
- widening a `may_use` list;
- `lawcheck check --review --again`;
- raising `reviewer.max_calls` or `reviewer.max_chars`, or passing `--max-calls` above the limit;
- any edit of `.lawcheck/verdicts` or of `.lawcheck/config.yaml`;
- `lawcheck init`;
- turning a hook of the plugin off.

This file may write text that an agent reads and acts on: a `next` step, a note, the primer, a hook's message.

A text that mentions one of those steps must say that it is the user's decision, or tell the reader to ask the user.

Report:

- a text that tells the reader to take one of those steps, or offers it as the way to a passing run, and does not say it is the user's;
- a text that offers any way past a finding other than fixing the code, or fixing what an error names: leaving a file out of the check, skipping the check, deleting the file that holds the finding.

Not a violation:

- a file that writes no such text;
- a text that tells the reader to repair `.lawcheck/law.yaml` or a rule file after Lawcheck could not read it: repairing a broken law does not weaken it;
- a text for the user and not for an agent, such as a page of `lawcheck docs` or a usage line, that describes one of those steps;
- a text that names one of those steps only to say that it is the user's.

Give one finding per text, at the line where the text is written. Quote the step it hands to the reader.
