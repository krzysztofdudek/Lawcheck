# A law shared by a team

Two developers record reviews on two branches, and both branches add lines to `.lawcheck/verdicts`. The merge keeps both, so nobody asks the reviewer again for what a teammate already paid for. The [law](concepts.md#law), the [rules](concepts.md#rule), the settings and the [verdicts](concepts.md#verdict) live in git, and every clone checks against the same law.

The outputs below come from a repository with this law, a [reviewer rule](concepts.md#reviewer-rule) in `.lawcheck/rules/clear-errors.md` ([Reviewer rules](reviewer-rules.md)), and a `main` that holds the law and no code:

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

Lawcheck takes the key from the environment alone. Each developer sets `ANTHROPIC_API_KEY` on their own machine. A key written into `.lawcheck/config.yaml` is `config-invalid` ([Reviewers and keys](providers.md)).

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

A CI job prints the same, and fails, for a file whose review nobody committed.

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

Commit `.lawcheck/verdicts` and `.lawcheck/.gitattributes` with the code. `.lawcheck/verdicts` holds one line per pass. `.lawcheck/.gitattributes` holds `verdicts merge=union`, so a merge keeps the lines of both branches. `.lawcheck/.local/` holds the fails this machine cached, and git ignores it.

## 5. Merge two branches that both recorded reviews

A teammate recorded the review of `src/core/price.ts` on the branch `price`. On `main`, after you merged `refund`:

```text
$ git merge price
```

Git keeps the lines of both branches, and the merge goes through.

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

`reviewed` says that `.lawcheck/verdicts` holds the pass for this content. A CI job reads it and calls no reviewer ([CI and git hooks](ci.md)).

## A conflict in the verdicts file

A merge stops with a conflict in `.lawcheck/verdicts` when `.lawcheck/.gitattributes` was never committed. Git then shows the lines of both branches between conflict markers.

### 1. Write the attribute

Write `.lawcheck/.gitattributes` with this line:

```text
verdicts merge=union
```

### 2. Merge the file again

```text
$ git checkout -m .lawcheck/verdicts
```

Git merges the file again with the attribute, and keeps every line of both branches without markers.

### 3. Commit the merge

```text
$ git add .lawcheck/verdicts .lawcheck/.gitattributes
$ git commit --no-edit
```

`lawcheck explain src/core/price.ts` then shows `reviewed`, as in step 6.

## A change of the law

A [change](concepts.md#change) that edits the law or a rule file changes the law every developer checks against. `lawcheck check` says so under its first line ([What a check judges](change.md)), and the CI job checks such a change a second time with the law of its base ([CI and git hooks](ci.md)). Lawcheck does not choose who reviews the change. On GitHub, a code owner for `.lawcheck/` and a required review make a person approve every change of the law.

## If it goes wrong

- `config-invalid` at the line of `keys`: someone wrote a key into `.lawcheck/config.yaml`. The key goes in the environment, so take that line out.
- A teammate's check shows `not-reviewed` for a file you reviewed. The file, the text or `why` of the rule, or a file its `context` names changed after your review, or you did not push `.lawcheck/verdicts`. Run `lawcheck check --review` again and commit the file.
- A review failed on your machine, and your teammate sees `not-reviewed`. A fail stays in `.lawcheck/.local/` of the machine that asked, and only a pass goes into `.lawcheck/verdicts`.
