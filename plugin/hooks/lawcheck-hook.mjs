import { createHash } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fit } from './fit.mjs';
import { nameOf } from './names.mjs';
import { snapshot, turnPaths } from './snapshot.mjs';
import { blank, deleteState, readState, removeOld, stateFile, writeState } from './state.mjs';
import { absolutePath, cutPoints, Deadline, DEADLINES, findRoot, firstLine, killCurrent, NO_CURRENT_FOLDER, runLawcheck, runnerAt } from './start.mjs';

absolutePath(process.env);
if (process.platform === 'win32') process.env[NO_CURRENT_FOLDER] = '1';

const PATH_TOOLS = { Write: 'file_path', Edit: 'file_path', NotebookEdit: 'notebook_path' };
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

function switchOn(name) {
  const value = process.env[name];
  if (value === undefined) return true;
  return !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
}

function hash(lines) {
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

function context(event, text) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

function startDir(input) {
  return typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : process.cwd();
}

function promptOf(input) {
  return typeof input.prompt_id === 'string' ? input.prompt_id : null;
}

function samePrompt(a, b) {
  return a === null || b === null || a === undefined || a === b;
}

async function sessionStart(input, deadline) {
  removeOld();
  const root = findRoot(startDir(input));
  const done = (text) => context('SessionStart', text);
  if (root === null) {
    return done('The Lawcheck plugin is on, and this directory has no law (.lawcheck/law.yaml here or above).\nStart one with lawcheck init only when the user asks for it.');
  }
  const runner = runnerAt(root);
  if ('bad' in runner) {
    return done(
      `This repository has a Lawcheck law (.lawcheck/law.yaml), and .lawcheck/config.yaml sets runner to ${cutPoints(runner.bad, 40)}, which is none of global, npx, pnpm, yarn, bun, so Lawcheck was not started.\nRead .lawcheck/law.yaml for the law, and tell the user that the runner setting is wrong.`,
    );
  }
  const result = await runLawcheck(runner, ['prime'], root, deadline);
  if (result.ran) return done(fit(null, result.output));
  return done(
    `This repository has a Lawcheck law (.lawcheck/law.yaml), and ${runner.cmd} prime did not run: ${result.reason}.\nInstall it with ${runner.install}, then start a new session. Until then, read .lawcheck/law.yaml for the law.`,
  );
}

async function prompt(input, deadline) {
  if (!switchOn('CLAUDE_PLUGIN_OPTION_CHECK_BEFORE_STOP')) return null;
  const root = findRoot(startDir(input));
  if (root === null) return null;
  const file = stateFile(input.session_id);
  if (file === null) return null;
  const old = readState(file);
  const state = { ...blank(root, promptOf(input)), told: old?.told === true };
  if (old !== null && old.root === root && old.open === true) {
    state.open = true;
    state.started = old.started;
    state.head = old.head;
    state.files = old.files;
  } else {
    const shot = snapshot(root, deadline);
    if ('problem' in shot) {
      deleteState(file);
      return null;
    }
    state.open = true;
    state.started = Math.floor(Date.now() / 1000);
    state.head = shot.head;
    state.files = shot.files;
  }
  writeState(file, state);
  return null;
}

function editedPath(input) {
  const key = PATH_TOOLS[input.tool_name];
  if (key === undefined) return null;
  const value = input.tool_input?.[key];
  if (typeof value !== 'string' || value === '') return null;
  const path = isAbsolute(value) ? value : resolve(startDir(input), value);
  try {
    if (!statSync(path).isFile()) return null;
    return join(realpathSync(dirname(path)), basename(path));
  } catch {
    return null;
  }
}

async function edit(input, deadline) {
  if (!switchOn('CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT')) return null;
  const path = editedPath(input);
  if (path === null) return null;
  const root = findRoot(dirname(path));
  if (root === null) return null;
  const runner = runnerAt(root);
  if ('bad' in runner) return null;
  const rel = sep === '\\' ? relative(root, path).split('\\').join('/') : nameOf(Buffer.from(relative(root, path)));
  const command = `${runner.cmd} check ./${rel}`;
  const result = await runLawcheck(runner, ['check', `./${rel}`], root, deadline);
  const done = (text) => context('PostToolUse', text);
  if (!result.ran) {
    if (result.late === true) return done(`Lawcheck: ${command} did not finish within ${deadline.seconds} seconds and was stopped.`);
    return null;
  }
  if (result.code === 1) return done(fit(`Lawcheck: after this edit, ${rel} breaks the law of this repository. ${command} printed:`, result.output));
  if (result.code !== 2) return null;
  const file = stateFile(input.session_id);
  if (file !== null) {
    const state = readState(file) ?? blank(root, promptOf(input));
    const h = hash(result.output);
    if (state.last_error === h) return null;
    writeState(file, { ...state, last_error: h });
  }
  return done(fit(`Lawcheck could not check ${rel} after this edit. ${command} printed:`, result.output));
}

function notice(file, root, input, text) {
  if (file === null) return { systemMessage: text };
  const state = readState(file) ?? blank(root, promptOf(input));
  if (state.told === true) return null;
  writeState(file, { ...state, told: true });
  return { systemMessage: text };
}

async function stop(input, deadline) {
  if (!switchOn('CLAUDE_PLUGIN_OPTION_CHECK_BEFORE_STOP')) return null;
  const root = findRoot(startDir(input));
  if (root === null) return null;
  const runner = runnerAt(root);
  if ('bad' in runner) return null;
  const writing = (Array.isArray(input.background_tasks) ? input.background_tasks : []).find((task) => task?.status === 'running' && WRITERS.includes(task?.type));
  if (writing !== undefined) {
    return { systemMessage: `lawcheck: the check before the agent finished waits for the background task ${writing.id} (${writing.type}), which may still be writing files; it runs at the first stop after that task ends.` };
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
  const paths = 'problem' in now ? now : turnPaths(root, state === null ? null : { head: state.head, files: state.files }, now, state?.started ?? 0, deadline);
  if ('problem' in paths) {
    finish(null);
    return notice(file, root, input, `lawcheck: the check before the agent finished did not run: git could not list the files of this turn, because ${paths.problem}.`);
  }
  if (paths.length === 0) return finish(null);
  if (paths.length > MOST_FILES) {
    return finish({ systemMessage: `lawcheck: ${paths.length} files changed in this turn, more than the ${MOST_FILES} the check before finishing takes, so it did not run; ${runner.cmd} check shows the result.` });
  }
  const result = await runLawcheck(runner, ['check', ...paths.map((path) => `./${path}`)], root, deadline);
  if (!result.ran) {
    finish(null);
    return notice(file, root, input, `lawcheck: the check before the agent finished did not run: ${result.reason}.`);
  }
  if (result.code === 0) return finish(null);
  let header;
  if (result.code === 1) {
    header = `Lawcheck: the files that changed in this turn break the law of this repository. Fix the code, then finish; if a fix needs the user's word, tell the user what blocks you and finish. ${runner.cmd} check on those files printed:`;
  } else if (paths.some((path) => path.startsWith('.lawcheck/'))) {
    header = `Lawcheck could not check the files that changed in this turn, and the turn changed files under .lawcheck/. Fix what the error names, then finish; if that needs the user's word, tell the user and finish. ${runner.cmd} check on those files printed:`;
  } else {
    finish(null);
    return notice(file, root, input, `lawcheck: lawcheck check could not judge the files that changed in this turn; ${runner.cmd} check shows why.`);
  }
  const handBack = context('Stop', fit(header, result.output));
  const h = hash(result.output);
  if (state === null) return input.stop_hook_active === true ? null : handBack;
  if (h === last || blocks >= 3) {
    return finish({ systemMessage: `lawcheck: the turn ended while lawcheck check still fails on the files that changed in it; ${runner.cmd} check shows why.` });
  }
  blocks += 1;
  last = h;
  writeState(file, { ...state, prompt_id: promptOf(input) ?? state.prompt_id, open: true, blocks, last });
  return handBack;
}

const EVENTS = { 'session-start': sessionStart, prompt, edit, stop };

async function main() {
  const event = process.argv[2];
  const handler = Object.hasOwn(EVENTS, event ?? '') ? EVENTS[event] : null;
  const deadline = handler === null ? null : new Deadline(DEADLINES[event]);
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(signal, () => {
      killCurrent();
      process.exit(0);
    });
  }
  const text = await readInput();
  if (handler === null) throw new Error(`unknown event '${event ?? ''}'; the events are session-start, prompt, edit, stop`);
  let input;
  try {
    input = JSON.parse(text);
  } catch (error) {
    throw new Error(`the input is no JSON: ${firstLine(error.message)}`);
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('the input is no JSON object');
  const output = await handler(input, deadline);
  if (output !== null) await new Promise((done) => process.stdout.write(JSON.stringify(output) + '\n', done));
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`lawcheck plugin: ${firstLine(error?.message ?? error)}\n`, () => process.exit(1));
  },
);
