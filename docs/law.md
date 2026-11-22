# The law file

An agent writes a database call into a page component. The build stays green. The law is the file `.lawcheck/law.yaml`. In it, you say which kinds of files the repository has, and which rules bind each kind.

Lawcheck looks for the file in the current directory, then in each directory above it. The nearest directory that holds it is the root. Git and the rules run in the root. Every path of the law starts there. A root below the top of the git work tree sees only the files below it. The law may hold 1 MiB, 10,000 rules and 1,000 types, subtypes included. A larger law is `file-too-large`.

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

Any other key is `law-invalid`. The message names a known key that is one or two letters away. A key written twice, an empty file and a value of the wrong kind are `law-invalid` too. A YAML alias, such as `*base`, stands for the value that an anchor, such as `&base`, marks. Lawcheck reads an alias as the value of its anchor. A type that holds itself through an alias is `law-invalid`.

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

`lawcheck` holds the version of the law's format, such as `0.1.0`. Lawcheck checks the form of the value. It does not compare the value with its own version. `lawcheck init` writes the version of the Lawcheck that ran it, as `MAJOR.MINOR.PATCH`.

## rules

`rules` maps each rule id to its rule. Each rule has one file in `.lawcheck/rules/` (section "Rule files" below). A rule that no type lists judges nothing. `lawcheck explain --rule <id>` says that such a rule is on no type.

### why

`why` is one line of at most 200 characters. Every rule needs it. Lawcheck prints it under each finding of the rule. Each prompt of a reviewer rule holds it as well.

### status

`status` is `enforced`, the default, or `advisory`. A finding of an enforced rule in the change is an error that fails the run. A finding of an advisory rule is a warning that never fails the run.

### context

`context` is a list of paths from the root, for a reviewer rule alone. On a script rule, `context` is `law-invalid`. Each path names a file that git lists and that is not binary. The reviewer gets each of these files with every file it judges for the rule (`lawcheck docs reviewer-rules`).

## types

`types` maps each type id to its type.

### about

`about` is one line that describes the type. `lawcheck explain` and `lawcheck prime` print it.

### paths

`paths` lists the patterns of the type's files. Every type needs it. At least one pattern has no `!`. The section "Patterns" below gives their syntax.

### content

`content` is a JavaScript regular expression with the flag `m`. A file that matches `paths` takes the type only when its text matches the expression somewhere. An expression that JavaScript cannot compile is `law-invalid`. The message gives JavaScript's own words.

### rules

`rules` lists the ids of the rules that bind the type's files. Each id must be a rule of the law. An id listed twice counts once.

### may_use

`may_use` lists the types whose files this type's files may [use](concepts.md#use). A type without the key takes the list of its nearest ancestor that has one. That list is the list in force for the type. Without a list anywhere above, a file may use anything.

A list allows a target whose type is a listed type or a subtype of one. A type may use its own files only when its list names it. `may_use: []` allows nothing. No list allows a use of a file with no type. Lawcheck does not judge a use of a binary file, nor a file's use of itself. Each id must be a type of the law. Each use that the list does not allow is `forbidden-use`. `lawcheck docs languages` says which uses Lawcheck reads.

### types

`types` holds the subtypes of the type, with the same keys (section "The type of a file" below).

### waivers

With `waivers: false`, Lawcheck reads a waiver marker in the type's files as plain text. A page or a test that writes about waivers can then have a type. Without the key, a type takes the value of its parent. A root type reads waivers.

## Ids

A rule id and a type id are kebab-case: lower-case letters and digits, in words joined by `-`. The pattern is `[a-z0-9]+(-[a-z0-9]+)*`. A type id is unique in the whole tree. A key that YAML reads as no string, such as `true` or `12`, is `law-invalid`. Write such a key in quotes.

A rule id may not equal a code of Lawcheck, or `untyped-file` (`lawcheck docs codes` lists the codes). Lawcheck reserves `forbidden-use`, `uses-not-read`, `parser-failed` and `already-initialized` this way, among the other codes.

## Patterns

A pattern matches the whole path from the root. It tells upper case from lower case on every system.

- `*` matches any run of characters without `/`, the empty run included. `?` matches one such character. A leading dot in a name is a character like any other: `*` matches `.env`.
- `**` is a whole segment. Before the last segment, it matches any number of directories, none included. As the last segment, it matches every file below its directory at any depth. It does not match the path of the directory itself.
- `{a,b}` matches one of its alternatives. An alternative is not empty. It holds no `/`, `{`, `}` or `,`, and it may hold `*` and `?`.
- Every other character matches itself. A pattern has no escape character.
- A leading `!` makes the pattern an exclusion. A file matches a list when it matches one plain pattern and no exclusion. The order of the list does not matter.

Lawcheck refuses these patterns with `law-invalid`:

- an empty pattern, or a pattern with an empty segment;
- a segment `.` or `..`;
- `**` beside other characters in one segment;
- `!` alone;
- a brace that is nested, unclosed or unopened, or that holds a `/` or an empty alternative.

## The type of a file

Lawcheck takes the files that `git ls-files --cached --others --exclude-standard` lists at the root, regular files alone. A symbolic link has no type. A file that git ignores has no type. `.lawcheck/verdicts` and `.lawcheck/.gitattributes` have no type either. A file whose first 8,000 bytes hold a NUL byte is binary. A binary file has no type. A file name may hold a line break, a carriage return, a backslash or bytes that are not UTF-8. Lawcheck judges such a file like any other. It prints the name with `\n`, `\r`, `\\` and `\xHH` in their place. Lawcheck does not look into a submodule, or into a repository of its own inside this one. It prints a note when the paths of a type reach into one.

Lawcheck tests a file against the root types, `paths` first and then `content`. It then tests the file against the subtypes of the type that matched, and so on down. The deepest match is the type of the file. The rules of every type on the way down bind the file, each rule once. Lawcheck never judges a file that no type matches.

Two types of one level that both match a file are `type-overlap`. Every run then stops with exit 2. To split two types by path, add a `!` pattern to one of them. To give some files of a type a type of their own by their text, make a subtype with a `content` expression under that type ([Types for an existing project](types-for-a-project.md#_14-give-the-tests-beside-the-code-a-type-by-their-text)). A second type of the same level with the same `paths` and a `content` still overlaps. The first type matches every file that the second one matches. `lawcheck explain <path>` shows how a file got its type.

## Rule files

Each rule has one file in `.lawcheck/rules/`:

- `<id>.mjs` for a script rule (`lawcheck docs script-rules`);
- `<id>.md` for a reviewer rule (`lawcheck docs reviewer-rules`).

A rule with neither file is `rule-missing-file`. A rule with a reviewer file of whitespace only is `rule-missing-file` too. A rule with both files is `rule-file-without-entry`. Any other file in `.lawcheck/rules/` is `rule-file-without-entry`, except the files below `.lawcheck/rules/lib/`. A script rule keeps the code it imports in that folder. Lawcheck sees the files that git lists. A rule file that git ignores counts as missing.

Next: [Settings](config.md)
