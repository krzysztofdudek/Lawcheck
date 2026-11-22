# Languages and uses

A file of the domain layer imports a file of the command layer, and the law forbids that [use](concepts.md#use). A type's `may_use` list names the types its files may use. A file's list in force is the list of its own type, or of the nearest type above it that has one. `lawcheck check` reads the uses of each judged file that has a list in force. It reports each use that the list does not allow as `forbidden-use`.

A reader is the part of Lawcheck that parses the files of one language and reports their uses. The readers come from Runes, the parsing library that Lawcheck depends on. Each reader loads a grammar. A grammar is a file that describes the syntax of one language, and Lawcheck's installation holds 13 of them.

## The languages whose uses are read

Lawcheck reads twelve languages under thirteen ids. The extra id is `tsx`, for TypeScript with JSX. Lawcheck takes a file's language from its extension and ignores the case of the extension:

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

Lawcheck reads a `.vue` or `.svelte` file through its script block, as TypeScript or JavaScript. A file with a relative `<script src>` uses the file that this attribute names. The readers skip a script inside an HTML comment. A `.vue` or `.svelte` file with no script uses nothing.

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

Java, Kotlin, C#, Ruby and Rust bind a name through what other files declare. The readers take these languages in four groups: Java with Kotlin, C#, Ruby, and Rust. When a run reads the uses of one file of a group, it reads the declarations of every file of that group in the repository. It reads them in files with a type and in files without one. Such a run costs the most in Java. Lawcheck sets no limit on what a file with syntax errors costs, whatever its size.

The readers of the other languages resolve a use by its path. The readers consult files such as `tsconfig.json`, `go.mod` and `composer.json` to do it.

The Python reader searches the root of the repository, a `src` layout, and the roots that `pyproject.toml` or `setup.cfg` name. It does not read `setup.py`.

The Go reader follows `go.work` and a `replace` with a relative directory of the repository. It does not follow a `replace` by another version, or a `replace` to a directory outside the repository.

## Unresolved uses

A reader resolves a use to the file that the use names. A use that the readers cannot resolve to a single file is unresolved. The readers report some uses as outside the repository, such as a use of the standard library or of an installed package. Lawcheck does not count those uses.

Lawcheck neither allows nor forbids an unresolved use. An unresolved use is never a finding. It never changes the exit code.

The first line of `check` counts the unresolved uses of the change. The debt heading counts those of the other files. `--json` lists each one with the readers' answer:

| Answer | Reason | Meaning |
|---|---|---|
| `none` | `unfollowed` | the use names a place of the repository that holds no file: a file the build writes and git ignores, an alias or a workspace package whose entry is build output, a name of the repository's own package that no file declares |
| `none` | `unowned` | the use binds a file that no type maps; `candidates` names it |
| `none` | none | the readers cannot say where it points, as in a Rust file of no Cargo package |
| `ambiguous` | none | the use could name several files of different types, or typed and untyped files; `candidates` lists them. Lawcheck does not judge it, even when the list forbids every one |

The readers count these uses as outside the repository:

- TypeScript and JavaScript: an installed package or a Node built-in;
- Python: a module whose top-level name no root of the repository holds;
- Go: an import path that no module of the repository holds;
- Rust: a crate the repository does not hold (`std`, a registry dependency);
- PHP: a class under no prefix of the repository's Composer maps;
- Java and Kotlin: a name in a package the repository declares nothing in, a `java.lang` name, a Kotlin default import (`String`, `List`), and a simple name that an on-demand import of such a package can give (`List` under `import java.util.*;`);
- C#: a name that only a namespace from elsewhere can give (`System.Text`);
- C and C++: an `#include <...>` of a header the repository does not hold (`<stdio.h>`);
- Ruby: a gem, the standard library and a constant the repository does not declare (`JSON`).

The readers report two kinds of `#include` as `unfollowed`. The first is a quoted `#include` of a library header (`"gtest/gtest.h"`). The second is an `#include` that needs `-I` while `compile_commands.json` is not in git.

## Known limits

- Java, Kotlin and C#: a library can declare a name into a package or namespace of the repository. The readers count that name as the repository's. Its use is then `unfollowed`.
- Java: a class can inherit a member type from a supertype outside the repository, such as `Entry` of a class that extends `java.util.AbstractMap`. The readers count that member type as outside the repository. When the class's package declares a type of the same name, that type takes the use instead.
- Java and Kotlin: an annotation processor is a tool that the compiler runs to generate code. It can generate a type into the file's own package, such as `AutoValue_Use` or `DaggerAppComponent`. A star import, such as `import java.util.*;`, brings in every name of a package. When a star import of a library could give the generated type's simple name, the readers count the type as outside. Lawcheck then drops a use of it and counts nothing. Without such a star import, the use is `unfollowed`.
- Go: the files of one package can have more than one type. An import of such a package is `ambiguous`, and its `candidates` are the package's files.
- TypeScript: the readers read the `types@<range>` export keys of a package the way TypeScript 7.0.2 reads them.
- C#: a class can inherit a member from a base class outside the repository, such as `ControllerBase.User`. A type of the repository with the member's name then takes the use.
- Rust `[patch]`: the readers compare no versions. The readers read no `exclude` and no `package.workspace` of a workspace. The readers match a GitHub URL as the manifest writes it.
- Rust: the readers skip the paths inside a macro invocation and inside `include!`.
- Line ends: a lone CR is a carriage return with no line feed (LF) after it. In Python, Go, Ruby, C and C++, a file with lone CR line ends can give fewer uses than the same file with LF line ends.
- Line numbers: Lawcheck ends a line at an LF, with or without a CR before it, and never at a lone CR. Lawcheck numbers the lines of uses, findings and waivers this way. It gives each use the number of the line that holds the start of the use. A waiver on that line covers the use, in a file with lone CR line ends too.

## Forms the readers miss

Lawcheck neither judges nor counts a use that a reader misses. The output shows nothing about such a use. A [script rule](concepts.md#script-rule) can check the forms that matter to you.

- TypeScript and JavaScript: the readers do not read `import.meta.glob` and `require.context`.
- TypeScript and JavaScript: some aliases live in a bundler's settings alone, such as Vite or webpack `resolve.alias` and Babel `module-resolver`. The readers read such an alias when its target is `fileURLToPath(new URL('./src', import.meta.url))` or `path.resolve(__dirname, 'src')`. In Babel, they read a relative path as a target too. The readers do not follow an alias written another way, such as through a variable. Lawcheck counts the uses of such an alias as unresolved. Put the alias in `tsconfig.json` `paths` as well.
- Rust: a `mod` with `#[path]` inside an inline module, a function body or a `cfg_if!` branch, or under a `cfg_attr`, gives no use. A `use` in a `cfg_if!` branch gives no use either.
- Java: the readers read a fully qualified name in a field type. The readers do not read it in a call, an annotation or `Class.forName`.
- Python: Lawcheck counts `from . import x` as unresolved when `x` is a name that `__init__.py` defines. It judges `from .m import x` and `from pkg.m import x`.

## uses-not-read

Lawcheck has no reader for some text files, such as `.json`. When such a file has a `may_use` list in force, Lawcheck cannot check its uses against the list. It warns with `uses-not-read`, so that it does not show the list as kept:

```text
.lawcheck/law.yaml:4  warning[uses-not-read]  1 file of type domain is not read for uses: 1 .json
```

Lawcheck gives this warning once per type, at the type's line in the law. It counts the files by extension. The warning never fails a run, and a waiver cannot drop it. To clear it, narrow the type's `paths` to files with a reader, or give the other files a type without a list. `lawcheck doctor` counts these files in its `readers` check.

Lawcheck does not read a file over 512 KiB for its uses. In Java, Kotlin, C#, Ruby and Rust, it does not read such a file for what it declares either. The file gets `uses-not-read` at its own path, whether it has a type or not. In the change, that finding is an error. In [debt](concepts.md#debt), it is a warning.

## parser-failed

Lawcheck stops the run with `parser-failed` and exit 2 in two cases: it cannot load a grammar, or a reader fails on a file.

Next: [Waivers](waivers.md)
