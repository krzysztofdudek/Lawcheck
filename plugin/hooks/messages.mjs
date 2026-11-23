export const NO_LAW = 'The Lawcheck plugin is on, and this directory has no law (.lawcheck/law.yaml here or above).\nStart one with lawcheck init only when the user asks for it.';

// The line lawcheck prime prints when the law has a reviewer rule and .lawcheck/config.yaml sets no reviewer; an older Lawcheck prints none.
export const PRIME_NO_REVIEWER = '- not-reviewed: no reviewer is set in .lawcheck/config.yaml';

export function sentence(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function badRunner(value) {
  return `This repository has a Lawcheck law (.lawcheck/law.yaml), and .lawcheck/config.yaml sets runner to '${value}'. The runner takes global, npx, pnpm, yarn or bun, so the plugin did not start Lawcheck.\nRead .lawcheck/law.yaml for the law, and tell the user that the runner setting is wrong.`;
}

export function primeNotRun(cmd, reason, install) {
  return `This repository has a Lawcheck law (.lawcheck/law.yaml), and ${cmd} prime did not run: ${sentence(reason)}\nInstall it with ${install}, then start a new session. Until then, read .lawcheck/law.yaml for the law.`;
}

export function noReviewer(cmd) {
  return `Lawcheck: this repository has a reviewer rule, and .lawcheck/config.yaml sets no reviewer, so a plain ${cmd} check and CI fail on every file a reviewer rule judges. Setting reviewer.provider and reviewer.model there is the user's decision; lawcheck docs providers lists the choices.`;
}

export function editLate(command, seconds) {
  return `Lawcheck: ${command} did not finish within ${seconds} seconds, so the hook stopped it.`;
}

export function editBreaks(rel, command) {
  return `Lawcheck: after this edit, ${rel} breaks the law of this repository. ${command} printed:`;
}

export function editError(command) {
  return `Lawcheck: after this edit, ${command} could not check the file. It printed:`;
}

export function waitsForTask(id, type) {
  return `Lawcheck: the check at the end of the turn waits for the background task ${id} (${type}), which may still be writing files. It runs the first time the agent finishes after that task ends.`;
}

export function gitFailed(problem) {
  return `Lawcheck: the check at the end of the turn did not run: git could not list the files of this turn, because ${sentence(problem)}`;
}

export function tooManyFiles(count, most, cmd) {
  return `Lawcheck: ${count} files changed in this turn, and the check at the end of a turn takes at most ${most}, so it did not run. ${cmd} check shows the result.`;
}

export function checkNotRun(reason) {
  return `Lawcheck: the check at the end of the turn did not run: ${sentence(reason)}`;
}

export function stopBreaks(cmd) {
  return `Lawcheck: the files that changed in this turn break the law of this repository. Fix the code, then finish; if a fix needs the user's word, tell the user what blocks you and finish. ${cmd} check on those files printed:`;
}

export function stopLawError(cmd) {
  return `Lawcheck: the check at the end of the turn stopped with an error, and the turn changed files under .lawcheck/. Fix what the error names, then finish; if that needs the user's word, tell the user and finish. ${cmd} check on those files printed:`;
}

export function stopError(cmd) {
  return `Lawcheck: the check at the end of the turn stopped with an error, and the turn changed no file under .lawcheck/. ${cmd} check shows the error.`;
}

export function stillFails(cmd) {
  return `Lawcheck: the turn ended while the check of its files still fails. ${cmd} check shows why.`;
}

export function turnMessage(waivers, law) {
  const parts = [];
  if (waivers.count > 0) parts.push(`added ${waivers.count === 1 ? '1 waiver' : `${waivers.count} waivers`} (${waivers.named})`);
  if (law !== null) parts.push(`changed ${law}`);
  if (parts.length === 0) return null;
  return `Lawcheck: in this turn the agent ${parts.join(' and ')}. Read them before you accept the turn.`;
}

export function moreLines(count) {
  return `... ${count} more ${count === 1 ? 'line' : 'lines'} not shown; run the command yourself to see them all`;
}

export function notFound(program) {
  return `${program} was not found`;
}

export const NO_PATHS = 'this Lawcheck does not take check <paths>; update it';

export function late(seconds) {
  return `it did not finish within ${seconds} seconds`;
}

export function noResult(ended) {
  return `it exited with ${ended} and printed no Lawcheck result`;
}

export function unknownEvent(event) {
  return `unknown event '${event}'; the events are session-start, prompt, edit, stop`;
}

export function notJson(problem) {
  return `the input is no JSON: ${problem}`;
}

export const NOT_OBJECT = 'the input is no JSON object';

export function hookFailed(text) {
  return `Lawcheck plugin: ${text}\n`;
}
