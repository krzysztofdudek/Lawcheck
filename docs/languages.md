# Languages and uses

A file of the domain layer imports the command layer, and the law forbids it. For each judged file of a type with a `may_use` list in force, `check` reads what the file uses, and reports each use the list does not allow as `forbidden-use`. Lawcheck reads no uses in the files of a type without a list.

## The languages whose uses are read

Lawcheck reads twelve languages under thirteen ids, since `tsx` is TypeScript with JSX. It takes a file's language from its extension, in any case:

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

A `.vue` or `.svelte` file is read through its script block, as TypeScript or JavaScript, or uses the file a relative `<script src>` names; a script in an HTML comment is not read, and without a script the file uses nothing.

A use is one reference the reader reports: an import, an `export ... from`, a type-only import, a `require` or an `import()` with a literal string, a `vi.mock` or `jest.mock` with a literal path, an `#include`, a `use`, a `mod` declaration, a path to a crate written in code, `require` and `require_relative`, a name of the same package written without an import, a type named in a declaration, a call or a `new`.

The readers come from Runes and report no dynamic form: `import()` of a variable, `importlib.import_module`, reflection strings, `const_get`.

## Languages that read other files' declarations

Java, Kotlin, C#, Ruby and Rust bind a name through what other files declare. A run that reads the uses of one file of the groups {Java, Kotlin}, {C#}, {Ruby} or {Rust} also reads the declarations of every file of that group in the repository, typed or not. Such a run costs most in Java; a file of any size with syntax errors has no bound.

The other languages resolve by path, through files such as `tsconfig.json`, `go.mod` and `composer.json`.

## Unresolved uses

A use the readers do not resolve to a single file is unresolved, unless they say it leaves the repository: Lawcheck does not count a use of the standard library or of an installed package. An unresolved use is neither allowed nor forbidden: it is never a finding and never changes the exit code.

The first line counts them for the change, the debt heading for the rest, and `--json` lists each with the readers' answer:

| Answer | Reason | Meaning |
|---|---|---|
| `none` | `unfollowed` | the use names a place of the repository that holds no file: a file the build writes and git ignores, an alias or a workspace package whose entry is build output, a name of the repository's own package that no file declares |
| `none` | `unowned` | the use binds a file that no type maps; `candidates` names it |
| `none` | none | the readers cannot say where it points, as in a Rust file of no Cargo package |
| `ambiguous` | none | the use could name several files of different types, or typed and untyped files; `candidates` lists them. Lawcheck does not judge it, even when the list forbids every one |

Outside, by language: TypeScript and JavaScript, an installed package or a Node built-in; Python, a module whose top-level name no root of the repository holds; Go, an import path no module of the repository holds; Rust, a crate the repository does not hold (`std`, a registry dependency); PHP, a class under no prefix of the repository's Composer maps; Java and Kotlin, a name in a package the repository declares nothing in, a `java.lang` name, a Kotlin default import (`String`, `List`), and a simple name an on-demand import of such a package can give (`List` under `import java.util.*;`); C#, a name only a namespace from elsewhere can give (`System.Text`); C and C++, an `#include <...>` of a header the repository does not hold (`<stdio.h>`); Ruby, a gem, the standard library and a constant the repository does not declare (`JSON`). A quoted `#include` of a library header (`"gtest/gtest.h"`), or one that needs `-I` when `compile_commands.json` is not in git, is `unfollowed`.

## Known limits

- Java, Kotlin and C#: a name that a library also declares into a package or namespace of the repository counts as the repository's, so it is `unfollowed`. A Java member type inherited from a supertype outside the repository (`Entry` of a class that extends `java.util.AbstractMap`) is outside, unless the class's package declares a type of that name, which then takes the use.
- Java and Kotlin: a type an annotation processor generates into the file's own package (`AutoValue_Use`, `DaggerAppComponent`) counts as outside when a star import of a library could give its simple name, so Lawcheck drops a use of it without a count; without such a star import it is `unfollowed`.
- Go: an import of a package whose files have more than one type is `ambiguous` with the package's files.
- TypeScript: the readers take a package's `types@<range>` export keys as TypeScript 7.0.2 does.
- C#: a member inherited from a base class outside the repository (`ControllerBase.User`) lets a type of the repository with that name take the use.
- Rust `[patch]`: the readers compare no versions, read no `exclude` or `package.workspace` of a workspace, and match a GitHub URL as written.
- Rust: the readers skip paths inside a macro invocation and `include!`.
- Python, Go, Ruby, C and C++: a file with lone CR line ends can give fewer uses than the same file with LF line ends.

## Forms the readers miss

A use a reader misses is neither judged nor counted, and the output shows nothing. A script rule can check the forms that matter.

- TypeScript and JavaScript: `import.meta.glob` and `require.context` are not read. An alias only a bundler defines (Vite or webpack `resolve.alias`, Babel `module-resolver`) is read when its target is `fileURLToPath(new URL('./src', import.meta.url))`, `path.resolve(__dirname, 'src')` or, in Babel, a relative path; an alias written another way, such as through a variable, is not followed, and its uses are counted as unresolved. Put such an alias in `tsconfig.json` `paths` too.
- Rust: a `mod` with `#[path]` inside an inline module, a function body or a `cfg_if!` branch, or under a `cfg_attr`, gives no use, and neither does a `use` in a `cfg_if!` branch.
- Java: a fully qualified name is read in a field type, and not in a call, an annotation or `Class.forName`.
- Python: `from . import x`, where `x` is a name `__init__.py` defines, is counted as unresolved, while `from .m import x` and `from pkg.m import x` are judged.

## uses-not-read

A text file of a type with a list in force, in a language without a reader, cannot be checked against the list. Lawcheck does not show that list as kept:

```text
.lawcheck/law.yaml:4  warning[uses-not-read]  1 file of type domain is not read for uses: 1 .json
```

The warning comes once per type, at its line in the law, with the files counted by extension. It never fails a run and cannot be waived. To clear it, narrow the type's `paths` to files with a reader, or give the others a type without a list. `lawcheck doctor` counts these files in its `readers` check.

Lawcheck reads a file over 512 KiB neither for its uses nor, in Java, Kotlin, C#, Ruby and Rust, for what it declares. It gets `uses-not-read` at its own path, typed or not: an error in the change, a warning in debt.

## parser-failed

A grammar that cannot be loaded, or a reader that fails on a file, stops the run with `parser-failed`, exit 2.
