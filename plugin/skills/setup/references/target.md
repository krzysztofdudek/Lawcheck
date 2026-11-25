# A target architecture and a plan

Read this file only when the user asked for a target architecture, a redesign or a plan to rebuild. The target is a law the code should reach, the distance of the code from it today, and at most seven steps, each one change of the law. It goes to `.lawcheck/target.md` and changes no law until the user says yes to one step. What the skill says under "The rules of a proposal" and "Measure for a proposal" holds for every line.

## 1. The aim

- **The user gave it.** Take the user's words, from the prompt or the conversation, and quote them as they were said. Add nothing to them. Write each problem the user named as one line: the words quoted, and the two types and the direction it is about.
- **The user gave none.** Ask once: "What should be true of this code that is not true today?" Give up to three options from the evidence of the repository, such as a written rule the code breaks, a cycle between two types or a type whose files fall into two groups, and room for the user's own words. Then wait for the answer.
- **No one will answer**, and the user said so. The aim may then come only from evidence of the kind `written`: a rule that someone wrote in the repository and the code breaks, quoted with its file and line. With no such rule, say in one sentence that the code gives no aim to plan for, and write no file.
- **A part of the aim that a law cannot hold**, such as speed, behaviour at run time, or uses in a language whose uses Lawcheck cannot read: put it under the heading `Not covered`, one line each.
- **What the user ruled out.** When the user said not to touch something, no step needs it. A step asks only to remove uses from files. It never needs a file moved or renamed, or a database migration, unless the user named that move.
- **An existing `.lawcheck/target.md`.** Keep its aim unless the user gives a new one, and write the file again from the measurement of today.

## 2. The target law

- Start from the law that stands. Change only what the aim asks for, and only types and `may_use` lists. A script rule is advice, not a target.
- Write the target law whole: the same as `.lawcheck/law.yaml` except in its types and their lists, so it can stand in the place of the law. It is written for where the files are today.
- Every type of the target has files today, unless the user named its folder in the aim.
- The types of the target are the units of the code, as the page's step 4 says. Merge into its unit each subtype of today's law that holds one file, or one subfolder of a unit such as its migrations or its models, unless the user named it. Never add such a subtype.
- A list that the target changes names what its files use today, minus the uses that the aim forbids.
- Each boundary that differs from the law of today names its evidence, of one kind:
  - `aim`: the user's words, quoted;
  - `written`: a rule that someone wrote in the repository, quoted with its file and line;
  - `direction`: a use against the main direction between two types, such as 40 files one way and 2 the other;
  - `cycle`: two types that use each other;
  - `few`: a use between two types that three files or fewer make;
  - `mixed`: a type whose files fall into two groups by the types they use, which the target splits into two subtypes.
- The target law must be a law: measured as a candidate, it prints no error code. It must fit `lawcheck prime` unshortened: the measurement prints no line `prime: shortened`.
- Each problem the user named shows up as findings of the target law: its row of the table counts its uses. A named problem with no finding means the target law misses it. Fix the target law before you go on.
- When the law of today already is the target, say so in one sentence, with what you checked, and write no file.

## 3. The distance

Measure the target law as the candidate, as "Measure for a proposal" says. Its table is the distance: from type, to type, files and uses. The line `total:` is the distance in one number, the uses the target forbids that the code makes today, and the files that make them. `$KEEP/types.txt` gives the count of today's files in each type of the target.

## 4. The steps

Each step is one change of `.lawcheck/law.yaml` that `lawcheck check` passes on the day it goes in.

- Step 1 holds the first problem the user named. Then the smallest bill first.
- A step only tightens: its law is the law of the step before plus its one change, and it takes away nothing an earlier step put in. The law of the last step is the target law.
- Every step of the kind `forbid now` adds findings. A split of a type goes into the step of the first boundary that needs it, never into a step of its own.
- Save the law of each step as `$KEEP/step-<n>.yaml` and measure it as the candidate. What the step adds is the count of findings of its line `debt (outside this change):`, minus that count of the step before. Write that count into the step, and its files and lines.
- Every step carries its whole law in the file. A step you cannot write out with its law is no step: write fewer steps, and put the rest under `Later`.

Each step has one kind, which is one of the ways of the page's part "A boundary the code already breaks":

- `forbid now`: the default. The files become debt: `lawcheck check --full --base HEAD` lists each use of the step, and each file fails the first change that edits it, as "Forbid it now" says. So the user sees each old use after a yes.
- `exception type`: only when the user asks that edits to those files keep passing. The files that break the boundary get a subtype of their own, with their paths written out and the wider list, as "Make the exception visible" says. Every other file of the type gets the boundary at once. No check lists their uses, and the step says so. `lawcheck explain --type <id>` shows how many files are still in the exception.
- `fix first`: the line goes into the law on the day the measured count is zero. Until then nothing holds the boundary, and the step says so.

Write at most seven steps. What is left goes under the heading `Later`, one line each, with the two types and the count of uses and files.

## 5. The file

Write `.lawcheck/target.md` after the last measurement, when no candidate is in place:

````markdown
# Target architecture: a proposal

Written by a coding agent on <date>, at commit <commit>, with Lawcheck <version>. Nothing in this file is law: `lawcheck check` reads none of it. A step becomes law when you say yes to that step.

## Aim

"<the user's words>"

- "<a problem the user named>": <from type> -> <to type>, <N> uses in <M> files under the target law

## Target law

| Type | Paths | Files today |
|---|---|---|

```yaml
<the whole target law>
```

## Distance today

| From | To | Files | Uses | Where |
|---|---|---|---|---|

Total: <N> uses in <M> files.

## Steps

### Step 1. <the change of `law.yaml`, in one sentence> (<kind>)

- Evidence: <kind and citation>
- Adds: <N> uses in <M> files that the law before it allows
- Code to change: <N> places in <M> files: <file:line, ...>
- Changes: `.lawcheck/law.yaml`, and no other file
- Done when: with this law in `.lawcheck/law.yaml`, `lawcheck check --full --base HEAD` exits 0 and prints a line that starts with `debt (outside this change): <N> findings in <M> files`
- To make it law: type `/lawcheck:setup make step 1 of the target law`
- Law after this step:

```yaml
<the whole law.yaml after this step>
```

## Later

## Not covered
````

Under a heading with nothing in it, write "nothing". In the column `Where`, give up to three files and lines, and "and <n> more" for the rest. Every step has all seven lines and its law. The line "Done when" copies the line `debt (outside this change):` of that step's measurement, and says nothing about the code after a fix. `lawcheck check` can print counts of waivers and unresolved uses after it on the same line, and the measurement leaves them out.

Check four things before you write the file:

1. Each problem of the part `## Aim` counts more than 0 uses under the target law.
2. Each step has its law, and the law of the last step is the target law.
3. Each count of a line `- Adds:` is the difference of two debt lines.
4. No type of the target is a subtype of one file or one subfolder.

## 6. Tell and ask

Give the aim, the distance and the first step in plain words, with their counts. Then ask one question: make step 1 law now, or keep the proposal as it is.

- **On a yes to a step.** Put the law of that step in place as the file writes it, and change no file outside its line "Changes". Then go through the page's parts "A boundary the code already breaks" and "Prove each restriction bites", and run `lawcheck check --full --base HEAD`, which exits 0. Tell the user its count of debt. A step of the kind `fix first` whose count is not zero yet writes no law: say so, and keep it. Measure the distance again, and write the file again without that step, with the new distance and the steps numbered again.
- **On a yes to the plan as a whole.** No law changes. The file stays as the plan of the team, and each step still needs its own yes.
- **No one will answer**, and the user said so: write the file, give the aim, the distance and the steps in the final message, and change no law.
- When the types and lists of `.lawcheck/law.yaml` equal the target law, delete the file and say so.

## 7. In later sessions

When the user asks how far the code is from the target, measure the target law of the file again and give the total of today beside the total in the file. Change the file only when the user asks.

## 8. The final message

It stands on its own, also after the user said "not now" or "I'll think about it". It has every label of the page's step 11, in its order, from **The law** on. **The law** and **Debt** describe the law in force, which this session wrote or found. Then comes a part of its own under the label **The target**, apart from what the law holds:

- where the file is, that nothing in it is law, and that the target is not in force;
- the distance as a number of uses and files;
- step 1 by its name, its count, and the line "To make it law" of the file;
- the steps that became law on the user's word, or "none";
- that the user decides whether to commit the file or delete it.

When no rebuild is needed, the part says so in one sentence, and says what you checked. It offers no advice.
