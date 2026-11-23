import { readFileSync, statSync } from 'node:fs';
import { onDisk } from './names.mjs';
import { blobsAt } from './snapshot.mjs';
import { turnMessage as message } from './messages.mjs';
import { plainText } from './start.mjs';

// Lawcheck's own law reads plugin/ for waivers, and the marker written whole would be one with no rule.
export const MARKER = ['lawcheck', 'waive'].join('-');
// FILE_TEXT_BYTES of src/limits.ts: Lawcheck reads no larger file, so a waiver in one never counts.
const LARGEST = 16 * 1024 * 1024;
const SHOWN = 5;

function marksOf(bytes) {
  const found = [];
  if (bytes === null || !bytes.includes(MARKER)) return found;
  bytes.toString('utf8').split('\n').forEach((text, index) => {
    const at = text.indexOf(MARKER);
    if (at >= 0) found.push({ line: index + 1, key: text.slice(at).trimEnd() });
  });
  return found;
}

function fileNow(root, path) {
  try {
    const at = onDisk(root, path);
    return statSync(at).size > LARGEST ? undefined : readFileSync(at);
  } catch {
    return null;
  }
}

export function isLaw(path) {
  return path === '.lawcheck/law.yaml' || path === '.lawcheck/config.yaml' || path.startsWith('.lawcheck/rules/');
}

export function marksAtStart(root, files) {
  const marks = {};
  for (const [path, id] of Object.entries(files)) {
    if (id === '-') continue;
    const bytes = fileNow(root, path);
    if (bytes === undefined) marks[path] = null;
    else {
      const keys = marksOf(bytes).map((mark) => mark.key);
      if (keys.length > 0) marks[path] = keys;
    }
  }
  return marks;
}

export function turnChanges(root, state, paths, deadline) {
  const law = paths.filter(isLaw);
  const now = new Map();
  for (const path of paths) {
    if (path.startsWith('.lawcheck/')) continue;
    const found = marksOf(fileNow(root, path) ?? null);
    if (found.length > 0) now.set(path, found);
  }
  const clean = [...now.keys()].filter((path) => !Object.hasOwn(state.files, path));
  const committed = clean.length === 0 ? { blobs: new Map() } : blobsAt(root, state.head, clean, deadline);
  const waivers = [];
  for (const [path, found] of now) {
    let before;
    if (Object.hasOwn(state.files, path)) {
      const kept = state.marks === undefined ? null : (state.marks[path] ?? []);
      if (kept === null) continue;
      before = [...kept];
    } else {
      if ('problem' in committed) continue;
      before = marksOf(committed.blobs.get(path) ?? null).map((mark) => mark.key);
    }
    for (const { line, key } of found) {
      const at = before.indexOf(key);
      if (at >= 0) before.splice(at, 1);
      else waivers.push({ path, line, rule: /^\s+(\S+)/.exec(key.slice(MARKER.length))?.[1] ?? null });
    }
  }
  return { waivers, law };
}

function listed(items) {
  const shown = items.slice(0, SHOWN);
  const rest = items.length - shown.length;
  return `${shown.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
}

export function turnMessage({ waivers, law }) {
  const named = waivers.map(({ path, line, rule }) => plainText(`${rule ?? MARKER} at ${path}:${line}`));
  return message({ count: waivers.length, named: listed(named) }, law.length === 0 ? null : listed(law.map(plainText)));
}
