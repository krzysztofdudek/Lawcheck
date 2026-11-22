import { invariantsOf, questionNumbers, scanTests, sectionLabels, sourcesOf } from './spec-map.ts';
import type { Inputs } from './spec-map.ts';

export interface Ran {
  file: string;
  name: string;
}

function carried(name: string): string[] {
  const source = sourcesOf(name);
  const lead = /^(S\d+-\d+|U-\d+|R-\d+|T[1-8])(?![\w-])/.exec(name)?.[1];
  return [...source.rows.map((n) => `test ${n}`), ...source.invariants, ...source.harness, ...(lead !== undefined ? [lead] : [])];
}

// What a name of a test that ran cites must exist: a template name holds its ids after the run, which the static scan cannot read.
export function namesProblems(input: Inputs, ran: Ran[]): string[] {
  const invariants = new Set([...input.specs, ...input.docs].flatMap((f) => invariantsOf(f).invariants.map((i) => i.id)));
  const questions = questionNumbers(input.questions);
  const sections = sectionLabels(input.sections);
  const problems: string[] = [];
  for (const { file, name } of ran) {
    const source = sourcesOf(name);
    const where = `${file}: ${name}`;
    for (const id of source.invariants) if (!invariants.has(id)) problems.push(`${where} names invariant ${id}, which is not in design/promises.md`);
    for (const id of source.harness) if (!input.harness.includes(id)) problems.push(`${where} names ${id}, which is no harness invariant`);
    for (const n of source.questions) if (!questions.has(n)) problems.push(`${where} names question ${n}, which is not in design/decisions.md`);
    for (const [stem, section] of source.sections) if (!sections.has(`${stem} §${section}`)) problems.push(`${where} names ${stem} §${section}, which the table of tests/README.md does not list`);
  }
  return problems;
}

// A test number, a promise, a harness invariant or a finding that leads the name of a test of the files of this run is covered only when a test that carries it ran and passed in this run: one that was skipped or failed is not in `ran`. A test left whole by a listed platform skip of this system (`excused`) covers nothing either, but an id that only such tests carry is no failure of the run on that system.
export function tieProblems(input: Inputs, files: string[], ran: Ran[], excused: Ran[] = []): string[] {
  const wanted = new Map<string, { file: string; name: string }[]>();
  for (const file of input.tests.filter((f) => files.includes(f.path))) {
    for (const test of scanTests(file.path, file.text).tests) {
      for (const id of carried(test.name)) wanted.set(id, [...(wanted.get(id) ?? []), { file: test.file, name: test.name }]);
    }
  }
  const got = new Set(ran.flatMap((r) => carried(r.name)));
  const problems: string[] = [];
  for (const [id, names] of [...wanted].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (got.has(id) || names.every((n) => excused.some((e) => e.file === n.file && e.name === n.name))) continue;
    problems.push(`${id} is carried by ${names.length === 1 ? 'a test' : `${names.length} tests`} of this run and none of them ran and passed: ${names.slice(0, 3).map((n) => `${n.file}: ${n.name}`).join('; ')}`);
  }
  return [...problems, ...namesProblems(input, ran)];
}
