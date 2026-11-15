import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import type { ErrorItem } from './output.js';

const MiB = 1024 * 1024;

// The numbers of the table of limits in spec/check-slice.md, section 10, each measured as that section says.
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
export const USES_FILE_BYTES = 4 * MiB;
export const LAW_RULES = 10_000;
export const LAW_TYPES = 1_000;
export const STEP_MS = 60_000;

export function mib(bytes: number): string {
  return `${bytes / MiB} MiB`;
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
