import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { killTree, powershell, PROCESS_TABLE, toEnd } from './programs.js';

const pids = new Set<number>();
const windows = process.platform === 'win32';
// On Windows a program left by one that has ended can be found only through the list of processes, and PowerShell takes seconds to start on a busy machine. While a group is registered, or once the tool has said it starts programs, one PowerShell keeps that list fresh, so the guard ends the tree from its next list without starting another.
let watcher: ChildProcess | null = null;
let table = '';
let listed = false;
let onListed: (() => void) | null = null;
const waitingForList: ((list: string | null) => void)[] = [];
// The tool starts a program only once the guard says its list runs, so a tool killed at any moment of a call leaves a tree the next list finds.
let held = false;
process.stdout.on('error', () => undefined);

function sayListing(): void {
  if (held) process.stdout.write('listing\n');
}

function watch(): void {
  if (!windows || watcher !== null) return;
  watcher = spawn(powershell(), ['-NoProfile', '-NonInteractive', '-Command', `while ($true) { ${PROCESS_TABLE}; '--'; Start-Sleep -Milliseconds 250 }`], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const current = watcher;
  const gone = () => {
    if (watcher !== current) return;
    for (const next of waitingForList.splice(0)) next(null);
    if (!listed) sayListing();
  };
  current.on('error', gone);
  current.on('close', gone);
  let partial = '';
  watcher.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
    partial += chunk;
    const end = partial.lastIndexOf('\n--');
    if (end < 0) return;
    const start = partial.lastIndexOf('\n--', end - 1);
    table = partial.slice(start < 0 ? 0 : start + 3, end);
    partial = partial.slice(end + 3);
    if (!listed) sayListing();
    listed = true;
    onListed?.();
    for (const next of waitingForList.splice(0)) next(table);
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
      if (!windows || listed || (watcher !== null && watcher.exitCode !== null)) sayListing();
      else watch();
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
function nextList(ms: number): Promise<string | null> {
  if (watcher === null || watcher.exitCode !== null) return Promise.resolve(null);
  return new Promise((done) => {
    const timer = setTimeout(() => done(null), ms);
    waitingForList.push((list) => {
      clearTimeout(timer);
      done(list);
    });
  });
}

// False when no list came, and the trees are then ended without one.
async function endWatched(): Promise<boolean> {
  if (groups.size === 0) return true;
  const before = table;
  const fresh = await nextList(3000);
  if (fresh === null) return false;
  for (const pid of toEnd(before, fresh, [...groups])) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process has already ended.
    }
  }
  return true;
}

function endAll(): void {
  if (ended) return;
  ended = true;
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The runner has already ended.
    }
  }
  void endWatched().then((found) => {
    for (const pid of groups) killTree(pid, 'SIGKILL', !found);
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
