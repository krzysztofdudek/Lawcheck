import { join, sep } from 'node:path';

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const PLAIN = /^[^\\\n\r]*$/;
const HEX = '0123456789abcdef';

function hex(byte: number): string {
  return `\\x${HEX[byte >> 4]}${HEX[byte & 15]}`;
}

function sequence(bytes: Uint8Array, at: number): number {
  const lead = bytes[at]!;
  if (lead < 0x80) return 1;
  const continued = (i: number, low = 0x80, high = 0xbf) => at + i < bytes.length && bytes[at + i]! >= low && bytes[at + i]! <= high;
  if (lead >= 0xc2 && lead <= 0xdf) return continued(1) ? 2 : 0;
  if (lead === 0xe0) return continued(1, 0xa0) && continued(2) ? 3 : 0;
  if (lead === 0xed) return continued(1, 0x80, 0x9f) && continued(2) ? 3 : 0;
  if (lead >= 0xe1 && lead <= 0xef) return continued(1) && continued(2) ? 3 : 0;
  if (lead === 0xf0) return continued(1, 0x90) && continued(2) && continued(3) ? 4 : 0;
  if (lead === 0xf4) return continued(1, 0x80, 0x8f) && continued(2) && continued(3) ? 4 : 0;
  if (lead >= 0xf1 && lead <= 0xf3) return continued(1) && continued(2) && continued(3) ? 4 : 0;
  return 0;
}

// Decision 80 of design/decisions.md: a path's bytes read as UTF-8, with a backslash, a line feed, a carriage return and every byte outside valid UTF-8 written as an escape, so the name holds no line break and maps back to the bytes on disk.
export function nameOf(bytes: Uint8Array): string {
  try {
    const text = strict.decode(bytes);
    if (PLAIN.test(text)) return text;
  } catch {
    // Not valid UTF-8: the bytes are escaped one sequence at a time below.
  }
  let out = '';
  for (let at = 0; at < bytes.length; ) {
    const length = sequence(bytes, at);
    if (length === 0) {
      out += hex(bytes[at]!);
      at++;
      continue;
    }
    const ch = strict.decode(bytes.subarray(at, at + length));
    out += ch === '\\' ? '\\\\' : ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch;
    at += length;
  }
  return out;
}

const NAMED: Record<string, number> = { '\\': 0x5c, n: 0x0a, r: 0x0d, t: 0x09 };

// The bytes a name stands for. Besides the escapes nameOf writes, \t, \x with two hexadecimal digits and \u with four are read, which the text output writes for other characters; a backslash that starts none of these stands for itself.
export function bytesOfName(name: string): Buffer {
  if (!name.includes('\\')) return Buffer.from(name, 'utf8');
  const parts: Buffer[] = [];
  let plain = '';
  const flush = () => {
    if (plain !== '') parts.push(Buffer.from(plain, 'utf8'));
    plain = '';
  };
  for (let i = 0; i < name.length; i++) {
    const ch = name[i]!;
    if (ch !== '\\') {
      plain += ch;
      continue;
    }
    const next = name[i + 1];
    if (next !== undefined && Object.hasOwn(NAMED, next)) {
      flush();
      parts.push(Buffer.from([NAMED[next]!]));
      i++;
    } else if (next === 'x' && /^[0-9a-fA-F]{2}$/.test(name.slice(i + 2, i + 4))) {
      flush();
      parts.push(Buffer.from([parseInt(name.slice(i + 2, i + 4), 16)]));
      i += 3;
    } else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(name.slice(i + 2, i + 6))) {
      plain += String.fromCharCode(parseInt(name.slice(i + 2, i + 6), 16));
      i += 5;
    } else {
      plain += ch;
    }
  }
  flush();
  return Buffer.concat(parts);
}

// The one spelling of a name a user typed, so a raw backslash and its escape select the same file; Windows reads a backslash as a separator, and its file names hold none of the escaped bytes.
export function canonicalName(word: string): string {
  if (sep === '\\' || !word.includes('\\')) return word;
  return nameOf(bytesOfName(word));
}

// A name that exists on one system is never refused as one that cannot. Windows answers that a name or path that is too long is missing, so the refusal is made here. Linux and macOS cap a name at 255 bytes and a path at 4,095; Windows caps a name at 255 UTF-16 units, so 86 CJK characters (258 bytes) exist there, and a path at 32,767. An escaped name is measured by the bytes it stands for.
export function cannotExist(root: string, given: string, platform: NodeJS.Platform = process.platform): boolean {
  const windows = platform === 'win32';
  const units = (bytes: Uint8Array) => (windows ? Buffer.from(bytes).toString('utf8').length : bytes.length);
  if (given.split('/').some((part) => units(bytesOfName(part)) > 255)) return true;
  const path = onDisk(root, given);
  return units(typeof path === 'string' ? Buffer.from(path, 'utf8') : path) > (windows ? 32767 : 4095);
}

export function onDisk(root: string, name: string): string | Buffer {
  if (sep === '\\' || !name.includes('\\')) return join(root, name);
  return Buffer.concat([Buffer.from(join(root, '/'), 'utf8'), bytesOfName(name)]);
}

// git reads a path of --stdin-paths in C quotes when the line starts with a double quote, from the top of the work tree; quoting every path the same way carries any byte and needs no other rule.
export function quotedLine(prefix: string, bytes: Uint8Array): Buffer {
  const out: number[] = [0x22];
  for (const byte of [...Buffer.from(prefix, 'utf8'), ...bytes]) {
    if (byte === 0x22 || byte === 0x5c) out.push(0x5c, byte);
    else if (byte < 0x20 || byte >= 0x7f) out.push(0x5c, ...Buffer.from(byte.toString(8).padStart(3, '0')));
    else out.push(byte);
  }
  out.push(0x22, 0x0a);
  return Buffer.from(out);
}
