This file may build text that Lawcheck prints: the `message` of an error or of a finding, a `next` step, a problem text it returns to a caller, a line of a command's output, or a text a hook hands to a coding agent. `<context>` holds every code Lawcheck prints and when it prints it.

A reader must be able to act on such a text without opening Lawcheck's source. So each text:

1. names the thing it is about, as the user wrote it: the path, the key, the flag, the rule id, the value;
2. says what is wrong as a fact about that thing, such as "the base 'x' names no commit here";
3. says which values are taken, where the set is small and fixed;
4. as a `next` step, names one action: a command to run, a file and what to change in it, or a decision to put to the user.

Report a text that:

- says only that something is invalid, failed, is wrong or is not supported, and names no thing or no fact;
- shows a name the user never wrote and cannot look up: a function, a class or a variable of Lawcheck, a stack trace, an error object printed whole;
- as a `next` step, names no action, or names two commands and does not say when each one applies;
- addresses the reader with "please", "you must" or an exclamation mark.

Not a violation:

- a file that builds no such text;
- a problem text that its caller completes, such as "is empty" after the caller has named the pattern;
- the first line of the system's own error, or of git's, passed on inside a message that names the thing;
- a `why` text, which gives the reason for a code and not the fix;
- the message of the code `internal`, which passes on the first line of a failure Lawcheck did not expect;
- a prompt sent to a reviewer model.

Give one finding per text, at the line where the text is written.
