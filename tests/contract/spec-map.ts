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
  tests: TextFile[];
  manual: string;
  ledger: string;
  sectionOnly: number;
  harness: string[];
  stress: Record<number, number>;
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

export function headingsOf(text: string): string[] {
  const out: string[] = [];
  for (const { line } of outsideFences(text)) {
    const match = /^#{2,4}\s+(.*?)\s*$/.exec(line);
    if (match) out.push(match[1]!);
  }
  return out;
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
  const testsDir = new URL('tests/', repo);
  return {
    specs: markdownUnder(new URL('spec/', repo), 'spec/'),
    docs: markdownUnder(new URL('docs/', repo), 'docs/'),
    questions: readFileSync(new URL('spec/questions.md', repo), 'utf8'),
    tests: testFilesOfRunner(repo),
    manual: readFileSync(new URL('contract/manual-rows.md', testsDir), 'utf8'),
    ledger: readFileSync(new URL('findings.md', testsDir), 'utf8'),
    sectionOnly,
    harness: Object.keys(INVARIANTS),
    stress: STRESS_FINDINGS,
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

export const SEVERITIES = ['blocks the release', 'should be fixed before', 'after the release'];
export const PACKAGES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'P', 'after alpha'];
export const STATES = ['open', 'limit', 'runes-limit', 'closed'];

// The findings of the stress reports 1 to 8, as each report numbers them: no row of these may go.
export const STRESS_FINDINGS: Record<number, number> = { 1: 15, 2: 8, 3: 9, 4: 11, 5: 16, 6: 10, 7: 16, 8: 8 };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A test carries a finding when the finding's id is its own source, at the start of its name: a mention after another source ties nothing.
export const carries = (name: string, id: string): boolean => new RegExp(`^${escape(id)}(?![\\w-])`).test(name);

export function ledgerProblems(ledger: string, tests: TestName[], questions: Set<number>, files: Map<string, string> = new Map(), stress: Record<number, number> = {}): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const rows = ledgerRows(ledger);
  if (rows.length === 0) problems.push('the ledger holds no rows');
  if (!tablesOf(ledger).some((t) => firstCell(t.header) === 'id')) problems.push('the ledger has no table headed id');
  for (const [report, count] of Object.entries(stress)) {
    for (let n = 1; n <= count; n++) if (!rows.some((r) => r.id === `S${report}-${n}`)) problems.push(`the finding S${report}-${n} of the stress reports has no row in the ledger`);
  }
  for (const row of rows) {
    const at = `ledger ${row.id}`;
    if (!/^(S[1-8]-\d+|U-\d+|R-\d+|T[1-8])$/.test(row.id)) problems.push(`${at}: the id is not S<report>-<n>, U-<n>, R-<n> or T<n>`);
    if (seen.has(row.id)) problems.push(`${at}: the id is used twice`);
    seen.add(row.id);
    if (!SEVERITIES.includes(row.severity)) problems.push(`${at}: severity "${row.severity}" is not one of ${SEVERITIES.join(', ')}`);
    if (!/^(-|\d(, \d)*)$/.test(row.layer)) problems.push(`${at}: layer "${row.layer}" is not - or layers 0 to 9`);
    if (!PACKAGES.includes(row.package)) problems.push(`${at}: package "${row.package}" is not one of ${PACKAGES.join(', ')}`);
    if (row.severity !== 'after the release' && row.package === 'after alpha') problems.push(`${at}: a finding that blocks or should be fixed before needs a package`);
    if (!['yes', 'no'].includes(row.runes)) problems.push(`${at}: Runes cause "${row.runes}" is not yes or no`);
    if (row.defect === '') problems.push(`${at}: the defect is empty`);
    const question = /^question (\d+)$/.exec(row.state);
    if (question !== null) {
      if (!questions.has(Number(question[1]))) problems.push(`${at}: state points to question ${question[1]}, which is not in spec/questions.md`);
    } else if (!STATES.includes(row.state)) problems.push(`${at}: state "${row.state}" is not one of ${STATES.join(', ')} or "question <n>"`);
    if (row.runes === 'yes' && row.state !== 'runes-limit' && row.state !== 'closed') problems.push(`${at}: a Runes cause is state runes-limit`);
    if (row.state === 'runes-limit' && row.runes !== 'yes') problems.push(`${at}: state runes-limit needs a Runes cause`);
    for (const m of `${row.defect} ${row.test} ${row.generalised}`.matchAll(/\bquestion (\d+)\b/g)) {
      if (!questions.has(Number(m[1]))) problems.push(`${at}: names question ${m[1]}, which is not in spec/questions.md`);
    }
    if (row.state === 'closed' || row.state === 'limit') {
      const named = /^(tests\/[^\s:]+): (.+)$/.exec(row.test);
      if (named === null) problems.push(`${at}: a ${row.state} row names its test as "<file>: <fragment>"`);
      else if (!tests.some((t) => t.file === named[1] && t.name.includes(named[2]!) && carries(t.name, row.id))) problems.push(`${at}: no test of ${named[1]} holds "${named[2]}" in its name and carries ${row.id} as a whole id`);
    }
    if (row.state === 'limit') {
      const stated = /\bstated in ((?:spec|docs)\/[\w./-]+\.md): "([^"]+)"/.exec(row.generalised);
      const squash = (t: string) => t.replace(/\s+/g, ' ');
      if (stated === null) problems.push(`${at}: a limit row says where the limit is stated, as stated in spec/<file>.md: "<words of the limit>", in the column generalised by`);
      else if (!files.has(stated[1]!)) problems.push(`${at}: the file ${stated[1]} that states the limit does not exist`);
      else if (!squash(files.get(stated[1]!)!).includes(squash(stated[2]!))) problems.push(`${at}: ${stated[1]} does not hold the words "${stated[2]}" of the limit`);
    }
  }
  return problems;
}

export function problemsOf(input: Inputs): string[] {
  const problems: string[] = [];
  const rows: Row[] = [];
  for (const spec of input.specs) {
    const read = rowsOf(spec);
    rows.push(...read.rows);
    problems.push(...read.problems);
  }
  const rowNumbers = new Set<number>();
  for (const row of rows) {
    if (rowNumbers.has(row.number)) problems.push(`row ${row.number} is used twice (again in ${row.spec})`);
    rowNumbers.add(row.number);
  }

  const manualNumbers = new Set<number>();
  for (const table of tablesOf(input.manual)) {
    if (firstCell(table.header) !== '#') continue;
    for (const line of table.rows) {
      const c = cells(line);
      if (!/^\d+$/.test(c[0]!)) {
        problems.push(`the rows no test carries: "${c[0]}" is not a plain integer`);
        continue;
      }
      const number = Number(c[0]);
      if (manualNumbers.has(number)) problems.push(`row ${number} is listed twice in the rows no test carries`);
      manualNumbers.add(number);
      if (!rowNumbers.has(number)) problems.push(`row ${number} is listed in the rows no test carries and is in no spec table`);
      if ((c[1] ?? '').length < 8) problems.push(`row ${number} is listed in the rows no test carries without a reason`);
      if ((c[2] ?? '').length < 3) problems.push(`row ${number} is listed in the rows no test carries without an owner`);
    }
  }

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
  problems.push(...ledgerProblems(input.ledger, tests, questions, new Map([...input.specs, ...input.docs].map((f) => [f.path, f.text])), input.stress));
  const findings = new Set(ledgerRows(input.ledger).map((r) => r.id));
  const headings = new Map(input.specs.filter((s) => s.path.startsWith('spec/')).map((s) => [s.path.slice('spec/'.length, -'.md'.length), headingsOf(s.text)]));

  const carried = new Set<number>();
  const named = new Set<string>();
  let sectionOnly = 0;
  for (const { file, name } of tests) {
    const source = sourcesOf(name);
    const where = `${file}: "${name}"`;
    let known = 0;
    let strong = 0;
    for (const number of source.rows) {
      carried.add(number);
      if (rowNumbers.has(number)) known++, strong++;
      else problems.push(`${where} names test ${number}, which is in no spec table`);
      if (manualNumbers.has(number)) problems.push(`${where} carries row ${number}, which the rows no test carries list`);
    }
    for (const id of source.invariants) {
      named.add(id);
      if (invariantIds.has(id)) known++, strong++;
      else problems.push(`${where} names invariant ${id}, which is in no spec table`);
    }
    for (const id of source.harness) {
      named.add(id);
      if (input.harness.includes(id)) known++, strong++;
      else problems.push(`${where} names ${id}, which is no invariant of tests/harness/invariants.ts`);
    }
    for (const id of source.findings) {
      if (findings.has(id)) known++, strong++;
      else problems.push(`${where} names finding ${id}, which is not in tests/findings.md`);
    }
    for (const [stem, section] of source.sections) {
      const list = headings.get(stem);
      if (list !== undefined && list.some((h) => h === section || h.startsWith(`${section}. `) || h.startsWith(`${section} `) || h.startsWith(`${section}:`))) known++;
      else problems.push(`${where} names ${stem} §${section}, which is no heading of that spec`);
    }
    for (const number of source.questions) {
      if (questions.has(number)) known++;
      else problems.push(`${where} names question ${number}, which is not in spec/questions.md`);
    }
    if (known === 0) problems.push(`${where} names no source: a spec row, an invariant id, a finding id, a spec section or a question`);
    else if (!leadsWithSource(name)) problems.push(`${where} does not lead with its source`);
    if (known > 0 && strong === 0) sectionOnly++;
  }
  for (const row of rows) {
    if (!carried.has(row.number) && !manualNumbers.has(row.number)) problems.push(`row ${row.number} of ${row.spec} has no test`);
  }
  for (const invariant of invariants) {
    if (!named.has(invariant.id)) problems.push(`invariant ${invariant.id} of ${invariant.spec} has no test with its id in the name`);
  }
  for (const id of input.harness) {
    if (!named.has(id)) problems.push(`harness invariant ${id} has no test with its id in the name`);
  }
  if (sectionOnly > input.sectionOnly) problems.push(`${sectionOnly} tests cite only a spec section or a question, and the ratchet allows ${input.sectionOnly}: a new test names a row, an invariant id or a finding id`);
  if (sectionOnly < input.sectionOnly) problems.push(`${sectionOnly} tests cite only a spec section or a question, and the ratchet still says ${input.sectionOnly}: lower SECTION_ONLY_TESTS in tests/numbers.ts`);
  return problems;
}
