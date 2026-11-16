import { carries, headingsOf, ledgerRows, questionNumbers, rowsOf, invariantsOf, scanTests, sourcesOf } from './spec-map.ts';
import type { Inputs } from './spec-map.ts';

export interface Ran {
  file: string;
  name: string;
}

function closedOf(input: Inputs): Set<string> {
  return new Set(ledgerRows(input.ledger).filter((r) => r.state === 'closed').map((r) => r.id));
}

function carried(name: string, closed: Set<string>): string[] {
  const source = sourcesOf(name);
  const lead = /^(S\d+-\d+|U-\d+|R-\d+|T[1-8])(?![\w-])/.exec(name)?.[1];
  return [...source.rows.map((n) => `test ${n}`), ...source.invariants, ...source.harness, ...(lead !== undefined && closed.has(lead) ? [lead] : [])];
}

// What a name of a test that ran cites must exist: a template name holds its ids after the run, which the static scan cannot read.
export function namesProblems(input: Inputs, ran: Ran[]): string[] {
  const invariants = new Set([...input.specs, ...input.docs].flatMap((f) => invariantsOf(f).invariants.map((i) => i.id)));
  const rows = new Set(input.specs.flatMap((f) => rowsOf(f).rows.map((r) => r.number)));
  const findings = new Set(ledgerRows(input.ledger).map((r) => r.id));
  const questions = questionNumbers(input.questions);
  const headings = new Map(input.specs.map((s) => [s.path.slice('spec/'.length, -'.md'.length), headingsOf(s.text)]));
  const problems: string[] = [];
  for (const { file, name } of ran) {
    const source = sourcesOf(name);
    const where = `${file}: ${name}`;
    for (const n of source.rows) if (!rows.has(n)) problems.push(`${where} names test ${n}, which is in no spec table`);
    for (const id of source.invariants) if (!invariants.has(id)) problems.push(`${where} names invariant ${id}, which is in no spec table`);
    for (const id of source.harness) if (!input.harness.includes(id)) problems.push(`${where} names ${id}, which is no harness invariant`);
    for (const id of source.findings) if (!findings.has(id)) problems.push(`${where} names finding ${id}, which is not in tests/findings.md`);
    for (const n of source.questions) if (!questions.has(n)) problems.push(`${where} names question ${n}, which is not in spec/questions.md`);
    for (const [stem, section] of source.sections) {
      const list = headings.get(stem);
      if (list === undefined || !list.some((h) => h === section || h.startsWith(`${section}. `) || h.startsWith(`${section} `) || h.startsWith(`${section}:`))) problems.push(`${where} names ${stem} §${section}, which is no heading of that spec`);
    }
  }
  return problems;
}

// A row, an invariant or a closed finding that a test of the files of this run carries is covered only when a test that carries it ran and passed in this run: one that was skipped or failed is not in `ran`. A test left whole by a listed platform skip of this system (`excused`) covers nothing either, but an id that only such tests carry is no failure of the run on that system.
export function tieProblems(input: Inputs, files: string[], ran: Ran[], excused: Ran[] = []): string[] {
  const closed = closedOf(input);
  const wanted = new Map<string, { file: string; name: string }[]>();
  for (const file of input.tests.filter((f) => files.includes(f.path))) {
    for (const test of scanTests(file.path, file.text).tests) {
      for (const id of carried(test.name, closed)) wanted.set(id, [...(wanted.get(id) ?? []), { file: test.file, name: test.name }]);
    }
  }
  const got = new Set(ran.flatMap((r) => carried(r.name, closed)));
  const problems: string[] = [];
  for (const [id, names] of [...wanted].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (got.has(id) || names.every((n) => excused.some((e) => e.file === n.file && e.name === n.name))) continue;
    problems.push(`${id} is carried by ${names.length === 1 ? 'a test' : `${names.length} tests`} of this run and none of them ran and passed: ${names.slice(0, 3).map((n) => `${n.file}: ${n.name}`).join('; ')}`);
  }
  for (const id of closed) {
    const row = ledgerRows(input.ledger).find((r) => r.id === id)!;
    const named = /^(tests\/[^\s:]+): (.+)$/.exec(row.test);
    const holds = (t: Ran) => t.file === named![1] && t.name.includes(named![2]!) && carries(t.name, id);
    if (named !== null && files.includes(named[1]!) && !ran.some(holds) && !excused.some(holds)) {
      problems.push(`the closed row ${id} names its test as "${named[2]}" in ${named[1]}, and no test with that in its name ran and passed in this run`);
    }
  }
  return [...problems, ...namesProblems(input, ran)];
}
