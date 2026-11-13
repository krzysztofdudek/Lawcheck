# Languages and uses

When a type has a `may_use` list in force (`lawcheck docs law`), `check` reads what each judged file of that type uses, and reports each use the list does not allow as `forbidden-use`. Files of types without a list are never read for uses.

## The languages whose uses are read

| Language id | Extensions |
|---|---|
| `typescript` | `.ts`, `.mts`, `.cts` |
| `tsx` | `.tsx` |
| `javascript` | `.js`, `.mjs`, `.cjs`, `.jsx` |
| `python` | `.py` |
| `go` | `.go` |
| `rust` | `.rs` |
| `java` | `.java` |
| `kotlin` | `.kt`, `.kts` |
| `csharp` | `.cs` |
| `c` | `.c`, `.h` |
| `cpp` | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`; a `.h` whose directory holds a C++ file and no `.c` file |
| `php` | `.php` |
| `ruby` | `.rb` |

A `.vue` or `.svelte` file is read through its script block, as TypeScript or JavaScript; without one it uses nothing.

A use is one reference the reader reports: an import, an `export ... from`, a type-only import, a `require` or an `import()` with a literal string, an `#include`, a `use`, a `mod` declaration, `require_relative`, a name of the same package written without an import, a type named in a declaration, a call or a `new`. Every reported use counts, whether or not the code runs it.

The readers come from Runes. A use they do not report is never a `forbidden-use` and is not counted. Dynamic forms are not reported: `import()` of a variable, `importlib.import_module`, reflection strings, `const_get`.

## Languages that read other files' declarations

Java, Kotlin, C#, Ruby and Rust bind a name through what other files declare. When a run reads the uses of one file of the groups {Java, Kotlin}, {C#}, {Ruby} or {Rust}, it also reads the declarations of every file of that group in the repository, with a type or without. Such a run costs more in a large repository.

The other languages resolve by path, through files such as `tsconfig.json`, `package.json`, `go.mod`, `Cargo.toml` and `composer.json`, and read no declarations.

## Unresolved uses

A use the readers do not resolve to exactly one file is unresolved: they answer that it is ambiguous, or they find no file. Lawcheck never guesses from the name what it meant. An unresolved use is neither allowed nor forbidden: it is never a finding and never changes the exit code.

Each run counts them, in the first line for the changed files and in the debt heading for the others, and `--json` lists each one with the readers' answer. Most of them are outside packages: the standard library and dependencies. A file the build writes and git ignores does not exist for the readers, so a use of it is unresolved too.

## uses-not-read

A text file of a type with a list in force, in a language without a reader, cannot be checked against the list. Lawcheck does not show that list as kept:

```text
.lawcheck/law.yaml:4  warning[uses-not-read]  1 file of type domain is not read for uses: 1 .json
```

The warning is one per type, at the type's line in the law, with the count of such files by extension. It never fails a run and cannot be waived. To clear it, narrow the type's `paths` to files with a reader, or give those files a type of their own without a list.

`lawcheck doctor` counts these files for the whole repository in its `readers` check, and loads every grammar, so a broken install shows before a check needs one.

## parser-failed

A grammar that cannot be loaded, or a reader that fails on a file, stops the run with `parser-failed`, exit 2. A file whose uses were not read is not taken to use nothing.
