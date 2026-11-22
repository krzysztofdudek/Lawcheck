# Forbid one layer to use another

You end with a law in which the business logic may not import the HTTP handlers. `lawcheck check` fails on the line that does.

The outputs below come from a repository with three files:

- `src/api/orders.ts` imports `src/core/price.ts`;
- `src/core/price.ts`;
- `src/core/orders.sql`.

The build writes `src/generated/schema.ts`, into a folder that `.gitignore` names. The law gives `src/api/` the type `api` and `src/core/` the type `core` ([Types for an existing project](types-for-a-project.md)).

## 1. Give core a may_use list

`may_use` names the types whose files a type's files may [use](concepts.md#use). A type may use its own files only when its list names it. Add the list to `core` in `.lawcheck/law.yaml`:

```yaml
lawcheck: 0.1.0

types:
  api:
    about: The HTTP handlers.
    paths: ["src/api/**"]
  core:
    about: The business logic.
    paths: ["src/core/**"]
    may_use: [core]
```

`api` has no list. Its files may use any file. A subtype without a list takes the list of its nearest parent that has one.

## 2. See the list a file gets

```text
$ lawcheck explain src/core/price.ts
```

```output
src/core/price.ts
  type:  core  (core)  The business logic.
  matched:  core by "src/core/**"
  may use:  core
  uses:  read as typescript
  rules:  none
  waivers:  none
```

The `uses` line says Lawcheck reads the imports of this file as TypeScript.

## 3. Write a file that breaks the list

Write `src/core/discount.ts`:

```ts
import { order } from '../api/orders';

export const discount = order;
```

## 4. Check it

```text
$ lawcheck check src/core/discount.ts
```

```output
lawcheck: FAIL  1 error in 1 named file

src/core/discount.ts:1  error[forbidden-use]  core may not use api (src/api/orders.ts); its may_use is [core]
  why:  a type's may_use names every type its files may use

next: fix src/core/discount.ts:1
```

The [finding](concepts.md#finding) gives four things:

- the line of the import;
- the type of the file;
- the type and the path of the file it imports;
- the `may_use` list of `core`.

`check` exits 1. `lawcheck check src/core/discount.ts` judges the file you name, changed or not. On a branch, a plain `lawcheck check` judges the file once it differs from the [base](concepts.md#base).

## 5. Fix the import

You have two fixes. One keeps the list and takes the import out. The other writes `may_use: [core, api]`, for a `core` that may use `api` after all. This example keeps the list. Write `src/core/discount.ts` again, without the import of `api`:

```ts
import { price } from './price';

export const discount = price;
```

## 6. Check it again

```text
$ lawcheck check src/core/discount.ts
```

```output
lawcheck: PASS  1 named file
```

## 7. Add an import of a file git does not list

Add an import of the schema the build writes:

```ts
import { price } from './price';
import { schema } from '../generated/schema';

export const discount = price + schema;
```

## 8. Check it with the new import

```text
$ lawcheck check src/core/discount.ts
```

```output
lawcheck: PASS  1 named file, 1 unresolved use
```

The import points into the repository. git lists no file there, since `.gitignore` names `src/generated/`. Lawcheck cannot tell which type the use reaches. It counts the use as unresolved. The list neither allows nor forbids an unresolved use. Such a use never fails a run. The first line counts it.

## 9. List the unresolved uses

```text
$ lawcheck check src/core/discount.ts --json
```

The `unresolved` list of the output holds the use:

```output
  "unresolved": [
    {
      "file": "src/core/discount.ts",
      "line": 2,
      "what": "../generated/schema",
      "answer": "none",
      "reason": "unfollowed",
      "candidates": [],
      "debt": false
    }
  ],
```

`unfollowed` means the use names a place of the repository that holds no file git lists. [Languages and uses](languages.md) lists every answer and reason. A use of an installed package or of the standard library leaves the repository. Lawcheck does not count such a use.

## 10. Check the whole folder

```text
$ lawcheck check src/core
```

```output
lawcheck: PASS  1 warning in 3 named files, 1 unresolved use

.lawcheck/law.yaml:7  warning[uses-not-read]  1 file of type core is not read for uses: 1 .sql
  why:  a restriction that cannot be checked is not shown as kept
```

Lawcheck reads the uses of twelve languages. A reader is the part of Lawcheck that reads the uses of one language. No reader reads `.sql` files. Lawcheck cannot check a `.sql` file of `core` against the list. It warns once for the type, at the line of `core` in the law. The warning never fails a run.

## 11. Leave the .sql files out of core

Give `core` these `paths`:

```yaml
    paths: ["src/core/**", "!src/core/**/*.sql"]
```

## 12. Check the folder again

```text
$ lawcheck check src/core
```

```output
lawcheck: PASS  3 named files, 1 unresolved use
```

The `.sql` files have no type now. No list judges them. A [script rule](concepts.md#script-rule) can check what they use ([Write a script rule](write-a-script-rule.md)).

## If it goes wrong

- The finding says `core may not use src/util/x.ts, which has no type`: no list allows a file without a type. Give the file a type and list that type, or move the file under a type the list names.
- A file of `core` uses another file of `core`, and the check fails: the list must name `core` itself.
- An import you expected to fail passes, and the first line counts no unresolved use: the readers miss some forms, such as `import()` of a variable. [Languages and uses](languages.md) lists them.
- An unresolved use with the answer `ambiguous`: the use could name several files of different types, and `candidates` lists them. Lawcheck judges none of them.

Next: [Write a script rule](write-a-script-rule.md)
