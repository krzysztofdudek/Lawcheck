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

A `.vue` or `.svelte` file is read through its script block, as TypeScript or JavaScript, or uses the file a relative `<script src>` names; a script in an HTML comment is not read, and without a script the file uses nothing.

A use is one reference the reader reports: an import, an `export ... from`, a type-only import, a `require` or an `import()` with a literal string, a `vi.mock` or `jest.mock` with a literal path, an `#include`, a `use`, a `mod` declaration, a path to a crate written in code, `require` and `require_relative`, a name of the same package written without an import, a type named in a declaration, a call or a `new`.

The readers come from Runes. Dynamic forms are not reported: `import()` of a variable, `importlib.import_module`, reflection strings, `const_get`.

## Languages that read other files' declarations

Java, Kotlin, C#, Ruby and Rust bind a name through what other files declare. When a run reads the uses of one file of the groups {Java, Kotlin}, {C#}, {Ruby} or {Rust}, it also reads the declarations of every file of that group in the repository, with a type or without. Such a run costs most in Java; a file of any size with syntax errors has no bound.

The other languages resolve by path, through files such as `tsconfig.json`, `package.json`, `go.mod`, `Cargo.toml` and `composer.json`, and read no declarations.

## Unresolved uses

A use the readers do not resolve to exactly one file is unresolved, unless they say it leaves the repository: a use of the standard library or of an installed package is not counted at all. Lawcheck never guesses what a use meant: outside, unfollowed or ambiguous is the readers' answer. An unresolved use is neither allowed nor forbidden: it is never a finding and never changes the exit code.

Each run counts them, in the first line for the changed files and in the debt heading for the others, and `--json` lists each one (`lawcheck docs json`) with the readers' answer:

| Answer | Reason | What it means |
|---|---|---|
| `none` | `unfollowed` | the use names a place of the repository that holds no file: a file the build writes and git ignores, an alias or a workspace package whose entry is build output the repository does not hold, a name of the repository's own package that no file declares |
| `none` | `unowned` | the use binds a file of the repository that no type maps; `candidates` names it |
| `none` | none | the readers cannot say where it points, as in a Rust file of no Cargo package |
| `ambiguous` | none | the use could name several files of different types, or of a type and no type; `candidates` lists them. It is not judged, even when the list forbids every one |

Outside, by language: TypeScript and JavaScript, an installed package or a Node built-in; Python, a module whose top-level name no root of the repository holds; Go, an import path no module of the repository holds; Rust, a path from a crate the repository does not hold (`std`, a registry dependency); PHP, a class under no prefix of the repository's Composer maps; Java and Kotlin, a name in a package the repository declares nothing in, a `java.lang` name and a Kotlin default import (`String`, `List`), and a simple name an on-demand import of such a package can give (`List` under `import java.util.*;`); C#, a name only a namespace from elsewhere can give (`System.Text`); C and C++, an `#include <...>` of a header the repository does not hold (`<stdio.h>`); Ruby, a gem, the standard library and a constant the repository does not declare (`JSON`). A quoted `#include` of a library header (`"gtest/gtest.h"`), or one that needs `-I` when `compile_commands.json` is not in git, is `unfollowed`.

## Known limits

- A Java, Kotlin or C# name that a library also declares into a package or namespace of the repository counts as the repository's, so it is `unfollowed`. A Java member type inherited from a supertype outside the repository (`Entry` of a class that extends `java.util.AbstractMap`) is `outside`, unless the class's package declares a type of that name, which then takes the use.
- Java and Kotlin: a type an annotation processor generates into the file's own package (`AutoValue_Use`, `DaggerAppComponent`) counts as outside when a star import of a library could give its simple name, so a use of that generated code is dropped without a count; without such a star import it is `unfollowed`.
- A Go import of a package whose files have more than one type is `ambiguous` with the package's files.
- TypeScript: a package's `types@<range>` export keys are read as TypeScript 7.0.2 reads them.
- C#: a member inherited from a base class outside the repository (`ControllerBase.User`) lets a type of the repository with that name take the use.
- Rust `[patch]`: the patched crate's version is not compared with the dependency's requirement, a workspace's `exclude` and `package.workspace` are not read, and a GitHub URL is matched as written.
- Rust: paths inside a macro invocation and `include!` are not read.
- Python, Go, Ruby, C and C++: a file with lone CR line ends can give fewer uses than the same file with LF line ends.

## Forms the readers miss

A use a reader misses is never a `forbidden-use` and is not counted, so a check can pass where the same use written another way fails, and nothing in the output shows it. Search the code for these forms; a script rule (`lawcheck docs script-rules`) can check the ones that matter.

- TypeScript and JavaScript: `import.meta.glob` and `require.context` are not read. An alias only a bundler defines (Vite or webpack `resolve.alias`, Babel `module-resolver`) is read when its target is `fileURLToPath(new URL('./src', import.meta.url))`, `path.resolve(__dirname, 'src')` or, in Babel, a relative path; an alias written another way, such as through a variable, is not followed, and its uses are counted as unresolved. Put such an alias in `tsconfig.json` `paths` too.
- Rust: a `mod` with `#[path]` inside an inline module, a function body or a `cfg_if!` branch, or under a `cfg_attr`, gives no use; nor does a `use` in a `cfg_if!` branch.
- Java: a fully qualified name is read in a field type, and not in a call, an annotation or `Class.forName`.
- Python: `from . import x`, where `x` is a name `__init__.py` defines, is counted as unresolved, while `from .m import x` and `from pkg.m import x` are judged.

## uses-not-read

A text file of a type with a list in force, in a language without a reader, cannot be checked against the list. Lawcheck does not show that list as kept:

```text
.lawcheck/law.yaml:4  warning[uses-not-read]  1 file of type domain is not read for uses: 1 .json
```

The warning is one per type, at the type's line in the law, with the count of such files by extension. It never fails a run and cannot be waived. To clear it, narrow the type's `paths` to files with a reader, or give the others a type without a list.

`lawcheck doctor` counts these files in its `readers` check, and loads every grammar, so a broken install shows before a check needs one.

## parser-failed

A grammar that cannot be loaded, or a reader that fails on a file, stops the run with `parser-failed`, exit 2. A file whose uses were not read is not taken to use nothing.
