import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createdIn, killTree, powershell, PROCESS_TABLE, toEnd } from './programs.js';

const pids = new Set<number>();
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

function watch(): void {
  if (!windows || watcher !== null) return;
  watcher = spawn(powershell(), ['-NoProfile', '-NonInteractive', '-Command', `while ($true) { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); ${PROCESS_TABLE}; '--'; Start-Sleep -Milliseconds 250 }`], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
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
const groups = new Set<number>();
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
    const pid = Number(line.slice(group ? 2 : 1));
    const set = group ? groups : pids;
    if (adding) set.add(pid);
    else set.delete(pid);
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
  if (groups.size === 0 && pids.size === 0) return;
  const learned = Date.now();
  const before = table;
  const fresh = (await listSince(learned, LIST_MS)) ?? listNow();
  // On Windows the tool starts the guard before it calls a program reviewer (startListing), so no process of a group's tree was made before the guard.
  for (const pid of toEnd(before, fresh, [...groups, ...pids], createdIn(fresh).get(process.pid))) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process has already ended.
    }
  }
}

function listNow(): string {
  const listed = spawnSync(powershell(), ['-NoProfile', '-NonInteractive', '-Command', PROCESS_TABLE], { encoding: 'utf8', windowsHide: true, timeout: LIST_MS, killSignal: 'SIGKILL' });
  return listed.error === undefined ? (listed.stdout ?? '') : '';
}

function endAll(): void {
  if (ended) return;
  ended = true;
  if (!windows) {
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // The runner has already ended.
      }
    }
    for (const pid of groups) killTree(pid, 'SIGKILL');
  }
  void (windows ? endWatched() : Promise.resolve()).then(() => {
    for (const folder of folders) rmSync(folder, { recursive: true, force: true, maxRetries: 10 });
    stopWatching(() => process.exit(0));
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
