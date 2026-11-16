import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createdIn, killTree, powershell, PROCESS_TABLE, stillListed, trace } from './programs.js';

trace('guard', 'start');
const pids = new Set<number>();
const windows = process.platform === 'win32';
// On Windows a program left by one that has ended can be found only through the list of processes, and PowerShell takes seconds to start on a busy machine. While a group is registered, one PowerShell keeps that list fresh, so the guard ends the tree at once from the last list.
let watcher: ChildProcess | null = null;
let table = '';
let listed = false;
let onListed: (() => void) | null = null;
const waitingForList: (() => void)[] = [];

function watch(): void {
  if (!windows || watcher !== null) return;
  trace('guard', 'watcher spawned');
  watcher = spawn(powershell(), ['-NoProfile', '-NonInteractive', '-Command', `while ($true) { ${PROCESS_TABLE}; '--'; Start-Sleep -Milliseconds 250 }`], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  watcher.on('error', () => undefined);
  let partial = '';
  watcher.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
    partial += chunk;
    const end = partial.lastIndexOf('\n--');
    if (end < 0) return;
    const start = partial.lastIndexOf('\n--', end - 1);
    table = partial.slice(start < 0 ? 0 : start + 3, end);
    partial = partial.slice(end + 3);
    trace('guard', `list of ${createdIn(table).size} processes${listed ? '' : ', the first'}`);
    listed = true;
    onListed?.();
    for (const next of waitingForList.splice(0)) next();
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
    if (group && !adding && groups.size === 0) stopWatching();
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
    waitingForList.push(() => {
      clearTimeout(timer);
      done(table);
    });
  });
}

async function endWatched(): Promise<void> {
  const before = table;
  trace('guard', `groups ${[...groups].join(',') || 'none'}, in the last list: ${stillListed(before, before, [...groups]).join(',') || 'none'}`);
  if (stillListed(before, before, [...groups]).length === 0) return;
  const began = Date.now();
  const fresh = await nextList(3000);
  trace('guard', `fresh list after ${Date.now() - began} ms: ${fresh === null ? 'none' : `kills ${stillListed(before, fresh, [...groups]).join(',') || 'none'}`}`);
  if (fresh === null) return;
  for (const pid of stillListed(before, fresh, [...groups])) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process has already ended.
    }
  }
}

function endAll(why = 'its input closed'): void {
  if (ended) return;
  ended = true;
  trace('guard', `the tool ended (${why}); a list ${listed ? 'was' : 'was not yet'} made`);
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The runner has already ended.
    }
  }
  void endWatched().then(() => {
    for (const pid of groups) killTree(pid, 'SIGKILL', true);
    const began = Date.now();
    for (const folder of folders) rmSync(folder, { recursive: true, force: true, maxRetries: 10 });
    trace('guard', `folders removed in ${Date.now() - began} ms`);
    stopWatching(() => {
      trace('guard', 'exit');
      process.exit(0);
    });
  });
}

process.stdin.on('close', () => endAll());

// On Windows the guard's input did not close when the tool was killed while claude ran, so the guard also watches the tool itself.
if (process.platform === 'win32') {
  const tool = process.ppid;
  setInterval(() => {
    try {
      process.kill(tool, 0);
    } catch {
      endAll('its parent is gone');
    }
  }, 250);
}
