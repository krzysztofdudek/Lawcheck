A comment in this file must say something the code cannot say.

A comment keeps the rule when it gives one of these:

- a constraint from outside the code: how an operating system, a runtime, a protocol or another program behaves;
- a trap: why the simpler form is wrong here, so that nobody replaces this one with it;
- where a value comes from: a measurement, a specification, a version.

Report a comment that:

- says in words what the lines beside it do;
- tells the history of the code: what it was before, what was changed, added or removed;
- names a task, a ticket, a review, a person, or a part of a specification by its number alone;
- is a heading for a block of code, or marks a region;
- is code that was commented out;
- is a TODO, a FIXME or a note to come back later.

Not a violation:

- a file with no comment;
- a line a tool reads: `#!`, `// @ts-expect-error`, a `lawcheck-waive` line;
- text inside a string or a template literal, which is no comment.

Give one finding per comment, at the comment's first line. Start the message with the comment's first words in quotes, then say which of the kinds above it is.
