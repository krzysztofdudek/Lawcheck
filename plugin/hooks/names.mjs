import { join, sep } from 'node:path';

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const PLAIN = /^[^\\\n\r]*$/;
const HEX = '0123456789abcdef';

function sequence(bytes, at) {
  const lead = bytes[at];
  if (lead < 0x80) return 1;
  const continued = (i, low = 0x80, high = 0xbf) => at + i < bytes.length && bytes[at + i] >= low && bytes[at + i] <= high;
  if (lead >= 0xc2 && lead <= 0xdf) return continued(1) ? 2 : 0;
  if (lead === 0xe0) return continued(1, 0xa0) && continued(2) ? 3 : 0;
  if (lead === 0xed) return continued(1, 0x80, 0x9f) && continued(2) ? 3 : 0;
  if (lead >= 0xe1 && lead <= 0xef) return continued(1) && continued(2) ? 3 : 0;
  if (lead === 0xf0) return continued(1, 0x90) && continued(2) && continued(3) ? 4 : 0;
  if (lead === 0xf4) return continued(1, 0x80, 0x8f) && continued(2) && continued(3) ? 4 : 0;
  if (lead >= 0xf1 && lead <= 0xf3) return continued(1) && continued(2) && continued(3) ? 4 : 0;
  return 0;
}

// The names of spec/check-slice.md, section 2, as src/names.ts writes them; the hooks ship without the tool, so they hold their own copy, and a property test holds the two equal.
export function nameOf(bytes) {
  try {
    const text = strict.decode(bytes);
    if (PLAIN.test(text)) return text;
  } catch {}
  let out = '';
  for (let at = 0; at < bytes.length; ) {
    const length = sequence(bytes, at);
    if (length === 0) {
      out += `\\x${HEX[bytes[at] >> 4]}${HEX[bytes[at] & 15]}`;
      at++;
      continue;
    }
    const ch = strict.decode(bytes.subarray(at, at + length));
    out += ch === '\\' ? '\\\\' : ch === '\n' ? '\\n' : ch === '\r' ? '\\r' : ch;
    at += length;
  }
  return out;
}

const NAMED = { '\\': 0x5c, n: 0x0a, r: 0x0d, t: 0x09 };

export function bytesOfName(name) {
  if (!name.includes('\\')) return Buffer.from(name, 'utf8');
  const parts = [];
  let plain = '';
  const flush = () => {
    if (plain !== '') parts.push(Buffer.from(plain, 'utf8'));
    plain = '';
  };
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    if (ch !== '\\') {
      plain += ch;
      continue;
    }
    const next = name[i + 1];
    if (next !== undefined && Object.hasOwn(NAMED, next)) {
      flush();
      parts.push(Buffer.from([NAMED[next]]));
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

export function onDisk(root, name) {
  if (sep === '\\' || !name.includes('\\')) return join(root, name);
  return Buffer.concat([Buffer.from(join(root, '/'), 'utf8'), bytesOfName(name)]);
}
