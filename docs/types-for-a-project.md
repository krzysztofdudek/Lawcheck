# Types for an existing project

You end with a law whose types cover the folders of an existing project with no file in two types, and `lawcheck explain` says for any path which type it has and why.

The outputs below come from a repository with `scripts/release.mjs` and five files under `src/`: `api/orders.ts`, `core/price.ts`, its test `core/price.test.ts`, `db/orders.ts`, and `generated/schema.ts`, which a code generator writes. You ran `lawcheck init` at its root ([The first type and the first rule](first-law.md)).

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

Give each folder of `src/` a type. A type under the `types` key of another type is a subtype: Lawcheck tests a file against a subtype only after the file matched the parent, so `api` takes only the `.ts` files of `src/api/`. Write this into `.lawcheck/law.yaml`:

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

The file of `source` is `src/generated/schema.ts`: it matches `src/**/*.ts` and no subtype. The two files without a type are the files of `.lawcheck/`. No rule judges a file without a type.

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

The `type` line gives the chain from the root type down to the file's type, `source > api`. The `matched` line gives the pattern that matched at each level. The rules of every type in the chain bind the file.

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

`core` holds the test of `src/core/price.ts` too. The tests need rules of their own, so they get a type of their own.

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

`src/core/price.test.ts` matches `source` and `test`, two root types. A file has one type, so every run stops with exit 2 until one of the two leaves the file out ([type-overlap](codes.md#type-overlap)).

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

The code generator writes `src/generated/schema.ts` again on every build, so no rule should judge it. Add a second exclusion to the `paths` of `source`:

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

`explain` takes a path that does not exist, and answers with the law a new file there would get:

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

[The law file](law.md) describes every key of a type and every form of a pattern.

## If it goes wrong

- `type-overlap` between two subtypes, such as `api` and `core`: the fix is the same, a `!` pattern in one of them.
- `law-invalid`, and the message says the pattern `holds ** beside other characters in one segment`: `**` stands for a whole segment. Write `src/api/**/*.ts`, never `src/api/**.ts`.
- A file of `src/api/v1/` gets `source` and no `api`, with the pattern `src/api/*`: `*` stops at a `/`. Write `src/api/**`.
- `explain` says the file matches the paths of a type but not their content: the type has a `content` expression, and the text of the file does not match it.
- `explain` answers `git ignores it, so Lawcheck never sees it`: `.gitignore` names the file, so no type takes it.
- `usage`, and the message ends with the nearest type id, such as `(did you mean 'core'?)`: `--type` takes the id of a type of the law.
