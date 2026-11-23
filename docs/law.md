# The law file

An agent writes a database call into a page component. The build stays green. The law is the file `.lawcheck/law.yaml`. In it, you say which kinds of files the repository has, and which rules the files of each kind keep. Under a law whose page components may not use the database code, Lawcheck reports that call as `forbidden-use`.

Lawcheck looks for the file in the current directory, then in each directory above it. The nearest directory that holds it is the root of the law. Lawcheck runs git and the script rules in the root. Every path of the law starts there. When the root lies below the top of the git work tree, Lawcheck judges only the files below the root. A law past 1 MiB, 10,000 rules or 1,000 types, subtypes included, stops the run with `file-too-large`.

## Keys

| Key | In | Value |
|---|---|---|
| `lawcheck` | top | `MAJOR.MINOR.PATCH`, required |
| `required` | top | patterns of files that must have a type |
| `ignored` | top | patterns of files that the law leaves out |
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

Lawcheck stops with `law-invalid` in these cases:

- a key outside the table;
- a key written twice;
- an empty file;
- a value of the wrong kind.

When a key outside the table differs by one or two letters from a known key, the `law-invalid` message ends with a hint that names the known key, such as `(did you mean 'paths'?)`.

A YAML alias, such as `*base`, stands for the value that an anchor, such as `&base`, marks. Lawcheck reads an alias as the value of its anchor.

Lawcheck stops with `law-invalid` when a type holds itself through an alias. For example, a subtype `again: *source` under `source: &source` makes `source` hold itself.

The law below uses every key of the table except `required`, `ignored`, `context`, `may_use` and `waivers`:

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

`lawcheck` holds the version of the law's format. Lawcheck checks that the value has the form `MAJOR.MINOR.PATCH`, such as `0.1.0`. It does not compare the value with its own version. `lawcheck init` writes its own version there.

## required

`required` lists the patterns of the files that must have a type. The section "Patterns" below gives their syntax. A text file that git lists, that a pattern of `required` matches and that no type takes is the finding `untyped-file`. With `required: ["src/**"]`, a file that an agent adds in a new folder `src/gen/` fails the check until a type takes it.

With `required: ["src/**"]` and a type whose `paths` take only `src/**/*.ts`, a stylesheet or an empty placeholder file in `src/` is also `untyped-file`. A `!` pattern leaves such files out of `required`, as in `required: ["src/**", "!src/**/*.css"]`.

`untyped-file` is an error in the change and a warning in debt, like `forbidden-use`. A binary file, a symbolic link and a file under `ignored` are never `untyped-file`. Without `required`, a file that no type takes is no finding.

A non-empty `required` needs at least one pattern without `!`. A wrong pattern is `law-invalid`.

## ignored

`ignored` lists the patterns of the files that the law leaves out. A file that a pattern of `ignored` matches has no type, even when the paths of a type match it. No rule judges it, its waivers are not read, and it is never `untyped-file`. A use of such a file is a use of a file with no type, so a `may_use` list in force forbids it.

`ignored` suits generated code inside a folder under `required`, such as `ignored: ["src/gen/**"]`. A non-empty `ignored` needs at least one pattern without `!`.

## rules

`rules` maps each rule id to its rule. Each rule has one file in `.lawcheck/rules/` (section "Rule files" below). Lawcheck judges no file against a rule that no type lists. For such a rule, `lawcheck explain --rule <id>` says so.

### why

`why` is one line of at most 200 characters. Every rule needs it. Lawcheck prints it under each finding of the rule. Each prompt that Lawcheck sends for a reviewer rule holds it.

### status

`status` is `enforced`, the default, or `advisory`. A finding of an enforced rule in the [change](concepts.md#change) is an error, which makes the run exit 1. A finding of an advisory rule is a warning, which leaves the exit code at 0.

### context

`context` is a list of paths from the root, for a reviewer rule alone. On a script rule, `context` is `law-invalid`. Each path names a file that git lists and that is not binary. The reviewer gets each of these files with every file it judges for the rule (`lawcheck docs reviewer-rules`).

## types

`types` maps each type id to its type.

### about

`about` is one line that describes the type. `lawcheck explain` and `lawcheck prime` print it.

### paths

`paths` lists the patterns of the type's files. Every type needs it. At least one of its patterns must have no `!`. The section "Patterns" below gives their syntax.

### content

`content` is a JavaScript regular expression with the flag `m`. A file that matches `paths` takes the type only when the expression matches a part of its text. An expression that JavaScript cannot compile is `law-invalid`. The message gives JavaScript's own words.

### rules

`rules` lists the ids of the rules that the type's files keep. Each id must be a rule of the law. An id listed twice counts once.

### may_use

`may_use` lists the types whose files this type's files may [use](concepts.md#use). A type without the key takes the list of the nearest type above it that has one. That list is the list in force for the type. With no list on the type or above it, a file of the type may use any file. Lawcheck then reads none of its uses.

A list in force works this way:

- it allows a target whose type is a listed type or a subtype of one;
- a type may use its own files only when its list names it;
- `may_use: []` allows no use;
- no list allows a use of a file that has no type;
- each id of the list must be a type of the law.

Lawcheck does not judge a use of a binary file, nor a file's use of itself. It reports each use that the list does not allow as the finding `forbidden-use`. `lawcheck docs languages` lists, for each language, the forms of a use that Lawcheck reads.

### types

`types` holds the subtypes of the type, with the same keys (section "The type of a file" below).

### waivers

With `waivers: false`, Lawcheck reads a waiver marker in the type's files as plain text. That way, a documentation page or a test whose text quotes the marker can have a type and waive nothing. Without the key, a type takes the value of its parent. In a type at the top of `types` without the key, Lawcheck reads waivers.

## Ids

A rule id and a type id are kebab-case: lower-case letters and digits, in words joined by `-`. The pattern is `[a-z0-9]+(-[a-z0-9]+)*`. Each type id may appear once in the whole tree of types. A key that YAML reads as no string, such as `true` or `12`, is `law-invalid`. Write such a key in quotes.

A rule id may not equal a code of Lawcheck (`lawcheck docs codes` lists the codes). The reserved ids include `forbidden-use`, `uses-not-read`, `untyped-file`, `parser-failed` and `already-initialized`.

## Patterns

A pattern matches the whole path from the root. A segment is the part of a path between two `/`, or before the first or after the last. A pattern tells upper case from lower case on every system.

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

Lawcheck takes the regular files that `git ls-files --cached --others --exclude-standard` lists at the root. These listed files have no type:

- a symbolic link;
- a file that git does not track and `.gitignore` names;
- `.lawcheck/verdicts` and `.lawcheck/.gitattributes`;
- a binary file, which Lawcheck tells by a byte of value 0 in its first 8,000 bytes;
- a file that a pattern of `ignored` matches.

Lawcheck judges a file like any other when its name holds a line break, a carriage return, a backslash or bytes that are not UTF-8. It prints such a name with `\n`, `\r`, `\\` and `\xHH` in their place.

A submodule is a git repository held inside another one. Lawcheck judges no file of a submodule, or of another repository inside this one. It prints a note when the paths of a type reach into one.

Lawcheck tests a file against the types at the top of `types`, `paths` first and then `content`. It then tests the file against the subtypes of the type that matched, one level at a time. The deepest match is the type of the file. The rules of every type on the way down bind the file, each rule once. No rule judges a file that no type matches. Under `required`, such a file is the finding `untyped-file`.

When two types of one level both match a file, every run stops with `type-overlap` and exit 2. To split two types by path, add a `!` pattern to one of them. To give some files of a type a type of their own by their text, make a subtype with a `content` expression under that type ([Types for an existing project](types-for-a-project.md#_14-give-the-tests-beside-the-code-a-type-by-their-text)). A second type of the same level with the same `paths` and a `content` overlaps the first, because the first type matches every file that the second one matches. `lawcheck explain <path>` shows how a file got its type.

## Rule files

Each rule has one file in `.lawcheck/rules/`:

- `<id>.mjs` for a script rule (`lawcheck docs script-rules`);
- `<id>.md` for a reviewer rule (`lawcheck docs reviewer-rules`).

Lawcheck stops with exit 2 and one of two codes when the rule files do not match the law:

- `rule-missing-file`, for a rule with neither file, or with a reviewer file that holds only whitespace;
- `rule-file-without-entry`, for a rule with both files, and for any other file in `.lawcheck/rules/` outside `.lawcheck/rules/lib/`.

A script rule keeps the code it imports in `.lawcheck/rules/lib/`. Lawcheck sees only the files that git lists, so a rule file that git does not track and `.gitignore` names counts as missing.

Next: [Settings](config.md)
