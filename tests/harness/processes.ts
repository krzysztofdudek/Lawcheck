import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { sep } from 'node:path';

interface Proc {
  pid: number;
  ppid: number;
  group: number;
  start: string;
  zombie: boolean;
}

// Windows has no cheap way to list the processes a program started; there the tool's leftovers are tested by the tests that kill it, not by the harness.
export const TRACKS_PROCESSES = process.platform !== 'win32';

const PROC = existsSync('/proc/self/stat');

function listProc(): Map<number, Proc> {
  const out = new Map<number, Proc>();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      out.set(Number(name), { pid: Number(name), ppid: Number(fields[1]), group: Number(fields[2]), start: fields[19]!, zombie: fields[0] === 'Z' });
    } catch {
      continue;
    }
  }
  return out;
}

function listPs(): Map<number, Proc> {
  const out = new Map<number, Proc>();
  const text = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,stat=,lstart='], { encoding: 'utf8' });
  for (const line of text.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m === null) continue;
    out.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), group: Number(m[3]), start: m[5]!.trim(), zombie: m[4]!.startsWith('Z') });
  }
  return out;
}

function list(): Map<number, Proc> {
  return PROC ? listProc() : listPs();
}

function cwdOf(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

export class Tracker {
  private readonly seen = new Map<number, string>();
  private readonly groups = new Set<number>();
  private readonly folders: string[];
  private timer: NodeJS.Timeout | null = null;

  constructor(pid: number, folders: string[]) {
    this.folders = folders;
    if (!TRACKS_PROCESSES) return;
    this.seen.set(pid, '');
    this.sample();
    this.timer = setInterval(() => this.sample(), PROC ? 50 : 200);
    this.timer.unref();
  }

  private sample(): void {
    const procs = list();
    for (const [pid, start] of this.seen) if (start === '' && procs.has(pid)) this.seen.set(pid, procs.get(pid)!.start);
    let grown = true;
    while (grown) {
      grown = false;
      for (const p of procs.values()) {
        if (this.seen.has(p.pid) || p.pid === process.pid) continue;
        if (this.seen.has(p.ppid) || this.groups.has(p.group)) {
          this.seen.set(p.pid, p.start);
          grown = true;
        }
      }
      for (const pid of this.seen.keys()) {
        const p = procs.get(pid);
        if (p !== undefined && p.group === pid && !this.groups.has(pid)) this.groups.add(pid);
      }
    }
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  alive(): number[] {
    if (!TRACKS_PROCESSES) return [];
    const procs = list();
    const left: number[] = [];
    for (const p of procs.values()) {
      if (p.zombie || p.pid === process.pid) continue;
      const known = this.seen.has(p.pid) && (this.seen.get(p.pid) === '' || this.seen.get(p.pid) === p.start);
      const grouped = this.groups.has(p.group);
      let inside = false;
      if (!known && !grouped && PROC && p.ppid !== process.pid && this.folders.length > 0) {
        const cwd = cwdOf(p.pid);
        inside = cwd !== null && this.folders.some((folder) => cwd === folder || cwd.startsWith(folder + sep));
      }
      if (known || grouped || inside) left.push(p.pid);
    }
    return left.sort((a, b) => a - b);
  }

  describe(pids: number[]): string {
    return pids
      .map((pid) => {
        let command = '';
        try {
          command = PROC ? readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim() : execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
        } catch {
          command = '?';
        }
        return `${pid} (${command.slice(0, 100)})`;
      })
      .join(', ');
  }
}

export function killAll(pids: number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      continue;
    }
  }
}
