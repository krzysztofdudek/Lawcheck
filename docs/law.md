# The law file

An agent writes a database call into a page component, and the build stays green. The law is the file where you say which kinds of files the repository has and what binds each kind: `.lawcheck/law.yaml`.

Lawcheck finds the file by walking up from the current directory. The nearest directory that holds it is the root: git and the rules run there, and every path is relative to it. A root below the top of the git work tree sees only the files below it. The law may hold 1 MiB, 10,000 rules and 1,000 types, subtypes included; past any of them it is `file-too-large`.

## Keys

| Key | In | Value |
|---|---|---|
| `lawcheck` | top | `MAJOR.MINOR.PATCH`, required |
| `rules` | top | rule id to rule |
| `types` | top | type id to root type |
| `why` | rule | one line, required |
| `status` | rule | `enforced` or `advisory` |
| `context` | rule | paths |
| `about` | type | one line |
| `paths` | type | patterns, required |
| `content` | type | a regular expression |
| `rules` | type | rule ids |
| `may_use` | type | type ids |
| `types` | type | type id to subtype |
| `waivers` | type | `true` or `false` |

Any other key is `law-invalid`, and the message names a known key that is one or two letters away. A key written twice, an empty file and a value of the wrong kind are `law-invalid` too. Lawcheck reads a YAML alias as the value of its anchor; a type that holds itself through an alias is `law-invalid`.

```yaml
lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.
  no-todo:
    why: A TODO without an issue number gets forgotten.
    status: advisory

types:
  source:
    about: Everything that ships.
    paths: ["src/**/*.ts", "!src/**/*.d.ts"]
    rules: [no-todo]
    types:
      library:
        about: Code the commands call.
        paths: ["src/core/**"]
        rules: [no-console]
      command:
        about: The command layer.
        paths: ["src/cli/**"]
  script:
    about: Executable helpers.
    paths: ["tools/**/*.{mjs,js}"]
    content: "^#!"
    rules: [no-todo]
```

## lawcheck

The version of the law's format, such as `0.1.0`. Lawcheck checks its form and does not compare it with its own version. `lawcheck init` writes the version of the Lawcheck that ran it.

## rules

A mapping from rule id to rule. Each rule has one file in `.lawcheck/rules/` (section "Rule files" below). A rule that no type lists judges nothing, and `lawcheck explain --rule <id>` says it is on no type.

### why

One line, at most 200 characters, required. Lawcheck prints it under each finding of the rule, and puts it in each prompt of a reviewer rule.

### status

`enforced`, the default, or `advisory`. A finding of an enforced rule in the change is an error and fails the run. A finding of an advisory rule is a warning and never fails it.

### context

A list of paths from the root, for a reviewer rule only; on a script rule it is `law-invalid`. Each path names a file git lists that is not binary. The reviewer gets each of these files with every file it judges for the rule (`lawcheck docs reviewer-rules`).

## types

A mapping from type id to type.

### about

One line that describes the type. `lawcheck explain` and `lawcheck prime` print it.

### paths

The patterns of the type's files, required, at least one without `!`, in the syntax of the section "Patterns" below.

### content

A JavaScript regular expression with the flag `m`. A file that matches `paths` takes the type only when its text matches the expression somewhere. An expression JavaScript cannot compile is `law-invalid`, with JavaScript's own message.

### rules

Rule ids that bind the type's files. Each id must be a rule of the law. An id listed twice counts once.

### may_use

The types whose files this type's files may use. A type without the key takes the list of its nearest ancestor that has one: that is the list in force. Without a list anywhere above, a file may use anything.

A list allows a target whose type is a listed type or a subtype of one. A type may use its own files only when its list names it. `may_use: []` allows nothing. No list allows a use of a file with no type. Lawcheck does not judge a use of a binary file, nor a file's use of itself. Each id must be a type of the law, and each use the list does not allow is `forbidden-use`. `lawcheck docs languages` says which uses are read.

### types

The subtypes of the type, with the same keys (section "The type of a file" below).

### waivers

`false` makes a waiver marker in the type's files plain text, so a page or a test that writes about waivers can have a type. Without the key a type takes its parent's value, and a root type reads waivers.

## Ids

A rule id and a type id are kebab-case: `[a-z0-9]+(-[a-z0-9]+)*`. A type id is unique in the whole tree. A key that YAML reads as no string, such as `true` or `12`, is `law-invalid`; quote it.

A rule id may not equal a code of Lawcheck (`lawcheck docs codes` lists them), nor `untyped-file`. So `forbidden-use`, `uses-not-read`, `parser-failed` and `already-initialized` are reserved.

## Patterns

A pattern matches the whole path from the root, case-sensitive on every system.

- `*` matches any run of characters without `/`, the empty run included, and `?` one such character. A leading dot in a name is a character like any other, so `*` matches `.env`.
- `**` is a whole segment. Before the last segment it matches any number of directories, none included. As the last segment it matches every file below its directory at any depth, and not the directory's own path.
- `{a,b}` is one of its alternatives. An alternative is not empty, holds no `/`, `{`, `}` or `,`, and may hold `*` and `?`.
- Other characters are literal, and there is no escape.
- A leading `!` excludes. A file matches a list when it matches one plain pattern and no exclusion. The order of the list means nothing.

An empty pattern, an empty segment, a segment `.` or `..`, `**` beside other characters in one segment, `!` alone, and a brace that is nested, unclosed or unopened, or that holds a `/` or an empty alternative, are `law-invalid`.

## The type of a file

The files are the ones `git ls-files --cached --others --exclude-standard` lists at the root, regular files only. A symbolic link and a file git ignores have no type, and neither do `.lawcheck/verdicts` and `.lawcheck/.gitattributes`. A file whose first 8,000 bytes hold a NUL byte is binary and has no type. A file whose name holds a line break, a carriage return, a backslash or bytes that are not UTF-8 is judged like any other, and its name prints with `\n`, `\r`, `\\` and `\xHH` in their place. Lawcheck does not look into a submodule or a repository of its own inside this one, and prints a note when a type's paths reach into one.

Lawcheck tests a file against the root types, `paths` first and then `content`, then against the subtypes of the one that matched, and so on down. The deepest match is the file's type. The rules of every type on the way down bind the file, each once. A file that no type matches is never judged.

Two types of one level that both match a file are `type-overlap`, and every run stops with exit 2. Add a `!` pattern or a `content` to one of them. `lawcheck explain <path>` shows how a file got its type.

## Rule files

Each rule has one file in `.lawcheck/rules/`:

- `<id>.mjs` for a script rule (`lawcheck docs script-rules`);
- `<id>.md` for a reviewer rule (`lawcheck docs reviewer-rules`).

A rule with neither file, or with a reviewer file of whitespace only, is `rule-missing-file`, and one with both is `rule-file-without-entry`. Any other file in `.lawcheck/rules/` is `rule-file-without-entry`, except below `.lawcheck/rules/lib/`, where a script rule keeps the code it imports. Lawcheck sees the files git lists, so a rule file git ignores is missing.

Next: [Settings](config.md)
