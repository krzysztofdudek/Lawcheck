import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { join, normalize } from 'node:path';

export type Env = Record<string, string | undefined>;

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

export function variableOf(env: Env, name: string, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== 'win32') return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

export function findProgram(name: string, env: Env, platform: NodeJS.Platform = process.platform): string | null {
  const windows = platform === 'win32';
  // On Windows a package manager installs a program as name.cmd beside a POSIX script called name, which Windows cannot start.
  const endings = windows ? (variableOf(env, 'PATHEXT', platform) ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ending) => ending !== '') : [''];
  for (const dir of (variableOf(env, 'PATH', platform) ?? '').split(windows ? ';' : ':')) {
    if (dir === '') continue;
    for (const ending of endings) {
      const candidate = join(dir, name + ending.toLowerCase());
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

// The quoting of cross-spawn: cmd.exe reads the line once, and the %* of a package manager's .cmd file reads it again.
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

export function startProgram(program: string, args: string[], options: SpawnOptions): ChildProcess {
  if (process.platform !== 'win32') return spawn(program, args, options);
  // A detached process on Windows has no console, and the programs it starts get a console of their own instead of its pipes; killTree ends the tree without a group.
  const windows = { ...options, detached: false, windowsHide: true };
  if (!/\.(cmd|bat)$/i.test(program)) return spawn(program, args, windows);
  const shell = variableOf(options.env ?? process.env, 'COMSPEC') ?? systemProgram('cmd.exe');
  return spawn(shell, ['/d', '/s', '/c', cmdLine(program, args)], { ...windows, windowsVerbatimArguments: true });
}

function descendants(root: number): number[] {
  const listed = spawnSync(
    systemProgram('WindowsPowerShell\\v1.0\\powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'],
    { encoding: 'utf8', windowsHide: true },
  );
  const children = new Map<number, number[]>();
  for (const line of (listed.stdout ?? '').split(/\r?\n/)) {
    const [child, parent] = line.trim().split(' ').map(Number);
    if (!Number.isInteger(child) || !Number.isInteger(parent) || child === parent) continue;
    children.set(parent!, [...(children.get(parent!) ?? []), child!]);
  }
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
