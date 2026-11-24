# A target architecture and a plan

Read this file only when the user asked for a target architecture, a redesign or a plan to rebuild. The target is a law the code should reach, the distance of the code from it today, and at most seven steps, each one change of the law. It goes to `.lawcheck/target.md` and changes no law until the user says yes to one step. What the skill says under "The rules of a proposal" and "Measure for a proposal" holds for every line.

## 1. The aim

- **The user gave it.** Take the user's words, from the prompt or the conversation, and quote them as they were said. Add nothing to them.
- **The user gave none.** Ask once: "What should be true of this code that is not true today?" Give up to three options from the evidence of the repository, such as a written rule the code breaks, a cycle between two types or a type whose files fall into two groups, and room for the user's own words. Then wait for the answer.
- **No one will answer**, and the user said so. The aim may then come only from evidence of the kind `written`: a rule that someone wrote in the repository and the code breaks, quoted with its file and line. With no such rule, say in one sentence that the code gives no aim to plan for, and write no file.
- **A part of the aim that a law cannot hold**, such as speed, behaviour at run time, or uses in a language whose uses Lawcheck cannot read: put it under the heading `Not covered`, one line each.
- **An existing `.lawcheck/target.md`.** Keep its aim unless the user gives a new one, and write the file again from the measurement of today.

## 2. The target law

- Start from the law that stands. Change only what the aim asks for, and only types and `may_use` lists. A script rule is advice, not a target.
- Write the target law whole: the same as `.lawcheck/law.yaml` except in its types and their lists, so it can stand in the place of the law.
- Every type of the target has files today, unless the user named its folder in the aim.
- Each boundary that differs from the law of today names its evidence, of one kind:
  - `aim`: the user's words, quoted;
  - `written`: a rule that someone wrote in the repository, quoted with its file and line;
  - `direction`: a use against the main direction between two types, such as 40 files one way and 2 the other;
  - `cycle`: two types that use each other;
  - `few`: a use between two types that three files or fewer make;
  - `mixed`: a type whose files fall into two groups by the types they use, which the target splits into two subtypes.
- The target law must be a law: measured as a candidate, it prints no error code. It must fit `lawcheck prime` unshortened: the measurement prints no line `prime: shortened`.
- When the law of today already is the target, say so in one sentence and write no file.

## 3. The distance

Measure the target law as the candidate, as "Measure for a proposal" says. Its table is the distance: from type, to type, files and uses. The line `total:` is the distance in one number, the uses the target forbids that the code makes today, and the files that make them.

## 4. The steps

Each step is one change of `.lawcheck/law.yaml` that `lawcheck check` passes on the day it goes in. Put a split of a type before the steps that need it, then the smallest bill first. Each step has one kind, which is one of the ways of the page's part "A boundary the code already breaks":

- `exception type`: the files that break the boundary get a subtype of their own, with their paths written out and the wider list, as "Make the exception visible" says. Its `about` says that its files still use the other type, that files leave it and none join it. Every other file of the type gets the boundary at once. The progress shows in `lawcheck explain --type <id>`: how many files are still in the exception. This kind is the default while the law with the files written out still fits `lawcheck prime` unshortened.
- `forbid now`: the files become debt, and each one fails the first change that edits it, as "Forbid it now" says. The progress shows in the count of findings outside the change of `lawcheck check --full --base HEAD`.
- `fix first`: the line goes into the law on the day the measured count is zero. Until then nothing holds the boundary, and the step says so. The progress shows in the measurement of the step's line as the candidate.

Write at most seven steps. What is left goes under the heading `Later`, one line each.

## 5. The file

Write `.lawcheck/target.md` after the last measurement, when no candidate is in place:

````markdown
# Target architecture: a proposal

Written by a coding agent on <date>, at commit <commit>, with Lawcheck <version>. Nothing in this file is law: `lawcheck check` reads none of it. A step becomes law when you say yes to that step.

## Aim

"<the user's words>"

## Target law

```yaml
<the whole target law>
```

## Distance today

| From | To | Files | Uses |
|---|---|---|---|

Total: <N> uses in <M> files.

## Steps

1. <the change of `law.yaml`> (<kind>). Evidence: <kind and citation>. Holds after it: <what the checker refuses>. Code to change: <files>. Progress: <command>.

## Later

## Not covered
````

Under a heading with nothing in it, write "nothing".

## 6. Tell and ask

Give the aim, the distance and the first step in plain words. Then ask one question: make step 1 law now, or keep the proposal as it is.

- **On a yes to a step.** Make it law through the page's parts "A boundary the code already breaks" and "Prove each restriction bites", then run `lawcheck check --full --base HEAD`, which exits 0. A step of the kind `fix first` whose count is not zero yet writes no law: say so, and keep it. Measure the distance again, and write the file again without that step, with the new distance and the steps numbered again.
- **On a yes to the plan as a whole.** No law changes. The file stays as the plan of the team, and each step still needs its own yes.
- **No one will answer**, and the user said so: write the file, give the aim, the distance and the steps in the final message, and change no law.
- When the types and lists of `.lawcheck/law.yaml` equal the target law, delete the file and say so.

## 7. In later sessions

When the user asks how far the code is from the target, measure the target law of the file again and give the total of today beside the total in the file. Change the file only when the user asks.

## 8. The final message

It stands on its own. It gives the aim, the distance, the steps, what became law, and where the file is. It says that nothing in the file is law, and that the user decides whether to commit the file or delete it. It offers no advice.
