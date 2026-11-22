import { changes, Tree } from '../guard/git.ts';
import { matchesAny } from '../guard/glob.ts';
import { loadConfig } from '../guard/guard.ts';
import { invariantRows, type Row } from '../guard/markdown.ts';
import { EXACT, isPattern, readSource } from '../guard/source.ts';
import type { Changed } from './red-on-base.ts';

const config = loadConfig();

function promises(tree: Tree): Map<string, { file: string; text: string }> {
  const out = new Map<string, { file: string; text: string }>();
  const add = (file: string, rows: Row[]): void => { for (const r of rows) if (!out.has(r.key)) out.set(r.key, { file, text: r.text }); };
  for (const file of [...tree.list()].filter((p) => matchesAny(p, config.specs) && p !== config.rulings).sort()) {
    add(file, invariantRows(tree.read(file) ?? ''));
  }
  return out;
}

function named(id: string): string[] {
  const out: string[] = [];
  for (const m of id.matchAll(/\btests?\s+(\d+(?:\s*(?:,|and|to)\s*\d+)*)/gi)) for (const n of m[1]!.matchAll(/\d+/g)) out.push(`row ${n[0]}`);
  for (const m of id.matchAll(/\bI-[A-Za-z0-9][\w-]*/g)) out.push(m[0]);
  for (const m of id.matchAll(/\bS\d+-\d+\b/g)) out.push(m[0]);
  return [...new Set(out)];
}

export function testIds(repo: string, mergeBase: string, head: string, changed: Changed[]): string {
  const before = new Tree(repo, mergeBase);
  const after = new Tree(repo, head);
  const known = new Map([...promises(before), ...promises(after)]);
  const ids = (tree: Tree): Map<string, { file: string; n: number }> => {
    const out = new Map<string, { file: string; n: number }>();
    for (const file of [...tree.list()].filter((p) => matchesAny(p, config.tests)).sort()) {
      for (const t of readSource(tree.read(file) ?? '').tests) {
        const k = out.get(t.id);
        if (k) k.n++;
        else out.set(t.id, { file, n: 1 });
      }
    }
    return out;
  };
  const was = ids(before);
  const now = ids(after);
  const removed = [...was].filter(([id, w]) => (now.get(id)?.n ?? 0) < w.n).map(([id, w]) => ({ id, file: w.file }));
  const lines = ['| Test | File | Change | Promise |', '|---|---|---|---|'];
  const promise = (id: string): string => {
    const keys = named(id);
    if (keys.length === 0) return 'names no test number, promise or finding';
    return keys.map((k) => {
      const p = known.get(k);
      if (p) return `${k} of ${p.file}: ${p.text.length > 160 ? `${p.text.slice(0, 157)}...` : p.text}`;
      return k.startsWith('I-') ? `${k}: not in ${config.specs.join(', ')}` : k.replace(/^row /, 'test ');
    }).join('; ').replace(/\|/g, '\\|');
  };
  for (const c of changed) lines.push(`| ${c.id.replace(/\|/g, '\\|')} | ${c.file}:${c.line} | ${c.change} | ${promise(c.id)} |`);
  for (const r of removed) lines.push(`| ${r.id.replace(/\|/g, '\\|')} | ${r.file} | removed | ${promise(r.id)} |`);
  if (lines.length === 2) return 'no test id added, changed or removed\n';
  return `${lines.join('\n')}\n`;
}

export function assertionCounts(repo: string, mergeBase: string, head: string): string {
  const before = new Tree(repo, mergeBase);
  const after = new Tree(repo, head);
  const files = changes(repo, mergeBase, head).filter((c) => matchesAny(c.path, config.tests) || matchesAny(c.from, config.tests));
  if (files.length === 0) return 'no test file changed\n';
  const lines = ['| File | Assertions | Removed or rewritten | Exact comparisons | Patterns | Exact became pattern |', '|---|---|---|---|---|---|'];
  for (const c of files) {
    const was = readSource(before.read(c.from) ?? '').assertions;
    const now = readSource(after.read(c.path) ?? '').assertions;
    const left = new Map<string, number>();
    for (const a of now) left.set(a.text, (left.get(a.text) ?? 0) + 1);
    let removed = 0;
    for (const a of was) {
      const n = left.get(a.text) ?? 0;
      if (n > 0) left.set(a.text, n - 1);
      else removed++;
    }
    const exact = (list: typeof was): number => list.filter((a) => EXACT.has(a.method)).length;
    const pattern = (list: typeof was): number => list.filter(isPattern).length;
    const became = Math.max(0, Math.min(exact(was) - exact(now), pattern(now) - pattern(was)));
    const name = c.status === 'R' ? `${c.from} -> ${c.path}` : c.path;
    lines.push(`| ${name} | ${was.length} -> ${now.length} | ${removed} | ${exact(was)} -> ${exact(now)} | ${pattern(was)} -> ${pattern(now)} | ${became} |`);
  }
  return `${lines.join('\n')}\n`;
}
