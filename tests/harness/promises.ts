import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INVARIANTS } from './invariants.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export function testIds(name: string): string[] {
  const ids: string[] = [];
  const rows = /^tests? (\d+(?:(?:, | and )\d+)*)/.exec(name);
  if (rows !== null) for (const n of rows[1]!.split(/, | and /)) ids.push(`test ${n}`);
  for (const m of name.matchAll(/(?<![\w-])(I-[a-z][a-z0-9]*-\d+|S\d+-\d+|U-\d+|R-\d+|harness-(?:\d+|count))(?![\w-])/g)) ids.push(m[1]!);
  return [...new Set(ids)];
}

export interface Promised {
  id: string;
  where: string;
  text: string;
}

function cells(line: string): string[] {
  return line
    .slice(1, line.endsWith('|') ? -1 : undefined)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

function sectionOf(lines: string[], at: number): string {
  for (let i = at; i >= 0; i--) {
    const m = /^##\s+(\d+)\.\s+(.*)$/.exec(lines[i]!);
    if (m !== null) return `section ${m[1]}`;
  }
  return 'no section';
}

function specs(): string[] {
  const dir = join(ROOT, 'spec');
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.md')).sort().map((name) => `spec/${name}`) : [];
}

export function promiseOf(id: string): Promised | null {
  if (id.startsWith('harness-')) return INVARIANTS[id] === undefined ? null : { id, where: 'tests/harness/invariants.ts', text: INVARIANTS[id]! };
  const row = /^test (\d+)$/.exec(id);
  const finding = /^(S\d+-\d+|U-\d+|R-\d+)$/.test(id);
  const files = finding ? ['tests/findings.md'] : specs();
  for (const file of files) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!line.startsWith('|')) continue;
      const parts = cells(line);
      const key = row !== null ? row[1] : id;
      if (parts[0] !== key && parts[0] !== `\`${key}\``) continue;
      const header = lines.slice(Math.max(0, i - 400), i).reverse().find((l) => /^\|\s*#|^\|\s*[Ii]d\s*\|/.test(l));
      const names = header === undefined ? [] : cells(header);
      const text = parts
        .slice(1)
        .map((cell, k) => (names[k + 1] ? `${names[k + 1]}: ${cell}` : cell))
        .join('; ');
      return { id, where: finding ? `${file}, row ${id}` : `${file}, ${sectionOf(lines, i)}, row ${parts[0]}`, text };
    }
  }
  return null;
}
