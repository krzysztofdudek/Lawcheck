import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { join, normalize, posix, win32 } from 'node:path';

export type Env = Record<string, string | undefined>;

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

export function variableOf(env: Env, name: string, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== 'win32') return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

// An absolute PATH entry, with the surrounding double quotes cmd.exe allows removed; a relative or empty entry is not one.
export function absoluteEntry(dir: string, windows: boolean): string | null {
  const bare = windows && dir.length >= 2 && dir.startsWith('"') && dir.endsWith('"') ? dir.slice(1, -1) : dir;
  return bare !== '' && (windows ? win32 : posix).isAbsolute(bare) ? bare : null;
}

export function findProgram(name: string, env: Env, platform: NodeJS.Platform = process.platform): string | null {
  const windows = platform === 'win32';
  // On Windows a package manager installs a program as name.cmd beside a POSIX script called name, which Windows cannot start.
  const endings = windows ? (variableOf(env, 'PATHEXT', platform) ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ending) => ending !== '') : [''];
  for (const dir of (variableOf(env, 'PATH', platform) ?? '').split(windows ? ';' : ':')) {
    // A relative or empty entry names the folder the program starts in, which is the repository.
    const base = absoluteEntry(dir, windows);
    if (base === null) continue;
    for (const ending of endings) {
      const candidate = join(base, name + ending.toLowerCase());
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
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
export function cmdArgument(arg: string): string {
  let quoted = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  quoted = quoted.replace(/(?=(\\+?)?)\1$/, '$1$1');
  return `"${quoted}"`.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

export function cmdLine(program: string, args: string[]): string {
  return `"${[normalize(program).replace(CMD_META, '^$1'), ...args.map(cmdArgument)].join(' ')}"`;
}

function systemProgram(name: string): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name);
}

// Every program Lawcheck starts inherits PATH without its relative and empty entries, which name the folder the program starts in: the repository.
export function absolutePath(env: Env, platform: NodeJS.Platform = process.platform): void {
  const windows = platform === 'win32';
  const separator = windows ? ';' : ':';
  for (const name of Object.keys(env)) {
    if (name !== 'PATH' && !(windows && name.toUpperCase() === 'PATH')) continue;
    env[name] = (env[name] ?? '').split(separator).filter((dir) => absoluteEntry(dir, windows) !== null).join(separator);
  }
}

// cmd.exe looks for a program in its current folder before PATH unless this variable is set (Microsoft's NeedCurrentDirectoryForExePathW).
export const NO_CURRENT_FOLDER = 'NoDefaultCurrentDirectoryInExePath';

export function startProgram(program: string, args: string[], options: SpawnOptions): ChildProcess {
  if (process.platform !== 'win32') return spawn(program, args, options);
  // A detached process on Windows has no console, and the programs it starts get a console of their own instead of its pipes; killTree ends the tree without a group.
  const windows = { ...options, env: { ...(options.env ?? process.env), [NO_CURRENT_FOLDER]: '1' }, detached: false, windowsHide: true };
  if (!/\.(cmd|bat)$/i.test(program)) return spawn(program, args, windows);
  const shell = variableOf(options.env ?? process.env, 'COMSPEC') ?? systemProgram('cmd.exe');
  return spawn(shell, ['/d', '/s', '/c', cmdLine(program, args)], { ...windows, windowsVerbatimArguments: true });
}

export const PROCESS_TABLE = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CreationDate.Ticks)" }';

export function powershell(): string {
  return systemProgram('WindowsPowerShell\\v1.0\\powershell.exe');
}

export function createdIn(table: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of table.split(/\r?\n/)) {
    const [pid, , created] = line.trim().split(' ');
    if (pid !== undefined && /^\d+$/.test(pid) && created !== undefined && created !== '') out.set(Number(pid), created);
  }
  return out;
}

// Windows gives an ended process's id to a new one soon, so of the groups' trees in an earlier list only the processes that a later list shows with the same id and the same time of making may be killed.
export function stillListed(before: string, after: string, roots: number[], floor?: string): number[] {
  const known = createdIn(before);
  const now = createdIn(after);
  const listed = [...new Set(roots.flatMap((pid) => [pid, ...madeBelow(before, pid, known.get(pid) ?? floor)]))];
  return listed.filter((pid) => known.has(pid) && now.get(pid) === known.get(pid));
}

// A process keeps the id of a parent that has ended, and Windows gives that id to a new one, so below a process only what was made after it is its own.
function madeBelow(table: string, root: number, rootMade: string | undefined): number[] {
  const made = createdIn(table);
  const children = childrenIn(table);
  const found: number[] = [];
  const queue: [number, string | undefined][] = [[root, rootMade]];
  const seen = new Set([root]);
  while (queue.length > 0) {
    const [pid, parentMade] = queue.shift()!;
    for (const child of children.get(pid) ?? []) {
      const childMade = made.get(child);
      if (seen.has(child)) continue;
      if (parentMade !== undefined && childMade !== undefined && earlier(childMade, parentMade)) continue;
      seen.add(child);
      found.push(child);
      queue.push([child, childMade]);
    }
  }
  return found;
}

// What the guard ends of the groups' trees when the tool has ended: what both lists show made at the same time, and what the list made after the end shows below a root. On Windows a root ends with the tool, which holds it in its job, and what the root started lives on below its id. Windows gives an ended process's id to a new one, so below a process only what was made after it counts, and below a root whose id a later process holds only what was made before that one. floor is a time before every root was made: for a root the earlier list does not show, it stands in for the root's own time, and a process that holds the root's id then may be the root or a stranger, so nothing made after it is ended from the list.
export function toEnd(before: string, after: string, roots: number[], floor?: string): number[] {
  const known = createdIn(before);
  const now = createdIn(after);
  const children = childrenIn(after);
  const found = new Set(stillListed(before, after, roots, floor));
  for (const root of roots) {
    const queue: [number, string | undefined][] = [[root, known.get(root) ?? floor]];
    const seen = new Set([root]);
    while (queue.length > 0) {
      const [pid, made] = queue.shift()!;
      const holder = now.get(pid);
      for (const child of children.get(pid) ?? []) {
        const childMade = now.get(child);
        if (seen.has(child)) continue;
        if (made !== undefined && childMade !== undefined && earlier(childMade, made)) continue;
        if (holder !== undefined && holder !== made && childMade !== undefined && !earlier(childMade, holder)) continue;
        seen.add(child);
        found.add(child);
        queue.push([child, childMade]);
      }
    }
  }
  return [...found];
}

function earlier(a: string, b: string): boolean {
  return a.length !== b.length ? a.length < b.length : a < b;
}

function childrenIn(table: string): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const line of table.split(/\r?\n/)) {
    const [child, parent] = line.trim().split(' ').map(Number);
    if (!Number.isInteger(child) || !Number.isInteger(parent) || child === parent) continue;
    children.set(parent!, [...(children.get(parent!) ?? []), child!]);
  }
  return children;
}

export function descendantsIn(table: string, root: number): number[] {
  const children = childrenIn(table);
  const found: number[] = [];
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.shift()!) ?? []) {
      if (found.includes(child)) continue;
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

function descendants(root: number): number[] {
  const listed = spawnSync(powershell(), ['-NoProfile', '-NonInteractive', '-Command', PROCESS_TABLE], { encoding: 'utf8', windowsHide: true });
  return descendantsIn(listed.stdout ?? '', root);
}

// orphans: on Windows the root of a tree can end before its children, and taskkill /T cannot find a tree whose root is gone, so the children are found by their parent's pid.
export function killTree(pid: number, signal: NodeJS.Signals, orphans = false): boolean {
  if (process.platform === 'win32') {
    const ended = spawnSync(systemProgram('taskkill.exe'), ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).status === 0;
    if (ended || !orphans) return ended;
    const left = descendants(pid);
    for (const child of left) {
      try {
        process.kill(child, 'SIGKILL');
      } catch {
        // The process has already ended.
      }
    }
    return left.length > 0;
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}
