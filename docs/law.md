# The law file

The law is `.lawcheck/law.yaml`. Lawcheck finds it by walking up from the current directory. The nearest directory that holds it is the root: git and the rules run there, and every path is relative to it. A root below the top of the git work tree sees only the files below it.

## Keys

| In | Key | Required | Value |
|---|---|---|---|
| top | `lawcheck` | yes | the version as `MAJOR.MINOR.PATCH`; only its form is checked |
| top | `rules` | no | a mapping of rule id to rule |
| top | `types` | no | a mapping of type id to root type |
| rule | `why` | yes | one line of at most 200 characters, printed with the rule's findings |
| rule | `status` | no | `enforced` (the default) or `advisory` |
| rule | `context` | no | for a reviewer rule only: paths of files the reviewer also receives |
| type | `about` | no | one line that describes the type |
| type | `paths` | yes | patterns, at least one without `!` |
| type | `content` | no | a JavaScript regular expression with the flag `m`; the file belongs only when its text matches |
| type | `rules` | no | rule ids |
| type | `may_use` | no | type ids whose files this type's files may use |
| type | `types` | no | subtypes, of the same shape |
| type | `waivers` | no | `false` makes a waiver marker in the type's files plain text; a subtype takes its parent's value |

`why` and `about` take a non-empty string without a line break. A null, a string where a list belongs, a number or an empty file is `law-invalid`. Any other key is `law-invalid`, and the message names the nearest known key.

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

## How a file gets its type

The files are the ones `git ls-files --cached --others --exclude-standard` lists at the root, regular files only. A symbolic link and a file git ignores have no type. A file whose name holds a line break, a carriage return, a backslash or bytes that are not UTF-8 is judged like any other, and its name is printed with `\n`, `\r`, `\\` and `\xHH` in their place; `explain` and `try` take it that way. Lawcheck does not look into a submodule or a repository of its own inside this one, and says so when a type's paths reach into one. A file whose first 8,000 bytes hold a NUL byte is binary and has no type, whatever its size. A file read as text may hold 16 MiB and 1,048,576 lines, and the files a run reads 128 MiB together; past either the run stops with `file-too-large` or `text-too-large` and names the file. The law itself may hold 1 MiB, 10,000 rules and 1,000 types.

Lawcheck tests a file against the root types, `paths` first and then `content`, then against the subtypes of the one that matched, and so on down. The deepest match is the file's type. The rules of every type on the way down bind the file, each once. A file that no type matches is never judged.

Two types of one level that both match a file are `type-overlap`, and every run stops with exit 2. Add a `!` pattern to one of them. `lawcheck explain <path>` shows how a file was typed.

## may_use

`may_use` names the types whose files a type's files may use. A type without the key takes the list of its nearest ancestor that has one: that is the list in force. Without a list anywhere above, a file may use anything.

A list allows a target whose type is a listed type or a subtype of one. A type may use its own files only when its list names it. `may_use: []` allows nothing. A use of a file with no type is not allowed by any list. A use of a binary file is not judged. Each use a list does not allow is `forbidden-use`. `lawcheck docs languages` says which uses are read.

## Rule files

Each rule has one file in `.lawcheck/rules/`:

- `<id>.mjs` for a script rule (`lawcheck docs script-rules`);
- `<id>.md` for a reviewer rule (`lawcheck docs reviewer-rules`).

A rule with neither file is `rule-missing-file`, and one with both is `rule-file-without-entry`. Any other file in `.lawcheck/rules/` is `rule-file-without-entry`, except below `.lawcheck/rules/lib/`, where a script rule keeps the code it imports. Lawcheck sees the files git lists, so a rule file git ignores is missing.

A rule that no type lists judges nothing.
