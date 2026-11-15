import { rmSync } from 'node:fs';
import { killTree } from './programs.js';

const pids = new Set<number>();
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
  }
});
let ended = false;

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
  for (const pid of groups) killTree(pid, 'SIGKILL');
  for (const folder of folders) rmSync(folder, { recursive: true, force: true, maxRetries: 10 });
  process.exit(0);
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
