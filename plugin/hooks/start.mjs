import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { late, NO_PATHS, noResult, notFound } from './messages.mjs';

const CONFIG_BYTES = 1024 * 1024;

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
  for (const raw of text.replace(/^\uFEFF/, '').split('\n')) {
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
    const path = join(root, '.lawcheck', 'config.yaml');
    const stat = statSync(path);
    // A config past the tool's limit of 1 MiB is refused by Lawcheck itself; the hook reads none of it.
    if (stat.isFile() && stat.size <= CONFIG_BYTES) value = runnerValue(readFileSync(path, 'utf8'));
  } catch {}
  if (!Object.hasOwn(RUNNERS, value)) return { bad: value };
  const runner = RUNNERS[value];
  return { name: value, words: runner.words, install: runner.install, cmd: runner.words.join(' ') };
}

export function points(text) {
  return [...text].length;
}

export const LINE_LIMIT = 2000;

export function cutLine(line) {
  if (line.length <= LINE_LIMIT) return line;
  let end = LINE_LIMIT - 40;
  const last = line.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return `${line.slice(0, end)}... (${line.length - end} more characters)`;
}

export function cutPoints(text, max) {
  return [...text].slice(0, max).join('');
}

// docs/plugin.md: each hook's timeout in hooks.json less 5 seconds. Only a test changes these values, from an entry of its own that sets them before it imports lawcheck-hook.mjs; no setting, variable or file a user controls reaches this object.
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
// cmd.exe accepts a PATH entry written in double quotes, and the quotes are not part of the folder.
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

/*
 * cmdArgument and the command line built for a .cmd or .bat program copy the escaping of cross-spawn 7.0.6
 * (lib/util/escape.js and lib/parse.js, https://github.com/moxystudio/node-cross-spawn): cmd.exe reads the line
 * once, and the %* of a package manager's .cmd file reads it again. cross-spawn's licence:
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
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
    if (result.error.code === 'ENOENT') return notRun(notFound(runner.words[0]));
    return notRun(firstLine(result.error.message));
  }
  if (result.timedOut) return { ...notRun(late(deadline.seconds)), late: true };
  const isCheck = args[0] === 'check';
  if (isCheck && result.code === 2) {
    const marked = output.filter((line) => line.includes('error['));
    if (marked.length > 0 && marked.every((line) => line.includes('error[usage]'))) return notRun(NO_PATHS);
  }
  const answered = isCheck
    ? [0, 1, 2].includes(result.code) && output.length > 0 && ANSWERS.some((start) => output[0].startsWith(start))
    : [0, 2].includes(result.code) && output.length > 0;
  if (answered) return { ran: true, code: result.code, output };
  const said = result.stderr.split('\n').map((line) => line.replace(/\r$/, '')).find((line) => line.trim() !== '');
  if (said !== undefined) return notRun(cutPoints(said, 200));
  return notRun(noResult(result.code ?? result.signal));
}

export function firstLine(text) {
  return String(text).split('\n')[0];
}

// The characters of promise I-out-1 of design/promises.md, written as the tool writes them, for text the hook echoes from input it does not own.
const FORBIDDEN = /[\x00-\x09\x0b-\x1f\x7f-\x9f\u2028\u2029]|(?![\u200c\u200d])\p{Cf}/gu;

export function plainText(text) {
  return text.replace(FORBIDDEN, (c) => {
    if (c === '\r') return '\\r';
    if (c === '\t') return '\\t';
    const code = c.charCodeAt(0);
    return code < 0x80 ? `\\x${code.toString(16).padStart(2, '0')}` : [...Array(c.length).keys()].map((i) => `\\u${c.charCodeAt(i).toString(16).padStart(4, '0')}`).join('');
  });
}
