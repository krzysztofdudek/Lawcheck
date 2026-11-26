import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMIT_GROUPS, groupDirs, NIGHTLY_GROUPS, ROOT, setFiles } from './sets.ts';
import type { Speed } from '../numbers.ts';

export const ID = /^(tests? \d+|I-[a-z][a-z0-9]*-\d+|S\d+-\d+|U-\d+|R-\d+|T[1-8])$/;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function idPattern(id: string): string {
  const row = /^tests? (\d+)$/.exec(id);
  if (row !== null) return `/^tests? (\\d+(, | and ))*${row[1]}(?!\\d)/`;
  return `/(^|[^\\w-])${escape(id)}([^\\w-]|$)/`;
}

export function holding(files: string[], id: string): string[] {
  const needle = new RegExp(idPattern(id).slice(1, -1).replace('^', "(^|['`])"));
  return files.filter((file) => needle.test(readFileSync(join(ROOT, file), 'utf8')));
}

export function chosenTests(value: string): string[] {
  return value.split(',').map((id) => id.trim().replace(/^tests /, 'test ')).filter((id) => id !== '');
}

export function everyTestFile(): string[] {
  return (['commit', 'nightly'] as const).flatMap((speed) => setFiles(speed, [...new Set(Object.values(speed === 'nightly' ? NIGHTLY_GROUPS : COMMIT_GROUPS).flat())]));
}

// What each job of nightly.yml runs: a set, and its group, or null for the whole set. tests/contract/nightly-chosen.test.ts holds this to the workflow.
export const NIGHTLY_JOBS: Record<string, { speed: Exclude<Speed, 'loop'>; group: string | null }> = {
  commit: { speed: 'commit', group: null },
  shuffle: { speed: 'commit', group: null },
  properties: { speed: 'nightly', group: 'properties' },
  limits: { speed: 'nightly', group: 'limits' },
  environments: { speed: 'nightly', group: 'environments' },
  deadlines: { speed: 'nightly', group: 'deadlines' },
  sabotage: { speed: 'nightly', group: 'sabotage' },
};

export const SEVERAL_SYSTEMS = ['commit', 'deadlines'];

// A job left out is skipped and a step without a chosen test runs nothing, and GitHub shows both without a red, so a name that matches nothing has to be refused here.
export function inputProblems(jobs: string, tests: string, os: string): string[] {
  const names = Object.keys(NIGHTLY_JOBS);
  const problems: string[] = [];
  const asked = jobs === '' ? [] : jobs.split(',');
  for (const job of asked) if (!names.includes(job)) problems.push(`jobs: there is no job '${job}'; name any of ${names.join(',')}, comma separated with no spaces`);
  const chosen = jobs === '' ? names : asked.filter((job) => names.includes(job));
  if (os !== '' && os !== 'all' && !chosen.some((job) => SEVERAL_SYSTEMS.includes(job))) problems.push(`os: only the jobs ${SEVERAL_SYSTEMS.join(' and ')} run on several systems, and none of them is chosen`);
  const ids = chosenTests(tests);
  if (tests !== '' && ids.length === 0) problems.push('tests: it names no test id');
  if (ids.length === 0) return problems;
  if (jobs === '') return [...problems, 'tests: name the jobs that hold the tests too, with -f jobs=<job>,<job>'];
  const held = new Set<string>();
  for (const job of chosen) {
    const { speed, group } = NIGHTLY_JOBS[job]!;
    const files = setFiles(speed, groupDirs(speed, group)!);
    const inside = ids.filter((id) => ID.test(id) && holding(files, id).length > 0);
    if (inside.length === 0) problems.push(`tests: the job ${job} holds none of ${ids.join(', ')}`);
    for (const id of inside) held.add(id);
  }
  for (const id of ids) {
    if (!ID.test(id)) problems.push(`tests: '${id}' is not a test id, such as test 251, R-73 or S2-5`);
    else if (!held.has(id)) problems.push(`tests: no chosen job holds a test named ${id}`);
  }
  return problems;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { LAWCHECK_JOBS: jobs = '', LAWCHECK_ONLY: tests = '', LAWCHECK_OS: os = '' } = process.env;
  const problems = inputProblems(jobs, tests, os);
  for (const problem of problems) process.stdout.write(`::error::${problem}\n`);
  if (problems.length > 0) process.exit(1);
  process.stdout.write(`chosen: jobs ${jobs || 'all'}, tests ${tests || 'all'}, os ${os || 'all'}\n`);
}
