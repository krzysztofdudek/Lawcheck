# Who recorded a pass

Finding R-38: a line of `.lawcheck/verdicts` proves that someone wrote it, and nothing about who judged. A pull request can add pass lines for its own files. It can also record them with a reviewer that answers pass to everything. The CI job of [docs/ci.md](../docs/ci.md) counts both as reviews.

This note weighs three ways to record who judged, with what each costs a user, and recommends one. The decision "Signed passes" in [decisions.md](decisions.md) holds the choice.

## A pass today

A line holds a review hash and a rule id: `<32 hex digits> <rule id>`. The hash covers the frame, the rule, its context, the judged file and its waived lines. None of that is secret, so anyone with the repository can compute it. A plain check reads the line as a pass and asks no one.

Two ways past a reviewer rule follow from that:

- write the line by hand, or copy it from another branch;
- run `lawcheck check --review` with a reviewer of your own, such as `openai-compatible` pointed at a server that always answers pass.

The CI job reads the file of the pull request, so both pass there. `docs/ci.md` says so under "The job trusts the verdicts" and asks a code owner to read each change to the file. A code owner who reads a hash learns nothing from it.

The reviewer providers sign none of their answers, so no line a contributor writes can prove that a model judged. Two weaker proofs remain. A line can carry the signature of someone the team named, made with a key the contributor does not hold. Or the CI job can ask the model itself, with a key of its own.

## A. Signed passes, when the law names signers

The law gains the key `signers`, a map from a signer's name to an Ed25519 public key. When the law names signers, `check --review` signs each pass it records with the private key in `LAWCHECK_SIGNING_KEY`, and the line becomes `<hash> <rule> <signer> <signature>`. A pass then counts only when its line names a signer of the law and that signer's key verifies the signature. A law without `signers` reads and writes the file as alpha.4 does.

- Old verdict files: the upgrade leaves every file valid, byte for byte, since no law names signers yet. A team that adds `signers` stops counting its unsigned passes, as an edit of a rule's text stops counting that rule's passes. A plain check judges the changed files, so each file needs one signed review when it next changes. A team that runs `--strict` pays one review of every bound file at once.
- CI: no secret and no call. The workflow of `docs/ci.md` checks out the law of the base for its second check, so the signers of the base decide. A pull request that adds its own key, or removes `signers`, passes the first check and fails the second. A pull request from a fork gets its passes when a maintainer who is a signer runs `check --review` on it, as "A contributor with no reviewer" in `docs/ci.md` already says. That run signs the answers it got from the reviewer and never a line the fork wrote.
- Size: a signed line adds the signer's name and 86 characters of signature. Lawcheck's own lines average 52 bytes; signed by `alice` they would hold 145. The 16 MiB limit of the file then holds about 115,000 passes, against about 320,000 unsigned.
- What it proves: a person or a job whose key the law of the base names recorded the pass. A signer who runs a fake reviewer still gets its passes counted, so the law names only the people and jobs the team trusts with a review. The signature covers the review hash of 128 bits, so a forged pass needs two prompts with one hash, about 2^64 hashes of work.
- Versions: Lawcheck alpha.4 refuses a law with `signers` as `law-invalid`, so a team turns signing on once every checkout and job runs alpha.5.

A pull request that edits the workflow can still skip both checks. `docs/ci.md` covers that under "A change to the law", and signing changes none of it.

## B. The CI job asks the reviewer itself

A setting makes a check count only the passes in the file of the base. The CI job then runs `check --review` with a key, and the reviewer answers for every file of the change that a reviewer rule binds.

- Old verdict files: valid, since the format stays.
- CI: the job holds the reviewer's key as a secret. The reviewer's settings must come from the base too, because `.lawcheck/config.yaml` of the pull request can send the prompt to any server. Every run pays one call per changed file and reviewer rule, on every push. A pull request from a fork gets no secret on `pull_request`, so its reviews cannot run, and `pull_request_target` would run the fork's script rules with the secret.
- Size: unchanged.
- What it proves: the job asked the model that the base configures. Of the three options it proves the most, and it costs a key and calls in every job.

## C. Each pass names its reviewer

The line gains the provider and the model that answered: `<hash> <rule> claude-code/claude-sonnet-4-5`.

- Old verdict files: their lines name no reviewer and still count. Lawcheck alpha.4 skips a line with a third field, and drops it when it rewrites the file, so a team on both versions loses passes.
- CI: no change.
- Size: about 30 more bytes a line.
- What it proves: nothing against R-38, since anyone can type any name into the line.

## Recommendation

Option A. It closes R-38 for everyone the law does not name, it needs no secret in CI, and it works for a pull request from a fork. It changes nothing for a team that names no signers, so every verdict file stays valid. Option B proves more, and it needs a key and calls in every job and cannot judge a fork's pull request. Option C changes the format and proves nothing.

A team that trusts every author of its pull requests leaves `signers` out of its law and keeps the behaviour of alpha.4.
