# Types for an existing project

You end with a law whose types cover the folders of an existing project. No file falls in two types. One type takes its files by their text. `lawcheck explain` says for any path which type it has, and why.

The outputs below come from a repository with `scripts/release.mjs` and five files under `src/`:

- `src/api/orders.ts`;
- `src/core/price.ts`;
- `src/core/price.test.ts`, which tests `src/core/price.ts`;
- `src/db/orders.ts`;
- `src/generated/schema.ts`, which a code generator writes.

You ran `lawcheck init` in its top folder, the [root](concepts.md#law) of the law ([The first type and the first rule](first-law.md)).

## 1. See the files without a type

```text
$ lawcheck explain .
```

```output
./  8 files
  no type  8 files
```

`explain` with a folder counts the files git lists below it, by type. The two files `init` wrote count too.

## 2. Describe the folders as types

Give each folder of `src/` a [type](concepts.md#type). A type under the `types` key of another type is a subtype, which Lawcheck tests on a file only after the file matched the parent. Under the parent `source`, `api` takes the `.ts` files of `src/api/` and no other file. Write this into `.lawcheck/law.yaml`:

```yaml
lawcheck: 0.1.0

types:
  source:
    about: Everything that ships.
    paths: ["src/**/*.ts"]
    types:
      api:
        about: The HTTP handlers.
        paths: ["src/api/**"]
      core:
        about: The business logic.
        paths: ["src/core/**"]
      db:
        about: The database access.
        paths: ["src/db/**"]
  script:
    about: The release scripts.
    paths: ["scripts/**"]
```

## 3. See the files of each type

```text
$ lawcheck explain .
```

```output
./  8 files
  source  1 file
  api  1 file
  core  2 files
  db  1 file
  script  1 file
  no type  2 files
```

The file of `source` is `src/generated/schema.ts`. It matches `src/**/*.ts` and no subtype. The two files without a type are the files of `.lawcheck/`. No rule judges a file without a type.

## 4. See why a file has its type

```text
$ lawcheck explain src/api/orders.ts
```

```output
src/api/orders.ts
  type:  api  (source > api)  The HTTP handlers.
  matched:  source by "src/**/*.ts", api by "src/api/**"
  may use:  any file; no type on the way up has may_use
  rules:  none
  waivers:  none
```

The `type` line gives the chain from the top-level type down to the type of the file: `source > api`. The `matched` line gives the pattern that matched at each level. The rules of every type in the chain [bind](concepts.md#rule) the file.

## 5. List the files of one type

```text
$ lawcheck explain --type core
```

```output
type core  (source > core)  The business logic.
  paths:  src/core/**
  may use:  any file; no type on the way up has may_use
  rules:  none
  subtypes:  none
  files:  2
    src/core/price.test.ts
    src/core/price.ts
```

`core` holds the test of `src/core/price.ts` too. The next step gives the tests a type, because they need rules of their own.

## 6. Add a type for the tests

Add these lines at the end of `.lawcheck/law.yaml`, under `types`, beside `source` and `script`:

```yaml
  test:
    about: The tests.
    paths: ["src/**/*.test.ts"]
```

## 7. Run a check

```text
$ lawcheck check
```

```output
lawcheck: ERROR  1 error

src/core/price.test.ts  error[type-overlap]  the file matches the types 'source' and 'test' of one level
  why:  a file has one type, so the rules that bind it are never in doubt

next: narrow the paths or content of the types that overlap in .lawcheck/law.yaml, then run lawcheck check
```

`src/core/price.test.ts` matches the two top-level types `source` and `test`. A file has one type. Every run stops with exit 2 until one of the two types leaves the file out ([type-overlap](codes.md#type-overlap)).

## 8. Leave the tests out of source

A pattern that starts with `!` excludes the files it matches. Give `source` these `paths`:

```yaml
    paths: ["src/**/*.ts", "!src/**/*.test.ts"]
```

## 9. See the type of the test

```text
$ lawcheck explain src/core/price.test.ts
```

```output
src/core/price.test.ts
  type:  test  (test)  The tests.
  matched:  test by "src/**/*.test.ts"
  may use:  any file; no type on the way up has may_use
  rules:  none
  waivers:  none
```

## 10. Leave the generated file out

The code generator writes `src/generated/schema.ts` again on every build. No rule should judge it. Add a second exclusion to the `paths` of `source`:

```yaml
    paths: ["src/**/*.ts", "!src/**/*.test.ts", "!src/generated/**"]
```

## 11. See the generated file

```text
$ lawcheck explain src/generated/schema.ts
```

```output
src/generated/schema.ts
  type:  none: no type's paths match it, so no rule judges it
```

## 12. See the type of a file you have not written yet

`explain` takes a path that does not exist. It answers with the law a new file there would get:

```text
$ lawcheck explain src/api/refunds.ts
```

```output
src/api/refunds.ts  (does not exist yet)
  type:  api  (source > api)  The HTTP handlers.
  matched:  source by "src/**/*.ts", api by "src/api/**"
  may use:  any file; no type on the way up has may_use
  rules:  none
```

## 13. Write a test beside the code

A test can sit beside the code, under a name that no pattern tells apart from the code. Write one such test, `src/core/rounding.ts`:

```ts
import { test } from 'node:test';
import { price } from './price';

test('a price is a whole number', () => price);
```

## 14. Give the tests beside the code a type by their text

A `content` expression gives a type to the files whose text matches it. Put such a type under the type that takes the file by its paths, because Lawcheck tests a subtype only on the files that matched its parent. In `.lawcheck/law.yaml`, replace the three lines of `core` with these:

```yaml
      core:
        about: The business logic.
        paths: ["src/core/**"]
        types:
          core-test:
            about: The tests beside the business logic.
            paths: ["src/core/**"]
            content: "from 'node:test'"
```

A type with `content` beside `core` does not work. Both types of one level would match the test, because `core` takes it by its paths alone. Every run would then stop with `type-overlap`.

## 15. See the type a file gets by its text

```text
$ lawcheck explain src/core/rounding.ts
```

```output
src/core/rounding.ts
  type:  core-test  (source > core > core-test)  The tests beside the business logic.
  matched:  source by "src/**/*.ts", core by "src/core/**", core-test by "src/core/**" and content "from 'node:test'"
  may use:  any file; no type on the way up has may_use
  rules:  none
  waivers:  none
```

The `matched` line names the pattern and the content that chose `core-test`. `src/core/price.ts` holds no `from 'node:test'`. It keeps the type `core`.

[The law file](law.md) describes every key of a type and every form of a pattern.

## If it goes wrong

- Two subtypes, such as `api` and `core`, give `type-overlap`: add a `!` pattern to one of them, as in step 8.
- A type with `content` and a type beside it give `type-overlap`: move the type with `content` under the type that takes the file by its paths, as in step 14.
- Lawcheck prints `law-invalid`, and the message says the pattern `holds ** beside other characters in one segment`: `**` stands for a whole segment. Write `src/api/**/*.ts`, never `src/api/**.ts`.
- A file of `src/api/v1/` gets `source` and no `api`, with the pattern `src/api/*`: `*` stops at a `/`. Write `src/api/**`.
- `explain` says the file matches the paths of a type but not their content: the type has a `content` expression. The text of the file does not match it.
- `explain` answers `git ignores it, so Lawcheck never sees it`: `.gitignore` names the file. No type takes a file that git ignores.
- `explain --type` prints the error [`usage`](codes.md#usage), and the message ends with the nearest type id, such as `(did you mean 'core'?)`: `--type` takes the id of a type of the law.

Next: [Forbid one layer to use another](forbid-a-use.md)
