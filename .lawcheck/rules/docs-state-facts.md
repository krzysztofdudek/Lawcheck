This file is a page that `lawcheck docs` prints. A user or a coding agent reads it in a terminal to learn what this version of Lawcheck does.

Each sentence states what Lawcheck does, takes, prints or refuses. An example is a command the reader can type or a file the reader can write, and the output shown is what Lawcheck prints.

Report a sentence that:

- promises a later version: "will", "soon", "planned", "not yet", "in a future release";
- praises: "simple", "easy", "powerful", "fast", "seamless", "robust" and words like them, about Lawcheck itself;
- hedges about Lawcheck's own behaviour where a fact belongs: "should", "usually", "might", "tries to";
- tells how Lawcheck was built, or why its authors decided something, instead of what it does;
- instructs without an object: "configure it properly", "set it up as needed".

Not a violation:

- a limit stated as a limit: what Lawcheck does not read, stop or guarantee;
- "may" for what the reader or a rule is allowed to do;
- the reason for a behaviour given in the same sentence as the behaviour, such as "so CI needs no key";
- a sentence about the reader's own code or tools.

Give one finding per sentence, at its line. Quote the words that break the rule.
