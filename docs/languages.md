# Languages and uses

A file of the domain layer imports a file of the command layer. The law forbids that [use](concepts.md#use). A type's `may_use` list names the types its files may use. A file's list in force is the list of its own type, or of the nearest type above it that has one. `lawcheck check` reads the uses of each judged file that has a list in force. It reports each use that the list does not allow as `forbidden-use`.

A reader is the part of Lawcheck that parses the files of one language and reports their uses. The readers come from Runes. Runes is the parsing library that Lawcheck depends on. Each reader loads a grammar. A grammar is a file that describes the syntax of one language. Lawcheck's installation holds 13 grammars.

## The languages whose uses are read

Lawcheck reads twelve languages under thirteen ids, because TypeScript with JSX has an id of its own, `tsx`. Lawcheck takes a file's language from its extension, whatever the case of its letters:

| Language id | Files |
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
| `cpp` | `.cpp`, `.cc`, `.cxx`, `.c++`, `.hpp`, `.hh`, `.hxx`, `.h++`, `.cppm`, `.ixx`, `.mpp`, `.ipp`, `.inl`, `.tpp`, `.txx`, and a `.h` whose directory holds a C++ file and no `.c` file |
| `php` | `.php` |
| `ruby` | `.rb`, `.rake`, `.gemspec`, `.ru`, and the files named `Rakefile`, `Gemfile`, `Guardfile`, `Capfile` and `Brewfile` |

Lawcheck reads a `.vue` or `.svelte` file through its script block, as TypeScript or JavaScript. Such a file with a relative `<script src>` uses the file that this attribute names. The readers skip a script inside an HTML comment. A `.vue` or `.svelte` file with no script uses nothing.

A reader reports each of these forms as a use:

- an import, or an `export ... from`;
- a type-only import;
- a `declare module` with a path;
- a `require` or an `import()` with a literal string;
- a `vi.mock` or `jest.mock` with a literal path;
- an `#include`;
- a `use`, or a `mod` declaration;
- a path to a crate written in code;
- `require` and `require_relative`;
- a name of the same package written without an import;
- a type named in a declaration, a call or a `new`.

A reader reports no dynamic form of a use, such as `import()` of a variable, `importlib.import_module`, a reflection string or `const_get`.

## Languages that read other files' declarations

In Java, Kotlin, C#, Ruby and Rust, a reader finds the file that a name points to by reading what other files declare. The readers take these languages in four groups: Java with Kotlin, C#, Ruby, and Rust. A run that reads the uses of one file of a group reads the declarations of every file of that group in the repository, with a type or without one. The first such run parses every file of the group. Later runs take the declarations of an unchanged file from the [reader cache](#the-reader-cache). Lawcheck sets no limit of its own on the time it takes to parse a file with syntax errors under 512 KiB.

The readers of the other languages find the file of a use by its path. To do it, they read files such as `tsconfig.json`, `go.mod` and `composer.json`.

The Python reader looks for modules in the top folder of the repository, in a `src` folder, and in the source folders that `pyproject.toml` or `setup.cfg` name. It does not read `setup.py`.

The Go reader follows `go.work` and a `replace` with a relative directory of the repository. It does not follow a `replace` that points outside the repository or names another version.

## The reader cache

Lawcheck keeps what each file of the four groups declares in `.lawcheck/.local/readers/`, one file per group. A later run parses again only the files whose uses it reads and the files that changed since the last run. In guava, a check of one changed Java file takes about 0.3 seconds with the cache and 6 seconds without it. In Newtonsoft.Json, a check of one changed C# file takes about 0.3 seconds with the cache and 4 seconds without it.

An entry of the cache counts only for the same path, the same text, the same grammar and the same versions of Lawcheck and Runes. A check with the cache gives the same output and exit code as a check without it. A damaged cache file counts as empty, and the run writes it again.

Lawcheck neither reads nor writes the cache when git lists a file under `.lawcheck/.local/`, or when that folder or its `readers/` folder is a link or holds a repository of its own. So a commit cannot bring a cache in. When Lawcheck cannot write the folder, the run gives the same output and parses every file of the group again next time.

To clear the cache, delete `.lawcheck/.local/readers/`. The next run parses every file of each group it reads.

## Unresolved uses

A reader resolves a use to the file that the use names. A use that the readers cannot resolve to a single file is unresolved. The readers report some uses as outside the repository, such as a use of the standard library or of an installed package. Lawcheck does not count those uses.

An unresolved use never becomes a finding: Lawcheck neither allows nor forbids it. It never changes the exit code of a run.

The first line of `check` counts the unresolved uses in the files of the change. Under `--full`, the debt heading counts those of the other files. In `--json`, Lawcheck lists each one with the readers' answer:

| Answer | Reason | Meaning |
|---|---|---|
| `none` | `unfollowed` | the use names a place of the repository that holds no file: a file the build writes and git ignores, an alias or a workspace package whose entry is build output, a name of the repository's own package that no file declares |
| `none` | `unowned` | the use names a file that has no type; `candidates` names it |
| `none` | none | the readers cannot say where it points, as in a Rust file of no Cargo package |
| `ambiguous` | none | the use could name several files of different types, or typed and untyped files; `candidates` lists them. Lawcheck does not judge it, even when the list forbids every one |

The readers count these uses as outside the repository:

- TypeScript and JavaScript: an installed package or a Node built-in;
- Python: a module whose top-level name no source folder of the repository holds;
- Go: an import path that no module of the repository holds;
- Rust: a crate the repository does not hold (`std`, a registry dependency);
- PHP: a class under no prefix of the repository's Composer maps;
- Java and Kotlin: a name in a package the repository declares nothing in, a `java.lang` name, a Kotlin default import (`String`, `List`), and a simple name that the import of a whole package of that kind can give (`List` under `import java.util.*;`);
- C#: a name that only a namespace from elsewhere can give (`System.Text`);
- C and C++: an `#include <...>` of a header the repository does not hold (`<stdio.h>`);
- Ruby: a gem, the standard library and a constant the repository does not declare (`JSON`).

The readers report two kinds of `#include` as `unfollowed`. The first is a quoted `#include` of a library header (`"gtest/gtest.h"`). The second is an `#include` that needs an `-I` folder of the compiler, in a repository whose `compile_commands.json` is not in git.

## Known limits

- Java, Kotlin and C#: a library can declare a name into a package or namespace of the repository. The readers count that name as the repository's. Its use is then `unfollowed`.
- Java: a class can inherit a member type from a supertype outside the repository, such as `Entry` of a class that extends `java.util.AbstractMap`. The readers count that member type as outside the repository. If the class's package declares a type of the same name, the readers tie the use to that type instead.
- Java and Kotlin: an annotation processor is a tool that the compiler runs to generate code. It can generate a type into the file's own package, such as `AutoValue_Use` or `DaggerAppComponent`. A star import, such as `import java.util.*;`, imports a whole package. If a star import of a library could give the generated type's simple name, the readers count the type as outside. Lawcheck then leaves a use of it out and counts nothing. Without such a star import, the use is `unfollowed`.
- Go: the files of one package can have more than one type. An import of such a package is `ambiguous`. Its `candidates` are the package's files.
- TypeScript: the readers read the `types@<range>` export keys of a package the way TypeScript 7.0.2 reads them.
- C#: a class can inherit a member from a base class outside the repository, such as `ControllerBase.User`. The readers then tie the use to a type of the repository with the member's name.
- Rust `[patch]`: the readers compare no versions. The readers match a GitHub URL as the manifest writes it, letter for letter. In a workspace, they ignore `exclude` and `package.workspace`.
- Rust: the readers skip the paths inside a macro invocation and inside `include!`.
- Line ends: a lone CR is a carriage return with no line feed (LF) after it. In Python, Go, Ruby, C and C++, a file with lone CR line ends can give fewer uses than the same file with LF line ends.
- Line numbers: Lawcheck ends a line at an LF, with or without a CR before it, and never at a lone CR. Lawcheck numbers the lines of uses, findings and waivers this way. It gives each use the number of the line that holds the start of the use. A waiver on that line covers the use, in a file with lone CR line ends too.

## Forms the readers miss

Lawcheck neither judges nor counts a use that a reader misses. It prints nothing about such a use. A [script rule](concepts.md#script-rule) can check the forms that matter to you.

- TypeScript and JavaScript: the readers do not read `import.meta.glob` and `require.context`.
- TypeScript and JavaScript: an alias can sit in a bundler's settings alone, such as Vite or webpack `resolve.alias` and Babel `module-resolver`. The readers read such an alias when its target is `fileURLToPath(new URL('./src', import.meta.url))` or `path.resolve(__dirname, 'src')`. In Babel, they read a relative path as a target too. The readers do not follow an alias written another way, such as through a variable. Lawcheck counts the uses of such an alias as unresolved. Put the alias in `tsconfig.json` `paths` as well.
- Rust: a `mod` with `#[path]` inside an inline module, a function body or a `cfg_if!` branch, or under a `cfg_attr`, gives no use. A `use` in a `cfg_if!` branch gives no use either.
- Java: the readers read a fully qualified name in a field type. The readers do not read it in a call, an annotation or `Class.forName`.
- Python: Lawcheck counts `from . import x` as unresolved when `x` is a name that `__init__.py` defines. It judges `from .m import x` and `from pkg.m import x`.

## uses-not-read

Lawcheck has no reader for some text files, such as `.json`. If such a file has a `may_use` list in force, Lawcheck cannot check its uses against the list. It warns with `uses-not-read`, so that it does not show the list as kept:

```text
.lawcheck/law.yaml:4  warning[uses-not-read]  1 file of type domain is not read for uses: 1 .json
```

Lawcheck gives this warning once per type, at the type's line in the law. In the message, it counts the files by extension, such as `1 .json`. The warning never fails a run. A waiver cannot drop it. To clear it, narrow the type's `paths` to files with a reader, or give the other files a type without a list. `lawcheck doctor` counts these files in its `readers` check.

Lawcheck does not read a file over 512 KiB for its uses. In Java, Kotlin, C#, Ruby and Rust, it does not read such a file for what it declares either. Lawcheck reports `uses-not-read` at the file's own path, whether the file has a type or not. That finding is an error in the change and a warning in [debt](concepts.md#debt).

## parser-failed

Lawcheck stops the run with `parser-failed` and exit 2 in two cases: it cannot load a grammar, or a reader fails on a file.

Next: [Waivers](waivers.md)
