import { tokenize, type Token } from './source.ts';

export type Value =
  | { kind: 'number'; value: number }
  | { kind: 'list'; items: string[] }
  | { kind: 'records'; items: Array<{ [key: string]: string | string[] }> }
  | { kind: 'text'; value: string }
  | { kind: 'unreadable'; text: string };

export function readConstants(text: string): Map<string, Value> {
  const tokens = tokenize(text);
  const out = new Map<string, Value>();
  const strings = stringConstants(tokens);
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
    const parsed = value(text, tokens, m + 1, strings);
    flatten(name.value, parsed.value, out);
    k = parsed.next - 1;
  }
  return out;
}

// What is left of the file once the exported constants whose values it reads are taken out: the code, which can raise a budget that no value shows, as a function that picks among the numbers does.
export function codeOf(text: string): string {
  const tokens = tokenize(text);
  const strings = stringConstants(tokens);
  const kept: string[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    const decl = tokens[k + 1];
    if (t.type === 'name' && t.value === 'export' && decl?.type === 'name' && ['const', 'let', 'var'].includes(decl.value) && tokens[k + 2]?.type === 'name') {
      let m = k + 3;
      if (isPunct(tokens[m], ':')) while (m < tokens.length && !isPunct(tokens[m], '=')) m++;
      if (isPunct(tokens[m], '=')) {
        const parsed = value(text, tokens, m + 1, strings);
        if (readable(parsed.value)) {
          k = (isPunct(tokens[parsed.next], ';') ? parsed.next + 1 : parsed.next) - 1;
          continue;
        }
      }
    }
    kept.push(`${t.type} ${t.value}`);
  }
  return kept.join('\n');
}

function readable(tree: Tree): boolean {
  if (tree.kind === 'unreadable') return false;
  if (tree.kind === 'object') return tree.entries.every(([key, child]) => !key.startsWith('?') && readable(child));
  return true;
}

// A list may name a string constant of its own file in place of a literal, as PLATFORM_SKIPS names its shared reasons.
function stringConstants(tokens: Token[]): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  for (let k = 0; k + 4 < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.type === 'punct' && '([{'.includes(t.value)) depth++;
    else if (t.type === 'punct' && ')]}'.includes(t.value)) depth--;
    if (depth !== 0 || t.type !== 'name' || t.value !== 'const' || tokens[k + 1]?.type !== 'name' || !isPunct(tokens[k + 2], '=')) continue;
    const literal = tokens[k + 3]!;
    if ((literal.type === 'string' || (literal.type === 'template' && !literal.dynamic)) && (isPunct(tokens[k + 4], ';') || tokens[k + 4]?.type === 'name')) out.set(tokens[k + 1]!.value, literal.value);
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

// Skips the type after 'as' or 'satisfies', and nothing past it: a token that is no part of a type, such as the '||' of `0 as number || 90_000`, stays, so the value reads as unreadable.
function skipAsConst(tokens: Token[], at: number): number {
  let k = at;
  if (tokens[k]?.type !== 'name' || (tokens[k]!.value !== 'as' && tokens[k]!.value !== 'satisfies')) return k;
  k++;
  const closers: { [open: string]: string } = { '<': '>', '[': ']', '{': '}', '(': ')' };
  const lone = (j: number): boolean => !isPunct(tokens[j - 1], tokens[j]!.value) && !isPunct(tokens[j + 1], tokens[j]!.value);
  let expectType = true;
  while (k < tokens.length) {
    const t = tokens[k]!;
    if (expectType && (t.type === 'name' || t.type === 'string' || t.type === 'other' || (t.type === 'template' && !t.dynamic))) { k++; expectType = false; continue; }
    if (t.type === 'punct' && t.value in closers && (expectType || t.value !== '(')) {
      let depth = 0;
      let j = k;
      for (; j < tokens.length; j++) {
        const u = tokens[j]!;
        if (u.type === 'punct' && u.value in closers) depth++;
        else if (u.type === 'punct' && Object.values(closers).includes(u.value) && !(u.value === '>' && isPunct(tokens[j - 1], '='))) depth--;
        if (depth === 0) break;
      }
      if (depth !== 0) return k;
      k = j + 1;
      expectType = false;
      continue;
    }
    if (!expectType && isPunct(t, '.') && tokens[k + 1]?.type === 'name') { k += 2; continue; }
    if (!expectType && (isPunct(t, '|') || isPunct(t, '&')) && lone(k)) { k++; expectType = true; continue; }
    break;
  }
  return expectType ? at : k;
}

function numberOf(raw: string): number | null {
  const clean = raw.replace(/_/g, '');
  if (!/^(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+(\.\d+)?([eE][-+]?\d+)?|\.\d+([eE][-+]?\d+)?)$/.test(clean)) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function value(text: string, tokens: Token[], at: number, strings: Map<string, string>): { value: Tree; next: number } {
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
  if (t.type === 'name' && strings.has(t.value)) return end(at + 1, { kind: 'text', value: strings.get(t.value)! });
  if (isPunct(t, '[')) {
    const items: string[] = [];
    const records: Array<{ [key: string]: string | string[] }> = [];
    let k = at + 1;
    let readable = true;
    while (k < tokens.length && !isPunct(tokens[k], ']')) {
      const item = tokens[k]!;
      if (item.type === 'string' || (item.type === 'template' && !item.dynamic)) { items.push(item.value); k++; continue; }
      if (isPunct(item, ',')) { k++; continue; }
      if (isPunct(item, '{')) {
        const child = value(text, tokens, k, strings);
        const record: { [key: string]: string | string[] } = {};
        if (child.value.kind === 'object') {
          for (const [key, leaf] of child.value.entries) {
            if (leaf.kind === 'text') record[key] = leaf.value;
            else if (leaf.kind === 'number') record[key] = String(leaf.value);
            else if (leaf.kind === 'list') record[key] = leaf.items;
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
        const child = value(text, tokens, k + 2, strings);
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
