import { readdirSync, readFileSync } from 'node:fs';

export interface Row {
  number: number;
  spec: string;
}

export interface Invariant {
  id: string;
  spec: string;
}

export interface SpecFile {
  stem: string;
  text: string;
}

export interface TestName {
  file: string;
  name: string;
}

export interface Inputs {
  specs: SpecFile[];
  questions: string;
  tests: TestName[];
  manual: string;
  ledger: string;
}

const CELL = /^\|\s*`?([^|`]*?)`?\s*\|/;

export function rowsOf(spec: SpecFile): Row[] {
  const rows: Row[] = [];
  let inside = false;
  for (const line of spec.text.split('\n')) {
    if (/^\|\s*#\s*\|/.test(line)) inside = true;
    else if (!line.startsWith('|')) inside = false;
    else if (inside) {
      const cell = CELL.exec(line)?.[1] ?? '';
      if (/^\d+$/.test(cell)) rows.push({ number: Number(cell), spec: spec.stem });
    }
  }
  return rows;
}

export function invariantsOf(spec: SpecFile): Invariant[] {
  const out: Invariant[] = [];
  for (const line of spec.text.split('\n')) {
    const cell = line.startsWith('|') ? (CELL.exec(line)?.[1] ?? '') : '';
    if (/^I-[a-z]+-\d+$/.test(cell)) out.push({ id: cell, spec: spec.stem });
  }
  return out;
}

export function headingsOf(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const match = /^#{2,4}\s+(.*?)\s*$/.exec(line);
    if (match) out.push(match[1]!);
  }
  return out;
}

export function ledgerIds(ledger: string): string[] {
  const out: string[] = [];
  for (const line of ledger.split('\n')) {
    const cell = line.startsWith('|') ? (CELL.exec(line)?.[1] ?? '') : '';
    if (/^(S\d+-\d+|U-\d+|R-\d+)$/.test(cell)) out.push(cell);
  }
  return out;
}

export function testNames(file: string, text: string): TestName[] {
  const out: TestName[] = [];
  const call = /(?<![\w.])(?:test|it)(?:\.\w+)?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1|\bt\.test\(\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/g;
  for (let match = call.exec(text); match !== null; match = call.exec(text)) {
    out.push({ file, name: (match[2] ?? match[4]!).replace(/\\(['"`\\])/g, '$1') });
  }
  return out;
}

export function testFiles(root: URL): string[] {
  const out: string[] = [];
  const walk = (dir: URL, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.test.ts')) out.push(`${prefix}${entry.name}`);
    }
  };
  walk(root, '');
  return out.sort();
}

export function loadInputs(repo: URL): Inputs {
  const specDir = new URL('spec/', repo);
  const specs = readdirSync(specDir)
    .filter((f) => f.endsWith('.md') && f !== 'questions.md')
    .sort()
    .map((f) => ({ stem: f.slice(0, -3), text: readFileSync(new URL(f, specDir), 'utf8') }));
  const testsDir = new URL('tests/', repo);
  const tests = testFiles(testsDir).flatMap((f) => testNames(`tests/${f}`, readFileSync(new URL(f, testsDir), 'utf8')));
  return {
    specs,
    questions: readFileSync(new URL('questions.md', specDir), 'utf8'),
    tests,
    manual: readFileSync(new URL('contract/manual-rows.md', testsDir), 'utf8'),
    ledger: readFileSync(new URL('findings.md', testsDir), 'utf8'),
  };
}

const SOURCE = {
  rows: /\btests? (\d+(?:(?:,\s*|\s+and\s+|,\s+and\s+)\d+)*)/g,
  invariant: /\bI-[a-z]+-\d+\b/g,
  finding: /\b(?:S\d+-\d+|U-\d+|R-\d+)\b/g,
  section: /\b([a-z]+(?:-[a-z]+)*) §([\w.]+)/g,
  question: /\bquestion (\d+)\b/g,
};

export function sourcesOf(name: string): { rows: number[]; invariants: string[]; findings: string[]; sections: [string, string][]; questions: number[] } {
  return {
    rows: [...name.matchAll(SOURCE.rows)].flatMap((m) => m[1]!.match(/\d+/g)!.map(Number)),
    invariants: name.match(SOURCE.invariant) ?? [],
    findings: name.match(SOURCE.finding) ?? [],
    sections: [...name.matchAll(SOURCE.section)].map((m) => [m[1]!, m[2]!]),
    questions: [...name.matchAll(SOURCE.question)].map((m) => Number(m[1])),
  };
}

export function problemsOf(input: Inputs): string[] {
  const problems: string[] = [];
  const rows = input.specs.flatMap(rowsOf);
  const rowNumbers = new Set<number>();
  for (const row of rows) {
    if (rowNumbers.has(row.number)) problems.push(`row ${row.number} is used twice (again in ${row.spec})`);
    rowNumbers.add(row.number);
  }
  const manual = rowsOf({ stem: 'manual-rows', text: input.manual });
  const manualNumbers = new Set<number>();
  for (const row of manual) {
    if (manualNumbers.has(row.number)) problems.push(`row ${row.number} is listed twice in the rows no test carries`);
    manualNumbers.add(row.number);
    if (!rowNumbers.has(row.number)) problems.push(`row ${row.number} is listed in the rows no test carries and is in no spec table`);
  }
  const invariants = input.specs.flatMap(invariantsOf);
  const invariantIds = new Set<string>();
  for (const invariant of invariants) {
    if (invariantIds.has(invariant.id)) problems.push(`invariant ${invariant.id} is used twice (again in ${invariant.spec})`);
    invariantIds.add(invariant.id);
  }
  const findings = new Set(ledgerIds(input.ledger));
  const headings = new Map(input.specs.map((s) => [s.stem, headingsOf(s.text)]));
  const questionNumbers = new Set([...input.questions.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1])));

  const carried = new Set<number>();
  const named = new Set<string>();
  for (const { file, name } of input.tests) {
    const source = sourcesOf(name);
    const where = `${file}: "${name}"`;
    let known = 0;
    for (const number of source.rows) {
      carried.add(number);
      if (rowNumbers.has(number)) known++;
      else problems.push(`${where} names test ${number}, which is in no spec table`);
      if (manualNumbers.has(number)) problems.push(`${where} carries row ${number}, which the rows no test carries list`);
    }
    for (const id of source.invariants) {
      named.add(id);
      if (invariantIds.has(id)) known++;
      else problems.push(`${where} names invariant ${id}, which is in no spec table`);
    }
    for (const id of source.findings) {
      if (findings.has(id)) known++;
      else problems.push(`${where} names finding ${id}, which is not in tests/findings.md`);
    }
    for (const [stem, section] of source.sections) {
      const list = headings.get(stem);
      if (list !== undefined && list.some((h) => h === section || h.startsWith(`${section}. `) || h.startsWith(`${section} `) || h.startsWith(`${section}:`))) known++;
      else problems.push(`${where} names ${stem} §${section}, which is no heading of that spec`);
    }
    for (const number of source.questions) {
      if (questionNumbers.has(number)) known++;
      else problems.push(`${where} names question ${number}, which is not in spec/questions.md`);
    }
    if (known === 0) problems.push(`${where} names no source: a spec row, an invariant id, a finding id, a spec section or a question`);
  }
  for (const row of rows) {
    if (!carried.has(row.number) && !manualNumbers.has(row.number)) problems.push(`row ${row.number} of ${row.spec} has no test`);
  }
  for (const invariant of invariants) {
    if (!named.has(invariant.id)) problems.push(`invariant ${invariant.id} of ${invariant.spec} has no test with its id in the name`);
  }
  return problems;
}
