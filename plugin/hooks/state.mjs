import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WEEK = 7 * 24 * 60 * 60 * 1000;

function dataDir() {
  const given = process.env.CLAUDE_PLUGIN_DATA;
  if (given) {
    mkdirSync(given, { recursive: true });
    return given;
  }
  const dir = join(tmpdir(), `lawcheck-plugin-${process.getuid()}`);
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const info = lstatSync(dir);
  if (!info.isDirectory() || info.uid !== process.getuid()) return null;
  return dir;
}

function sessionsDir() {
  try {
    const data = dataDir();
    if (data === null) return null;
    const dir = join(data, 'sessions');
    mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return null;
  }
}

// The state file's temporary name adds about 30 characters to the id, and most file systems take names of 255 bytes.
const LONGEST_ID = 128;

export function stateFile(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length > LONGEST_ID || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
  const dir = sessionsDir();
  return dir === null ? null : join(dir, `${sessionId}.json`);
}

export function readState(file) {
  if (file === null) return null;
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeState(file, state) {
  if (file === null) return;
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, JSON.stringify(state) + '\n');
  renameSync(temporary, file);
}

export function deleteState(file) {
  if (file !== null) rmSync(file, { force: true });
}

export function blank(root, promptId) {
  return { root, prompt_id: promptId, open: false, started: 0, head: null, files: {}, blocks: 0, last: null, last_error: null, told: false };
}

export function removeOld() {
  const dir = sessionsDir();
  if (dir === null) return;
  const before = Date.now() - WEEK;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    try {
      if (statSync(path).mtimeMs < before) rmSync(path, { force: true });
    } catch {}
  }
}
