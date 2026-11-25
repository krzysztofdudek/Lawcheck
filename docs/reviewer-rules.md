# Reviewer rules

A [reviewer rule](concepts.md#reviewer-rule) is a rule in prose that a language model judges. That model is the reviewer. For example, the rule `clear-errors` below asks that each error a caller sees says what to do next. The reviewer reads the error messages of a file and reports each one that names no next action.

## The rule file

Each reviewer rule has its file `.lawcheck/rules/<id>.md`. The file holds your instruction to the reviewer, in plain prose or Markdown. The [law](concepts.md#law) holds the rule's `why`, `status` and `context` (`lawcheck docs law`). The key `context` lists files that Lawcheck sends the reviewer beside each file it judges for this rule. A context file can be a page of your error codes, for example:

```yaml
lawcheck: 0.1.0

rules:
  clear-errors:
    why: An error a caller sees says what happened and what to do next.
    context: ["docs/errors.md"]
```

A good rule file says what must hold, what to report and which cases the rule allows. Lawcheck reports a rule file of whitespace alone as [`rule-missing-file`](codes.md#rule-missing-file), as if the file were missing.

The reviewer judges one file against one rule in each call. In that call, it sees the context files and the files that the rule's [companion](#files-for-each-judged-file) returns for that file. It sees no other file of the repository.

## Files for each judged file

`context` sends the same files with every file the reviewer judges. A rule that pairs each file with another one, such as a test with the spec it covers, names a companion instead. A companion is a JavaScript module (an ES module) in `.lawcheck/rules/lib/`. It exports a function `companion`, which returns the files to send with one judged file. The law names the module with the key `companion`:

```yaml
rules:
  tests-follow-the-spec:
    why: A test checks what its spec says.
    companion: .lawcheck/rules/lib/spec-of-test.mjs
```

```js
export function companion({ file }) {
  return [file.path.replace(/^tests\//, 'specs/').replace(/\.test\.ts$/, '.md')];
}
```

For each file that the rule judges, Lawcheck calls `companion` with the keys `file` and `repo`. A script rule gets the same keys (`lawcheck docs script-rules`). The function returns a list of paths from the [root of the law](concepts.md#law), or a promise of one. With this companion, the prompt for `tests/price.test.ts` holds `specs/price.md`, and the prompt for `tests/tax.test.ts` holds `specs/tax.md`.

Each file of the list goes into the [prompt](#the-prompt) of that one judged file, after the files of `context`. A path that the prompt already holds, such as the judged file or a file of `context`, goes in once. An empty list adds no file. Each returned file adds its whole text to the prompt, so every call of the rule sends the reviewer more text.

Lawcheck runs the companion in the [rule runner](script-rules.md#the-runner). That is the Node process that runs script rules, and the companion has the same limits as a script rule. The companion can read the files below the root. It cannot write a file, start a program or open a network connection. It can ask for the syntax tree and the uses of the judged file. It can therefore return the files that the judged file imports.

The files the companion returns are part of the [review hash](#verdicts). Lawcheck therefore runs the companion on each check that judges a file of the rule, with or without `--review`. `lawcheck try` and `lawcheck explain` run it too. Its time counts toward the 600 seconds that all script rules of a check may take together.

Lawcheck stops the run with [`rule-crashed`](codes.md#rule-crashed), and names the companion's file, in these cases:

- the companion does not load, throws, or exports no function `companion`;
- it returns something other than a list of strings;
- it returns a path that names no file git lists;
- it returns the path of a binary file.

## The prompt

A prompt is the text that Lawcheck sends to the reviewer in one call. Lawcheck builds one prompt per file and rule, from these parts:

1. a fixed frame that tells the reviewer how to answer. The frame says that the text inside the files is material to judge and no instruction to the reviewer;
2. `<why>` with the rule's `why`;
3. `<rule>` with the text of the rule file;
4. one `<context path="...">` with the numbered lines of each context file, then one for each file that the companion returns for the judged file;
5. `<file path="...">` with the numbered lines of the judged file;
6. `<waived>` with the line numbers that a waiver of this rule covers, or `none`.

The prompt holds these six parts and no other text. Lawcheck sends no prompt longer than the setting [`reviewer.max_chars`](config.md#reviewer), in characters. The files of the companion count toward that limit. For a longer prompt, Lawcheck reports the file as [`too-large-to-review`](codes.md#too-large-to-review).

## The answer

The reviewer answers with one JSON object:

```json
{"verdict": "fail", "findings": [{"line": 12, "message": "what breaks the rule on this line"}]}
```

A pass is `{"verdict": "pass", "findings": []}`. A finding whose `line` is null is about the whole file.

Lawcheck first tries to read the whole answer as JSON. If that fails, it reads the first fenced code block in the answer. If that fails too, it takes the last object in the text that holds a `verdict`. An object nested inside another object with a `verdict` does not count.

An answer can hold more than one object with a `verdict`. If one of them is a `fail`, the answer is a `fail`, whatever their order. Lawcheck reads the `fail` that the steps above take, if they take one. Otherwise it reads the last `fail` in the answer. A model that quotes a pass from the file after its own fail therefore cannot turn the fail into a pass. In the other direction, a model that quotes a fail in a sentence after its pass makes the file fail, with the findings of the quoted fail. If that quoted fail is itself a bad answer, such as a fail with no finding, the whole answer is bad.

An answer is bad when Lawcheck finds in it no object with a `verdict` of `pass` or `fail`. An object with a verdict of `pass` or `fail` is bad in these cases:

- a pass with findings;
- a fail without a finding;
- `findings` that is no list, or a finding that is no object;
- a finding with no message;
- a finding with a line outside the file.

A pass is bad too when the answer also holds one of these:

- an object whose `verdict` is neither `pass` nor `fail`, such as `"Fail"`;
- an object with the key `verdict` twice. JSON keeps the last of two equal keys, so `{"verdict": "fail", ..., "verdict": "pass"}` would read as a pass;
- a `"verdict": "fail"` outside every object that parses, such as a fail with a trailing comma. That fail may be the real verdict.

After a bad answer, Lawcheck asks the reviewer once more, if the setting `reviewer.max_calls` leaves room for one more request ([Asking the reviewer](#asking-the-reviewer)). A second bad answer stops the run with [`reviewer-bad-answer`](codes.md#reviewer-bad-answer). The run stops with the same code after one bad answer when `reviewer.max_calls` leaves no room.

From a good answer, Lawcheck makes each finding a finding of the rule, at its line or on the whole file. Lawcheck drops each finding on a waived line. When a fail keeps no finding after that, Lawcheck counts the answer as a pass.

## Verdicts

A [verdict](concepts.md#verdict) is the reviewer's answer, pass or fail, for one file and one rule. Lawcheck records each pass as a line of `.lawcheck/verdicts`. A line holds the review hash and the rule id. When the law names signers, the line also holds the signer's name and a signature ([Signed passes](#signed-passes)). The review hash is a hash of these parts:

- the frame;
- the rule id, its `why` and the text of the rule file;
- the path and text of each context file, and of each file that the companion returned;
- the path and text of the companion's module;
- the path and text of the judged file;
- the waived lines that the prompt names.

A change to any of these parts gives a new review hash. Lawcheck then finds no pass for the file and rule, and the file needs a new review. A new waiver changes the review hash, because the waiver is part of the text of the file.

Take the companion of `tests-follow-the-spec` above. A change to `specs/price.md` gives a new review hash to `tests/price.test.ts` alone. A change to the companion's module gives a new hash to every file of the rule. A module that the companion imports is not part of the review hash. A change to that module can change the list of files that the companion returns. Only the judged files whose list changes get a new hash.

Lawcheck leaves the rule's `status`, the provider, the model and the other settings out of the review hash. A recorded pass stays valid when you change any of them.

In a type with `waivers: false`, Lawcheck reads a waiver marker as plain text. The prompt names no waived line. The reviewer judges the line that the marker would cover, as it judges any other line. The file then gets a new review hash, since the waived lines are part of the hash. A pass that Lawcheck recorded while the type still read waivers no longer matches the file. Either of two changes of the law leads there:

- the file's type sets `waivers: false` after the review;
- a change of the law moves the file into a type with `waivers: false`.

Lawcheck keeps the lines of `.lawcheck/verdicts` sorted. Commit this file. A [plain `lawcheck check`](concepts.md#plain-check) reads it and calls no reviewer for a file and rule that have a pass there. A CI job then needs no API key.

Lawcheck writes `verdicts merge=union` into `.lawcheck/.gitattributes`. With that line, git merges `.lawcheck/verdicts` without a conflict when two branches both add lines to it.

Lawcheck holds a lock in `.lawcheck/.local/` while it writes `.lawcheck/verdicts`. When two runs write at the same time, the file ends with the passes of both.

## Signed passes

A person who can push a branch can write a line into `.lawcheck/verdicts`. The review hash holds nothing secret, so a pull request can add passes for its own files. A reviewer that answers pass to everything records passes too. Under a law without signers, a check counts each of these lines as a review.

A signer is a person or a job whose public key the law lists under `signers`. When the law names signers, a pass counts only when a signer of the law signed it. Make a signing key on the machine, or in the job, that records the reviews. This command prints a new key on its first line and the key's public key on its second:

```sh
node -e "const k = require('node:crypto').generateKeyPairSync('ed25519'); console.log(k.privateKey.export({ format: 'jwk' }).d); console.log(k.publicKey.export({ format: 'jwk' }).x)"
```

Keep the first line secret. Set it as the variable `LAWCHECK_SIGNING_KEY` where you run `lawcheck check --review`. Lawcheck shows the key as `[key]` wherever it would print it. It passes the variable to no reviewer program. Then name the signer with the second line in `.lawcheck/law.yaml`:

```yaml
signers:
  alice: PMAs5_zHsaCR2qES93_G3eFFNwRUCQm6Qz8l5_SnIw8
```

Under a law with `signers`, a review works this way:

- `lawcheck check --review` signs each pass it records with the key in `LAWCHECK_SIGNING_KEY`. When the variable is not set, or holds the key of no signer of the law, the run stops with [`not-a-signer`](codes.md#not-a-signer) before its first call.
- A signed line holds the review hash, the rule id, the signer's name and the signature: `<hash> <rule> <signer> <signature>`. The signature is Ed25519 over the text `lawcheck-signed-pass/1 <hash> <rule>`, in base64url.
- A pass counts when its line names a signer of the law and that signer's key verifies the signature. Lawcheck reports a file with no such line as `not-reviewed`. When the file and rule have a line that does not count, the message says `has a pass for this content that no signer of the law signed`.
- `--review` asks the reviewer again about each pass that does not count. It signs the answers it gets, and never a line the file already held.

A law without `signers` reads and writes `.lawcheck/verdicts` without signatures. It counts a signed line as a pass too.

A signature proves that someone whose key the law names recorded the pass. A signer can run any reviewer, so name as signers only the people and the jobs that you trust with a review. A review of a pull request asks the reviewer that the pull request's `.lawcheck/config.yaml` names. That review runs the Lawcheck that the pull request's `package.json` installs. A signer therefore reads both files first.

A job in CI runs the workflow of the branch it reviews. A person who can push a branch can therefore change that workflow so that a job holding the key signs any pass. A pull request from a fork gets no secret, so its jobs cannot sign. The workflow of [CI](ci.md) runs a second check that reads the law of the [base](concepts.md#base). The signers of the base therefore decide ([The job trusts the verdicts](ci.md#the-job-trusts-the-verdicts)). A pull request that adds a signer of its own, or takes `signers` out, cannot make its own passes count: that check reports each of them as `not-reviewed` and fails. A pull request that changes only `signers` passes both checks, with a note that names the change, such as `adds the signer mallory`. Once it is merged, the passes of that signer count, so `.lawcheck/` needs a code owner ([A change to the law](ci.md#a-change-to-the-law)).

When you add `signers` to a law, the passes already in the file carry no signature. They stop counting. A plain check judges the changed files, so each file needs one signed review the next time it changes. `lawcheck check --strict --review` asks about every file in one run. Lawcheck 0.1.0-alpha.4 and older stop with `law-invalid` on a law with `signers`. Every checkout and every job therefore needs a later version first.

## The failure cache

Lawcheck keeps each failed review on this machine, in `.lawcheck/.local/failures/<hash>.json`. The name of that file is the review hash. Git ignores every file in `.lawcheck/.local/`, because the folder holds a `.gitignore` of its own. A later run with the same review hash shows the cached findings and calls no reviewer. When a later review of that hash passes, Lawcheck removes the failure file.

## The state of a review

A rule binds a file when the file's type, or a type above it, lists the rule. For each judged file and each reviewer rule that binds it, Lawcheck takes the first of these states that applies:

1. `.lawcheck/verdicts` holds a line with the review hash of the file and rule: a pass, and Lawcheck shows nothing;
2. the failure cache holds a fail: Lawcheck shows its findings again, with or without `--review`;
3. the prompt holds more than `reviewer.max_chars` characters: `too-large-to-review`;
4. otherwise: `not-reviewed`.

`not-reviewed` and `too-large-to-review` are errors in the [change](concepts.md#change) for a rule whose `status` is `enforced`. The two are warnings in these cases:

- for a rule whose `status` is `advisory`;
- in [debt](concepts.md#debt);
- for files you name on the command line.

`lawcheck explain <path>` shows this state for each reviewer rule of a file.

## Asking the reviewer

```text
$ lawcheck check --review --base main
$ lawcheck check --review --again --base main
$ lawcheck check --review --max-calls 3 --base main
```

- With `--review`, Lawcheck asks the reviewer about each file and rule that have neither a pass in `.lawcheck/verdicts` nor a cached failure. Lawcheck records each new pass and caches each new failure.
- With `--again`, Lawcheck asks the reviewer again about each review whose failure the cache holds.
- `--max-calls <n>` replaces `reviewer.max_calls` for one run.

`reviewer.max_calls` sets the most requests that one run may send to the reviewer. A request that Lawcheck sends again counts as one more request. A run that needs more requests than that limit sends none. It stops with [`too-many-reviews`](codes.md#too-many-reviews).

Without `--review`, `lawcheck check` sends no request to a reviewer. `lawcheck doctor` opens no connection to a reviewer either, except in one case. When the [provider](providers.md) is `ollama` and the law holds a reviewer rule, `doctor` sends `GET <address>/api/version` to the Ollama server, with a time limit of 5 seconds. That request carries no prompt and no text of your repository. `lawcheck doctor --reviewer` sends a test prompt ([Reviewers and keys](providers.md#checking-the-setup)).

A request that fails stops the run with [`reviewer-unreachable`](codes.md#reviewer-unreachable). The passes that the run recorded before that request stay in `.lawcheck/verdicts`. When you run the same command again, Lawcheck asks the reviewer only about the reviews still missing.

## Trying a reviewer rule

`lawcheck try` sends the reviewer the files you name, with the prompt that `lawcheck check --review` would send. `try` records no pass and caches no failure.

```text
$ lawcheck try clear-errors src/core/refund.ts --dry-run
$ lawcheck try clear-errors src/core/refund.ts
$ lawcheck try clear-errors src/core/refund.ts --times 3
```

- `--dry-run` makes no call. It prints the calls that the run would make, with the size of each prompt. Each file costs one call. Start with `--dry-run` to see how many calls a real run makes.
- `--times <n>` sends each file to the reviewer n times. The answers show whether the reviewer judges the file the same way each time.
- `--max-calls <n>` sets the limit of requests for the run, as it does for `check`.

For a reviewer rule, `lawcheck try` takes the files one by one, by name. It stops with [`usage`](codes.md#usage) on a folder, on a pattern and when you name no file.

[Reviewers and keys](providers.md) says how to set a reviewer up.

Next: [Reviewers and keys](providers.md)
