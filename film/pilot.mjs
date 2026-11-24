import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTranscript, trimTranscript } from './trim.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PILOT = join(HERE, 'pilot.json');

const USES = /\b(?:import|export)\b[^;"']*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\b(?:import|require)\s*\(\s*["']([^"']+)["']/g;

const METADATA = /^(?:\.DS_Store|\._.*)$/;

function filesBelow(folder, prefix = '') {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => !METADATA.test(entry.name))
    .flatMap((entry) => {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? filesBelow(join(folder, entry.name), path) : [path];
    })
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function fingerprint(folder) {
  const lines = filesBelow(folder).map((path) => {
    const bytes = readFileSync(join(folder, path));
    return `${sha256(!path.includes('/') && isTranscript(path) ? Buffer.from(trimTranscript(bytes.toString('utf8'))) : bytes)}  ${path}\n`;
  });
  return sha256(lines.join(''));
}

export function apiImports(folder) {
  const found = [];
  const files = join(folder, 'files');
  if (!existsSync(files)) return found;
  for (const path of filesBelow(files).filter((name) => name.startsWith('src/core/'))) {
    const text = readFileSync(join(files, path), 'utf8');
    for (const match of text.matchAll(USES)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier.split('/').includes('api')) found.push(`${path}:${text.slice(0, match.index).split('\n').length}`);
    }
  }
  return found;
}

export function rowOf(folder) {
  const take = JSON.parse(readFileSync(join(folder, 'take.json'), 'utf8'));
  return {
    id: take.id,
    arm: take.arm,
    recorded: take.recorded,
    complete: take.complete,
    changed: take.changed,
    apiImports: apiImports(folder),
    tests: take.tests,
    check: take.check,
    versions: take.versions,
    record: fingerprint(folder),
  };
}

export function summaryOf(rows) {
  const summary = {};
  for (const arm of ['a', 'b']) {
    const of = rows.filter((row) => row.arm === arm);
    summary[arm] = { sessions: of.length, imported: of.filter((row) => row.apiImports.length > 0).length };
  }
  return summary;
}

export function pilotOf(takes) {
  const folders = readdirSync(takes)
    .map((name) => join(takes, name))
    .filter((path) => statSync(path).isDirectory() && existsSync(join(path, 'take.json')));
  const rows = folders.map(rowOf).sort((a, b) => (a.id < b.id ? -1 : 1));
  const prompts = new Set(folders.map((folder) => JSON.parse(readFileSync(join(folder, 'take.json'), 'utf8')).prompt));
  if (prompts.size !== 1) throw new Error(`the records hold ${prompts.size} prompts, not one`);
  return {
    prompt: [...prompts][0],
    recordHash: 'SHA-256 of the lines "<SHA-256 of a file>  <path>" of every file of a record, sorted by path, each line ending in a newline, with each transcript taken as node film/trim.mjs writes it',
    summary: summaryOf(rows),
    sessions: rows,
  };
}

export function differences(have, want) {
  const lines = [];
  const rows = (pilot) => new Map(pilot.sessions.map((row) => [row.id, row]));
  const [kept, recounted] = [rows(have), rows(want)];
  for (const id of [...new Set([...kept.keys(), ...recounted.keys()])].sort()) {
    const [old, now] = [kept.get(id), recounted.get(id)];
    if (old === undefined) lines.push(`session ${id} is not in film/pilot.json`);
    else if (now === undefined) lines.push(`session ${id} has no record in the folder`);
    else {
      const fields = Object.keys({ ...old, ...now }).filter((field) => JSON.stringify(old[field]) !== JSON.stringify(now[field]));
      if (fields.length > 0) lines.push(`session ${id} differs in ${fields.join(', ')}`);
    }
  }
  for (const field of ['prompt', 'recordHash', 'summary']) if (JSON.stringify(have[field]) !== JSON.stringify(want[field])) lines.push(`${field} differs`);
  return lines;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, takes] = process.argv.slice(2);
  if ((command !== 'write' && command !== 'check') || takes === undefined) {
    process.stderr.write('usage: node film/pilot.mjs <write|check> <folder of the records of the pilot>\n');
    process.exit(2);
  }
  const text = `${JSON.stringify(pilotOf(takes), null, 2)}\n`;
  if (command === 'write') {
    writeFileSync(PILOT, text);
    process.stdout.write(`film/pilot.json written from ${takes}\n`);
  }
  const have = readFileSync(PILOT, 'utf8');
  const summary = JSON.parse(text).summary;
  process.stdout.write(`recount: arm a ${summary.a.imported} of ${summary.a.sessions} imported src/api into src/core, arm b ${summary.b.imported} of ${summary.b.sessions}\n`);
  if (have !== text) {
    const lines = differences(JSON.parse(have), JSON.parse(text));
    process.stdout.write(`film/pilot.json differs from a recount of the records${lines.length === 0 ? ' in its formatting' : ''}\n${lines.map((line) => `${line}\n`).join('')}`);
    process.exit(1);
  }
  process.stdout.write('film/pilot.json equals a recount of the records\n');
}
