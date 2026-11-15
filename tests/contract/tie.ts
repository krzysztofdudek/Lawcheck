import { scanTests, sourcesOf } from './spec-map.ts';
import type { Inputs } from './spec-map.ts';

export interface Ran {
  file: string;
  name: string;
}

function carried(name: string): string[] {
  const source = sourcesOf(name);
  return [...source.rows.map((n) => `test ${n}`), ...source.invariants, ...source.harness];
}

// A row or an invariant that a test of the files of this run carries is covered only when a test that carries it ran and passed in this run: one that was skipped or failed is not in `ran`. A test left whole by a listed platform skip of this system (`excused`) covers nothing either, but a row that only such tests carry is not a failure of the run on that system.
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
  return problems;
}
