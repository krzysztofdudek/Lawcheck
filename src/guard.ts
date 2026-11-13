import { rmSync } from 'node:fs';

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
process.stdin.on('close', () => {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The runner has already ended.
    }
  }
  for (const pid of groups) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // The group has already ended.
    }
  }
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});
