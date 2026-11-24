import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A session's transcript also holds Claude Code's own text (its system prompt, tool schemas and listings) and the host's kernel string; only these lines are the session.
const KEPT = new Set(['user', 'assistant', 'attachment/hook_success', 'attachment/hook_additional_context', 'system/stop_hook_summary']);

export const isTranscript = (name) => /^transcript.*\.jsonl$/.test(name);

function kindOf(event) {
  if (event.attachment !== undefined) return `${event.type}/${event.attachment.type}`;
  if (event.subtype !== undefined) return `${event.type}/${event.subtype}`;
  return String(event.type);
}

export function trimLine(line) {
  if (line.trim() === '') return line;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    event = { type: 'unreadable' };
  }
  if (event.trimmed !== undefined || KEPT.has(kindOf(event))) return line;
  return JSON.stringify({ trimmed: kindOf(event), sha256: createHash('sha256').update(line).digest('hex') });
}

export function trimTranscript(text) {
  return text.split('\n').map(trimLine).join('\n');
}

export function trimRecord(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (/^(?:\.DS_Store|\._.*)$/.test(entry.name)) continue;
    if (entry.isDirectory()) cpSync(join(from, entry.name), join(to, entry.name), { recursive: true, filter: (path) => !/(?:^|[\\/])(?:\.DS_Store|\._[^\\/]*)$/.test(path) });
    else if (isTranscript(entry.name)) writeFileSync(join(to, entry.name), trimTranscript(readFileSync(join(from, entry.name), 'utf8')));
    else cpSync(join(from, entry.name), join(to, entry.name));
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [from, to] = process.argv.slice(2);
  if (from === undefined || to === undefined || !existsSync(join(from, 'take.json')) || existsSync(to)) {
    process.stderr.write('usage: node film/trim.mjs <folder of a record> <new folder for its trimmed copy>\n');
    process.exit(2);
  }
  trimRecord(from, to);
  process.stdout.write(`film/trim.mjs: ${to} holds ${from} with every line of its transcript that is not the session replaced by its kind and SHA-256\n`);
}
