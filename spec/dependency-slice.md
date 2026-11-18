# Lawcheck: the dependency slice

The third working slice: who may use whom, by type, read from the code. It extends `spec/check-slice.md` (slice one) and `spec/reviewer-slice.md` (slice two) and keeps their tests 1 to 79, with the amendments of section 9. A worker builds what this file says, and a reviewer ticks section 10. The conventions of the earlier slices hold: quoted text output is exact, byte for byte; JSON is compared as parsed data; for every other message this file fixes the code, the place and the exit code, and the worker words one line. Where this file says nothing, the earlier slices decide.

## 1. Scope

In: the law key `may_use` on a type; reading what each judged file uses with the language readers of Runes, as they are, for the twelve languages they read; judging each use Runes resolves to a file against the type's list; counting every use it does not resolve, except one that leaves the repository; the finding codes `forbidden-use` and `uses-not-read` and the exit-2 code `parser-failed` in `lawcheck check`; the grammars the package ships, with their licences; a measurement on two public repositories kept outside `npm test`; and the fix of a reviewer error message from slice two (section 8).

Out: what the design has and no slice builds yet is listed in [`deferred.md`](deferred.md), with where it is mentioned and why it waits. What this slice does in its place:

| Out | Here |
|---|---|
| `file.uses()`, `file.tree()` and `file.language` in a script rule | absent: a script rule receives what slice one gives it |
| waivers counted only inside real comments of a parsed language | absent: waivers stay text (slice one, decision 12) |
| telling an outside package from a use the readers could not follow | in, as Runes answers it since 1.1.0: a use that leaves the repository is not counted (section 4) |
| a cache of syntax trees or declarations in `.lawcheck/.local/`, and a bound on the size of a file the readers parse | absent: every run reads what it needs (section 3.4 gives the cost) |
| the readers' diagnostics about configuration files | not shown |
| JSON, YAML, TOML, and the languages Runes pins grammars for without a reader (Scala, Bash, Lua, Zig, Groovy, Solidity, Java properties) | no reader: `uses-not-read` where a list reaches the file |
| `doctor` and `explain` naming a file's language | absent with those commands |

## 2. The law file

One key more on a type:

| In | Key | Required | Meaning |
|---|---|---|---|
| type | `may_use` | no | Type ids: the types whose files a file of this type may use |

**Values.** `may_use` takes a sequence of strings, possibly empty, each the id of a type anywhere in the law. A null (the key left empty), a string, a number or a mapping in its place, an item that is no string and an item that names no type are `law-invalid`: at the item's line for an item, at the key's line otherwise. An id written twice counts once.

**The list in force.** A type's list is its own `may_use`. A type without the key takes the list of its nearest ancestor that has one. A type with no list on the way up is unrestricted, and the uses of its files are never read. A list is closed: a use is allowed when its target's type is a type the list names or a subtype of one, and forbidden otherwise. So:

- naming a type allows its subtypes, never its parent;
- a type whose files use each other names itself;
- a subtype's own list replaces its parent's, it does not add to it;
- `may_use: []` forbids every file of the repository, the type's own included.

**Files without a type.** A file with no type is never judged, as in slice one, so its uses are not read. A use of a text file with no type, from a type with a list, is `forbidden-use`: to close a list is to say where everything the type uses belongs. This is provisional: it takes the design's open question 14, option A, on which the owner has not ruled. Under option B the line `src/core/extra.ts:4` of test 85 and gson's two lines about `GsonBuildConfig.java` (section 11) go away. A use of a binary file is not governed, since slice one gives a binary file no type.

**Reserved ids.** A rule id may not equal `forbidden-use`, `uses-not-read` or `parser-failed`.

### The example: U

U is slice one's sample S with this `.lawcheck/law.yaml` in place of S's, kept in `tests/uses-sample/`:

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
    may_use: [library]
    types:
      library:
        about: Code the commands call.
        paths: ["src/core/**"]
        rules: [no-console]
      command:
        about: The command layer.
        paths: ["src/cli/**"]
        may_use: [command, library]
  script:
    about: Executable helpers.
    paths: ["tools/**/*.{mjs,js}"]
    content: "^#!"
    rules: [no-todo]
    may_use: [source]
```

| Type | List in force | Its files may use |
|---|---|---|
| `source` | `[library]`, its own | files of `library` |
| `library` | `[library]`, from `source` | files of `library` |
| `command` | `[command, library]`, its own | files of `command` and `library` |
| `script` | `[source]`, its own | files of `source`, `library` and `command` |

In S, `src/cli/main.ts` imports `../core/price.js`: command uses library, which its list allows. E is `src/core/report.ts`:

<!-- example: dependency-e -->
```ts
import { price } from './price.js';
import '../cli/main.js';
export const report = (): number => price(1);
```

Line 1 uses `src/core/price.ts` (library, allowed). Line 2 uses `src/cli/main.ts` (command), which the list library takes from source does not name.

## 3. Uses

### 3.1 What counts as a use

A use is one reference the reader of the file's language reports: an import, an `export ... from`, a type-only import, a `require` or an `import()` with a literal string, `new URL('<literal>', import.meta.url)`, an `#include`, a `use`, a `mod` declaration, `require_relative`, a name of the same package or namespace written without an import, a type named in a declaration, a call or a `new`. Section 7 lists per language what the readers report and what they do not. Every reported use counts, whatever its kind, and whether or not the code ever runs it. A use carries the line the reader gives it.

### 3.2 Which files are read

A run reads the uses of each file of the run (the changed files, or every file with `--full`) that has a type with a list in force, is not binary, and has a reader:

- a `.vue` or `.svelte` file is read through its script block; without a script block it uses nothing;
- any other file has a reader when `relationLanguageForPath` gives it a language and `extractorForLanguage` has an extractor for it: TypeScript, TSX, JavaScript, Python, Go, Rust, Java, Kotlin, C#, C, C++, PHP and Ruby.

A text file of the run with a list in force and no reader counts toward `uses-not-read` (section 5). A file of the run past the limit of a file whose uses are read (`spec/check-slice.md`, section 10) is not read either: it is a `uses-not-read` of its own, at the file, an error in the change and debt outside it, and the run goes on. A file read only for what it declares (Java, Kotlin, C#, Ruby, Rust) that is past the limit is not read either, so the uses of it by other files are not judged; it is a `uses-not-read` of its own, at its path, `the uses of it are not judged: it is read for what it declares, and the file holds <n> bytes, more than the 512 KiB a file whose uses are read may hold`, an error in the change and debt under `--full`. Its `type` in JSON is its type, or an empty string for a file with no type.

**Declarations.** Java, Kotlin, C#, Ruby and Rust bind a name through what other files declare. When the run reads the uses of a file of one of the groups {Java, Kotlin}, {C#}, {Ruby}, {Rust}, it also reads the declarations of every non-binary file of slice one's section 2 in that group, with a type or without. The other languages resolve by path and read no declarations. Files are parsed once per run, in path order, for their declarations, their uses or both.

**What a finding depends on.** A `forbidden-use` depends on more than the judged file: on the target's path and type, and on files the readers consult (`tsconfig.json`, `package.json`, `go.mod`, `Cargo.toml`, `composer.json`, C# project files, other files' declarations). The change stays slice one's, the files that differ. So a change that only retargets a `tsconfig.json` alias passes, and the next edit of a file that uses the alias fails on a line the edit did not touch. Whether a change to a file the readers consult should widen the run is the owner's to decide later.

### 3.3 The readers

Lawcheck depends on Runes (section 6) and composes these of its exports, from `@chrisdudek/runes/relations`, `/ast` and `/grammars`. Runes' catalogue runner, `test/relations/reference-case-runner.mjs` in its repository at tag `v1.2.0`, composes the same calls and is the reference for each argument.

1. **The files the readers see** are the files of slice one's section 2, as `listedFileView(<their paths>, read)`. `read(path)` returns the file's text as slice one decodes it, from the run's one read of the file (slice two, section 4). A file git ignores, a symlink and a submodule do not exist for the readers. A file that the readers ask for, or whose bytes the owner of step 2 needs, and that the tool cannot read is `file-unreadable` at that file, exit 2.
2. **The owner of a file**, which the resolver counts targets by: for a file of section 2, its type's id when it has a type, else `#binary` when it is binary, else `#untyped`; for any other path, none. No type id can equal the last two.
3. **The parser host**: `createParserHost({ runtime, runtimeIdentity: () => fileSha256(<the path import.meta.resolve('web-tree-sitter/web-tree-sitter.wasm') names>), grammarDirs: [<the package>/dist/grammars] })`, with `runtime` the `web-tree-sitter` module. Before the first file of a language is parsed, `host.getParser(primaryExtensionForLanguage(language))` loads its grammar. A run loads only the grammars of the languages it parses.
4. **A file's language**: `sfcScriptView(path, text)` for `.vue` and `.svelte`, which gives the language, the path to parse under and the script's text; otherwise `relationLanguageForPath(path, () => <the names of section 2's files in the same directory>)`.
5. **Parsing**: `host.withParsedFile(parsePath, text, fn, override)`, `override` being the language when `getLanguageForExtension` of `parsePath`'s extension gives another. Inside, the parsed file is `{ path, content: text, tree, language, newParser: host.newParser }`; the Kotlin reader needs `newParser`. Take `extractor.declarations(parsed)` for a file of the four groups and `extractor.uses(parsed)` for a file whose uses are read, except in C#: every C# file parsed gives `extractCsharpRefs(parsed)`, whose scope feeds step 6 and whose candidates become the file's uses there. Each declaration goes to one `SymbolTable` as `declare(language, symbolKey, path)`.
6. **C#**: `buildCsharpProjectScopes(root, files, { files: view })`, where `files` holds for each C# file parsed `{ path, globalPrefixes: extract.scope.globalPrefixes, globalAliases: [...extract.scope.globalAliases.entries()], globalStatics: extract.scope.globalStatics }`, and `buildCsharpReachability(root, <the paths of those files>, { files: view })`. The uses of a C# file are `assembleCsharpCandidates(extract, { projectGlobalUsings: scope?.usings ?? [], projectGlobalUsingAliases: scope?.aliases ?? [], projectGlobalStatics: scope?.statics ?? [] })`, `scope` being the file's entry of the scopes.
7. **The resolver**: `makeResolver({ ownerIndex: { ownerOf }, symbolTable, resolvePathToFile: makeResolvePathToFile(root, ownerOf, undefined, { files: view }), reach })`, `reach` being the C# reachability, absent when no C# file was parsed. `root` is slice one's root.
8. **A use's answer**: `resolver.classifyUse(<its candidates>, path, language)`, which walks the candidates in order exactly as Runes' own edge walk does. `resolved` gives one file, its `resolvedFile`. `ambiguous` gives the files the use could name, its `candidates`. `absent` gives its `reason`: `outside` (the use leaves the repository), `unfollowed` (it names a place of the repository that binds no file), `unowned` (it binds a file no owner maps, its `resolvedFile`), or none. Runes may add values of `reason` in a later 1.x release and asks that a value one does not know be read as none; Lawcheck reads it so.

**Failures.** Every exception a Runes call throws is `parser-failed`, and the run stops at the first one with exit 2:

| Where | Place | Message | `next:` |
|---|---|---|---|
| loading a grammar (step 3) | none | `the grammar of <language> cannot be loaded: <first line of the error>` | `reinstall Lawcheck; a grammar it ships cannot be loaded` |
| parsing a file, its declarations, its uses, or classifying one of its uses (steps 5, 6, 8) | the file | `the <language> reader fails on this file: <first line of the error>` | `report the failure of the <language> reader on <file>; until it is fixed, no <language> use can be judged` |
| the C# scopes or reachability (step 6) | none | `the C# project reader fails: <first line of the error>` | `report the failure of the C# project reader; until it is fixed, no C# use can be judged` |

### 3.4 What it costs

Measured in the dev container with a throwaway script making exactly these calls: hono (section 11), the uses of 96 files read in 0.19 s; gson, the declarations of its 266 Java files and the uses of 102 of them in 0.7 s; L (section 5), 13 grammars loaded and 30 files parsed in 0.12 s; a TypeScript file of 32 MB, 12.8 s and 1.36 GB of memory; 5,320 Java files (gson copied 20 times), 21 s. Runes parses input its grammar cannot read at 13 to 16 s per MB. A run that reads no use loads no grammar and parses nothing. A run that reads one C#, Java, Kotlin, Ruby or Rust use parses every file of that group in the repository, on every run. Whether to cache, or to bound the size of a parsed file, is the owner's to decide with these numbers (decision 12).

### 3.5 From a use to a type

| Runes' answer | What follows |
|---|---|
| one file: the file itself | nothing |
| one file with a type | allowed by the list in force, or `forbidden-use` |
| one text file with no type | `forbidden-use` |
| one binary file | nothing |
| `ambiguous` | an unresolved use with its candidates (section 4) |
| `absent`, `outside` | nothing, and not counted |
| `absent`, `unfollowed` or `unowned` | an unresolved use with that reason (section 4) |
| `absent` with no reason, or one Lawcheck does not know | an unresolved use with no reason (section 4) |

Because the owner is the type, a name declared in several files of one type binds that type, and the target is the first of those files in path order (Runes' rule for one owner). A name declared in files of different types, or in files some of which have no type, is `ambiguous`.

## 4. Unresolved uses

**The rule, the same in every language:** a use that Runes does not resolve to one file is unresolved, unless Runes answers that it leaves the repository. Lawcheck never looks at the use's specifier or name to guess what it meant: whether a use is outside, unfollowed, unowned or ambiguous is Runes' answer alone. An unresolved use is neither allowed nor forbidden: it is never a finding and never changes the exit code. Every run counts the unresolved uses of the files whose uses it reads, in the first line for the changed files and in the debt heading for the others, and `--json` lists each one with Runes' answer (section 5).

What the user sees for the three kinds of silence the design names:

- **An outside package** (the standard library, an installed dependency): not counted, where Runes says it leaves the repository. Since Runes 1.2.0 this holds in C, C++ and Ruby too: `<stdio.h>`, `require 'json'` and the constant `JSON` are `outside`.
- **A dynamic import** (`import(name)`, a template string, `importlib.import_module`, a reflection string, `const_get`): the reader reports no use, so nothing at all (section 7 lists the forms).
- **Generated code.** A file the build writes and git ignores does not exist for the readers: a use of it is unresolved, counted, mostly `unfollowed`. Runes answers `outside` for a Java or Kotlin type an annotation processor generates into the file's own package when a star import of a library could give its name, so that use is not counted. Generated code that is committed is a file like any other and needs a type when a list reaches it (gson's `GsonBuildConfig.java`, section 11).

Runes 1.2.0 gives a reason in every language it reads; 1.1.0 gave none in C, C++ and Ruby. A Python `from m import name` reports `m` and `m.name`; the use leaves the repository when `m` does, and otherwise binds the file of the module `m.name`, or the file of `m` when `name` is no module, relative imports included. `from . import name`, with `name` defined in `__init__.py`, stays unresolved. A name of the repository's own package or namespace that a library also declares into reads as the repository's, so it is `unfollowed`, never `outside`.

## 5. Findings, output and exit codes

| Code | Place | Message | Severity |
|---|---|---|---|
| `forbidden-use` | `<file>:<line>` of the use | below | error in the change, warning in debt |
| `uses-not-read` | `.lawcheck/law.yaml:<line of the type's id>` | `<n> files of type <type> are not read for uses: <k> <extension>, ...` | warning |

The `forbidden-use` message has four forms, `<type>` being the file's type and `<list>` the list in force as the law writes it, ids joined by `, `, each once (`[]` when empty):

```
<type> may not use <target type> (<target file>); its may_use is [<list>]
<type> may not use <target type> (<target file>); it takes may_use [<list>] from <ancestor>
<type> may not use <target file>, which has no type; its may_use is [<list>]
<type> may not use <target file>, which has no type; it takes may_use [<list>] from <ancestor>
```

There is one `forbidden-use` per line and target file.

**`uses-not-read`** is one warning per type, not per file. For each type with a list in force whose files of the run include text files with no reader, it counts them: one finding for those in the change, and with `--full` one more in debt for the others, each only when its count is not zero. One file reads `1 file of type <type> is not read for uses: ...`. The extension is the part of the file's name from its last `.` when that `.` is not its first character, else `no extension`; the extensions are sorted, each with its count. The finding has no rule and cannot be waived.

**Fixed whys.** `forbidden-use`: `a type's may_use names every type its files may use`. `uses-not-read`: `a restriction that cannot be checked is not shown as kept`. `parser-failed`: `a file whose uses were not read is not taken to use nothing`.

**The counts.** `<unresolved>` is `, <u> unresolved uses` (`, 1 unresolved use`), left out when `u` is zero. It stands in the first line after `<waivers>` and before `<calls>`, counting the unresolved uses of the changed files, and at the end of the debt heading, counting those of the other files: `debt (outside this change): <f> findings in <n> files<waivers><unresolved>`, or `debt (outside this change): none<waivers><unresolved>`.

**JSON.** `forbidden-use` and `uses-not-read` are findings of `lawcheck-check/0` with `rule` null and `type` the type of the file (for `uses-not-read`, the type counted), like slice one's built-in codes. `summary` gains `unresolved`, the count of the changed files, after `waivers`. The document gains `unresolved` between `waivers` and `reviews`: every unresolved use of the run as `{ "file", "line", "what", "answer", "reason", "candidates", "debt" }`, sorted by file, line and `what`. `answer` is `ambiguous` or `none`. `reason` is `unfollowed` or `unowned` for `none` when Runes gives one, else null, and always null for `ambiguous`. `candidates` lists, sorted, the files an `ambiguous` use could name as Runes gives them, and for `unowned` the one file the use binds; it is empty otherwise. `what` is the specifier or symbol key, as Runes writes it, of the use's first candidate. `debt` is true for a file outside the change. The schema keeps its name: both keys are added, none changes meaning.

**Waivers.** Slice one's waiver may name, besides a rule of the law, `forbidden-use`. It drops those findings on its covered line and counts them in `waived`; a counted waiver of `forbidden-use` that drops nothing is `waiver-unused`. A waiver naming `uses-not-read`, `parser-failed` or any other code is `waiver-unknown-rule`.

**`next:`** is slice one's: `fix <place>` of the first error.

**Exit 2.** One row joins the table of slice two, section 8, after `rule-crashed` and before the reviewer rows: `parser-failed`, with section 3.3's places, messages and `next:`.

**The order of a run.** Slice two's order, with the uses read after the script rules and before each review's state. So a reader that fails stops the run before any reviewer call.

### The example

U on branch `work`, E added, `lawcheck check --base main` exits 1:

```
lawcheck: FAIL  1 error in 1 changed file (against main)

src/core/report.ts:2  error[forbidden-use]  library may not use command (src/cli/main.ts); it takes may_use [library] from source
  why:  a type's may_use names every type its files may use

next: fix src/core/report.ts:2
```

With `--json`:

```json
{
  "schema": "lawcheck-check/0",
  "result": "fail",
  "scope": { "mode": "change", "base": "main", "files": 1 },
  "summary": { "errors": 1, "warnings": 0, "debt": 0, "waivers": 0, "unresolved": 0 },
  "findings": [
    { "code": "forbidden-use", "rule": null, "severity": "error", "blocking": true, "debt": false,
      "file": "src/core/report.ts", "line": 2, "type": "library",
      "message": "library may not use command (src/cli/main.ts); it takes may_use [library] from source",
      "why": "a type's may_use names every type its files may use" }
  ],
  "waivers": [],
  "unresolved": [],
  "reviews": { "missing": 0, "calls_made": 0, "passes_recorded": 0 },
  "next": { "command": null, "text": "fix src/core/report.ts:2" }
}
```

### The languages: L

L is a repository of 36 files, kept in `tests/languages-sample/`: two types and one use from `domain` to `app` in each language, an ambiguous name in C#, and uses that bind nothing. Each file below is the lines after its `--- <path>` line up to the next one, each line ending with a line end.

```text
--- .lawcheck/law.yaml
lawcheck: 0.1.0

types:
  domain:
    paths: ["**/domain/**"]
    may_use: [domain]
  app:
    paths: ["**/app/**"]
    may_use: [app, domain]
--- c/app/service.h
int run(void);
--- c/domain/order.c
#include "../app/service.h"
#include "config.h"
#include <stdio.h>
int total(void) { return run(); }
--- cpp/app/service.hpp
int run();
--- cpp/domain/order.cpp
#include "../app/service.hpp"
int total() { return run(); }
--- cs/app/Clock.cs
namespace Shop.App;

public class Clock {}
--- cs/app/Service.cs
namespace Shop.App;

public class Service { public Clock Now; }
--- cs/domain/Order.cs
using Shop.App;

namespace Shop.Domain;

public class Order { public Service S; }
--- cs/legacy/Clock.cs
namespace Shop.App;

public class Clock {}
--- go/app/service.go
package app

func Run() int { return 1 }
--- go/domain/order.go
package domain

import "example.com/shop/app"

var X = app.Run
--- go/go.mod
module example.com/shop

go 1.22
--- java/src/main/java/com/acme/app/Service.java
package com.acme.app;

public class Service {}
--- java/src/main/java/com/acme/domain/Order.java
package com.acme.domain;

import com.acme.app.Service;
import com.acme.app.ServiceProto;

public class Order { Service s; ServiceProto p; }
--- js/app/tax.js
module.exports = 1;
--- js/domain/total.js
const tax = require("../app/tax.js");
module.exports = tax;
--- kotlin/src/main/kotlin/com/acme/k/app/Service.kt
package com.acme.k.app

class Service
--- kotlin/src/main/kotlin/com/acme/k/domain/Order.kt
package com.acme.k.domain

import com.acme.k.app.Service

class Order(val s: Service)
--- php/composer.json
{ "autoload": { "psr-4": { "Shop\\": "src/" } } }
--- php/src/app/Service.php
<?php
namespace Shop\app;

class Service {}
--- php/src/domain/Order.php
<?php
namespace Shop\domain;

use Shop\app\Service;

class Order { public function s(): Service { return new Service(); } }
--- py/pyproject.toml
[project]
name = "shop"
--- py/shop/app/service.py
def run():
    return 1
--- py/shop/domain/order.py
from shop.app.service import run
from .rules import limit
from .gen_pb2 import OrderProto
import json
--- py/shop/domain/rules.py
limit = 10
--- ruby/app/service.rb
module Shop
  class Service
  end
end
--- ruby/domain/order.rb
require_relative "../app/service"
require_relative "../gen/schema"
require "json"

class Order
  def s = Shop::Service.new
end
--- rust/Cargo.toml
[package]
name = "shop"
version = "0.1.0"
edition = "2021"
--- rust/src/app/mod.rs
pub fn run() -> i32 { 1 }
--- rust/src/domain/mod.rs
use crate::app::run;
use crate::gen::Table;
use serde::Serialize;
pub fn total() -> i32 { run() }
--- rust/src/lib.rs
mod domain;
mod app;
--- ts/app/service.ts
export const charge = (n: number) => n;
--- ts/domain/order.ts
import { charge } from "../app/service";
import { compact } from "lodash";
export const total = (n: number) => charge(n);
--- ts/domain/schema.json
{ "total": 1 }
--- ts/domain/widget.tsx
import { charge } from "../app/service";
export const Widget = () => <b>{charge(1)}</b>;
--- vue/domain/Card.vue
<template><b>x</b></template>
<script setup lang="ts">
import { charge } from "../../ts/app/service";
</script>
```

In a new git repository holding L in one commit on `main`, with no remote, `lawcheck check` judges every file. Measured with the throwaway script of section 3.4, its first line is `lawcheck: FAIL  15 errors, 1 warning in 36 files (no base: every file counts as changed), 9 unresolved uses`, and its findings are exactly these 16:

<!-- example: dependency-l-findings -->
```
.lawcheck/law.yaml:4  warning[uses-not-read]  1 file of type domain is not read for uses: 1 .json
c/domain/order.c:1  error[forbidden-use]  domain may not use app (c/app/service.h); its may_use is [domain]
cpp/domain/order.cpp:1  error[forbidden-use]  domain may not use app (cpp/app/service.hpp); its may_use is [domain]
cs/domain/Order.cs:5  error[forbidden-use]  domain may not use app (cs/app/Service.cs); its may_use is [domain]
go/domain/order.go:3  error[forbidden-use]  domain may not use app (go/app/service.go); its may_use is [domain]
java/src/main/java/com/acme/domain/Order.java:3  error[forbidden-use]  domain may not use app (java/src/main/java/com/acme/app/Service.java); its may_use is [domain]
js/domain/total.js:1  error[forbidden-use]  domain may not use app (js/app/tax.js); its may_use is [domain]
kotlin/src/main/kotlin/com/acme/k/domain/Order.kt:3  error[forbidden-use]  domain may not use app (kotlin/src/main/kotlin/com/acme/k/app/Service.kt); its may_use is [domain]
php/src/domain/Order.php:4  error[forbidden-use]  domain may not use app (php/src/app/Service.php); its may_use is [domain]
py/shop/domain/order.py:1  error[forbidden-use]  domain may not use app (py/shop/app/service.py); its may_use is [domain]
ruby/domain/order.rb:1  error[forbidden-use]  domain may not use app (ruby/app/service.rb); its may_use is [domain]
ruby/domain/order.rb:6  error[forbidden-use]  domain may not use app (ruby/app/service.rb); its may_use is [domain]
rust/src/domain/mod.rs:1  error[forbidden-use]  domain may not use app (rust/src/app/mod.rs); its may_use is [domain]
ts/domain/order.ts:1  error[forbidden-use]  domain may not use app (ts/app/service.ts); its may_use is [domain]
ts/domain/widget.tsx:1  error[forbidden-use]  domain may not use app (ts/app/service.ts); its may_use is [domain]
vue/domain/Card.vue:3  error[forbidden-use]  domain may not use app (ts/app/service.ts); its may_use is [domain]
```

Its 7 unresolved uses, as `<file>:<line>  <answer>[ <reason>]  <what>[  [<candidates>]]`:

<!-- example: dependency-l-unresolved -->
```
c/domain/order.c:2  none unfollowed  config.h
cs/app/Service.cs:3  ambiguous  Shop.App.Service+Clock  [cs/app/Clock.cs, cs/legacy/Clock.cs]
java/src/main/java/com/acme/domain/Order.java:4  none unfollowed  com.acme.app.ServiceProto
py/shop/domain/order.py:3  none unfollowed  .gen_pb2
py/shop/domain/order.py:3  none unfollowed  .gen_pb2.OrderProto
ruby/domain/order.rb:2  none unfollowed  ../gen/schema
rust/src/domain/mod.rs:2  none unfollowed  crate::gen::Table
```

Measured with `lawcheck check --json` on Runes 1.1.0. Before it there were 12: `py/shop/domain/order.py:4` (`json`, the standard library), `rust/src/domain/mod.rs:3` (`serde::Serialize`, a registry crate) and `ts/domain/order.ts:2` (`lodash`, an installed package) are now `outside` and not counted. C and Ruby give no reason, so `<stdio.h>` stays. The C# use's `what` is now its first candidate, the reading of `Clock` as a type nested in `Service` (decision 19).

Measured again on Runes 1.2.0, 9 became 7: `c/domain/order.c:3` (`<stdio.h>`) is `outside` and not counted, `py/shop/domain/order.py:2` (`limit` of the relative module `.rules`) binds the module's file, and the C and Ruby uses carry the reason `unfollowed`. The findings did not change.

## 6. The readers and the grammars

What was found, on 2026-11-13, on 2026-11-15 for 1.1.0, and on 2026-11-18 for 1.2.0:

| Question | Answer |
|---|---|
| Published | on npm as `@chrisdudek/runes`: 1.0.0 of 2026-09-29, 1.1.0 of 2026-11-15 from tag `v1.1.0` at commit `1f3476b`, and 1.2.0 from tag `v1.2.0` at commit `cb801eb` |
| Licence | MIT, by the author of Lawcheck, as Lawcheck |
| Its own dependencies | none at run time; `web-tree-sitter` as an optional peer, which the consumer installs and hands in: 0.27.0 for 1.1.0, 0.27.2 for 1.2.0 |
| What it exports | six subpaths; this slice uses `relations` (the readers, the symbol table, the resolver, the file view), `ast` (the parser host) and `grammars` (the language table, the grammar pins, `buildGrammars`) |
| The grammars | in 1.1.0, not in the package: Runes shipped their pins, patches and a recipe, `buildGrammars`, which checks every file against its sha256, and the 13 grammars of the twelve languages came 3 from npm packages, 2 from GitHub releases and 8 from source, built with `tree-sitter-cli` 0.27.0. 1.2.0 ships all 23 grammars built in `grammars/built/`, each checked against its sha256, and `buildGrammars` takes them before any other source |
| Size | 1.0.0: 144 files, 839 KB unpacked; 1.1.0: 162 files, 1.6 MB unpacked; 1.2.0: 35.4 MB unpacked, its grammars included. The 13 grammars: 23.8 MB of WebAssembly, 2 MB compressed |
| 1.0.0 against this slice | it lacks `listedFileView` (resolution against a list of files instead of the disk), `buildCsharpReachability`, Java and Kotlin names of the same package, and the reader fixes since; its catalogue had 460 cases |
| What this slice needs | 1.2.0. Its grammar pins are those of 1.1.0 and of the commit this slice was first built on, `b326704` of Runes' branch `release/1.1.0`: the 13 grammars Lawcheck ships have the same bytes since alpha.1. Its `web-tree-sitter` peer is 0.27.2 |

**Lawcheck depends on Runes 1.2.0 from npm, exactly**, and on the runtime Runes is built for:

```json
"dependencies": {
  "@chrisdudek/runes": "1.2.0",
  "web-tree-sitter": "0.27.2",
  "yaml": "^2.9.1"
}
```

`package-lock.json` resolves it from `https://registry.npmjs.org/@chrisdudek/runes/-/runes-1.2.0.tgz` with its integrity, `sha512-RtBFo9o9A735ZtWDKkcuDMzps8UbBZzY28biYmKW+oujd/RhqHmpFIJ4hbVvr0hZc1N11s2ezjbK+S4zOPNwEQ==` (written by `npm install --save-exact @chrisdudek/runes@1.2.0 web-tree-sitter@0.27.2` in the dev container). A later Runes is taken knowingly, by changing this version: its readers may answer differently, and section 11's numbers move with them.

**The grammars are built at Lawcheck's build and ship in its package.** `scripts/grammars.ts` calls `buildGrammars({ outDir: 'dist/grammars', only, resolveFrom: <the repository root>, cacheDir: '<the repository root>/.grammars', offline })` with `only` the 13 ids `typescript`, `tsx`, `javascript`, `python`, `go`, `rust`, `java`, `kotlin`, `csharp`, `c`, `cpp`, `php`, `ruby`, and `offline` true when it is given `--offline`; it then copies `scripts/grammar-licenses.txt` to `dist/grammars/LICENSES.txt`. On a failure it prints the error and exits 1. Since Runes 1.2.0 `buildGrammars` copies the 13 grammars from the installed `@chrisdudek/runes`, so the build needs no network, no grammar package and no `tree-sitter-cli`, on Windows too; Lawcheck has none of them as a development dependency.

**The grammars' licences.** The package copies 13 compiled grammars, and their licences ask for their notices in every copy. `scripts/grammar-licenses.txt` holds, for each of the 13, its language, its repository and commit from Runes' `grammars/manifest.json`, and the copyright line and licence text its repository states at that commit.

| Where | What |
|---|---|
| `package.json` scripts | `"grammars": "node scripts/grammars.ts"`; `"build": "tsc -p . && node scripts/grammars.ts --offline"`; `"real": "npm run build && node tests/real/run.ts"`; the others as before |
| `package.json` `allowScripts` | none since Runes 1.2.0: it held the approval of `tree-sitter-cli`'s install script and the denial of the three grammar packages' scripts, which left the development dependencies with them |
| `.devcontainer/devcontainer.json` | `postCreateCommand`: `npm ci && npm run grammars` |
| `.gitignore` | `.grammars/` added |

With Runes 1.1.0 a first `npm run grammars` needed the network: measured, 74 s, and `tree-sitter-cli` fetched its WebAssembly toolchain (940 MB) into `~/.cache/tree-sitter` of the container. With 1.2.0 it needs neither, and `npm run build` and `npm test` need no network. The package grows by the 13 grammars, their `node-types.json` files and the licences, about 25 MB unpacked.

## 7. The readers' known limits

The readers are used as they are; what they lack is Runes' to change. Runes 1.1.0 closed the three gaps this slice was built around: it tells a use that leaves the repository from one it could not follow, an ambiguous answer names its files, and a tsconfig `rootDir` or `outDir` written with a trailing `/` maps build output back to its source. What shapes this slice now:

1. **What C, C++ and Ruby cannot tell.** Since Runes 1.2.0 a system header, a gem and a constant the repository does not declare are `outside`. A quoted `#include` of a library header (`"gtest/gtest.h"`) is `unfollowed`, since the readers do not know the build's include path.
2. **An ambiguous use is not judged.** Lawcheck lists its candidates and never makes a finding of it, even when the list forbids every file it names. A Go import of a package whose files have more than one type is ambiguous with the package's files.
3. **Where the readers place a name.** A Java, Kotlin or C# name that a library declares into a package or namespace of the repository reads as the repository's (`unfollowed`), and so does a Java member type inherited from a supertype outside the repository when the class's own package declares a type of that name. Without such a type it is `outside` since 1.2.0 (gson's `Entry` from `java.util.AbstractMap`, section 11). In Python and PHP, a use several roots or projects could hold is `ambiguous` with their files since 1.2.0.
4. **Generated Java and Kotlin types count as outside.** A type an annotation processor generates into the file's own package (`AutoValue_Use`, `DaggerAppComponent`) is `outside` when a star import of a library could give its simple name, so a use of the repository's own generated code is dropped without a count; without such a star import it is `unfollowed` (section 4).
5. **The modelled TypeScript.** A package's `types@<range>` export keys are read as TypeScript 7.0.2 reads them, whatever TypeScript the project uses.
6. **An alias a bundler defines is read from its configuration as text** (S4-1). Since Runes 1.2.0 Vite and webpack `resolve.alias` and Babel `module-resolver` are read without running the configuration: a target written as `fileURLToPath(new URL('./src', import.meta.url))` or `path.resolve(__dirname, 'src')`, or a relative path in Babel, binds the files it names. A target written another way, such as a variable, is not followed, and where such an alias may apply, a bare specifier that names no dependency is `unfollowed` and counted. `import.meta.glob` and `require.context` are not read and not counted; `vi.mock` and `jest.mock` with a literal path are read. `docs/languages.md` says to put an alias the readers cannot follow in `tsconfig.json` `paths`. A C or C++ `#include` that needs `-I`, with `compile_commands.json` ignored by git, is an unresolved use, `unfollowed`.
7. **A Python root that configuration names is a root** (S4-2). Runes 1.1.0 read a package under `lib/` with `where = ["lib"]` in `pyproject.toml` as `outside` in its absolute imports of itself (`from pkg.data.d import x`, `import pkg.data.d`). Since 1.2.0 the roots that `pyproject.toml` or `setup.cfg` name are searched, and such a package is judged on every form, as at a root the readers searched before. `setup.py` is not read.
8. **Rust `#[path]` and a crate written in code** (S4-3). Since Runes 1.2.0 a `mod` with `#[path]` among the items of its file (declared in `src/lib.rs` and in a module file) is judged, and so is a path to a path-dependency crate written in code with no `use` (`datacrate::dc()`). A `#[path]` inside an inline module, a function body, a `cfg_if!` branch or a `cfg_attr` gives no use, and neither does a `use` written in a `cfg_if!` branch.
9. **Smaller limits of the readers, measured by the stress round.** Runes 1.1.0 read a `<script>` block inside an HTML comment of a Vue file as code and did not read `<script src>`; 1.2.0 skips the comment and judges a relative `src` (S4-6). In 1.1.0 the count of unresolved uses depended on the import style: Python's `from .m import Name` counted one unresolved use when `Name` was no module and `from app.m import Name` counted none, and Ruby counted every constant it could not resolve. Since 1.2.0 both Python forms bind the module's file, a Ruby constant the repository does not declare is `outside`, and `from . import Name`, with `Name` defined in `__init__.py`, is still counted (S4-7). A Go module wired to a sibling only by a relative `replace`, with no `go.work`, is judged since 1.2.0 (S4-8). Java is the slowest language, and a large file with syntax errors has no bound (S4-10). In a file whose lines end with a lone CR, the grammars of Python, Go, Ruby, C and C++ do not end a statement at the line end, so such a file can give fewer uses.

Known defects, from the changelogs of 1.1.0 and 1.2.0: a member inherited from a C# base class outside the repository (`ControllerBase.User`) lets a type of the repository with that name take the use; Rust `[patch]` does not compare the patched crate's version with the requirement, does not read a workspace's `exclude` or `package.workspace`, and matches a GitHub URL as written. Measured at `b326704` and not measured again: in a Kotlin file with syntax errors an annotation can be split from its function. Runes 1.2.0 settled the chain of C# `is not` tests of dotted types, which 1.1.0 did not read, and found that a Rust library whose `lib.rs` holds only an inline module with a `#[path]` module was no defect.

Per language, from Runes' catalogue at tag `v1.2.0` (`reference/relations/<language>/`, each case an `edge` the reader must find or a `silence` it must keep) and the notes of its `docs/api.md`. A form in neither is untested. What the readers do not report is never a `forbidden-use` and is not counted.

| Language | Cases (edge / silence) | Read | Not read, or read wrong |
|---|---|---|---|
| TypeScript | 148 (118 / 30), 25 of them with `.mts` or `.cts` files | static imports, re-exports, type-only imports and import types, `require`, `import x = require`, `declare module "<path>"`, `import()` and `require()` with a literal, `new URL(literal, import.meta.url)`, JSON imports, `vi.mock` and `jest.mock` and their companion calls with a literal path; resolved through relative paths, aliases of Vite, webpack and Babel configurations written in the forms of item 6, `tsconfig` and `jsconfig` `paths` and `baseUrl` (solution-style configs included), package `exports` and `imports` with their conditions, workspace members (`workspaces`, `pnpm-workspace.yaml`, `file:`, `link:`, `workspace:`), and package entries under build output mapped back through the package's own tsconfig | `node:` built-ins, `import()` of a variable or a template string, `require.resolve`, `import.meta.resolve`, `import.meta.glob`, `require.context`, an alias written in another form (item 6 below), JSDoc `@import` types, triple-slash references, `export interface I extends import('x').T {}`. Read wrong: `new URL('.', import.meta.url)` names a directory and is an unresolved use. A `node:` built-in or an installed package is `outside` |
| TSX | 2 | as TypeScript | as TypeScript |
| JavaScript | 10 (9 / 1), and the TypeScript cases | as TypeScript, with `require` and `module.exports` | as TypeScript |
| Vue, Svelte | 4 and 2 | the script block, as TypeScript or JavaScript, a relative `<script src>` and no script inside an HTML comment | the template |
| Python | 47 (32 / 15) | `import`, `from` imports, relative imports, submodules, star, conditional, function-local and `TYPE_CHECKING` imports, namespace packages, `src` layouts, source roots `pyproject.toml` or `setup.cfg` name (S4-2), members of uv and Poetry workspaces, test helpers through pytest's basedir | `importlib.import_module`, `__import__`, `__all__`, `setup.py`. A module whose top-level name no root of the repository holds is `outside`; one several roots hold is ambiguous |
| Go | 25 (17 / 8) | imports through `go.mod` and `go.work`, a `replace` with a relative directory of the repository (S4-8), internal packages, major versions, external test packages; a package import binds one file of its directory | names used within one package, cgo, a `replace` by another version or by a directory outside the repository. An import path no module of the repository holds is `outside`; a package whose files have more than one type is ambiguous |
| Rust | 204 (165 / 39) | `use` paths from `crate`, `self`, `super` and names in scope, `mod` declarations, with `#[path]` among the items of a file (S4-3), paths to a path dependency written in code (S4-3), path dependencies in every Cargo.toml spelling, `extern crate`, editions 2015 and later, glob re-exports of crate roots, crates with several roots | paths inside a macro invocation, `#[macro_export]`, `include!`, a `#[path]` inside an inline module, a function body, a `cfg_if!` branch or a `cfg_attr`, a `use` in a `cfg_if!` branch, `[patch]` without a path. A path from a crate the repository does not hold (`std`, a registry dependency) is `outside` |
| Java | 76 (44 / 32) | single, wildcard and static imports, names of the same package without an import (main code never sees test code), a member type written `Outer.Inner` in the package of `Outer`, Maven and Gradle source roots, one namespace shared with Kotlin | fully qualified names written inline in a call, an annotation or a constant (`com.b.Util.run()`, `@com.acme.Audit`, `com.acme.Color.RED`; a fully qualified field type is read), reflection strings, module imports, a member type inherited from a supertype outside the repository where the class's package declares a type of that name. A `java.lang` name written without an import (`String`), a name in a package the repository declares nothing in (`java.util`), and a name an on-demand import of such a package can give are `outside` |
| Kotlin | 77 (52 / 25); none with `.kts` files | imports, star imports, aliases, names of the same package, annotated declarations | constructor calls, `::class` and other references written fully qualified, files without `package`. A file with syntax errors is read in spans. A name of the default imports (`String`, `List`), a name in a package the repository declares nothing in, and a name an on-demand import of such a package can give are `outside` |
| C# | 320 (245 / 75) | type names through usings (global, aliases, `using static`), namespaces, nested and base types, attributes, generic arity, extension methods with their argument counts, project references for what a project can see, `InternalsVisibleTo` | reflection strings, `nameof`, types behind `extern alias`, a base reached only through another file's global using. Read wrong: a member inherited from a base class outside the repository (`ControllerBase.User`) lets a type of the repository with that name take the use. A name only a namespace from elsewhere can give (`System.Text`, `System.Console`) is `outside`; a partial type spread across types is ambiguous |
| C | 8 (3 / 5) | `#include "..."` beside the file, then under the roots of `compile_commands.json` or every `include/` directory; `#include <...>` under a compilation database's `-I`, or without one beside the file, at the root and under every `include/` directory; dead branches (`#if 0`) skipped | `#embed`, an include through a macro, usage sites (C links by name). A system header the repository does not hold is `outside`; a quoted include that binds no file is `unfollowed` |
| C++ | 32 (14 / 18) | as C, with the C++ extensions; a `.h` is C++ when its directory holds a C++ file and no `.c` file | modules: `import`, partitions, header units, `import std`. Reasons as in C |
| PHP | 67 (38 / 29) | `use` (plain, grouped, aliased), fully qualified and namespace-relative class names in code, through PSR-4 and PSR-0 of `composer.json`; `require` and `include` built from `__DIR__` | `use function`, `use const`, `require 'x.php'` without `__DIR__`, `new $var`, `class_alias`, class names built from strings. A class under no prefix of the repository's Composer maps is `outside` |
| Ruby | 38 (20 / 18) | constants (bare, qualified, rooted, mixins, superclasses, pattern matching), Zeitwerk namespaces, `require_relative`, a plain `require` of a file on the repository's load path (`lib/`, a gemspec's `require_paths`, `spec/` or `test/`) | `const_get`, autoload; reopening a core class declares nothing. A gem, the standard library and a constant rooted at a core class or at a constant the repository does not declare are `outside`; a constant under a namespace the repository declares that binds no file is `unfollowed` |

The catalogue is thin for C (8 cases), TSX (2), Vue and Svelte (6), Go and Ruby, and empty for `.kts`. The two repositories of section 11 were read without a reader failure.

## 8. The reviewer's connection error

Slice two's `src/providers/http.ts` reports a request that got no answer as `the connection to the reviewer gave no answer (<what>)`, with `<what>` the code of the error's cause or else the error's name. A failed `fetch` throws a `TypeError` whose cause often has no code, so the run prints `(TypeError)` and loses the reason; slice one's rule for a failure of unknown kind is its message. Measured with the current build: an endpoint on port 9, which `fetch` refuses, prints `clear-errors: the connection to the reviewer gave no answer (TypeError)`, where the cause says `bad port`.

`<what>` becomes the first of: the cause's `code`, when it is capital letters, digits and underscores; the first line of the cause's `message`, when the error has a cause and that is not empty; the first line of the error's own `message`, when not empty; `an unknown error`. It is cut at 200 characters.

A message can quote a header. `fetch` refuses a header value with a line break and puts the whole value in its message (measured on Node 24.22.1: `Headers.append: "Bearer se\ncret" is an invalid header value.`), so printing it would print part of a key. Before the first call (slice two, section 6), `openai-compatible` and `anthropic` check the key they would send: one that holds a character outside `!` (U+0021) to `~` (U+007E) makes `ready()` answer `<variable> holds a character an HTTP header cannot carry`, `<variable>` being `LAWCHECK_REVIEWER_KEY` or `ANTHROPIC_API_KEY`, whichever is in force. The run then ends with `reviewer-unreachable` without place and sends nothing.

## 9. Decisions taken here

1. **Runes is taken from npm at an exact version, 1.2.0 since Lawcheck 0.1.0-alpha.2.** The published 1.0.0 resolves against the disk: build output, `node_modules` or a generated file present on one machine and not another would decide where an import lands, and the same commit would answer differently. The file view of 1.1.0 lets the readers see exactly the files of slice one's section 2. Until 1.1.0 was published, Lawcheck took the GitHub archive of its release commit `b326704`; the exact version replaces it, since a range would let an install pick readers that answer differently. Vendoring would bring Runes' sources and their comments into Lawcheck's repository; rewriting the readers would throw away 961 cases.
2. **The grammars ship in the package, with their licences, built from Runes' recipe.** Fetching them at run time would open a connection without `--review`, which slice two promises never happens. Since Runes 1.2.0 the build copies them from the installed Runes package, so it needs no network at all. Lawcheck keeps its own copy of the 13 grammars it loads, beside their licences, so what it ships and loads stays the same as in alpha.1.
3. **The resolver counts targets by type.** `may_use` asks which type a use reaches, so a name declared in several files of one type (a C# partial class, Kotlin overloads) is one target. Counting by file would make those ambiguous; counting by directory would tie the answer to a layout the law does not describe.
4. **What Runes does not resolve is counted, the same in every language, unless Runes says it leaves the repository.** The readers are used as they are, and what they lack is Runes' to add (the owner's ruling). Lawcheck therefore never judges a use by the shape of its specifier: a use Runes resolves to one file is judged, a use Runes answers `outside` is dropped, any other is an unresolved use with Runes' reason or candidates. Before 1.1.0 every miss was counted alike; section 11's numbers changed knowingly when 1.1.0 came (decision 18).
5. **An unresolved use is a count, not a finding.** A use the readers could not follow is often the readers' gap, not the code's, and in C, C++ and Ruby outside names are still among them, so a warning at each would bury every other line; a count in the first line keeps them visible, `--json` lists each with its reason or candidates, and none blocks.
6. **A use of an untyped text file is `forbidden-use`, provisionally** (section 2). A closed list that an untyped file can walk around is not closed; the owner decides open question 14, and section 2 lists what option B removes.
7. **Every reported use counts**, type-only imports and code that never runs included: `may_use` describes the architecture, and a type import is a dependency on what it names.
8. **`uses-not-read` is one warning per type, at its line in the law.** The design has one per run with a count; one per file would warn on every stylesheet and image a typed folder holds, and narrowing `paths` to silence it would make each imported stylesheet an untyped target. Splitting change from debt keeps the warning in the change only when a changed file is unread.
9. **One `forbidden-use` per line and target file.** A reader may report one statement more than once for one target (a C# line that names a type twice); different targets give different findings, so Python's `from shop.app import service` gives one for the package's `__init__.py` and one for the module.
10. **The list goes into the message and the why stays fixed**, as for every built-in code of slice one; the agent sees what the type may use beside the place to fix.
11. **Only `forbidden-use` can be waived; waivers stay text.** Reading waivers only in real comments would change slice one's tested behaviour for every rule and is not needed for `may_use`.
12. **No cache and no size bound.** Each run parses the declarations of every file of a name-binding group it reads a use in, and a file of any size; section 3.4 gives the cost, and the owner decides whether either comes, with those numbers.
13. **The first reader failure stops the run with exit 2**, at a place section 3.3 fixes for each step, in path order. A file whose uses were not read is never taken to use nothing, and once the WebAssembly runtime fails, every file after it fails too.
14. **Runes' diagnostics are not shown.** They are best effort and reported once per configuration file, so a line built on them would depend on which file was resolved first and so on the mode of the run.
15. **The JSON document gains `unresolved` and `summary.unresolved` and keeps its name**: both are additions, nothing changes meaning. The fields `reason` and `candidates` of each unresolved use are additions too (decision 19).
16. **The reviewer error shows the cause, and a key that a header cannot carry stops the run before any call** (section 8): printing every error's message would otherwise print part of a key. It stays in this slice because the brief puts it here.
17. **The real-repository test pins two repositories that are not in Runes' own corpus of 33**, so it measures the readers on code they were not tuned on, and its numbers are the behaviour of the Runes version Lawcheck depends on.
18. **A use Runes answers `outside` is not counted; `unfollowed`, `unowned` and a missing reason stay unresolved.** Taken on 2026-11-15 when Lawcheck moved to Runes 1.1.0. A use that leaves the repository cannot reach a type of the law, so counting it only hid the uses that matter: in gson, 2,555 of the 2,567 uses it counted leave the repository. A use Runes could not follow may still reach a type, so it stays visible with its reason. Lawcheck adds no reasoning of its own: a reason it does not know, and a language Runes gives no reason in, count as no reason, so a later Runes can only make the count more precise, never silently drop a use it did not call outside.
19. **`what` is the use's first candidate, and `ambiguous` lists its candidates.** `classifyUse` answers for the whole use and does not say which candidate ended the walk, which `what` named before 1.1.0. The first candidate is the name as the reader read it first, and the files of `candidates` say more than which reading was ambiguous. A use whose candidates the list all forbids is still not a finding (section 7).

**What changes in slices one and two:**

- slice one, section 1: `may_use` and the language readers are in;
- section 2: `may_use` on a type, three more reserved ids;
- section 5: a waiver may name `forbidden-use`;
- section 6: two finding codes, the `<unresolved>` part of the first line and of the debt heading, `summary.unresolved` and `unresolved` in JSON, and `parser-failed` in the exit-2 table; test 41's documents gain `"unresolved": 0` in `summary` and `"unresolved": []`;
- test 18: its case `may_use: [command]` on `library` becomes `may_use: [nope]`, still `law-invalid`; test 19: the same replacement, with the same two lines at `:8` and `:20`; the unit test that reads `may_use: [command]` as an unknown key drops that key from its list;
- slice two, section 6: the `<what>` of a connection that gave no answer, and the key check before the first call; test 75's and section 8's documents gain the two keys;
- `package.json`, `.devcontainer/devcontainer.json` and `.gitignore` as section 6 says.

## 10. Acceptance tests

The earlier slices' terms hold. U and E are section 2's, L is section 5's. Each U test starts from U in a new git repository, one commit on `main`, then branch `work`, and runs `lawcheck check --base main` unless it names a command; a change to U's law is a second commit on `main` before `work`. "The copy" is a temporary folder holding the built package's `package.json` and `dist/` and a symbolic link `node_modules` to the repository's own, run as `node <copy>/dist/cli.js`; tests 89 and 90 build it. The added files:

- `src/util/format.ts`: `import { rate } from '../core/tax.js';`, `import { shout } from './shout.js';`, `export const format = (n: number): string => shout(String(n * rate));`
- `src/util/shout.ts`: `export const shout = (text: string): string => text.toUpperCase();`
- `src/cli/flags.ts`: `import { shout } from '../util/shout.js';`, `export const flag = shout('x');`
- `tools/build.mjs`: `#!/usr/bin/env node`, `import { price } from '../src/core/price.js';`, `import './release.mjs';`
- `src/core/extra.ts`, nine lines: `import { readFileSync } from 'node:fs';`, `import lodash from 'lodash';`, `import { client } from './generated/client.js';`, `import { helper } from '../../lib/helper.js';`, `import logo from './logo.png';`, `export * from '../cli/main.js';`, `export type { Banner } from '../cli/banner.js';`, `export const load = async (name: string) => import(name);`, `export const later = async () => import('./price.js');`
- `lib/helper.ts`: `export const helper = 1;`; `src/cli/banner.ts`: `export type Banner = string;`; `src/core/logo.png`: the ten bytes `89 50 4E 47 0D 0A 1A 0A 00 00`; `src/core/generated/client.js`: `export const client = 1;`; `.gitignore`: `src/core/generated/`
- `packages/ui/package.json`: `{ "name": "@sample/ui", "main": "dist/index.js" }`; `src/core/view.ts`: `import { button } from '@sample/ui';`, `export const view = button;`

Each file is its lines in the order given, each ending with a line end. X is the set of `extra.ts`, `helper.ts`, `banner.ts`, `logo.png`, `client.js`, `.gitignore`, `packages/ui/package.json` and `view.ts`.

| # | Do | See |
|---|---|---|
| 80 | U: nothing; then `--full` | `lawcheck: PASS  nothing changed against main`, exit 0; then the same first line and `debt (outside this change): 3 findings in 3 files`, slice one's three, no `forbidden-use`, exit 0 |
| 81 | add E | section 5's text output, exit 1 |
| 82 | add E; `--json` | section 5's document, exit 1 |
| 83 | `main` gets a second commit adding E; on `work` append `// end` to `src/core/tax.ts`; a plain run, then `--full` | test 7's output, exit 0; then that output, a blank line, `debt (outside this change): 3 findings in 3 files`, and under it `src/core/price.ts:2  warning[no-console]  writes to the terminal with console.log` with its why, `src/core/report.ts:2  warning[forbidden-use]  library may not use command (src/cli/main.ts); it takes may_use [library] from source` with its why, and `tools/release.mjs:2  warning[no-todo]  TODO without an issue number`, exit 0 |
| 84 | add `format.ts`, `shout.ts`, `flags.ts` and `build.mjs` | `lawcheck: FAIL  3 errors in 4 changed files (against main)`; exactly `src/cli/flags.ts:1  error[forbidden-use]  command may not use source (src/util/shout.ts); its may_use is [command, library]`, `src/util/format.ts:2  error[forbidden-use]  source may not use source (src/util/shout.ts); its may_use is [library]` and `tools/build.mjs:3  error[forbidden-use]  script may not use script (tools/release.mjs); its may_use is [source]`; `next: fix src/cli/flags.ts:1`; exit 1 |
| 85 | add X; then the same with `--json` | `lawcheck: FAIL  3 errors in 7 changed files (against main), 2 unresolved uses`; exactly `src/core/extra.ts:4  error[forbidden-use]  library may not use lib/helper.ts, which has no type; it takes may_use [library] from source`, `src/core/extra.ts:6  error[forbidden-use]  library may not use command (src/cli/main.ts); it takes may_use [library] from source` and `src/core/extra.ts:7  error[forbidden-use]  library may not use command (src/cli/banner.ts); it takes may_use [library] from source`; `next: fix src/core/extra.ts:4`; exit 1. Then `summary.unresolved` 2 and `unresolved` `[{ "file": "src/core/extra.ts", "line": 3, "what": "./generated/client.js", "answer": "none", "reason": "unfollowed", "candidates": [], "debt": false }, { "file": "src/core/view.ts", "line": 1, "what": "@sample/ui", "answer": "none", "reason": "unfollowed", "candidates": [], "debt": false }]`; `lodash` leaves the repository and is not counted |
| 86 | one at a time: E with line 2 `import '../cli/main.js'; // lawcheck-waive forbidden-use -- the report repeats the banner until 2.0`, then the same with `--json`; E with a new first line `// lawcheck-waive forbidden-use -- price is library code`; E with line 2 ending ` // lawcheck-waive uses-not-read -- the banner` | `lawcheck: PASS  1 changed file (against main), 1 waiver`, exit 0, then `waivers` `[{ "file": "src/core/report.ts", "line": 2, "rule": "forbidden-use", "debt": false, "waived": 1, "reason": "the report repeats the banner until 2.0" }]`; `lawcheck: FAIL  1 error, 1 warning in 1 changed file (against main), 1 waiver` with `src/core/report.ts:1  warning[waiver-unused]` and `src/core/report.ts:3  error[forbidden-use]`; `lawcheck: FAIL  2 errors in 1 changed file (against main)` with `src/core/report.ts:2  error[forbidden-use]` then `src/core/report.ts:2  error[waiver-unknown-rule]` |
| 87 | one at a time in U's law, as the last key of `library`: `may_use: [nope]`; `may_use: library`; `may_use:` with no value; `may_use: [1]`. Then, after `no-todo`, a rule `forbidden-use` with `why: x`; the same named `uses-not-read`, `parser-failed` | each exit 2 with `error[law-invalid]` alone: the first four at `.lawcheck/law.yaml:21`, the rest at `.lawcheck/law.yaml:9` |
| 88 | L in a new git repository, one commit on `main`, no remote; `lawcheck check --json`. Then make branch `work`, append `// end` to `kotlin/src/main/kotlin/com/acme/k/domain/Order.kt` and `cs/domain/Order.cs` and `# end` to `ruby/domain/order.rb`, and run `lawcheck check --base main` | exit 1; `scope` `{ "mode": "change", "base": null, "files": 36 }`; `summary` `{ "errors": 15, "warnings": 1, "debt": 0, "waivers": 0, "unresolved": 7 }`; `findings`, by code, file, line, severity and message, exactly section 5's 16 lines in their order; `unresolved` exactly section 5's 7, all with `debt` false. Then `lawcheck: FAIL  4 errors in 3 changed files (against main), 1 unresolved use`, with section 5's lines at `cs/domain/Order.cs:5`, `kotlin/.../Order.kt:3`, `ruby/domain/order.rb:1` and `:6`, exit 1 |
| 89 | S, slice one's sample with no `may_use`: add E, with the copy whose `dist/grammars/` is removed. Then U, add E, with the copy whose `dist/grammars/tree-sitter-ruby.wasm` holds the one byte `x` | `lawcheck: PASS  1 changed file (against main)`, exit 0; then test 81's output, exit 1 |
| 90 | add E; with the copy whose `dist/grammars/tree-sitter-typescript.wasm` holds the one byte `x`; then with that file removed | each: `lawcheck: ERROR  1 error`, a line starting `error[parser-failed]  the grammar of typescript cannot be loaded: `, `next: reinstall Lawcheck; a grammar it ships cannot be loaded`, exit 2 |
| 91 | `may_use: []` in place of `may_use: [library]` on `source`; add E | `lawcheck: FAIL  2 errors in 1 changed file (against main)`: `src/core/report.ts:1  error[forbidden-use]  library may not use library (src/core/price.ts); it takes may_use [] from source` and `src/core/report.ts:2  error[forbidden-use]  library may not use command (src/cli/main.ts); it takes may_use [] from source`, exit 1 |
| 92 | slice two's R, add F; `--review` with `LAWCHECK_REVIEWER_ENDPOINT=http://127.0.0.1:9/v1` | exit 2 and exactly one error line, `src/core/refund.ts  error[reviewer-unreachable]  clear-errors: http://127.0.0.1:9/v1 names a port that fetch refuses to call (bad port)`, the sentence of `spec/reviewer-slice.md`, section 6; no `TypeError` in the output |
| 93 | R, add F; `--review` with the fake and `LAWCHECK_REVIEWER_KEY` holding `k1`, a line break and `k2`; then config `provider: anthropic` and `model: test-model`, no endpoint, `ANTHROPIC_API_KEY` holding `k3`, a tab and `k4` | `error[reviewer-unreachable]  openai-compatible cannot be called: LAWCHECK_REVIEWER_KEY holds a character an HTTP header cannot carry` without place, exit 2, no request, neither `k1` nor `k2` in the output; then the same with `anthropic` and `ANTHROPIC_API_KEY`, neither `k3` nor `k4` |
| 94 | `npm test` | tests 1 to 93 pass, those section 9 amends as amended, offline |
| 95 | `npm run real`, outside `npm test`, with the network | section 11's two runs match, exit 0 |

The unit tests carry the rest, one file per new source file: the list in force for a type with and without its own key; each row of section 3.5 from resolver answers written by hand; `what` from the candidate that ended the walk and from the first; the `uses-not-read` message, its extensions and its split between change and debt; one finding per line and target; each row of section 3.3's failures, a reader that throws reading no file after it; `<what>` of section 8 for an error with a coded cause, a cause with a message only, no cause, and an empty message; and a notice in `dist/grammars/LICENSES.txt` for every `.wasm` beside it.

## 11. The real-repository test

`tests/real/run.ts`, run by `npm run real`, which builds first. It is not part of `npm test`. For each repository below, in a new `mktemp -d` folder: `git init`, `git remote add origin <url>`, `git fetch --depth 1 --no-tags origin <commit>`, `git checkout <commit>`, and a check that `HEAD` is that commit; then it writes `tests/real/<id>.yaml` as `.lawcheck/law.yaml`, runs `git add .lawcheck/law.yaml` and `node dist/cli.js check --full --base HEAD --json` there, and removes the folder. A run matches when it exits 0, its change holds no finding and no unresolved use, and `tests/real/<id>.expected` equals, line by line: each debt finding as `<place>  warning[<code>]  <message>`; then `unresolved: <n> (<a> ambiguous, <f> unfollowed, <o> unowned, <r> without a reason)`; then, for each repository, each unresolved use as `<file>:<line>  <answer>[ <reason>]  <what>[  [<candidates>]]`. The script prints each repository's result and time, and exits 0 when both match, 1 when one does not, 2 when a fetch fails.

The expected lines below were measured on 2026-11-13 with the throwaway script of section 3.4, which makes the calls of section 3.3 and applies sections 3.5, 4 and 5, measured again on 2026-11-15 with `npm run real` when Lawcheck moved to Runes 1.1.0, and on 2026-11-18 when it moved to Runes 1.2.0. They are the behaviour of that Runes version: a change of the readers changes them, and the change is made to the expected files knowingly, with the reason for each changed number below. Neither repository is the author's own, and neither is among the 33 of Runes' corpus.

### hono: TypeScript

`https://github.com/honojs/hono.git` at `f6fbaf0299c48eea9e656e03e2ffe7ac755e8823` (v4.13.18, 2026-11-11, MIT): 585 files. The law reads the layering its folders show: the core, small utilities that know nothing of the framework, routers, middleware, and two outer packages. 97 files fall under a list, 251 uses are read.

`tests/real/hono.yaml`:

```yaml
lawcheck: 0.1.0

types:
  tests:
    about: Tests beside the code they test.
    paths: ["src/**/*.test.{ts,tsx}"]
  source:
    about: The code of the hono package.
    paths: ["src/**", "!src/**/*.test.{ts,tsx}"]
    types:
      core:
        about: The application, the context, the request and the types every part shares.
        paths: ["src/*.ts", "src/request/**"]
        may_use: [core, utils, router]
      utils:
        about: Small functions that know nothing of the framework.
        paths: ["src/utils/**"]
        may_use: [utils]
      router:
        about: Routers behind one interface.
        paths: ["src/router/**"]
        may_use: [router, core, utils]
      middleware:
        about: Middleware, each on the public core and helpers.
        paths: ["src/middleware/**"]
        may_use: [middleware, core, utils, helper]
      helper:
        paths: ["src/helper/**"]
      adapter:
        paths: ["src/adapter/**"]
      jsx:
        paths: ["src/jsx/**"]
      client:
        paths: ["src/client/**"]
      validator:
        paths: ["src/validator/**"]
      preset:
        paths: ["src/preset/**"]
  vercel:
    about: The Vercel adapter package, built on the hono package of this workspace.
    paths: ["adapters/vercel/src/**"]
    may_use: [vercel, source]
  measures:
    about: Type-check measurements of the client.
    paths: ["perf-measures/type-check/*.ts"]
    may_use: [measures]
```

The debt heading is `debt (outside this change): 15 findings in 11 files, 1 unresolved use`. `tests/real/hono.expected`: 14 `forbidden-use`, 1 `uses-not-read`, and 1 unresolved use, a generated file git ignores, `unfollowed`. `src/index.ts:48` is a type-only re-export.

What changed with Runes 1.1.0: unresolved uses 5 → 1, because the reader now maps build output back to source through a tsconfig `outDir` written with a trailing slash, so the vercel adapter's four imports of `hono` bind `src/index.ts` and `src/helper/conninfo/index.ts`, which `[vercel, source]` allows (a reader fix; no new finding). The findings are unchanged: 14 `forbidden-use` and 1 `uses-not-read`.

```
.lawcheck/law.yaml:23  warning[uses-not-read]  1 file of type middleware is not read for uses: 1 .json
perf-measures/type-check/client.ts:1  warning[forbidden-use]  measures may not use client (src/client/index.ts); its may_use is [measures]
src/hono-base.ts:10  warning[forbidden-use]  core may not use helper (src/helper/route/index.ts); its may_use is [core, utils, router]
src/index.ts:48  warning[forbidden-use]  core may not use client (src/client/index.ts); its may_use is [core, utils, router]
src/middleware/combine/index.ts:9  warning[forbidden-use]  middleware may not use router (src/router/trie-router/index.ts); its may_use is [middleware, core, utils, helper]
src/middleware/jsx-renderer/index.ts:9  warning[forbidden-use]  middleware may not use jsx (src/jsx/index.ts); its may_use is [middleware, core, utils, helper]
src/middleware/jsx-renderer/index.ts:10  warning[forbidden-use]  middleware may not use jsx (src/jsx/index.ts); its may_use is [middleware, core, utils, helper]
src/middleware/jsx-renderer/index.ts:11  warning[forbidden-use]  middleware may not use jsx (src/jsx/streaming.ts); its may_use is [middleware, core, utils, helper]
src/middleware/method-not-allowed/index.ts:10  warning[forbidden-use]  middleware may not use router (src/router/trie-router/index.ts); its may_use is [middleware, core, utils, helper]
src/utils/body.ts:6  warning[forbidden-use]  utils may not use core (src/request.ts); its may_use is [utils]
src/utils/ipaddr.ts:6  warning[forbidden-use]  utils may not use helper (src/helper/conninfo/index.ts); its may_use is [utils]
src/utils/jwt/jws.ts:7  warning[forbidden-use]  utils may not use helper (src/helper/adapter/index.ts); its may_use is [utils]
src/utils/mount.ts:1  warning[forbidden-use]  utils may not use core (src/context.ts); its may_use is [utils]
src/utils/mount.ts:2  warning[forbidden-use]  utils may not use core (src/http-exception.ts); its may_use is [utils]
src/utils/mount.ts:3  warning[forbidden-use]  utils may not use core (src/request/constants.ts); its may_use is [utils]
unresolved: 1 (0 ambiguous, 1 unfollowed, 0 unowned, 0 without a reason)
perf-measures/type-check/client.ts:2  none unfollowed  ./generated/app
```

### gson: Java

`https://github.com/google/gson.git` at `a961b0fe088f8558d00cc1b56e506a3656907a91` (2026-11-09, Apache-2.0): 315 files, 266 of them Java. The law reads the packages: a streaming API meant to stand alone, annotations, type tokens, internals, the public classes with the tree of JSON values among them, and the extension artifacts built on the public classes. Every Java file is parsed for its declarations; 102 files fall under a list, 3,364 uses are read.

`tests/real/gson.yaml`:

```yaml
lawcheck: 0.1.0

types:
  library:
    about: The code of the gson artifact.
    paths: ["gson/src/main/java/com/google/gson/**/*.java"]
    may_use: [library]
    types:
      api:
        about: The public classes users call.
        paths: ["gson/src/main/java/com/google/gson/*.java"]
        types:
          tree:
            about: The tree of JSON values, which knows nothing of binding.
            paths: ["gson/src/main/java/com/google/gson/Json{Element,Array,Object,Primitive,Null}.java"]
            may_use: [tree, stream, internal]
      annotations:
        about: Annotations users put on their own classes.
        paths: ["gson/src/main/java/com/google/gson/annotations/**"]
        may_use: [annotations]
      stream:
        about: The streaming reader and writer, usable without the rest of gson.
        paths: ["gson/src/main/java/com/google/gson/stream/**"]
        may_use: [stream]
      reflect:
        about: Type tokens.
        paths: ["gson/src/main/java/com/google/gson/reflect/**"]
        may_use: [reflect, internal]
      internal:
        about: Implementation details behind the public classes.
        paths: ["gson/src/main/java/com/google/gson/internal/**"]
  extensions:
    about: Separate artifacts built on the public classes only.
    paths: ["extras/src/main/java/**/*.java", "proto/src/main/java/**/*.java", "metrics/src/main/java/**/*.java"]
    may_use: [extensions, api, annotations, reflect, stream]
  tests:
    about: Tests of every artifact.
    paths: ["*/src/test/java/**/*.java"]
```

The debt heading is `debt (outside this change): 19 findings in 9 files`. `tests/real/gson.expected`: 19 `forbidden-use` and the count of unresolved uses, 0. `JsonElement.java:427` names `Strictness`, a class of its own package, without an import. The two uses of `GsonBuildConfig.java` reach a template the build fills in, committed under `java-templates/` outside every type. The extensions keep their list. The 12 unresolved uses, all `unfollowed`, none ambiguous, are each `Entry` in `gson/src/main/java/com/google/gson/internal/LinkedTreeMap.java`: the member type `Map.Entry`, which `LinkedTreeMap` inherits from `java.util.Map` through `AbstractMap` (`AbstractSet+Entry` is only the first reading Runes tries inside `EntrySet`); Runes reads a member type inherited from a supertype outside the repository as a place of the repository it could not follow (section 7).

What changed with Runes 1.1.0: unresolved uses 2,567 → 12, because the reader now answers `outside` for the other 2,555 (of the 2,567 counted before, 1,740 were `java.lang` names offered as names of the file's own package, 744 imports of `java.*` and `javax.*`, and the rest imports of libraries), and Lawcheck no longer counts a use that leaves the repository (decision 18; a new outside classification, no reader fix). The findings are unchanged: 19 `forbidden-use`.

What changed with Runes 1.2.0: unresolved uses 12 → 0. The 12 were `Entry`, a member type `LinkedTreeMap` inherits from `java.util.AbstractMap` and `java.util.AbstractSet`; the readers now answer it `outside`, since the package `com.google.gson.internal` declares no type `Entry`. The findings are unchanged. hono is unchanged.

```
gson/src/main/java/com/google/gson/Gson.java:24  warning[forbidden-use]  api may not use gson/src/main/java-templates/com/google/gson/internal/GsonBuildConfig.java, which has no type; it takes may_use [library] from library
gson/src/main/java/com/google/gson/JsonElement.java:427  warning[forbidden-use]  tree may not use api (gson/src/main/java/com/google/gson/Strictness.java); its may_use is [tree, stream, internal]
gson/src/main/java/com/google/gson/annotations/JsonAdapter.java:19  warning[forbidden-use]  annotations may not use api (gson/src/main/java/com/google/gson/Gson.java); its may_use is [annotations]
gson/src/main/java/com/google/gson/annotations/JsonAdapter.java:20  warning[forbidden-use]  annotations may not use api (gson/src/main/java/com/google/gson/GsonBuilder.java); its may_use is [annotations]
gson/src/main/java/com/google/gson/annotations/JsonAdapter.java:21  warning[forbidden-use]  annotations may not use api (gson/src/main/java/com/google/gson/InstanceCreator.java); its may_use is [annotations]
gson/src/main/java/com/google/gson/annotations/JsonAdapter.java:22  warning[forbidden-use]  annotations may not use api (gson/src/main/java/com/google/gson/JsonDeserializer.java); its may_use is [annotations]
gson/src/main/java/com/google/gson/annotations/JsonAdapter.java:23  warning[forbidden-use]  annotations may not use api (gson/src/main/java/com/google/gson/JsonSerializer.java); its may_use is [annotations]
gson/src/main/java/com/google/gson/annotations/JsonAdapter.java:24  warning[forbidden-use]  annotations may not use api (gson/src/main/java/com/google/gson/TypeAdapter.java); its may_use is [annotations]
gson/src/main/java/com/google/gson/annotations/JsonAdapter.java:25  warning[forbidden-use]  annotations may not use api (gson/src/main/java/com/google/gson/TypeAdapterFactory.java); its may_use is [annotations]
gson/src/main/java/com/google/gson/annotations/Since.java:19  warning[forbidden-use]  annotations may not use api (gson/src/main/java/com/google/gson/GsonBuilder.java); its may_use is [annotations]
gson/src/main/java/com/google/gson/annotations/Until.java:19  warning[forbidden-use]  annotations may not use api (gson/src/main/java/com/google/gson/GsonBuilder.java); its may_use is [annotations]
gson/src/main/java/com/google/gson/internal/reflect/ReflectionHelper.java:20  warning[forbidden-use]  internal may not use gson/src/main/java-templates/com/google/gson/internal/GsonBuildConfig.java, which has no type; it takes may_use [library] from library
gson/src/main/java/com/google/gson/stream/JsonReader.java:20  warning[forbidden-use]  stream may not use api (gson/src/main/java/com/google/gson/Strictness.java); its may_use is [stream]
gson/src/main/java/com/google/gson/stream/JsonReader.java:21  warning[forbidden-use]  stream may not use internal (gson/src/main/java/com/google/gson/internal/JsonReaderInternalAccess.java); its may_use is [stream]
gson/src/main/java/com/google/gson/stream/JsonReader.java:22  warning[forbidden-use]  stream may not use internal (gson/src/main/java/com/google/gson/internal/TroubleshootingGuide.java); its may_use is [stream]
gson/src/main/java/com/google/gson/stream/JsonReader.java:23  warning[forbidden-use]  stream may not use internal (gson/src/main/java/com/google/gson/internal/bind/JsonTreeReader.java); its may_use is [stream]
gson/src/main/java/com/google/gson/stream/JsonWriter.java:28  warning[forbidden-use]  stream may not use api (gson/src/main/java/com/google/gson/FormattingStyle.java); its may_use is [stream]
gson/src/main/java/com/google/gson/stream/JsonWriter.java:29  warning[forbidden-use]  stream may not use api (gson/src/main/java/com/google/gson/Strictness.java); its may_use is [stream]
gson/src/main/java/com/google/gson/stream/MalformedJsonException.java:19  warning[forbidden-use]  stream may not use api (gson/src/main/java/com/google/gson/Strictness.java); its may_use is [stream]
unresolved: 0 (0 ambiguous, 0 unfollowed, 0 unowned, 0 without a reason)
```

## 12. Repository layout additions

```
package.json                  dependencies, allowScripts and scripts of section 6
.devcontainer/devcontainer.json   postCreateCommand: npm ci && npm run grammars
.gitignore                    .grammars/ added
scripts/grammars.ts           builds the 13 grammars into dist/grammars/ from the cache .grammars/, with LICENSES.txt
scripts/grammar-licenses.txt  each grammar's repository, commit, copyright line and licence text
spec/dependency-slice.md
src/
  readers.ts                  the readers of section 3.3: the file view, owners, the parser host and its grammars, languages, declarations, C# scopes and reachability, the resolver, each use's answer, the failures
  uses.ts                     the lists in force and sections 3.5, 4 and 5: answers to findings, the unresolved uses, their messages
  law.ts, waivers.ts, output.ts, check.ts, providers/http.ts, providers/openai-compatible.ts, providers/anthropic.ts   changed as sections 2, 5 and 8 say
tests/
  uses-sample/.lawcheck/law.yaml   U's law, laid over S
  languages-sample/           L's 36 files
  acceptance/                 tests 80 to 93, named by number, and the helper that builds the copy in a mktemp -d folder
  unit/readers.test.ts, unit/uses.test.ts
  real/run.ts, real/hono.yaml, real/hono.expected, real/gson.yaml, real/gson.expected
```

`npm test` builds, grammars included from the cache, and runs the unit tests and tests 1 to 93, offline and deterministic. `npm run real` needs the network and runs only by hand. Both run inside the dev container.
