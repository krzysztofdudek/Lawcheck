import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MARK = /^<!-- example: ([a-z0-9-]+) -->$/;

export interface Example {
  id: string;
  file: string;
  line: number;
  text: string;
}

function pages(): string[] {
  const out: string[] = [];
  for (const dir of ['spec', 'docs']) for (const name of readdirSync(join(ROOT, dir)).sort()) if (name.endsWith('.md')) out.push(`${dir}/${name}`);
  return out;
}

let all: Map<string, Example> | null = null;

export function examples(): Map<string, Example> {
  if (all !== null) return all;
  const found = new Map<string, Example>();
  for (const file of pages()) {
    const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const mark = MARK.exec(lines[i]!);
      if (mark === null) continue;
      const id = mark[1]!;
      const fence = /^(`{3,})/.exec(lines[i + 1] ?? '');
      if (fence === null) throw new Error(`${file}:${i + 1}: the example ${id} is not followed by a fenced block`);
      const end = lines.findIndex((line, k) => k > i + 1 && line === fence[1]);
      if (end < 0) throw new Error(`${file}:${i + 2}: the block of the example ${id} is not closed`);
      if (found.has(id)) throw new Error(`${file}:${i + 1}: the example ${id} is also at ${found.get(id)!.file}:${found.get(id)!.line}`);
      found.set(id, { id, file, line: i + 1, text: lines.slice(i + 2, end).join('\n') });
    }
  }
  all = found;
  return found;
}

export function example(id: string): string {
  const found = examples().get(id);
  if (found === undefined) throw new Error(`no fenced block in spec/ or docs/ carries <!-- example: ${id} -->`);
  return found.text;
}

// A page cannot show the line end after a block's last line; a file the tests write and every output the tool prints end with one.
export function exampleText(id: string): string {
  return example(id) + '\n';
}
