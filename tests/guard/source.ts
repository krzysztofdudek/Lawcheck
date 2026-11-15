export type Token =
  | { type: 'name'; value: string; line: number; start: number; end: number }
  | { type: 'string'; value: string; line: number; start: number; end: number }
  | { type: 'template'; value: string; dynamic: boolean; line: number; start: number; end: number }
  | { type: 'punct'; value: string; line: number; start: number; end: number }
  | { type: 'other'; value: string; line: number; start: number; end: number };

const REGEX_BEFORE = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof']);

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  const regexAllowed = (): boolean => {
    const last = tokens[tokens.length - 1];
    if (!last) return true;
    if (last.type === 'name') return REGEX_BEFORE.has(last.value);
    if (last.type === 'punct') return !(last.value === ')' || last.value === ']' || last.value === '}');
    return false;
  };
  const lines = (from: number, to: number): number => {
    let n = 0;
    for (let k = from; k < to; k++) if (text[k] === '\n') n++;
    return n;
  };
  while (i < text.length) {
    const c = text[i]!;
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      line += lines(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      const { end, value } = readQuoted(text, i);
      tokens.push({ type: 'string', value, line, start: i, end });
      line += lines(i, end);
      i = end;
      continue;
    }
    if (c === '`') {
      const { end, value, dynamic } = readTemplate(text, i + 1);
      tokens.push({ type: 'template', value, dynamic, line, start: i, end });
      line += lines(i, end);
      i = end;
      continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== '\n') {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '[') inClass = true;
        else if (text[j] === ']') inClass = false;
        else if (text[j] === '/' && !inClass) break;
        j++;
      }
      j++;
      while (j < text.length && /[a-z]/i.test(text[j]!)) j++;
      tokens.push({ type: 'other', value: text.slice(i, j), line, start: i, end: j });
      i = j;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < text.length && /[\w$]/.test(text[j]!)) j++;
      tokens.push({ type: 'name', value: text.slice(i, j), line, start: i, end: j });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < text.length && /[\w.]/.test(text[j]!)) {
        if ((text[j] === 'e' || text[j] === 'E') && (text[j + 1] === '-' || text[j + 1] === '+')) j++;
        j++;
      }
      tokens.push({ type: 'other', value: text.slice(i, j), line, start: i, end: j });
      i = j;
      continue;
    }
    tokens.push({ type: 'punct', value: c, line, start: i, end: i + 1 });
    i++;
  }
  return tokens;
}

function readQuoted(text: string, at: number): { end: number; value: string } {
  const quote = text[at];
  let j = at + 1;
  let value = '';
  while (j < text.length && text[j] !== quote && text[j] !== '\n') {
    if (text[j] === '\\') { value += unescapeChar(text, j); j += escapeLength(text, j); continue; }
    value += text[j];
    j++;
  }
  return { end: j + 1, value };
}

function readTemplate(text: string, from: number): { end: number; value: string; dynamic: boolean } {
  let j = from;
  let value = '';
  let dynamic = false;
  while (j < text.length) {
    const c = text[j]!;
    if (c === '\\') { value += unescapeChar(text, j); j += escapeLength(text, j); continue; }
    if (c === '`') return { end: j + 1, value, dynamic };
    if (c === '$' && text[j + 1] === '{') {
      dynamic = true;
      value += '${…}';
      j = skipExpression(text, j + 2);
      continue;
    }
    value += c;
    j++;
  }
  return { end: j, value, dynamic };
}

function skipRegex(text: string, from: number): number {
  let j = from + 1;
  let inClass = false;
  while (j < text.length && text[j] !== '\n') {
    if (text[j] === '\\') { j += 2; continue; }
    if (text[j] === '[') inClass = true;
    else if (text[j] === ']') inClass = false;
    else if (text[j] === '/' && !inClass) break;
    j++;
  }
  j++;
  while (j < text.length && /[a-z]/i.test(text[j]!)) j++;
  return j;
}

function skipExpression(text: string, from: number): number {
  let depth = 1;
  let j = from;
  let last = '(';
  while (j < text.length) {
    const c = text[j]!;
    if (c === '/' && text[j + 1] !== '/' && text[j + 1] !== '*' && /[(,=:[!&|?{};+\-*%<>~^]/.test(last)) { j = skipRegex(text, j); last = 'x'; continue; }
    if (!/\s/.test(c)) last = c;
    if (c === '"' || c === "'") { j = readQuoted(text, j).end; continue; }
    if (c === '`') { j = readTemplate(text, j + 1).end; continue; }
    if (c === '/' && text[j + 1] === '/') { while (j < text.length && text[j] !== '\n') j++; continue; }
    if (c === '/' && text[j + 1] === '*') { const end = text.indexOf('*/', j + 2); j = end === -1 ? text.length : end + 2; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) return j + 1; }
    j++;
  }
  return j;
}

function escapeLength(text: string, at: number): number {
  const next = text[at + 1];
  if (next === 'u' && text[at + 2] === '{') return text.indexOf('}', at) - at + 1;
  if (next === 'u') return 6;
  if (next === 'x') return 4;
  if (next === '\r' && text[at + 2] === '\n') return 3;
  return 2;
}

function unescapeChar(text: string, at: number): string {
  const next = text[at + 1] ?? '';
  const simple: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0', '\n': '', '\r': '' };
  if (next in simple) return simple[next]!;
  if (next === 'u' && text[at + 2] === '{') return String.fromCodePoint(parseInt(text.slice(at + 3, text.indexOf('}', at)), 16));
  if (next === 'u') return String.fromCharCode(parseInt(text.slice(at + 2, at + 6), 16));
  if (next === 'x') return String.fromCharCode(parseInt(text.slice(at + 2, at + 4), 16));
  return next;
}

export type Marker = { kind: 'only' | 'skip' | 'todo' | 'platform'; line: number; text: string; strings: string[] };

export type TestCall = {
  id: string;
  dynamic: boolean;
  line: number;
  body: string;
  top: { id: string; dynamic: boolean };
};

export type Source = { tests: TestCall[]; markers: Marker[]; assertions: Assertion[] };

export type Assertion = { method: string; text: string; line: number };

const TEST_NAMES = new Set(['test', 'it', 'describe', 'suite']);
const PLATFORM = /\bprocess\s*\.\s*(platform|arch|getuid|geteuid|env)\b|\bplatform\s*\(\)|\bWINDOWS\b|\bIS_WINDOWS\b/;
const MODIFIERS = new Set(['only', 'skip', 'todo']);
const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

function matching(tokens: Token[], open: number): number {
  const stack: string[] = [];
  for (let k = open; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.type !== 'punct') continue;
    if (t.value in OPEN) stack.push(OPEN[t.value]!);
    else if (t.value === ')' || t.value === ']' || t.value === '}') {
      stack.pop();
      if (stack.length === 0) return k;
    }
  }
  return tokens.length - 1;
}

function splitArgs(tokens: Token[], open: number, close: number): Array<[number, number]> {
  const args: Array<[number, number]> = [];
  let depth = 0;
  let from = open + 1;
  for (let k = open + 1; k < close; k++) {
    const t = tokens[k]!;
    if (t.type !== 'punct') continue;
    if (t.value in OPEN) depth++;
    else if (t.value === ')' || t.value === ']' || t.value === '}') depth--;
    else if (t.value === ',' && depth === 0) { args.push([from, k]); from = k + 1; }
  }
  if (from < close) args.push([from, close]);
  return args;
}

function stringsIn(tokens: Token[], from: number, to: number): string[] {
  const out: string[] = [];
  for (let k = from; k < to; k++) {
    const t = tokens[k]!;
    if (t.type === 'string' || (t.type === 'template' && !t.dynamic)) out.push(t.value);
  }
  return out;
}

function textOf(text: string, tokens: Token[], from: number, to: number): string {
  if (from >= to) return '';
  return text.slice(tokens[from]!.start, tokens[to - 1]!.end).replace(/\s+/g, ' ').trim();
}

function optionKeys(text: string, tokens: Token[], from: number): Marker[] {
  const out: Marker[] = [];
  if (tokens[from]?.type !== 'punct' || tokens[from]!.value !== '{') return out;
  const close = matching(tokens, from);
  const props = splitArgs(tokens, from, close);
  for (const [a, b] of props) {
    const key = tokens[a];
    const colon = tokens[a + 1];
    if (!key || (key.type !== 'name' && key.type !== 'string') || !MODIFIERS.has(key.value)) continue;
    if (!colon || colon.type !== 'punct' || colon.value !== ':') {
      if (a + 1 === b) out.push({ kind: key.value as Marker['kind'], line: key.line, text: key.value, strings: [] });
      continue;
    }
    const value = textOf(text, tokens, a + 2, b);
    if (value === 'false' || value === 'undefined' || value === "''" || value === '""') continue;
    out.push({ kind: key.value as Marker['kind'], line: key.line, text: value, strings: stringsIn(tokens, a + 2, b) });
  }
  return out;
}

export function readSource(text: string, skipCalls: readonly string[] = ['platformSkip']): Source {
  const tokens = tokenize(text);
  const tests: TestCall[] = [];
  const markers: Marker[] = [];
  const assertions: Assertion[] = [];
  const open_: Array<{ id: string; dynamic: boolean; end: number }> = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k]!;
    if (t.type !== 'name') continue;
    const prev = tokens[k - 1];
    const afterDot = prev?.type === 'punct' && prev.value === '.';
    if (t.value === 'assert' && !afterDot) {
      let m = k + 1;
      let method = 'ok';
      if (tokens[m]?.type === 'punct' && tokens[m]!.value === '.' && tokens[m + 1]?.type === 'name') { method = tokens[m + 1]!.value; m += 2; }
      if (tokens[m]?.type === 'punct' && tokens[m]!.value === '(') {
        const close = matching(tokens, m);
        assertions.push({ method, text: textOf(text, tokens, k, close + 1), line: t.line });
      }
      continue;
    }
    if (afterDot && (t.value === 'skip' || t.value === 'todo' || t.value === 'runOnly')) {
      const receiver = tokens[k - 2];
      if (receiver?.type === 'name' && TEST_NAMES.has(receiver.value)) continue;
      const open = tokens[k + 1];
      if (open?.type !== 'punct' || open.value !== '(') continue;
      const close = matching(tokens, k + 1);
      const args = textOf(text, tokens, k + 2, close);
      if (t.value === 'runOnly') { if (args !== 'false') markers.push({ kind: 'only', line: t.line, text: `runOnly(${args})`, strings: [] }); continue; }
      markers.push({ kind: t.value as 'skip' | 'todo', line: t.line, text: args, strings: stringsIn(tokens, k + 2, close) });
      continue;
    }
    if (skipCalls.includes(t.value) && !afterDot && tokens[k + 1]?.type === 'punct' && tokens[k + 1]!.value === '(') {
      const close = matching(tokens, k + 1);
      markers.push({ kind: 'platform', line: t.line, text: `${t.value}(${textOf(text, tokens, k + 2, close)})`, strings: stringsIn(tokens, k + 2, close) });
      continue;
    }
    if (t.value === 'if' && !afterDot && tokens[k + 1]?.type === 'punct' && tokens[k + 1]!.value === '(') {
      const close = matching(tokens, k + 1);
      const condition = textOf(text, tokens, k + 2, close);
      let r = close + 1;
      if (tokens[r]?.type === 'punct' && tokens[r]!.value === '{') r++;
      const ret = tokens[r];
      const next = tokens[r + 1];
      const bare = next === undefined || (next.type === 'punct' && (next.value === ';' || next.value === '}')) || (next.line > ret!.line);
      if (ret?.type === 'name' && ret.value === 'return' && bare && PLATFORM.test(condition)) {
        markers.push({ kind: 'skip', line: t.line, text: `if (${condition}) return, with no skip`, strings: [] });
      }
      continue;
    }
    if (!TEST_NAMES.has(t.value)) continue;
    if (afterDot && (t.value !== 'test' || tokens[k - 2]?.type !== 'name')) continue;
    let m = k + 1;
    let modifier: string | null = null;
    if (tokens[m]?.type === 'punct' && tokens[m]!.value === '.' && tokens[m + 1]?.type === 'name' && MODIFIERS.has(tokens[m + 1]!.value)) {
      modifier = tokens[m + 1]!.value;
      m += 2;
    }
    const open = tokens[m];
    if (open?.type !== 'punct' || open.value !== '(') continue;
    const first = tokens[m + 1];
    if (!first || (first.type !== 'string' && first.type !== 'template')) continue;
    const close = matching(tokens, m);
    const args = splitArgs(tokens, m, close);
    while (open_.length > 0 && open_[open_.length - 1]!.end < k) open_.pop();
    const self = { id: first.value, dynamic: first.type === 'template' && first.dynamic };
    tests.push({
      ...self,
      line: t.line,
      body: text.slice(t.start, tokens[close]!.end),
      top: open_.length > 0 ? { id: open_[0]!.id, dynamic: open_[0]!.dynamic } : self,
    });
    open_.push({ ...self, end: close });
    if (modifier) {
      const rest = args.slice(1).map(([a, b]) => textOf(text, tokens, a, b)).filter((s) => !s.startsWith('(') && !s.startsWith('async') && !s.startsWith('function')).join(', ');
      markers.push({ kind: modifier as Marker['kind'], line: t.line, text: `${t.value}.${modifier}(${JSON.stringify(first.value)})${rest ? ` ${rest}` : ''}`, strings: [] });
    }
    for (const [a] of args.slice(1)) markers.push(...optionKeys(text, tokens, a));
  }
  return { tests, markers, assertions };
}

export function namePattern(id: string, dynamic: boolean): RegExp {
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  if (!dynamic) return new RegExp(`^${escape(id)}$`);
  return new RegExp(`^${id.split('${…}').map(escape).join('.*')}$`);
}

export const EXACT = new Set(['equal', 'strictEqual', 'deepEqual', 'deepStrictEqual', 'notEqual', 'notStrictEqual', 'notDeepEqual', 'notDeepStrictEqual', 'partialDeepStrictEqual']);

export function isPattern(a: Assertion): boolean {
  if (a.method === 'match' || a.method === 'doesNotMatch') return true;
  if (a.method === 'ok') return /\.(includes|startsWith|endsWith|test|search|some)\(/.test(a.text);
  return false;
}
