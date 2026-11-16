import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';

export const RUNNERS = {
  global: { words: ['lawcheck'], install: 'npm i -g lawcheck@alpha' },
  npx: { words: ['npx', '--no-install', 'lawcheck'], install: 'npm install' },
  pnpm: { words: ['pnpm', 'exec', 'lawcheck'], install: 'pnpm install' },
  yarn: { words: ['yarn', 'run', 'lawcheck'], install: 'yarn install' },
  bun: { words: ['bun', 'x', '--no-install', 'lawcheck'], install: 'bun install' },
};

export function findRoot(start) {
  let dir = resolve(start);
  for (;;) {
    try {
      if (statSync(join(dir, '.lawcheck', 'law.yaml')).isFile()) return realpathSync(dir);
    } catch {}
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function runnerValue(text) {
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line.startsWith('runner:')) continue;
    const rest = line.slice('runner:'.length);
    const comment = rest.search(/[ \t]#/);
    return (comment < 0 ? rest : rest.slice(0, comment)).replace(/^[ \t]+|[ \t]+$/g, '');
  }
  return 'global';
}

export function runnerAt(root) {
  let value = 'global';
  try {
    value = runnerValue(readFileSync(join(root, '.lawcheck', 'config.yaml'), 'utf8'));
  } catch {}
  if (!Object.hasOwn(RUNNERS, value)) return { bad: value };
  const runner = RUNNERS[value];
  return { name: value, words: runner.words, install: runner.install, cmd: runner.words.join(' ') };
}

export function points(text) {
  return [...text].length;
}

export function cutPoints(text, max) {
  return [...text].slice(0, max).join('');
}

// spec/plugin-slice.md, section 4: each hook's timeout in hooks.json less 5 seconds. Only a test changes these values, from an entry of its own that sets them before it imports lawcheck-hook.mjs; no setting, variable or file a user controls reaches this object.
export const DEADLINES = { 'session-start': 25, prompt: 15, edit: 25, stop: 145 };

export class Deadline {
  constructor(seconds) {
    this.seconds = seconds;
    this.at = Date.now() + seconds * 1000;
  }

  left() {
    return Math.max(0, this.at - Date.now());
  }
}

let current = null;

export function killCurrent() {
  if (current !== null) killGroup(current, 'SIGKILL');
}

const WINDOWS = process.platform === 'win32';
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function variableOf(env, name) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function systemProgram(name) {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name);
}

// Every program the hooks start inherits PATH without its relative and empty entries, which name the folder the program starts in: the repository.
export function absolutePath(env) {
  for (const name of Object.keys(env)) {
    if (name !== 'PATH' && !(WINDOWS && name.toUpperCase() === 'PATH')) continue;
    env[name] = (env[name] ?? '').split(WINDOWS ? ';' : ':').filter((dir) => absoluteEntry(dir) !== null).join(WINDOWS ? ';' : ':');
  }
}

// cmd.exe looks for a program in its current folder before PATH unless this variable is set (Microsoft's NeedCurrentDirectoryForExePathW).
export const NO_CURRENT_FOLDER = 'NoDefaultCurrentDirectoryInExePath';

// On Windows a package manager installs a program as name.cmd beside a POSIX script called name, which Windows cannot start.
// An absolute PATH entry, with the surrounding double quotes cmd.exe allows removed; a relative or empty entry is not one.
export function absoluteEntry(dir) {
  const bare = WINDOWS && dir.length >= 2 && dir.startsWith('"') && dir.endsWith('"') ? dir.slice(1, -1) : dir;
  return bare !== '' && isAbsolute(bare) ? bare : null;
}

export function findProgram(name, env) {
  const endings = WINDOWS ? (variableOf(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ending) => ending !== '') : [''];
  for (const dir of (variableOf(env, 'PATH') ?? '').split(WINDOWS ? ';' : ':')) {
    // A relative or empty entry names the folder the program starts in, which is the repository.
    const base = absoluteEntry(dir);
    if (base === null) continue;
    for (const ending of endings) {
      const candidate = join(base, name + ending.toLowerCase());
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return null;
}

// The quoting of cross-spawn: cmd.exe reads the line once, and the %* of a package manager's .cmd file reads it again.
export function cmdArgument(arg) {
  let quoted = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  quoted = quoted.replace(/(?=(\\+?)?)\1$/, '$1$1');
  return `"${quoted}"`.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

function startWindows(words, options) {
  const program = findProgram(words[0], options.env);
  if (program === null) throw Object.assign(new Error(`spawn ${words[0]} ENOENT`), { code: 'ENOENT' });
  // A detached process on Windows has no console, and the programs it starts get a console of their own instead of its pipes; taskkill ends the tree without a group.
  const windows = { ...options, env: { ...options.env, [NO_CURRENT_FOLDER]: '1' }, detached: false, windowsHide: true };
  if (!/\.(cmd|bat)$/i.test(program)) return spawn(program, words.slice(1), windows);
  const line = [normalize(program).replace(CMD_META, '^$1'), ...words.slice(1).map(cmdArgument)].join(' ');
  const shell = variableOf(options.env, 'COMSPEC') ?? systemProgram('cmd.exe');
  return spawn(shell, ['/d', '/s', '/c', `"${line}"`], { ...windows, windowsVerbatimArguments: true });
}

function startPosix(words, options) {
  const program = findProgram(words[0], options.env);
  if (program === null) throw Object.assign(new Error(`spawn ${words[0]} ENOENT`), { code: 'ENOENT' });
  return spawn(program, words.slice(1), options);
}

function killGroup(pid, signal) {
  if (WINDOWS) {
    spawnSync(systemProgram('taskkill.exe'), ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {}
}

export function call(words, root, deadline) {
  return new Promise((done) => {
    const out = [];
    const err = [];
    let child;
    try {
      const options = { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true };
      child = WINDOWS ? startWindows(words, options) : startPosix(words, options);
    } catch (error) {
      done({ error, code: null, signal: null, stdout: '', stderr: '', timedOut: false });
      return;
    }
    const pid = child.pid;
    if (pid !== undefined) current = pid;
    let exited = null;
    let open = 2;
    let timedOut = false;
    let finished = false;
    const timers = [];
    const finish = (extra) => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      if (pid !== undefined) killGroup(pid, 'SIGKILL');
      if (current === pid) current = null;
      done({
        error: null,
        code: exited?.code ?? null,
        signal: exited?.signal ?? null,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        timedOut,
        ...extra,
      });
    };
    child.on('error', (error) => {
      if (pid === undefined || error.code === 'ENOENT') finish({ error });
    });
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    const closed = () => {
      open--;
      if (open === 0 && exited !== null) finish({});
    };
    child.stdout.on('close', closed);
    child.stderr.on('close', closed);
    child.on('exit', (code, signal) => {
      exited = { code, signal };
      if (open === 0) finish({});
      else timers.push(setTimeout(() => finish({}), 2000));
    });
    timers.push(
      setTimeout(() => {
        timedOut = true;
        if (pid !== undefined) killGroup(pid, 'SIGTERM');
        timers.push(
          setTimeout(() => {
            if (pid !== undefined) killGroup(pid, 'SIGKILL');
          }, 2000),
        );
      }, deadline.left()),
    );
  });
}

export function outputOf(stdout, runner) {
  const lines = stdout.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const at = lines.findIndex((line) => line.startsWith('lawcheck: ') || line.startsWith('Lawcheck '));
  if (at < 0) return [];
  const kept = lines.slice(at);
  if (runner === 'yarn' && kept.length > 1 && kept[kept.length - 1].startsWith('Done in ')) kept.pop();
  return kept;
}

const ANSWERS = ['lawcheck: PASS  ', 'lawcheck: FAIL  ', 'lawcheck: ERROR  '];

export async function runLawcheck(runner, args, root, deadline) {
  const result = await call([...runner.words, ...args], root, deadline);
  const output = outputOf(result.stdout, runner.name);
  const notRun = (reason) => ({ ran: false, reason, output });
  if (result.error !== null) {
    if (result.error.code === 'ENOENT') return notRun(`${runner.words[0]} was not found`);
    return notRun(firstLine(result.error.message));
  }
  if (result.timedOut) return { ...notRun(`it did not finish within ${deadline.seconds} seconds`), late: true };
  const isCheck = args[0] === 'check';
  if (isCheck && result.code === 2) {
    const marked = output.filter((line) => line.includes('error['));
    if (marked.length > 0 && marked.every((line) => line.includes('error[usage]'))) return notRun('this lawcheck does not take check <paths>; update it');
  }
  const answered = isCheck
    ? [0, 1, 2].includes(result.code) && output.length > 0 && ANSWERS.some((start) => output[0].startsWith(start))
    : [0, 2].includes(result.code) && output.length > 0;
  if (answered) return { ran: true, code: result.code, output };
  const said = result.stderr.split('\n').map((line) => line.replace(/\r$/, '')).find((line) => line.trim() !== '');
  if (said !== undefined) return notRun(cutPoints(said, 200));
  return notRun(`it exited with ${result.code ?? result.signal} and printed no Lawcheck result`);
}

export function firstLine(text) {
  return String(text).split('\n')[0];
}
