import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const TESTS = join(ROOT, 'tests');

export const COMMIT_GROUPS: Record<string, string[]> = {
  core: ['unit', 'acceptance', 'contract', 'guard'],
  inputs: ['properties', 'security', 'limits'],
  environments: ['environments'],
};

export const NIGHTLY_GROUPS: Record<string, string[]> = {
  properties: ['properties'],
  security: ['security'],
  limits: ['limits'],
  environments: ['environments'],
  docs: ['docs'],
  sabotage: ['sabotage'],
};

// The groups that have no test file yet, by set; a group not named here that finds none fails, and a contract test fails when one named here holds tests.
export const EMPTY_GROUPS: Record<'commit' | 'nightly', string[]> = {
  commit: [],
  nightly: ['properties', 'security', 'limits', 'docs', 'sabotage'],
};

// Folders under tests/ that hold repositories, inputs and recorded results for the tests, never tests of their own.
export const FIXTURES = ['tests/sample', 'tests/reviewer-sample', 'tests/uses-sample', 'tests/languages-sample', 'tests/agent/fixture', 'tests/agent/samples', 'tests/stability/fixture', 'tests/security/attacks'];

export const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

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
