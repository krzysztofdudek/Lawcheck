import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fit } from './fit.mjs';
import { HOSTS, startDir } from './hosts.mjs';
import { nameOf } from './names.mjs';
import { changedInTurn, isRegular, snapshot } from './snapshot.mjs';
import { blank, readState, removeOld, stateFile, writeState } from './state.mjs';
import { marksAtStart, turnChanges, turnMessage } from './turn.mjs';
import * as say from './messages.mjs';
import { absolutePath, cutPoints, Deadline, DEADLINES, findRoot, firstLine, killCurrent, NO_CURRENT_FOLDER, plainText, runLawcheck, runnerAt } from './start.mjs';

absolutePath(process.env);
if (process.platform === 'win32') process.env[NO_CURRENT_FOLDER] = '1';

const MOST_FILES = 1000;
const WRITERS = ['subagent', 'teammate', 'workflow'];

function readInput() {
  return new Promise((done, fail) => {
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', fail);
  });
}

let host = HOSTS['claude-code'];

function switchOn(name) {
  const value = process.env[host.switches[name]];
  if (value === undefined) return true;
  return !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
}

function hash(lines) {
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

function context(event, text) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

function promptOf(input) {
  return host.promptId(input);
}

function samePrompt(a, b) {
  return a === null || b === null || a === undefined || a === b;
}

async function sessionStart(input, deadline) {
  removeOld();
  const root = findRoot(startDir(input));
  const done = (text) => context('SessionStart', text);
  if (root === null) return done(say.noLaw(host.setup));
  const runner = runnerAt(root);
  if ('bad' in runner) return done(say.badRunner(cutPoints(runner.bad, 40)));
  const result = await runLawcheck(runner, ['prime'], root, deadline);
  if (!result.ran) return done(say.primeNotRun(runner.cmd, result.reason, runner.install));
  const primed = done(fit(null, result.output));
  if (!result.output.some((line) => line.startsWith(say.PRIME_NO_REVIEWER))) return primed;
  const file = stateFile(input.session_id);
  const state = readState(file) ?? blank(root, null);
  if (state.reviewer_told === true) return primed;
  try {
    writeState(file, { ...state, reviewer_told: true });
  } catch {}
  return { ...primed, systemMessage: say.noReviewer(runner.cmd) };
}

async function prompt(input, deadline) {
  if (!switchOn('check_before_stop')) return null;
  const root = findRoot(startDir(input));
  if (root === null) return null;
  const file = stateFile(input.session_id);
  if (file === null) return null;
  const old = readState(file);
  const state = { ...blank(root, promptOf(input)), told: old?.told === true, reviewer_told: old?.reviewer_told === true };
  if (old !== null && old.root === root && old.open === true) {
    state.open = true;
    state.started = old.started;
    state.head = old.head;
    state.files = old.files;
    state.marks = old.marks;
    if (samePrompt(old.prompt_id, promptOf(input))) {
      state.prompt_id = promptOf(input) ?? old.prompt_id;
      state.blocks = old.blocks;
      state.last = old.last;
    }
  } else {
    const shot = snapshot(root, deadline);
    if ('problem' in shot) {
      writeState(file, state);
      return null;
    }
    state.open = true;
    state.started = Math.floor(Date.now() / 1000);
    state.head = shot.head;
    state.files = shot.files;
    state.marks = marksAtStart(root, shot.files);
  }
  writeState(file, state);
  return null;
}

function onDisk(path) {
  try {
    if (!statSync(path).isFile()) return null;
    return join(realpathSync(dirname(path)), basename(path));
  } catch {
    return null;
  }
}

async function edit(input, deadline) {
  if (!switchOn('check_after_edit')) return null;
  const paths = host.editedFiles(input).map(onDisk).filter((path) => path !== null);
  if (paths.length === 0) return null;
  const root = findRoot(dirname(paths[0]));
  if (root === null) return null;
  const runner = runnerAt(root);
  if ('bad' in runner) return null;
  const rels = paths.filter((path) => findRoot(dirname(path)) === root).map((path) => (sep === '\\' ? relative(root, path).split('\\').join('/') : nameOf(Buffer.from(relative(root, path)))));
  const named = rels.map((rel) => `./${rel}`);
  const command = `${runner.cmd} check ${named.join(' ')}`;
  const result = await runLawcheck(runner, ['check', ...named], root, deadline);
  const done = (text) => context('PostToolUse', text);
  if (!result.ran) {
    if (result.late === true) return done(say.editLate(command, deadline.seconds));
    return null;
  }
  const file = stateFile(input.session_id);
  const saved = readState(file);
  const errors = saved !== null && saved.last_error !== null && typeof saved.last_error === 'object' && !Array.isArray(saved.last_error) ? saved.last_error : {};
  if (result.code !== 2) {
    if (Object.hasOwn(errors, root)) {
      const rest = { ...errors };
      delete rest[root];
      writeState(file, { ...saved, last_error: rest });
    }
    return result.code === 1 ? done(fit(say.editBreaks(rels, command), result.output)) : null;
  }
  if (file !== null) {
    const state = saved ?? blank(root, promptOf(input));
    const h = hash(result.output);
    if (errors[root] === h) return null;
    writeState(file, { ...state, last_error: { ...errors, [root]: h } });
  }
  return done(fit(say.editError(command), result.output));
}

function joined(output, text) {
  if (text === null) return output;
  return { systemMessage: output === null ? text : `${output.systemMessage}\n${text}` };
}

function notice(file, root, input, text) {
  if (file === null) return { systemMessage: text };
  const state = readState(file) ?? blank(root, promptOf(input));
  if (state.told === true) return null;
  writeState(file, { ...state, told: true });
  return { systemMessage: text };
}

function lawDeleted(input) {
  const file = stateFile(input.session_id);
  const saved = readState(file);
  if (saved === null || saved.open !== true || typeof saved.root !== 'string') return null;
  let here;
  try {
    here = realpathSync(startDir(input));
  } catch {
    return null;
  }
  if (here !== saved.root && !here.startsWith(saved.root.endsWith(sep) ? saved.root : saved.root + sep)) return null;
  writeState(file, { ...saved, open: false });
  return { systemMessage: turnMessage({ waivers: [], law: [], gone: ['.lawcheck/law.yaml'] }) };
}

async function stop(input, deadline) {
  if (!switchOn('check_before_stop')) return null;
  const root = findRoot(startDir(input));
  if (root === null) return lawDeleted(input);
  const runner = runnerAt(root);
  if ('bad' in runner) return null;
  const writing = (Array.isArray(input.background_tasks) ? input.background_tasks : []).find((task) => task?.status === 'running' && WRITERS.includes(task?.type));
  if (writing !== undefined) {
    return { systemMessage: say.waitsForTask(writing.id, writing.type) };
  }

  const file = stateFile(input.session_id);
  const saved = readState(file);
  const state = saved !== null && saved.root === root && saved.open === true ? saved : null;
  const matches = state !== null && samePrompt(state.prompt_id, promptOf(input));
  let blocks = matches ? state.blocks : 0;
  let last = matches ? state.last : null;
  const finish = (output) => {
    if (state !== null) writeState(file, { ...state, prompt_id: promptOf(input) ?? state.prompt_id, open: false, blocks, last });
    return output;
  };

  const now = snapshot(root, deadline);
  const changed = 'problem' in now ? now : changedInTurn(root, state === null ? null : { head: state.head, files: state.files }, now, state?.started ?? 0, deadline);
  if ('problem' in changed) {
    finish(null);
    return notice(file, root, input, say.gitFailed(changed.problem));
  }
  const paths = changed.filter((path) => isRegular(root, path));
  const withTurn = (output) => joined(output, state === null ? null : turnMessage(turnChanges(root, state, changed, deadline)));
  if (paths.length === 0) return finish(withTurn(null));
  if (paths.length > MOST_FILES) {
    return finish(withTurn({ systemMessage: say.tooManyFiles(paths.length, MOST_FILES, runner.cmd) }));
  }
  const result = await runLawcheck(runner, ['check', ...paths.map((path) => `./${path}`)], root, deadline);
  if (!result.ran) {
    finish(null);
    return withTurn(notice(file, root, input, say.checkNotRun(result.reason)));
  }
  if (result.code === 0) return finish(withTurn(null));
  let header;
  if (result.code === 1) {
    header = say.stopBreaks(runner.cmd);
  } else if (changed.some((path) => path.startsWith('.lawcheck/'))) {
    header = say.stopLawError(runner.cmd);
  } else {
    finish(null);
    return withTurn(notice(file, root, input, say.stopError(runner.cmd)));
  }
  const handBack = host.handBack(fit(header, result.output));
  const h = hash(result.output);
  if (state === null) return input.stop_hook_active === true ? null : handBack;
  if (h === last || blocks >= 3) {
    return finish(withTurn({ systemMessage: say.stillFails(runner.cmd) }));
  }
  blocks += 1;
  last = h;
  writeState(file, { ...state, prompt_id: promptOf(input) ?? state.prompt_id, open: true, blocks, last });
  return handBack;
}

const EVENTS = { 'session-start': sessionStart, prompt, edit, stop };

async function main() {
  const [event, flag, name, ...rest] = process.argv.slice(2);
  const hostKnown = flag === undefined || (flag === '--host' && name !== undefined && Object.hasOwn(HOSTS, name) && rest.length === 0);
  if (flag !== undefined && hostKnown) host = HOSTS[name];
  const handler = Object.hasOwn(EVENTS, event ?? '') ? EVENTS[event] : null;
  const deadline = handler === null ? null : new Deadline(DEADLINES[event]);
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(signal, () => {
      killCurrent();
      process.exit(0);
    });
  }
  const text = await readInput();
  if (handler === null) throw new Error(say.unknownEvent(event ?? ''));
  if (!hostKnown) throw new Error(say.unknownHost(process.argv.slice(3).join(' ')));
  let input;
  try {
    input = JSON.parse(text);
  } catch (error) {
    throw new Error(say.notJson(firstLine(error.message)));
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error(say.NOT_OBJECT);
  const output = await handler(input, deadline);
  if (output !== null) await new Promise((done) => process.stdout.write(JSON.stringify(output) + '\n', done));
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(say.hookFailed(plainText(firstLine(error?.message ?? error))), () => process.exit(1));
  },
);
