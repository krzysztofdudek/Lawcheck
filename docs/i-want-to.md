# I want to

Each line ends the sentence of the title. Its link opens the step where that path starts.

## Start

- [install Lawcheck on my machine](install.md#install-globally)
- [install Lawcheck in a project with npm, pnpm, Yarn or Bun](install.md#install-in-a-project)
- [start Lawcheck through the package manager of the project](install.md#the-runner-setting)
- [confirm that the setup works](install.md#check-the-install)
- [remove Lawcheck](install.md#remove-it)
- [see a first breach caught in my own repository](quick-start.md#_1-start-the-law)
- [fix the line a failing check names](quick-start.md#_5-check)
- [learn the words these pages use](concepts.md)
- [choose between Lawcheck and a tool I already use](other-tools.md)
- [read these pages in the terminal](commands.md#docs)

## Types

- [write the first type and the first script rule](first-law.md#_1-start-the-law)
- [try a rule on the files I name, even before a type lists it](first-law.md#_7-try-the-rule-on-one-file)
- [give every file of an existing project a type](types-for-a-project.md#_1-see-the-files-without-a-type)
- [describe a project with types inside types](types-for-a-project.md#_2-describe-the-folders-as-types)
- [find out why a file has its type](types-for-a-project.md#_4-see-why-a-file-has-its-type)
- [fix two types that claim one file](types-for-a-project.md#_7-run-a-check)
- [keep generated or vendored files out of the law](types-for-a-project.md#_10-leave-the-generated-file-out)
- [see the law of a file I have not written yet](types-for-a-project.md#_12-see-the-type-of-a-file-you-have-not-written-yet)
- [give the files of one folder two types by their text, such as tests beside the code](types-for-a-project.md#_14-give-the-tests-beside-the-code-a-type-by-their-text)
- [find out why a file has no type](commands.md#explain)

## Uses

- [stop one layer from using another](forbid-a-use.md#_1-give-core-a-may-use-list)
- [understand and fix a forbidden-use finding](forbid-a-use.md#_4-check-it)
- [understand an unresolved use](forbid-a-use.md#_8-check-it-with-the-new-import)
- [handle a file in a language Lawcheck does not read](forbid-a-use.md#_10-check-the-whole-folder)
- [guard the layers of a project in several languages](languages.md#the-languages-whose-uses-are-read)

## Script rules

- [write a script rule](write-a-script-rule.md#_1-add-the-rule-to-the-law)
- [share code between rules](write-a-script-rule.md#_2-write-a-helper-the-rules-share)
- [make a rule advisory](write-a-script-rule.md#_7-make-the-rule-advisory)
- [fix a rule that crashes or runs too long](write-a-script-rule.md#_9-put-a-typo-in-the-helper)
- [use a package in a script rule](script-rules.md#the-runner)

## Reviewer rules

- [write a rule in plain words that a model judges](write-a-reviewer-rule.md#_1-write-the-rule-file)
- [choose a reviewer and set its key](write-a-reviewer-rule.md#_3-choose-a-reviewer)
- [judge with a model on my own machine](write-a-reviewer-rule.md#_3-choose-a-reviewer)
- [judge with Claude Code, Codex, Gemini CLI or Copilot CLI and no API key](providers.md#the-programs)
- [see what a review will cost before it runs](write-a-reviewer-rule.md#_6-see-the-cost-of-a-try)
- [tune the wording of a rule on a few files](write-a-reviewer-rule.md#_7-try-the-rule-on-the-file)
- [check that a rule gets the same answer each time](write-a-reviewer-rule.md#_8-ask-the-same-question-twice)
- [ask the reviewer again after a failed review](write-a-reviewer-rule.md#if-it-goes-wrong)
- [handle a file too large to review, or a rule the model cannot judge](write-a-reviewer-rule.md#if-it-goes-wrong)
- [give the reviewer another file with each file it judges](law.md#context)
- [know whether the recorded passes hold after I change the model](reviewer-rules.md#verdicts)
- [fix a reviewer that cannot be reached](codes.md#reviewer-unreachable)

## A law for existing code

- [bring in a law without turning the build red](adopt-in-an-existing-repository.md#_1-start-the-law-on-a-branch)
- [decide whether a new rule starts enforced or advisory](adopt-in-an-existing-repository.md#start-the-rule-enforced-or-advisory)
- [start a new rule as advisory](adopt-in-an-existing-repository.md#_2-write-the-law-with-an-advisory-rule)
- [list the debt](adopt-in-an-existing-repository.md#_5-list-the-debt)
- [turn an advisory rule into an enforced one](adopt-in-an-existing-repository.md#_9-make-the-rule-enforced)

## Coding agents

- [use Lawcheck with Claude Code](claude-code.md#_1-install-lawcheck)
- [give the agent the law at the start of each session](claude-code.md#_3-start-a-session)
- [have each edit of the agent checked at once](claude-code.md#_4-see-the-check-after-an-edit)
- [send the agent back while the files of its turn break the law](claude-code.md#_5-see-the-check-before-the-agent-finishes)
- [switch off one of the plugin's checks](claude-code.md#_6-switch-off-one-of-the-checks)
- [use Lawcheck with Codex, Copilot CLI, Gemini CLI or another agent](other-agents.md#_1-add-one-line-to-the-instructions-file)
- [see what the agent leaves to my word](other-agents.md#_2-see-what-the-agent-reads)
- [see how the agent reads a failed check](other-agents.md#_3-see-a-failed-check-as-the-agent-does)

## CI and teams

- [add a CI job](ci.md#a-ci-job)
- [set the base in CI, for pull requests, pushes to main and the first push of a branch](ci.md#_2-add-the-workflow)
- [run the check on GitLab CI, Azure Pipelines or another service](ci.md#_5-give-the-base-on-another-ci-service)
- [fix a job whose clone is shallow](ci.md#if-it-goes-wrong)
- [run reviewer rules in CI without calling a model](ci.md#reviewer-rules-in-ci)
- [record reviews in CI with the key kept as a secret](providers.md#text-that-leaves-the-machine)
- [cap the reviewer calls of one run](slow-check.md#_5-bound-the-reviewer)
- [review a pull request that changes the law](ci.md#a-change-to-the-law)
- [add a git hook](ci.md#git-hooks)
- [decide where a check may run on a stranger's change](ci.md#where-a-check-may-run)
- [read the result as JSON, in a script or in annotations of a pull request](json.md#lawcheck-check-0)
- [share one law in a team](team.md#_1-give-everyone-one-reviewer)
- [merge two branches that both recorded reviews](team.md#_5-merge-two-branches-that-both-recorded-reviews)
- [resolve a conflict in the verdicts file](team.md#a-conflict-in-the-verdicts-file)
- [run the same check on Windows and macOS](support.md#node-git-and-the-systems)

## A monorepo

- [use Lawcheck in a monorepo](monorepo.md#_1-start-a-law-in-one-package)
- [run it from a folder inside a package](monorepo.md#_3-check-from-a-folder-inside-the-package)
- [understand the error at the top of the monorepo](monorepo.md#_4-run-it-from-the-top)
- [give each package its own runner or reviewer](monorepo.md#_5-give-a-package-its-own-runner)
- [leave a submodule or a nested repository to its own law](monorepo.md#_6-leave-a-nested-repository-to-its-own-law)

## Trouble

- [handle a finding I believe is wrong](false-alarm.md#_1-read-the-finding)
- [waive one line for one rule](false-alarm.md#_6-waive-the-one-line)
- [clean up waivers that waive nothing](false-alarm.md#_7-find-the-waivers-that-waive-nothing)
- [list every waiver and the change that added it](waivers.md#the-count-of-waivers)
- [forbid waivers in one kind of file](law.md#waivers)
- [see what changes when I take a rule off a type](change.md#the-limits-of-a-plain-check)
- [find out why a check is slow](slow-check.md#_1-see-what-the-run-judges)
- [check only some files while I work](slow-check.md#_2-check-one-file)
- [go on after `internal` or `memory-too-large`](slow-check.md#if-it-goes-wrong)
- [understand and fix a code I have not seen](codes.md)
- [find the line a law or settings error names](codes.md#law-invalid)
- [run Lawcheck where it refuses to start](support.md#the-environments-lawcheck-refuses)
- [see which part of my setup is broken](commands.md#doctor)
- [find a short answer to a common question](questions.md)

## Upgrade

- [upgrade to a new alpha](upgrade.md#_1-install-the-new-version)
- [understand why a law that passed now fails](upgrade.md#a-law-that-passed-now-fails)
- [see what each version changed](changelog.md)

Next: [The first type and the first rule](first-law.md)
