import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const TESTS = join(ROOT, 'tests');

export const COMMIT_GROUPS: Record<string, string[]> = {
  core: ['unit', 'acceptance', 'contract', 'guard'],
  inputs: ['properties', 'security', 'limits'],
  environments: ['environments'],
  gate: ['gate'],
};

export const NIGHTLY_GROUPS: Record<string, string[]> = {
  properties: ['properties'],
  security: ['security'],
  limits: ['limits'],
  environments: ['environments'],
  docs: ['docs'],
  sabotage: ['sabotage'],
  corpus: ['corpus'],
  coverage: ['coverage'],
  live: ['live'],
  mutants: ['mutants'],
};

// The groups that have no test file yet, by set; a group not named here that finds none fails, and a contract test fails when one named here holds tests.
export const EMPTY_GROUPS: Record<'commit' | 'nightly', string[]> = {
  commit: ['gate'],
  nightly: ['properties', 'security', 'limits', 'docs', 'sabotage', 'corpus', 'coverage', 'live', 'mutants'],
};

// Folders under tests/ that hold repositories, inputs and recorded results for the tests, never tests of their own.
export const FIXTURES = ['tests/sample', 'tests/reviewer-sample', 'tests/uses-sample', 'tests/languages-sample', 'tests/agent/fixture', 'tests/agent/samples', 'tests/stability/fixture', 'tests/security/attacks'];

export const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

// What discovery leaves out when it looks for test files anywhere in the checkout: what npm, the build and git make, and the files that are named like a test and are none. Every other file named like a test must be in a set of the runner.
export const NOT_SEARCHED = ['node_modules', '.git', 'dist', '.grammars'];
export const NOT_TESTS: string[] = [];

const rel = (path: string) => relative(ROOT, path).split(sep).join('/');

export function walk(dir: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || FIXTURES.includes(rel(path))) continue;
      out.push(...walk(path, keep));
    } else if (entry.isFile() && keep(entry.name)) out.push(rel(path));
  }
  return out.sort();
}

export const nightly = (path: string) => path.endsWith('.nightly.test.ts');

export function testNamedFiles(root = ROOT): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (NOT_SEARCHED.includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && TEST_FILE.test(entry.name) && !NOT_TESTS.includes(relative(root, path).split(sep).join('/'))) out.push(relative(root, path).split(sep).join('/'));
    }
  };
  visit(root);
  return out.sort();
}

export function setFiles(speed: 'commit' | 'nightly', dirs: string[]): string[] {
  return dirs
    .flatMap((dir) => walk(join(TESTS, dir), (name) => name.endsWith('.test.ts')))
    .filter((path) => (speed === 'nightly' ? nightly(path) : !nightly(path)))
    .sort();
}

export function groupDirs(speed: 'commit' | 'nightly', group: string | null): string[] | null {
  const groups = speed === 'nightly' ? NIGHTLY_GROUPS : COMMIT_GROUPS;
  if (group !== null) return groups[group] ?? null;
  return [...new Set(Object.values(groups).flat())];
}
