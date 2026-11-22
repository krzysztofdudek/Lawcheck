import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { COMMIT_GROUPS, NIGHTLY_GROUPS, setFiles } from '../harness/sets.ts';
import { INVARIANTS } from '../harness/invariants.ts';

export interface Row {
  number: number;
  spec: string;
}

export interface Invariant {
  id: string;
  spec: string;
}

export interface TextFile {
  path: string;
  text: string;
}

export interface TestName {
  file: string;
  name: string;
}

export interface Inputs {
  specs: TextFile[];
  docs: TextFile[];
  questions: string;
  sections: string;
  tests: TextFile[];
  sectionOnly: number;
  harness: string[];
}

export function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

export function rawFirstCell(line: string): string {
  const match = /^\|\s*([^|]*?)\s*\|/.exec(line);
  return match === null ? '' : match[1]!;
}

export function firstCell(line: string): string {
  return rawFirstCell(line).replace(/^`(.*)`$/, '$1');
}

export interface Table {
  start: number;
  header: string;
  rows: string[];
}

export function outsideFences(text: string): { line: string; number: number }[] {
  const out: { line: string; number: number }[] = [];
  let fenced = false;
  text.split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) out.push({ line, number: index + 1 });
  });
  return out;
}

export function tablesOf(text: string): Table[] {
  const tables: Table[] = [];
  let open: Table | null = null;
  for (const found of outsideFences(text)) {
    const { number } = found;
    const line = found.line.trimStart();
    if (!line.startsWith('|')) {
      open = null;
    } else if (open === null) {
      open = { start: number, header: line, rows: [] };
      tables.push(open);
    } else if (!/^\|[\s:|-]+\|$/.test(line)) {
      open.rows.push(line);
    }
  }
  return tables;
}

const NUMBER_HEADERS = new Set(['#', 'id', 'no', 'nr', 'row']);

export function rowsOf(file: TextFile): { rows: Row[]; problems: string[] } {
  const rows: Row[] = [];
  const problems: string[] = [];
  for (const table of tablesOf(file.text)) {
    const head = rawFirstCell(table.header);
    if (/^\d+$/.test(head) || /^I-/.test(head)) {
      problems.push(`${file.path}: the row "${head}" at line ${table.start} stands in a table with no header: a blank line before it splits its table`);
      continue;
    }
    const firsts = table.rows.map(rawFirstCell);
    const integers = firsts.filter((c) => /^\d+$/.test(c)).length;
    if (NUMBER_HEADERS.has(head.toLowerCase())) {
      table.rows.forEach((_, i) => {
        if (/^\d+$/.test(firsts[i]!)) rows.push({ number: Number(firsts[i]), spec: file.path });
        else if (!/^I-[a-z]+-\d+$/.test(firsts[i]!)) problems.push(`${file.path}: a row of the table "${head}" at line ${table.start} starts with "${firsts[i]}", which is neither a plain integer nor an invariant id`);
      });
      if (integers > 0 && integers < firsts.length && firsts.some((c) => /^I-[a-z]+-\d+$/.test(c))) problems.push(`${file.path}: the table "${head}" at line ${table.start} mixes numbered rows and invariant ids`);
    } else if (firsts.length >= 1 && integers === firsts.length) {
      problems.push(`${file.path}: the table at line ${table.start} looks like an acceptance table under the header "${head}"; its header starts with # or its first column holds no numbers`);
    } else if (integers > 0 && integers < firsts.length) {
      problems.push(`${file.path}: the first column of the table at line ${table.start} mixes numbers and other text`);
    }
  }
  return { rows, problems };
}

export function invariantsOf(file: TextFile): { invariants: Invariant[]; problems: string[] } {
  const invariants: Invariant[] = [];
  const problems: string[] = [];
  for (const table of tablesOf(file.text)) {
    if (firstCell(table.header).startsWith('I-')) problems.push(`${file.path}: the invariant "${firstCell(table.header)}" at line ${table.start} stands in a table with no header: a blank line before it splits its table`);
    for (const row of table.rows) {
      const cell = firstCell(row);
      if (!cell.startsWith('I-')) continue;
      if (/^I-[a-z]+-\d+$/.test(cell)) invariants.push({ id: cell, spec: file.path });
      else problems.push(`${file.path}: "${cell}" starts like an invariant id and is not one (I-<name>-<number>, name in lower case letters)`);
    }
  }
  return { invariants, problems };
}

export interface LedgerRow {
  id: string;
  severity: string;
  class: string;
  defect: string;
  layer: string;
  package: string;
  runes: string;
  test: string;
  generalised: string;
  state: string;
}

export function ledgerRows(ledger: string): LedgerRow[] {
  const out: LedgerRow[] = [];
  for (const { line } of outsideFences(ledger)) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('|') || /^\|[\s:|-]+\|$/.test(trimmed) || firstCell(trimmed) === 'id') continue;
    const c = cells(trimmed);
    out.push({ id: c[0]!, severity: c[1] ?? '', class: c[2] ?? '', defect: c[3] ?? '', layer: c[4] ?? '', package: c[5] ?? '', runes: c[6] ?? '', test: c[7] ?? '', generalised: c[8] ?? '', state: c[9] ?? '' });
  }
  return out;
}

export interface Scanned {
  tests: TestName[];
  skipped: string[];
  problems: string[];
}

interface Literal {
  value: string;
  prefix: string;
  dynamic: boolean;
  end: number;
}

function blank(text: string): { code: string; literals: Map<number, Literal> } {
  const code = text.split('');
  const literals = new Map<number, Literal>();
  const n = text.length;
  const wipe = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (code[k] !== '\n') code[k] = ' ';
  };
  const keywords = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'instanceof', 'yield', 'await']);
  let last = '';
  let lastWord = '';

  const quoted = (start: number): number => {
    const quote = text[start]!;
    let i = start + 1;
    let value = '';
    while (i < n && text[i] !== quote) {
      if (text[i] === '\\') {
        value += text[i + 1] ?? '';
        i += 2;
      } else value += text[i++];
    }
    literals.set(start, { value, prefix: value, dynamic: false, end: i + 1 });
    wipe(start, i + 1);
    return i + 1;
  };

  const template = (start: number): number => {
    let i = start + 1;
    let value = '';
    let prefix: string | null = null;
    let dynamic = false;
    wipe(start, start + 1);
    while (i < n && text[i] !== '`') {
      if (text[i] === '\\') {
        value += text[i + 1] ?? '';
        wipe(i, i + 2);
        i += 2;
      } else if (text[i] === '$' && text[i + 1] === '{') {
        dynamic = true;
        prefix ??= value;
        wipe(i, i + 2);
        i = scan(i + 2, true);
        wipe(i - 1, i);
      } else {
        value += text[i];
        wipe(i, i + 1);
        i++;
      }
    }
    wipe(i, i + 1);
    literals.set(start, { value, prefix: prefix ?? value, dynamic, end: i + 1 });
    return i + 1;
  };

  const scan = (from: number, stop: boolean): number => {
    let i = from;
    let depth = 0;
    while (i < n) {
      const c = text[i]!;
      const d = text[i + 1];
      if (c === '/' && d === '/') {
        let e = text.indexOf('\n', i);
        if (e < 0) e = n;
        wipe(i, e);
        i = e;
      } else if (c === '/' && d === '*') {
        let e = text.indexOf('*/', i + 2);
        e = e < 0 ? n : e + 2;
        wipe(i, e);
        i = e;
      } else if (c === "'" || c === '"') {
        i = quoted(i);
        last = '"';
      } else if (c === '`') {
        i = template(i);
        last = '"';
      } else if (c === '/' && (last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || keywords.has(lastWord))) {
        let k = i + 1;
        let inClass = false;
        while (k < n && (text[k] !== '/' || inClass) && text[k] !== '\n') {
          if (text[k] === '\\') k++;
          else if (text[k] === '[') inClass = true;
          else if (text[k] === ']') inClass = false;
          k++;
        }
        k++;
        while (k < n && /[a-z]/.test(text[k]!)) k++;
        wipe(i, k);
        i = k;
        last = '"';
      } else if (c === '{') {
        depth++;
        last = c;
        i++;
      } else if (c === '}') {
        if (depth === 0 && stop) return i + 1;
        depth--;
        last = c;
        i++;
      } else {
        if (!/\s/.test(c)) {
          last = c;
          lastWord = /[\w$]/.test(c) ? (/[\w$]/.test(text[i - 1] ?? '') ? lastWord + c : c) : '';
        }
        i++;
      }
    }
    return i;
  };
  scan(0, false);
  return { code: code.join(''), literals };
}

const LEAD = new RegExp(
  '^(?:(tests? \\d+(?:(?:,\\s*|\\s+and\\s+|,\\s+and\\s+)\\d+)*)|(I-[a-z]+-\\d+|harness-(?:\\d+|count))|(S\\d+-\\d+|U-\\d+|R-\\d+|T[1-8])|([a-z][a-z/-]* §[\\w.]+)|(question \\d+)):',
);

export function leadsWithSource(name: string): boolean {
  return LEAD.test(name);
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

export function stringsOf(text: string): string[] {
  return [...blank(text).literals.values()].map((l) => l.value);
}

function matching(body: string, open: number, up: string, down: string): number {
  let depth = 0;
  for (let i = open; i < body.length; i++) {
    if (body[i] === up) depth++;
    else if (body[i] === down && --depth === 0) return i;
  }
  return body.length;
}

function definitionOf(body: string, name: string): string {
  const id = name.replace(/\$/g, '\\$');
  const fn = new RegExp(`\\bfunction\\s*\\*?\\s+${id}\\s*\\(`).exec(body);
  if (fn !== null) {
    const open = body.indexOf('{', matching(body, fn.index + fn[0].length - 1, '(', ')'));
    return open < 0 ? '' : body.slice(fn.index, matching(body, open, '{', '}') + 1);
  }
  const variable = new RegExp(`\\b(?:const|let|var)\\s+${id}\\s*=`).exec(body);
  if (variable === null) return '';
  const from = variable.index + variable[0].length;
  const block = /^\s*(?:async\s*)?(?:function\b[^{]*|(?:\([^)]*\)|[\w$]+)\s*=>\s*)\{/.exec(body.slice(from));
  if (block !== null) return body.slice(variable.index, matching(body, from + block[0].length - 1, '{', '}') + 1);
  const end = body.slice(from).search(/;|\n/);
  return body.slice(variable.index, end < 0 ? body.length : from + end);
}

function argumentsAt(body: string, text: string, open: number): string[] {
  const close = matching(body, open, '(', ')');
  const out: string[] = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = body[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(text.slice(from, close).trim());
  return out;
}

// The assertions that cannot fail: one on a literal that is true, the same expression on both sides of an equality, one that a catch swallows.
function unfailing(body: string, text: string, from: number, to: number, where: string, problems: string[]): void {
  const inside = body.slice(from, to);
  const call = /(?<![\w$.])assert(?:\.(?:ok|strict\.ok))?\s*\(/g;
  for (let m = call.exec(inside); m !== null; m = call.exec(inside)) {
    const open = from + m.index + m[0].length - 1;
    const first = argumentsAt(body, text, open)[0] ?? '';
    if (/^(true|!0|[1-9]\d*|'[^']*'|"[^"]*"|`[^`$]*`)$/.test(first)) problems.push(`${where}: an assertion on the literal ${first}, which cannot fail`);
  }
  const equal = /(?<![\w$.])assert\.(?:strict\.)?(?:equal|strictEqual|deepEqual|deepStrictEqual)\s*\(/g;
  for (let m = equal.exec(inside); m !== null; m = equal.exec(inside)) {
    const open = from + m.index + m[0].length - 1;
    const [a, b] = argumentsAt(body, text, open);
    if (a !== undefined && a !== '' && a === b) problems.push(`${where}: an assertion with ${a} on both sides, which cannot fail`);
  }
  const attempt = /\btry\s*\{/g;
  for (let m = attempt.exec(inside); m !== null; m = attempt.exec(inside)) {
    const open = from + m.index + m[0].length - 1;
    const end = matching(body, open, '{', '}');
    if (!/\bassert\b/.test(body.slice(open, end))) continue;
    const after = /^\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(body.slice(end + 1));
    if (after === null) continue;
    const catchOpen = end + 1 + after[0].length - 1;
    if (!/\bthrow\b/.test(body.slice(catchOpen, matching(body, catchOpen, '{', '}')))) problems.push(`${where}: an assertion inside a try whose catch does not throw, so it cannot fail the test`);
  }
}

export function scanTests(file: string, text: string): Scanned {
  const result: Scanned = { tests: [], skipped: [], problems: [] };
  const { code, literals } = blank(text);
  const importPattern = /\bimport\s+(?:type\s+)?([^;'"`]*?)\s*from(?=[\s'"])/g;
  let imported = false;
  const hidden = code.split('');
  for (let m = importPattern.exec(code); m !== null; m = importPattern.exec(code)) {
    const at = m.index + m[0].length;
    let j = at;
    while (/\s/.test(text[j] ?? '')) j++;
    const from = literals.get(j);
    if (from?.value !== 'node:test') continue;
    imported = true;
    for (let k = m.index; k < from.end; k++) if (hidden[k] !== '\n') hidden[k] = ' ';
    const clause = text.slice(m.index, at).replace(/^import\s+(?:type\s+)?/, '').replace(/\s*from\s*$/, '');
    const named = /\{([^}]*)\}/.exec(clause);
    const rest = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
    if (rest.startsWith('*')) result.problems.push(`${file}: node:test is imported as a namespace; import test, describe and it by name`);
    else if (rest !== '' && rest !== 'test') result.problems.push(`${file}: the default import of node:test is "${rest}", an alias; it must be test`);
    for (const spec of (named?.[1] ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '')) {
      if (/\bas\b/.test(spec)) result.problems.push(`${file}: "${spec}" imports from node:test under another name; the rail reads test, describe and it only as they are`);
      else if (spec === 'suite') result.problems.push(`${file}: suite is not read; use describe`);
    }
  }
  if (!imported) result.problems.push(`${file}: imports nothing from node:test, so no test in it is read`);
  const body = hidden.join('');

  const call = /(?<![\w$.])(test|it|describe|suite)(?:\s*\.\s*(\w+))?\s*\(|(?<![\w$.])t\s*\.\s*test\s*\(/g;
  const found: { index: number; end: number; name: string; skipped: boolean; describe: boolean }[] = [];
  for (let m = call.exec(body); m !== null; m = call.exec(body)) {
    const where = `${file}:${lineOf(text, m.index)}`;
    const callee = m[1] ?? 't.test';
    const member = m[2];
    const open = m.index + m[0].length - 1;
    let close = open;
    for (let depth = 0; close < body.length; close++) {
      if (body[close] === '(') depth++;
      else if (body[close] === ')' && --depth === 0) break;
    }
    let j = open + 1;
    while (/\s/.test(text[j] ?? '')) j++;
    const literal = literals.get(j);
    if (callee === 'suite') {
      result.problems.push(`${where}: suite() is not read; use describe`);
      continue;
    }
    if (literal === undefined || (literal.dynamic && !leadsWithSource(literal.prefix))) {
      result.problems.push(`${where}: the name of this ${callee}() call is not a literal string, or a template whose literal start holds the source and its colon, so the rail cannot read it`);
      continue;
    }
    if (member === 'only') {
      result.problems.push(`${where}: ${callee}.only is not allowed`);
      continue;
    }
    if (member !== undefined && member !== 'skip' && member !== 'todo') {
      result.problems.push(`${where}: ${callee}.${member}() is not read`);
      continue;
    }
    let skipped = member === 'skip' || member === 'todo';
    let k = literal.end;
    while (/\s/.test(body[k] ?? '')) k++;
    if (body[k] === ',') {
      let o = k + 1;
      while (/\s/.test(body[o] ?? '')) o++;
      if (body[o] === '{') {
        let depth = 0;
        let e = o;
        for (; e < body.length; e++) {
          if (body[e] === '{') depth++;
          else if (body[e] === '}' && --depth === 0) break;
        }
        if (/\b(skip|todo|only)\b(?!\s*:\s*false\b)/.test(body.slice(o, e + 1))) skipped = true;
      } else if (!/^(?:async\b|function\b|\(|[\w$]+\s*=>)/.test(body.slice(o, o + 40))) {
        result.problems.push(`${where}: the second argument of this ${callee}() call is neither an options object nor a function written there, so the rail cannot see a skip`);
        skipped = true;
      }
    }
    const region = body.slice(literal.end, close);
    const arrow = region.indexOf('=>');
    const plain = region.search(/function\b[^{]*\{/);
    let inner: string | null = null;
    let innerAt = 0;
    if (arrow >= 0 && (plain < 0 || arrow < plain)) {
      let b = arrow + 2;
      while (/\s/.test(region[b] ?? '')) b++;
      if (region[b] === '{') {
        let depth = 0;
        let e = b;
        for (; e < region.length; e++) {
          if (region[e] === '{') depth++;
          else if (region[e] === '}' && --depth === 0) break;
        }
        inner = region.slice(b + 1, e);
        innerAt = literal.end + b + 1;
      }
    } else if (plain >= 0) {
      const b = region.indexOf('{', plain);
      let depth = 0;
      let e = b;
      for (; e < region.length; e++) {
        if (region[e] === '{') depth++;
        else if (region[e] === '}' && --depth === 0) break;
      }
      inner = region.slice(b + 1, e);
      innerAt = literal.end + b + 1;
    }
    if (inner !== null && !skipped && callee !== 'describe') unfailing(body, text, innerAt, innerAt + inner.length, where, result.problems);
    if (!skipped && callee !== 'describe' && inner !== null && /^(?:return\s*;?)*$/.test(inner.replace(/\s+/g, ' ').trim())) {
      result.problems.push(`${where}: the test "${literal.dynamic ? literal.prefix : literal.value}" asserts nothing: its body is empty or only returns`);
    }
    found.push({ index: m.index, end: close, name: literal.dynamic ? literal.prefix : literal.value, skipped, describe: callee === 'describe' });
  }
  const hidden_ = found.filter((f) => f.describe && f.skipped);
  for (const f of found) {
    if (f.describe) continue;
    const inside = hidden_.some((d) => f.index > d.index && f.index < d.end);
    if (f.skipped || inside) result.skipped.push(`${file}: ${f.name}`);
    else result.tests.push({ file, name: f.name });
  }
  const hook = /(?<![\w$.])(beforeEach|afterEach|before|after)\s*\(/g;
  for (let m = hook.exec(body); m !== null; m = hook.exec(body)) {
    const open = m.index + m[0].length - 1;
    if (/\b(assert|expectBroken)\b/.test(body.slice(open, matching(body, open, '(', ')')))) result.problems.push(`${file}:${lineOf(text, m.index)}: an assertion in ${m[1]}() counts for no test`);
  }
  const timer = /(?<![\w$])(setTimeout|setInterval|setImmediate|queueMicrotask|nextTick)\s*\(/g;
  for (let m = timer.exec(body); m !== null; m = timer.exec(body)) {
    const open = m.index + m[0].length - 1;
    if (/\b(assert|expectBroken)\b/.test(body.slice(open, matching(body, open, '(', ')')))) result.problems.push(`${file}:${lineOf(text, m.index)}: an assertion in the callback of ${m[1]}() may run after its test has ended`);
    else {
      const callback = /^\s*([A-Za-z_$][\w$]*)\s*[,.)]/.exec(body.slice(open + 1))?.[1];
      if (callback !== undefined && !['function', 'async', 'new', 'await'].includes(callback) && /\b(assert|expectBroken)\b/.test(definitionOf(body, callback))) {
        result.problems.push(`${file}:${lineOf(text, m.index)}: an assertion in ${callback}, the callback of ${m[1]}(), may run after its test has ended`);
      }
    }
  }
  const alias = /(?<![\w$.])=\s*(test|it|describe)\s*[;,\n)]/g;
  for (let m = alias.exec(body); m !== null; m = alias.exec(body)) result.problems.push(`${file}:${lineOf(text, m.index)}: ${m[1]} is assigned to another name, so calls through it cannot be read`);
  return result;
}

export function testFilesOfRunner(repo: URL): TextFile[] {
  const dirs = [...new Set([...Object.values(COMMIT_GROUPS).flat(), ...Object.values(NIGHTLY_GROUPS).flat()])];
  const paths = [...setFiles('commit', dirs), ...setFiles('nightly', dirs)];
  return paths.map((path) => ({ path, text: readFileSync(new URL(path, repo), 'utf8') })).sort((a, b) => (a.path < b.path ? -1 : 1));
}

function markdownUnder(root: URL, prefix: string): TextFile[] {
  const out: TextFile[] = [];
  const walk = (dir: URL, at: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir), `${at}${entry.name}/`);
      else if (entry.name.endsWith('.md')) out.push({ path: `${at}${entry.name}`, text: readFileSync(new URL(entry.name, dir), 'utf8') });
    }
  };
  if (existsSync(root)) walk(root, prefix);
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

export function loadInputs(repo: URL, sectionOnly: number): Inputs {
  return {
    specs: [{ path: 'design/promises.md', text: readFileSync(new URL('design/promises.md', repo), 'utf8') }],
    docs: markdownUnder(new URL('docs/', repo), 'docs/'),
    questions: readFileSync(new URL('design/decisions.md', repo), 'utf8'),
    sections: readFileSync(new URL('tests/README.md', repo), 'utf8'),
    tests: testFilesOfRunner(repo),
    sectionOnly,
    harness: Object.keys(INVARIANTS),
  };
}

const SOURCE = {
  invariant: /\bI-[a-z]+-\d+\b/g,
  harness: /(?<![\w-])harness-(?:\d+|count)(?![\w-])/g,
  finding: /\b(?:S\d+-\d+|U-\d+|R-\d+|T[1-8])\b/g,
  section: /\b([a-z][a-z/-]*) §([\w.]+)/g,
  question: /\bquestion (\d+)\b/g,
};

export function sourcesOf(name: string): { rows: number[]; invariants: string[]; harness: string[]; findings: string[]; sections: [string, string][]; questions: number[] } {
  const lead = /^tests? (\d+(?:(?:,\s*|\s+and\s+|,\s+and\s+)\d+)*):/.exec(name);
  return {
    rows: lead === null ? [] : lead[1]!.match(/\d+/g)!.map(Number),
    invariants: name.match(SOURCE.invariant) ?? [],
    harness: name.match(SOURCE.harness) ?? [],
    findings: name.match(SOURCE.finding) ?? [],
    sections: [...name.matchAll(SOURCE.section)].map((m) => [m[1]!, m[2]!]),
    questions: [...name.matchAll(SOURCE.question)].map((m) => Number(m[1])),
  };
}

export function questionNumbers(questions: string): Set<number> {
  return new Set([...questions.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1])));
}

// The section labels of the first design, as the table of tests/README.md lists them: its first column, `<slice> §<n>`.
export function sectionLabels(readme: string): Set<string> {
  const out = new Set<string>();
  for (const table of tablesOf(readme)) for (const row of table.rows) {
    const label = /^([a-z][a-z/-]*) §([\w.]+)$/.exec(firstCell(row));
    if (label) out.add(`${label[1]} §${label[2]}`);
  }
  return out;
}

// Decisions 95 and 160 of design/decisions.md say that no feature of the tool describes what their tests check, the suite's own machinery and the repository's own law, so no row can ever carry those tests: one that cites only its entry, in the files of that machinery, is outside the count of tests that cite only a section.
export const NO_ROW_QUESTIONS: Record<number, RegExp> = { 95: /^tests\/(contract|guard|sabotage)\//, 160: /^tests\/acceptance\/self-law[\w-]*\.test\.ts$/ };

export function problemsOf(input: Inputs): string[] {
  const problems: string[] = [];
  for (const spec of input.specs) problems.push(...rowsOf(spec).problems);

  const invariants: Invariant[] = [];
  for (const file of [...input.specs, ...input.docs]) {
    const read = invariantsOf(file);
    invariants.push(...read.invariants);
    problems.push(...read.problems);
  }
  const invariantIds = new Set<string>();
  for (const invariant of invariants) {
    if (invariantIds.has(invariant.id)) problems.push(`invariant ${invariant.id} is used twice (again in ${invariant.spec})`);
    invariantIds.add(invariant.id);
  }

  const tests: TestName[] = [];
  for (const file of input.tests) {
    const scanned = scanTests(file.path, file.text);
    tests.push(...scanned.tests);
    problems.push(...scanned.problems);
  }
  const names = new Set<string>();
  for (const t of tests) {
    if (names.has(`${t.file}\n${t.name}`)) problems.push(`${t.file}: the name "${t.name}" is used by two tests of one file`);
    names.add(`${t.file}\n${t.name}`);
  }
  const questions = questionNumbers(input.questions);
  const sections = sectionLabels(input.sections);

  const named = new Set<string>();
  let sectionOnly = 0;
  for (const { file, name } of tests) {
    const source = sourcesOf(name);
    const where = `${file}: "${name}"`;
    let known = source.rows.length + source.findings.length;
    let strong = known;
    for (const id of source.invariants) {
      named.add(id);
      if (invariantIds.has(id)) known++, strong++;
      else problems.push(`${where} names invariant ${id}, which is not in design/promises.md`);
    }
    for (const id of source.harness) {
      named.add(id);
      if (input.harness.includes(id)) known++, strong++;
      else problems.push(`${where} names ${id}, which is no invariant of tests/harness/invariants.ts`);
    }
    for (const [stem, section] of source.sections) {
      if (sections.has(`${stem} §${section}`)) known++;
      else problems.push(`${where} names ${stem} §${section}, which the table of tests/README.md does not list`);
    }
    for (const number of source.questions) {
      if (questions.has(number)) known++;
      else problems.push(`${where} names question ${number}, which is not in design/decisions.md`);
    }
    if (known === 0) problems.push(`${where} names no source: a test number, a promise id, a finding id, a section or a decision`);
    else if (!leadsWithSource(name)) problems.push(`${where} does not lead with its source`);
    const noRow = source.sections.length === 0 && source.questions.length > 0 && source.questions.every((q) => NO_ROW_QUESTIONS[q]?.test(file) === true);
    if (known > 0 && strong === 0 && !noRow) sectionOnly++;
  }
  for (const invariant of invariants) {
    if (!named.has(invariant.id)) problems.push(`invariant ${invariant.id} of ${invariant.spec} has no test with its id in the name`);
  }
  for (const id of input.harness) {
    if (!named.has(id)) problems.push(`harness invariant ${id} has no test with its id in the name`);
  }
  if (sectionOnly > input.sectionOnly) problems.push(`${sectionOnly} tests cite only a section or a decision, and the ratchet allows ${input.sectionOnly}: a new test names a test number, a promise id or a finding id`);
  if (sectionOnly < input.sectionOnly) problems.push(`${sectionOnly} tests cite only a section or a decision, and the ratchet still says ${input.sectionOnly}: lower SECTION_ONLY_TESTS in tests/numbers.ts`);
  return problems;
}
