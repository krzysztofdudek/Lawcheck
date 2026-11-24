import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, rm, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createdIn, killTree, powershell, PROCESS_TABLE, ticksAt, toEnd, variableOf, withTemp } from './programs.js';

// The count of runners holding each id: two runners may get the same id one after the other, and the earlier one may be released after the later one started.
const runners = new Map<number, number>();
const windows = process.platform === 'win32';
// The longest the guard waits for a list of its own: a PowerShell that hangs would keep the guard, and the folders it is to remove, for ever.
const LIST_MS = 10_000;
// On Windows a program left by one that has ended can be found only through the list of processes, and PowerShell takes seconds to start on a busy machine. While a group is registered, or once the tool has said it starts programs, one PowerShell keeps that list fresh, so the guard ends the tree from a list begun after the kill without starting another PowerShell.
let watcher: ChildProcess | null = null;
let table = '';
let listed = false;
let onListed: (() => void) | null = null;
// A list is printed after its snapshot ends, so one that comes after the kill may show the processes as they were before it; each list starts with the time its snapshot began, and the guard ends a tree only from a list begun once it knew of the kill.
const waitingForList: { since: number; done: (list: string | null) => void }[] = [];
// Once the tool has said it is about to call a program, the list runs until the tool ends, so it is running when a call starts.
let held = false;

// PowerShell writes the test files of its script policy into its temporary directory while it starts, and the guard's PowerShell may still be starting when the run that set that directory has ended. So it gets a folder of its own under LOCALAPPDATA, where it keeps its other startup data anyway, and the guard removes that folder when it ends, with whatever a PowerShell stopped while starting left there. A guard that is killed, or ends by an error, removes nothing, so the folder's name holds the guard's id, and a later guard removes the folders of guards that no longer run.
let shellTemp: string | null | undefined;
const SHELL_FOLDER = /^lawcheck-guard-(\d+)-/;

function shellEnv(): NodeJS.ProcessEnv | undefined {
  if (shellTemp === undefined) {
    const local = variableOf(process.env, 'LOCALAPPDATA');
    try {
      if (local === undefined) shellTemp = null;
      else {
        const temp = join(local, 'Temp');
        removeLeft(temp);
        shellTemp = mkdtempSync(join(temp, `lawcheck-guard-${process.pid}-`));
      }
    } catch {
      shellTemp = null;
    }
  }
  return shellTemp === null ? undefined : withTemp(process.env, shellTemp);
}

function removeLeft(temp: string): void {
  let names: string[];
  try {
    names = readdirSync(temp);
  } catch {
    return;
  }
  for (const name of names) {
    const owner = SHELL_FOLDER.exec(name);
    if (owner !== null && !running(Number(owner[1]))) rm(join(temp, name), { recursive: true, force: true, maxRetries: 10 }, () => undefined);
  }
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function watch(): void {
  if (!windows || watcher !== null) return;
  watcher = spawn(powershell(), ['-NoProfile', '-NonInteractive', '-Command', `while ($true) { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); ${PROCESS_TABLE}; '--'; Start-Sleep -Milliseconds 250 }`], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, env: shellEnv() });
  const current = watcher;
  const gone = () => {
    if (watcher !== current) return;
    for (const next of waitingForList.splice(0)) next.done(null);
  };
  current.on('error', gone);
  current.on('close', gone);
  let partial = '';
  watcher.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
    partial += chunk;
    const end = partial.lastIndexOf('\n--');
    if (end < 0) return;
    const start = partial.lastIndexOf('\n--', end - 1);
    const [begun, ...rows] = partial.slice(start < 0 ? 0 : start + 3, end).trimStart().split('\n');
    table = rows.join('\n');
    partial = partial.slice(end + 3);
    listed = true;
    onListed?.();
    const takenAt = Number(begun);
    for (const next of waitingForList.filter((waiting) => takenAt >= waiting.since)) {
      waitingForList.splice(waitingForList.indexOf(next), 1);
      next.done(table);
    }
  });
}
// Each group's root, with the time the tool took just before it started the root, when it said one: one entry per call, as two calls may get the same id.
const groups = new Map<number, (number | undefined)[]>();
const folders = new Set<string>();
let pending = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  pending += chunk;
  for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
    const line = pending.slice(0, end);
    pending = pending.slice(end + 1);
    const adding = line.startsWith('+');
    if (line === '+w') {
      held = true;
      watch();
      continue;
    }
    if (line[1] === 'd') {
      if (adding) folders.add(line.slice(2));
      else folders.delete(line.slice(2));
      continue;
    }
    const group = line[1] === 'g';
    const [pid, said] = line.slice(group ? 2 : 1).split(' ').map(Number) as [number, number | undefined];
    const started = Number.isFinite(said) ? said : undefined;
    const calls = groups.get(pid) ?? [];
    if (group && adding) groups.set(pid, [...calls, started]);
    else if (group && calls.includes(started)) {
      calls.splice(calls.indexOf(started), 1);
      if (calls.length === 0) groups.delete(pid);
    } else if (group) continue;
    else if (adding) runners.set(pid, (runners.get(pid) ?? 0) + 1);
    else if ((runners.get(pid) ?? 0) > 1) runners.set(pid, runners.get(pid)! - 1);
    else runners.delete(pid);
    if (group && adding) watch();
    if (group && !adding && groups.size === 0 && !held) stopWatching();
  }
});
// PowerShell writes test files to the temporary directory while it starts and removes them once started, so the watcher is ended only after its first list, or after 10 seconds.
function stopWatching(then: () => void = () => undefined): void {
  const current = watcher;
  if (current === null || listed || current.exitCode !== null) {
    current?.kill();
    watcher = null;
    listed = false;
    then();
    return;
  }
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    current.kill();
    if (watcher === current) {
      watcher = null;
      listed = false;
    }
    then();
  };
  onListed = end;
  current.on('exit', end);
  setTimeout(end, 10_000).unref();
}

let ended = false;

// Windows gives an ended process's id to a new one soon, so a process is killed from the list only when a list made after the tool's end still shows that id made at the same time.
function listSince(since: number, ms: number): Promise<string | null> {
  if (watcher === null || watcher.exitCode !== null) return Promise.resolve(null);
  return new Promise((done) => {
    const waiting = {
      since,
      done: (list: string | null) => {
        clearTimeout(timer);
        done(list);
      },
    };
    const timer = setTimeout(() => {
      waitingForList.splice(waitingForList.indexOf(waiting), 1);
      done(null);
    }, ms);
    waitingForList.push(waiting);
  });
}

// Windows may have given a root's id to another process, so the guard never ends a tree or a runner by its id: it ends only what toEnd finds in a list begun after the kill, and takes that list itself when the watcher gives none in time.
async function endWatched(): Promise<void> {
  // With no call of a program reviewer open, only rule runners are left, which end with the tool in its job and start no program under Node's permission model, so a list could end nothing.
  if (groups.size === 0) return;
  const learned = Date.now();
  const before = table;
  const fresh = (await listSince(learned, LIST_MS)) ?? listNow();
  // On Windows the tool starts the guard before it calls a program reviewer (startListing), so no process of a group's tree was made before the guard; and none was made before the time the tool took just before it started the group's root, which tells the root from an earlier holder of its id when no earlier list shows the root.
  // Of two calls that got the same id, the later one's program holds it, and what was made below it before that program is not known to be the tool's.
  const since = new Map([...groups].flatMap(([pid, calls]): [number, string][] => {
    const known = calls.filter((started) => started !== undefined);
    return known.length === 0 ? [] : [[pid, ticksAt(Math.max(...known))]];
  }));
  for (const pid of toEnd(before, fresh, [...groups.keys(), ...runners.keys()], createdIn(fresh).get(process.pid), since)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process has already ended.
    }
  }
}

function listNow(): string {
  const listed = spawnSync(powershell(), ['-NoProfile', '-NonInteractive', '-Command', PROCESS_TABLE], { encoding: 'utf8', windowsHide: true, timeout: LIST_MS, killSignal: 'SIGKILL', env: shellEnv() });
  return listed.error === undefined ? (listed.stdout ?? '') : '';
}

function endAll(): void {
  if (ended) return;
  ended = true;
  if (!windows) {
    for (const pid of runners.keys()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // The runner has already ended.
      }
    }
    for (const pid of groups.keys()) killTree(pid, 'SIGKILL');
  }
  void (windows ? endWatched() : Promise.resolve()).then(() => {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true, maxRetries: 10 });
    stopWatching(() => {
      if (typeof shellTemp === 'string') rmSync(shellTemp, { recursive: true, force: true, maxRetries: 10 });
      process.exit(0);
    });
  });
}

process.stdin.on('close', endAll);

// On Windows the guard's input did not close when the tool was killed while claude ran, so the guard also watches the tool itself.
if (process.platform === 'win32') {
  const tool = process.ppid;
  setInterval(() => {
    try {
      process.kill(tool, 0);
    } catch {
      endAll();
    }
  }, 250);
}
