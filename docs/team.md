# A law shared by a team

Two developers record reviews on two branches. Both branches add lines to `.lawcheck/verdicts`. Git keeps the lines of both branches in the merge. You do not pay the reviewer again for a file that your teammate's review covers. The [law](concepts.md#law), the [rules](concepts.md#rule), the settings and the [verdicts](concepts.md#verdict) are files in git. Every clone checks against the same law.

The outputs below come from a repository whose `main` holds the law and no code. Its [reviewer rule](concepts.md#reviewer-rule) is `.lawcheck/rules/clear-errors.md` ([Reviewer rules](reviewer-rules.md)). This is its law:

```yaml
lawcheck: 0.1.0

rules:
  clear-errors:
    why: An error a caller sees says what happened and what to do next.

types:
  library:
    about: The code every command shares.
    paths: ["src/core/**"]
    rules: [clear-errors]
```

## 1. Give everyone one reviewer

Commit `.lawcheck/config.yaml` with the provider and the model:

```yaml
reviewer:
  provider: anthropic
  model: your-model-id
```

Lawcheck takes the key from the environment alone. Each developer sets `ANTHROPIC_API_KEY` on their own machine. Lawcheck refuses a key written into `.lawcheck/config.yaml` with `config-invalid` ([Reviewers and keys](providers.md)).

## 2. See the files with no verdict

On the branch `refund`, which adds `src/core/refund.ts`:

```text
$ lawcheck check --base main
```

```output
lawcheck: FAIL  1 error in 1 changed file (against main)

src/core/refund.ts  error[not-reviewed]  clear-errors has no verdict for this content
  why:  a reviewer rule says nothing about content it has not judged

next: lawcheck check --review --base main  (1 reviewer call)
```

A CI job prints the same lines and fails when the committed `.lawcheck/verdicts` holds no review of the file.

## 3. Record the reviews before you push

```text
$ lawcheck check --review --base main
```

```output
lawcheck: PASS  1 changed file (against main), 1 reviewer call
```

## 4. Commit what the review wrote

```text
$ git status --short --ignored .lawcheck
```

```output
?? .lawcheck/.gitattributes
?? .lawcheck/verdicts
!! .lawcheck/.local/
```

Commit `.lawcheck/verdicts` and `.lawcheck/.gitattributes` with the code. `.lawcheck/verdicts` holds one line per pass. `.lawcheck/.gitattributes` holds `verdicts merge=union`. With that line, git keeps the lines of both branches when it merges the file. `.lawcheck/.local/` holds the failed reviews that this machine keeps. Git ignores that folder.

## 5. Merge two branches that both recorded reviews

A teammate recorded the review of `src/core/price.ts` on the branch `price`. You merged `refund` into `main`. On `main`, merge `price`:

```text
$ git merge price
```

Git keeps the lines of both branches. The merge goes through without a conflict.

## 6. See the teammate's review on main

```text
$ lawcheck explain src/core/price.ts
```

```output
src/core/price.ts
  type:  library  (library)  The code every command shares.
  matched:  library by "src/core/**"
  may use:  any file; no type on the way up has may_use
  rules:
    clear-errors  reviewer  enforced  from library  reviewed  An error a caller sees says what happened and what to do next.
  waivers:  none
```

The word `reviewed` says that `.lawcheck/verdicts` holds the pass for this content of the file. A CI job reads that pass and calls no reviewer ([CI and git hooks](ci.md)).

## A conflict in the verdicts file

If the repository has no committed `.lawcheck/.gitattributes`, git stops the merge with a conflict in `.lawcheck/verdicts`. Git then shows the lines of both branches between conflict markers.

### 1. Write the attribute

Write `.lawcheck/.gitattributes` with this line:

```text
verdicts merge=union
```

### 2. Merge the file again

```text
$ git checkout -m .lawcheck/verdicts
```

Git merges the file again with the attribute. It keeps every line of both branches, with no conflict markers.

### 3. Commit the merge

```text
$ git add .lawcheck/verdicts .lawcheck/.gitattributes
$ git commit --no-edit
```

`lawcheck explain src/core/price.ts` then shows `reviewed`, as in step 6.

## A change of the law

A [change](concepts.md#change) that edits the law or a rule file changes the law that every developer checks against. `lawcheck check` says so in a note under its first line ([What a check judges](change.md)). The CI job checks such a change a second time, with the law of its base ([CI and git hooks](ci.md)). Lawcheck does not choose who reviews the change. On GitHub, a code owner for `.lawcheck/` and a required review make a person approve each change of the law.

## If it goes wrong

- `config-invalid` at the line of `keys`: someone wrote a key into `.lawcheck/config.yaml`. Remove that line, and set the key in the environment.
- A teammate's check shows `not-reviewed` for a file you reviewed. Check that you pushed `.lawcheck/verdicts`. If you did, one of these changed after your review: the file, the text or `why` of the rule, or a file that the rule's `context` names. The key `context` of a rule names files that the reviewer reads with each file it judges. Run `lawcheck check --review` again, and commit `.lawcheck/verdicts`.
- A review failed on your machine. Your teammate sees `not-reviewed` for that file. Lawcheck keeps a failed review in `.lawcheck/.local/` of the machine that ran it. It writes only passes into `.lawcheck/verdicts`.

Next: [A monorepo](monorepo.md)
