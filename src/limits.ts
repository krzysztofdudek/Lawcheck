import { closeSync, constants, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { availableParallelism, freemem } from 'node:os';
import { join } from 'node:path';
import type { ErrorItem } from './output.js';

const MiB = 1024 * 1024;

// Most of these are the numbers of the table of limits in docs/config.md (decision 74 of design/decisions.md); HEAD_BYTES is the binary test of docs/law.md, and MEMORY_CHECK_MS is on no page.
export const HEAD_BYTES = 8000;
export const FILE_TEXT_BYTES = 16 * MiB;
export const FILE_LINES = 1_048_576;
export const RUN_TEXT_BYTES = 128 * MiB;
export const RUN_FINDINGS = 200_000;
export const RUN_MESSAGE_CHARS = 16 * MiB;
export const MESSAGE_CHARS = 4096;
export const RULES_RUN_MS = 600_000;
export const LAW_BYTES = 1 * MiB;
export const CONFIG_BYTES = 1 * MiB;
export const USES_FILE_BYTES = 512 * 1024;
export const LAW_RULES = 10_000;
export const LAW_TYPES = 1_000;
export const STEP_MS = 30_000;
export const MEMORY_BYTES = 1536 * MiB;
export const MEMORY_SHARE = 0.85;
export const STEP_MEMORY_BYTES = 384 * MiB;
export const MEMORY_RESERVE_BYTES = 128 * MiB;
export const MEMORY_CHECK_MS = 5;

// The most memory a run may hold: MEMORY_BYTES, or less on a smaller machine.
export function runBound(total: number): number {
  return Math.min(MEMORY_BYTES, Math.floor((total * MEMORY_SHARE) / MiB) * MiB);
}

// The processors this run may use at once: what Node counts, or fewer where a cgroup gives the process a smaller share of processor time, as a container started with a limit of processors does. Node's own count leaves that share out.
export function cores(counted: number = availableParallelism(), share: string | null = cpuShare()): number {
  const [quota, period] = (share ?? '').trim().split(/\s+/).map(Number);
  if (quota === undefined || period === undefined || !(quota > 0) || !(period > 0)) return Math.max(1, counted);
  return Math.max(1, Math.min(counted, Math.ceil(quota / period)));
}

function cpuShare(): string | null {
  if (process.platform !== 'linux') return null;
  try {
    const own = /^0::(\/.*)$/m.exec(readFileSync('/proc/self/cgroup', 'utf8'));
    if (own !== null) return readFileSync(join('/sys/fs/cgroup', own[1]!, 'cpu.max'), 'utf8');
  } catch {
    // A cgroup of the first version, or none: its two files below.
  }
  try {
    return `${readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', 'utf8').trim()} ${readFileSync('/sys/fs/cgroup/cpu/cpu.cfs_period_us', 'utf8').trim()}`;
  } catch {
    return null;
  }
}

// The most memory the syntax trees kept for the rules of one run may take: a third of what the run may hold. A tree past it is parsed again for each rule that asks.
export function treeMemoryBound(total: number): number {
  return Math.floor(runBound(total) / 3);
}

// The memory the system can still give: on Linux the kernel's estimate, or a container's limit less what its processes use; on Windows the physical memory that is free or on standby. macOS counts only the pages free this moment, which it keeps few, so there it gives no number.
export function availableNow(platform: NodeJS.Platform = process.platform): number | null {
  if (platform === 'darwin') return null;
  const left = process.availableMemory();
  if (platform !== 'linux' || left >= MEMORY_RESERVE_BYTES) return left;
  return withCache(left, cgroupStat(), freemem());
}

// A cgroup v2 counts its page cache as used, so right after a large write its limit less its use reads near nothing; where the kernel charges its own memory to the cgroup (most kernels; not one booted with cgroup.memory=nokmem), the dentries and inodes of every file the cgroup touched count as used too. The kernel takes both back before it kills a process of the cgroup, so they count as left, as the kernel's own estimate of available memory counts the page cache and the reclaimable slab, and never as more than that estimate. Shared memory and tmpfs are not on these lists.
export function withCache(left: number, stat: string | null, free: number): number {
  if (stat === null) return left;
  let cache = 0;
  for (const line of stat.split('\n')) {
    const [key, value] = line.split(' ');
    if (key === 'active_file' || key === 'inactive_file' || key === 'slab_reclaimable') cache += Number(value) || 0;
  }
  return cache === 0 ? left : Math.min(free, left + cache);
}

function cgroupStat(): string | null {
  try {
    const own = /^0::(\/.*)$/m.exec(readFileSync('/proc/self/cgroup', 'utf8'));
    return own === null ? null : readFileSync(join('/sys/fs/cgroup', own[1]!, 'memory.stat'), 'utf8');
  } catch {
    return null;
  }
}

export interface MemoryRead {
  rss: number;
  stepGrowth: number | null;
  available: number | null;
  total: number;
}

export type MemoryCase = 'file' | 'run' | 'system' | null;

export function memoryCase(read: MemoryRead): MemoryCase {
  if (read.stepGrowth !== null && read.stepGrowth > STEP_MEMORY_BYTES) return 'file';
  if (read.rss > runBound(read.total)) return 'run';
  if (read.available !== null && read.available < MEMORY_RESERVE_BYTES) return 'system';
  return null;
}

// A character is a code point, as a reader counts one, so a pair of UTF-16 code units counts once.
export function points(text: string): number {
  let count = text.length;
  for (let i = 1; i < text.length; i++) {
    const low = text.charCodeAt(i);
    if (low >= 0xdc00 && low <= 0xdfff) {
      const high = text.charCodeAt(i - 1);
      if (high >= 0xd800 && high <= 0xdbff) count--;
    }
  }
  return count;
}

export function mib(bytes: number): string {
  return bytes < MiB ? `${bytes / 1024} KiB` : `${bytes / MiB} MiB`;
}

export function count(value: number): string {
  return value.toLocaleString('en-US');
}

export class FileTooLarge extends Error {
  constructor(
    readonly path: string,
    readonly bytes: number,
    readonly lines: number | null = null,
  ) {
    super(lines === null ? `${path} holds ${count(bytes)} bytes, more than the ${mib(FILE_TEXT_BYTES)} a file read as text may hold` : `${path} holds ${count(lines)} lines, more than the ${count(FILE_LINES)} a file read as text may hold`);
  }
}

export class TextTooLarge extends Error {
  constructor(
    readonly path: string,
    readonly bytes: number,
  ) {
    super(`the text read in this run reaches ${count(bytes)} bytes at ${path}, more than the ${mib(RUN_TEXT_BYTES)} one run may read`);
  }
}

export function tooLargeError(error: FileTooLarge | TextTooLarge): ErrorItem {
  if (error instanceof FileTooLarge) {
    const what = error.lines === null ? `${count(error.bytes)} bytes, more than the ${mib(FILE_TEXT_BYTES)}` : `${count(error.lines)} lines, more than the ${count(FILE_LINES)}`;
    return { code: 'file-too-large', file: error.path, line: null, message: `the file holds ${what} a file read as text may hold` };
  }
  return {
    code: 'text-too-large',
    file: error.path,
    line: null,
    message: `the text of the files read in this run reaches ${count(error.bytes)} bytes with this file, more than the ${mib(RUN_TEXT_BYTES)} one run may read`,
  };
}

export class NotRegular extends Error {
  constructor(readonly path: string) {
    super(`${path} is no regular file`);
  }
}

export function readError(path: string, error: unknown): ErrorItem {
  if (error instanceof NotRegular) return { code: 'file-unreadable', file: path, line: null, message: 'the file cannot be read (it is no regular file)' };
  if (error instanceof FileTooLarge || error instanceof TextTooLarge) return tooLargeError(error);
  const code = (error as NodeJS.ErrnoException).code ?? 'an error';
  return { code: 'file-unreadable', file: path, line: null, message: `the file cannot be read (${code})` };
}

export interface Bounded {
  bytes: Uint8Array;
  binary: boolean;
}

const head = Buffer.allocUnsafe(HEAD_BYTES);

// A named pipe or a device opened for reading waits for a writer, and the thread waiting in that call cannot be ended; opened without waiting, it is refused by its kind.
const OPEN = process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NONBLOCK;

// A binary file is known by its first 8,000 bytes, so only they are read, and only up to the NUL is kept; a text file is read whole, up to its limit.
export function readBounded(full: string | Buffer, path: string, headOnly = true): Bounded {
  const limit = FILE_TEXT_BYTES;
  const fd = openSync(full, OPEN);
  try {
    const stat = fstatSync(fd);
    if (stat.isDirectory()) throw Object.assign(new Error('EISDIR: illegal operation on a directory, read'), { code: 'EISDIR' });
    if (!stat.isFile()) throw new NotRegular(path);
    const size = stat.size;
    let got = 0;
    while (got < HEAD_BYTES) {
      const n = readSync(fd, head, got, HEAD_BYTES - got, null);
      if (n === 0) break;
      got += n;
    }
    const nul = head.subarray(0, got).indexOf(0);
    if (headOnly && nul >= 0) return { bytes: Buffer.from(head.subarray(0, nul + 1)), binary: true };
    if (got < HEAD_BYTES) return { bytes: Buffer.from(head.subarray(0, got)), binary: false };
    if (size > limit) throw new FileTooLarge(path, size);
    let buffer = Buffer.allocUnsafe(Math.min(Math.max(size, HEAD_BYTES), limit) + 1);
    head.copy(buffer, 0, 0, got);
    for (;;) {
      if (got === buffer.length) {
        if (got > limit) throw new FileTooLarge(path, got);
        const grown = Buffer.allocUnsafe(Math.min(buffer.length * 2, limit + 1));
        buffer.copy(grown, 0, 0, got);
        buffer = grown;
      }
      const n = readSync(fd, buffer, got, buffer.length - got, null);
      if (n === 0) break;
      got += n;
      if (got > limit) throw new FileTooLarge(path, got);
    }
    const bytes = buffer.subarray(0, got);
    // A run holds a line in memory at a cost of its own, so a file of short lines is bounded by their count as well as by its bytes.
    if (headOnly) {
      const lines = lineEnds(bytes);
      if (lines > FILE_LINES) throw new FileTooLarge(path, got, lines);
    }
    return { bytes, binary: false };
  } finally {
    closeSync(fd);
  }
}

// Only the first 8,000 bytes tell a binary file, so a file whose text no type needs is not read whole.
export function startsBinary(full: string | Buffer): boolean {
  const fd = openSync(full, OPEN);
  try {
    let got = 0;
    while (got < HEAD_BYTES) {
      const n = readSync(fd, head, got, HEAD_BYTES - got, null);
      if (n === 0) break;
      got += n;
    }
    return head.subarray(0, got).includes(0);
  } finally {
    closeSync(fd);
  }
}

function lineEnds(bytes: Uint8Array): number {
  let lines = 0;
  for (let at = bytes.indexOf(10); at >= 0; at = bytes.indexOf(10, at + 1)) lines++;
  return bytes.length > 0 && bytes[bytes.length - 1] !== 10 ? lines + 1 : lines;
}

export function readWhole(full: string | Buffer, path: string): Uint8Array {
  return readBounded(full, path, false).bytes;
}

export function readFailure(error: unknown): string {
  if (error instanceof FileTooLarge) return `it holds more than ${mib(FILE_TEXT_BYTES)}`;
  if (error instanceof NotRegular) return 'it is no regular file';
  return (error as NodeJS.ErrnoException).code ?? 'an error';
}
