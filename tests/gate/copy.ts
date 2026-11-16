import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHARED = ['node_modules', '.grammars'];
const LEFT_OUT = new Set(['.git', 'dist', ...SHARED]);

export function tempDir(prefix: string): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `lawcheck-${prefix}-`));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

function listTree(repo: string, rev: string): string[] {
  return execFileSync('git', ['-C', repo, 'ls-tree', '-r', '-z', '--name-only', rev], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter(Boolean);
}

function readBlobs(repo: string, specs: string[]): Buffer[] {
  if (specs.length === 0) return [];
  const out = execFileSync('git', ['-C', repo, 'cat-file', '--batch'], { input: `${specs.join('\n')}\n`, maxBuffer: 1024 * 1024 * 1024 });
  const blobs: Buffer[] = [];
  let at = 0;
  for (const spec of specs) {
    const end = out.indexOf(0x0a, at);
    const header = out.subarray(at, end).toString('utf8');
    const m = /^[0-9a-f]+ blob (\d+)$/.exec(header);
    if (!m) throw new Error(`git cat-file could not read ${spec}: ${header}`);
    const size = Number(m[1]);
    blobs.push(out.subarray(end + 1, end + 1 + size));
    at = end + 1 + size + 1;
  }
  return blobs;
}

export function writeTree(repo: string, files: Array<{ path: string; rev: string }>, dir: string): void {
  const blobs = readBlobs(repo, files.map((f) => `${f.rev}:${f.path}`));
  files.forEach((file, i) => {
    const target = join(dir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, blobs[i]!);
  });
}

export function headWithBaseSrc(repo: string, head: string, base: string, dir: string): void {
  const files = [
    ...listTree(repo, head).filter((p) => !p.startsWith('src/') && !LEFT_OUT.has(p.split('/')[0]!)).map((path) => ({ path, rev: head })),
    ...listTree(repo, base).filter((p) => p.startsWith('src/')).map((path) => ({ path, rev: base })),
  ];
  writeTree(repo, files, dir);
}

export function copyWorkingTree(root: string, dir: string): void {
  for (const entry of readdirSync(root)) {
    if (LEFT_OUT.has(entry)) continue;
    cpSync(join(root, entry), join(dir, entry), { recursive: true, verbatimSymlinks: true });
  }
}

export function linkShared(root: string, dir: string): void {
  for (const name of SHARED) {
    if (existsSync(join(root, name)) && !existsSync(join(dir, name))) symlinkSync(join(root, name), join(dir, name), process.platform === 'win32' ? 'junction' : 'dir');
  }
}

export function build(dir: string): { ok: boolean; output: string } {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync('npm', ['run', 'build'], { cwd: dir, env, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 });
  return { ok: run.status === 0, output: `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? run.error.message : ''}` };
}

export function runTests(dir: string, file: string, patterns: RegExp[]): { tap: string; status: number | null } {
  const harness = join(dir, 'tests', 'harness', 'tool.ts');
  const args = ['--test', ...(existsSync(harness) ? [`--import=${pathToFileURL(harness).href}`] : []), '--test-reporter=tap', ...patterns.map((p) => `--test-name-pattern=${p.source}`), file];
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { tap: run.stdout ?? '', status: run.status };
}
