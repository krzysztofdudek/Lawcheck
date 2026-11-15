import { tokenize, type Token } from './source.ts';

export type Value =
  | { kind: 'number'; value: number }
  | { kind: 'list'; items: string[] }
  | { kind: 'records'; items: Array<{ [key: string]: string }> }
  | { kind: 'text'; value: string }
  | { kind: 'unreadable'; text: string };

export function readConstants(text: string): Map<string, Value> {
  const tokens = tokenize(text);
  const out = new Map<string, Value>();
  for (let k = 0; k + 3 < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.type !== 'name' || t.value !== 'export') continue;
    const decl = tokens[k + 1];
    const name = tokens[k + 2];
    if (decl?.type !== 'name' || !['const', 'let', 'var'].includes(decl.value) || name?.type !== 'name') continue;
    let m = k + 3;
    if (tokens[m]?.type === 'punct' && tokens[m]!.value === ':') {
      while (m < tokens.length && !(tokens[m]!.type === 'punct' && tokens[m]!.value === '=')) m++;
    }
    if (tokens[m]?.type !== 'punct' || tokens[m]!.value !== '=') continue;
    const parsed = value(text, tokens, m + 1);
    flatten(name.value, parsed.value, out);
    k = parsed.next - 1;
  }
  return out;
}

type Tree = Value | { kind: 'object'; entries: Array<[string, Tree]> };

function flatten(prefix: string, tree: Tree, out: Map<string, Value>): void {
  if (tree.kind === 'object') {
    for (const [key, child] of tree.entries) flatten(`${prefix}.${key}`, child, out);
    return;
  }
  out.set(prefix, tree);
}

function isPunct(t: Token | undefined, v: string): boolean {
  return t?.type === 'punct' && t.value === v;
}

function skipAsConst(tokens: Token[], at: number): number {
  let k = at;
  if (tokens[k]?.type === 'name' && (tokens[k]!.value === 'as' || tokens[k]!.value === 'satisfies')) {
    k++;
    while (k < tokens.length && !isPunct(tokens[k], ';') && !isPunct(tokens[k], ',') && !isPunct(tokens[k], '}') && !isPunct(tokens[k], ']')) k++;
  }
  return k;
}

function numberOf(raw: string): number | null {
  const clean = raw.replace(/_/g, '');
  if (!/^(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(\.\d+)?([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?)$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function value(text: string, tokens: Token[], at: number): { value: Tree; next: number } {
  const t = tokens[at];
  const end = (k: number, v: Tree): { value: Tree; next: number } => {
    const after = skipAsConst(tokens, k);
    const stop = tokens[after];
    if (!stop || isPunct(stop, ';') || isPunct(stop, ',') || isPunct(stop, '}') || isPunct(stop, ']') || (stop.type === 'name' && stop.value === 'export')) return { value: v, next: after };
    let j = after;
    while (j < tokens.length && !isPunct(tokens[j], ';') && !(tokens[j]!.type === 'name' && tokens[j]!.value === 'export')) j++;
    return { value: { kind: 'unreadable', text: text.slice(t!.start, tokens[j - 1]!.end).trim() }, next: j };
  };
  if (!t) return { value: { kind: 'unreadable', text: '' }, next: at };
  if (isPunct(t, '-') && tokens[at + 1]?.type === 'other') {
    const n = numberOf(tokens[at + 1]!.value);
    if (n !== null) return end(at + 2, { kind: 'number', value: -n });
  }
  if (t.type === 'other') {
    const n = numberOf(t.value);
    if (n !== null) return end(at + 1, { kind: 'number', value: n });
  }
  if (t.type === 'string' || (t.type === 'template' && !t.dynamic)) return end(at + 1, { kind: 'text', value: t.value });
  if (isPunct(t, '[')) {
    const items: string[] = [];
    const records: Array<{ [key: string]: string }> = [];
    let k = at + 1;
    let readable = true;
    while (k < tokens.length && !isPunct(tokens[k], ']')) {
      const item = tokens[k]!;
      if (item.type === 'string' || (item.type === 'template' && !item.dynamic)) { items.push(item.value); k++; continue; }
      if (isPunct(item, ',')) { k++; continue; }
      if (isPunct(item, '{')) {
        const child = value(text, tokens, k);
        const record: { [key: string]: string } = {};
        if (child.value.kind === 'object') {
          for (const [key, leaf] of child.value.entries) {
            if (leaf.kind === 'text') record[key] = leaf.value;
            else if (leaf.kind === 'number') record[key] = String(leaf.value);
            else readable = false;
          }
        } else readable = false;
        records.push(record);
        k = child.next;
        continue;
      }
      readable = false;
      k++;
    }
    if (!readable || (items.length > 0 && records.length > 0)) return end(k + 1, { kind: 'unreadable', text: text.slice(t.start, tokens[k]?.end ?? text.length) });
    if (records.length > 0) return end(k + 1, { kind: 'records', items: records });
    return end(k + 1, { kind: 'list', items });
  }
  if (isPunct(t, '{')) {
    const entries: Array<[string, Tree]> = [];
    let k = at + 1;
    while (k < tokens.length && !isPunct(tokens[k], '}')) {
      const key = tokens[k]!;
      if (isPunct(key, ',')) { k++; continue; }
      if ((key.type === 'name' || key.type === 'string' || key.type === 'other') && isPunct(tokens[k + 1], ':')) {
        const child = value(text, tokens, k + 2);
        entries.push([key.value, child.value]);
        k = child.next;
        continue;
      }
      let depth = 0;
      const from = k;
      while (k < tokens.length && !(depth === 0 && (isPunct(tokens[k], ',') || isPunct(tokens[k], '}')))) {
        if (isPunct(tokens[k], '{') || isPunct(tokens[k], '[') || isPunct(tokens[k], '(')) depth++;
        if (isPunct(tokens[k], '}') || isPunct(tokens[k], ']') || isPunct(tokens[k], ')')) depth--;
        k++;
      }
      entries.push([`?${from}`, { kind: 'unreadable', text: text.slice(key.start, tokens[k - 1]!.end) }]);
    }
    return end(k + 1, { kind: 'object', entries });
  }
  return end(at, { kind: 'unreadable', text: '' });
}
