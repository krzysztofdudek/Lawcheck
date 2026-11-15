import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { sep } from 'node:path';

interface Proc {
  pid: number;
  ppid: number;
  group: number;
  start: string;
  zombie: boolean;
  marked: boolean;
}

export const MARK = 'LAWCHECK_HARNESS_RUN';

const PROC = existsSync('/proc/self/stat');
const PS = !PROC && process.platform !== 'win32';

function listProc(mark: string): Map<number, Proc> {
  const out = new Map<number, Proc>();
  const needle = Buffer.from(`${MARK}=${mark}\0`);
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      let marked = false;
      try {
        marked = readFileSync(`/proc/${name}/environ`).includes(needle);
      } catch {
        marked = false;
      }
      out.set(Number(name), { pid: Number(name), ppid: Number(fields[1]), group: Number(fields[2]), start: fields[19]!, zombie: fields[0] === 'Z', marked });
    } catch {
      continue;
    }
  }
  return out;
}

// macOS has no /proc; its ps shows a process's environment after its command with -E, and -ww keeps the line whole.
function listPs(mark: string): Map<number, Proc> {
  const out = new Map<number, Proc>();
  const table = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,pgid=,stat=,lstart='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  for (const line of table.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (m === null) continue;
    out.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), group: Number(m[3]), start: m[5]!.trim(), zombie: m[4]!.startsWith('Z'), marked: false });
  }
  const environments = execFileSync('ps', ['-A', '-E', '-ww', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  for (const line of environments.split('\n')) {
    if (!line.includes(`${MARK}=${mark}`)) continue;
    const pid = Number(/^\s*(\d+)/.exec(line)?.[1]);
    const p = out.get(pid);
    if (p !== undefined) p.marked = true;
  }
  return out;
}

function list(mark: string): Map<number, Proc> {
  return PROC ? listProc(mark) : listPs(mark);
}

function cwdOf(pid: number): string | null {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

// A process of the run is found by any of four signs: it carries the run's mark in its environment, it was seen below the tool while the run lasted, it is in a process group of one seen so, or on Linux its folder is inside the run's folders. A rule's runner starts with an empty environment, so a detached child of a rule that leaves within one sample carries none of them.
export class Tracker {
  readonly mark: string;
  private readonly seen = new Map<number, string>();
  private readonly groups = new Set<number>();
  private readonly folders: string[];
  private timer: NodeJS.Timeout | null = null;
  readonly tracks: boolean;

  constructor(pid: number, mark: string, folders: string[], tracks: boolean) {
    this.mark = mark;
    this.folders = folders;
    this.tracks = tracks && (PROC || PS);
    if (!this.tracks) return;
    this.seen.set(pid, '');
    this.sample();
    this.timer = setInterval(() => this.sample(), PROC ? 50 : 200);
    this.timer.unref();
  }

  private sample(): void {
    const procs = list(this.mark);
    for (const [pid, start] of this.seen) if (start === '' && procs.has(pid)) this.seen.set(pid, procs.get(pid)!.start);
    let grown = true;
    while (grown) {
      grown = false;
      for (const p of procs.values()) {
        if (this.seen.has(p.pid) || p.pid === process.pid) continue;
        if (this.seen.has(p.ppid) || this.groups.has(p.group) || p.marked) {
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

  alive(byFolder = true): number[] {
    if (!this.tracks) return [];
    const procs = list(this.mark);
    const left: number[] = [];
    for (const p of procs.values()) {
      if (p.zombie || p.pid === process.pid) continue;
      const known = this.seen.has(p.pid) && (this.seen.get(p.pid) === '' || this.seen.get(p.pid) === p.start);
      let inside = false;
      if (!known && !p.marked && !this.groups.has(p.group) && byFolder && PROC && p.ppid !== process.pid && this.folders.length > 0) {
        const cwd = cwdOf(p.pid);
        inside = cwd !== null && this.folders.some((folder) => cwd === folder || cwd.startsWith(folder + sep));
      }
      if (known || p.marked || this.groups.has(p.group) || inside) left.push(p.pid);
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
