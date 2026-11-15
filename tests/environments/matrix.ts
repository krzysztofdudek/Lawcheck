import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, SAMPLE } from '../acceptance/helpers.ts';

export const MATRIX = join(ROOT, 'tests', 'environments', 'matrix');

export interface Cell {
  image: string;
  manager: string;
  expect: 'pass' | 'refuse';
  cause?: string;
}

// spec/environments.md, section 7: which cells pass and which are refused, and the words each refusal names.
export const INSTALL_CELLS: Cell[] = [
  ...['node:24', 'node:24-alpine'].flatMap((image): Cell[] => [
    { image, manager: 'npm', expect: 'pass' },
    { image, manager: 'pnpm', expect: 'pass' },
    { image, manager: 'yarn1', expect: 'pass' },
    { image, manager: 'yarn4', expect: 'pass' },
    { image, manager: 'yarn4-pnpm', expect: 'pass' },
    { image, manager: 'yarn4-pnp', expect: 'refuse', cause: "Plug'n'Play" },
    { image, manager: 'bun', expect: 'pass' },
  ]),
  { image: 'oven/bun', manager: 'bun', expect: 'refuse', cause: 'this run is on Bun' },
  { image: 'node:20', manager: 'npm', expect: 'refuse', cause: 'Node 20.' },
  { image: 'node:22', manager: 'npm', expect: 'refuse', cause: 'Node 22.' },
];

export const GIT_IMAGES = ['ubuntu:22.04', 'debian:12', 'ubuntu:24.04', 'debian:sid'];

export interface CellRun {
  code: number | null;
  lines: string[];
  output: string;
}

export function docker(dir: string, image: string, script: string, args: string[]): CellRun {
  const run = spawnSync('docker', ['run', '--rm', '-v', `${dir}:/cell:ro`, image, 'sh', `/cell/${script}`, ...args], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (run.error) throw new Error(`could not run: docker (${run.error.message})`);
  const output = `${run.stdout}${run.stderr}`;
  return { code: run.status, lines: run.stdout.split('\n').filter((line) => line.startsWith('cell: ')).map((line) => line.slice('cell: '.length)), output };
}

// The folder an install cell mounts: the packed tarball, the sample and the cell script.
export function installFolder(dir: string): void {
  execFileSync('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', dir], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const [tarball] = readdirSync(dir).filter((name) => name.endsWith('.tgz'));
  if (tarball === undefined) throw new Error('npm pack made no tarball');
  copyFileSync(join(dir, tarball), join(dir, 'lawcheck.tgz'));
  cpSync(SAMPLE, join(dir, 'sample'), { recursive: true });
  copyFileSync(join(MATRIX, 'install-cell.sh'), join(dir, 'install-cell.sh'));
}

// The folder a git cell mounts: this Node, the checkout with dist and node_modules, and the cell script.
export function gitFolder(dir: string): void {
  // The cell runs the tests as a user other than root, who must enter the folder mkdtemp made for its owner alone.
  chmodSync(dir, 0o755);
  mkdirSync(join(dir, 'node'));
  copyFileSync(process.execPath, join(dir, 'node', 'node'));
  chmodSync(join(dir, 'node', 'node'), 0o755);
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  for (const entry of ['package.json', 'dist', 'node_modules', 'tests', 'spec', 'docs', 'plugin']) cpSync(join(ROOT, entry), join(repo, entry), { recursive: true, verbatimSymlinks: true });
  copyFileSync(join(MATRIX, 'git-cell.sh'), join(dir, 'git-cell.sh'));
}

// The test files whose names carry a row of spec/check-slice.md, section 8.
export function checkSliceFiles(): string[] {
  const dir = join(ROOT, 'tests', 'acceptance');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.test.ts'))
    .filter((name) => [...readFileSync(join(dir, name), 'utf8').matchAll(/test\('tests? (\d+)\b/g)].some((found) => Number(found[1]) >= 1 && Number(found[1]) <= 45))
    .map((name) => `tests/acceptance/${name}`)
    .sort();
}
