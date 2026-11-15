import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { example } from '../harness/examples.ts';
import { KINDS } from './ci-cell.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ACTIONLINT = 'rhysd/actionlint:1.7.7';
const PNPM = 'pnpm@12.21.0';

const PULL_REQUESTS = [
  'pull request, a clean change',
  'pull request, a breach fails the job',
  'pull request, a breach and the rule taken off its type fails the second check, which says whose law it uses',
  'pull request, a note in the law passes both checks',
  'pull request, a pull request that adds a rule passes both checks',
  'pull request, a waiver the change adds is named',
  'pull request, a shallow checkout with no base is refused by name',
];
const PUSHES = [
  'push to main, the commits since the one before',
  'push to main, a force-push that removed the commit before is judged by its last commit',
  'push to main, an all-zero before falls back to the parent',
  'push to main, a direct push that takes a rule off its type and breaks it fails the second check',
  'push to main, a root commit has no parent and is judged whole',
  'push to main, a root commit with a breach fails',
];
const ONLY_NPM = [
  'merge queue',
  'the pre-commit hook refuses a breach and lets a clean commit through',
  'the pre-commit hook judges the working tree and not the index',
  'the pre-push hook refuses a push while the tree holds a breach, and a delete or a tag passes',
  'pull request, a law below the top, a breach and the rule taken off its type fails the second check',
];

function expected(kind: string): string[] {
  return [...PULL_REQUESTS, ...PUSHES, ...(kind === 'npm-lock' ? ONLY_NPM : [])].map((name) => `${kind}: ${name}`).sort();
}

function inFolder<T>(body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-recipes-'));
  chmodSync(dir, 0o755);
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function cellFolder(dir: string): void {
  execFileSync('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', dir], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  const [tarball] = readdirSync(dir).filter((name) => name.endsWith('.tgz'));
  if (tarball === undefined) throw new Error('npm pack made no tarball');
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'tests', 'harness'), { recursive: true });
  for (const entry of ['package.json', 'docs', 'spec']) cpSync(join(ROOT, entry), join(repo, entry), { recursive: true });
  for (const entry of ['tests/sample', 'tests/docs', 'tests/harness/examples.ts']) cpSync(join(ROOT, entry), join(repo, entry), { recursive: true });
  mkdirSync(join(repo, 'node_modules'));
  cpSync(join(ROOT, 'node_modules', 'yaml'), join(repo, 'node_modules', 'yaml'), { recursive: true });
  cpSync(join(dir, tarball), join(dir, 'lawcheck.tgz'));
}

function cell(dir: string, kind: string): { code: number | null; lines: string[]; output: string } {
  const script = `command -v pnpm > /dev/null 2>&1 || npm install --global --no-audit --no-fund ${PNPM} > /dev/null 2>&1 || { echo 'cell: could not run: npm install pnpm'; exit 3; }; cd /cell/repo && node tests/docs/ci-cell-main.ts ${kind} /cell/lawcheck.tgz`;
  const run = spawnSync('docker', ['run', '--rm', '-v', `${dir}:/cell:ro`, 'node:24', 'sh', '-c', script], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (run.error) throw new Error(`could not run: docker (${run.error.message})`);
  const output = `${run.stdout}${run.stderr}`;
  return { code: run.status, lines: run.stdout.split('\n').filter((line) => line.startsWith('cell: ')).map((line) => line.slice('cell: '.length)), output };
}

for (const kind of KINDS) {
  test(`S7-1, S7-2, S7-3, S7-4 (design tests 15 and 16): the workflow and the hooks of docs/ci.md, run as written on ${kind}, as a pull request and as a push (network)`, () => {
    inFolder((dir) => {
      cellFolder(dir);
      const run = cell(dir, kind);
      const failed = run.lines.filter((line) => line.startsWith('fail') || line.startsWith('could not run') || line.startsWith('  '));
      assert.deepEqual(failed, [], run.output);
      assert.ok(run.lines.includes('done'), run.output);
      assert.equal(run.code, 0, run.output);
      assert.deepEqual(run.lines.filter((line) => line.startsWith('ok ')).map((line) => line.slice(3)).sort(), expected(kind), run.output);
    });
  });
}

test('S7-4: actionlint accepts the workflow of docs/ci.md as it stands', () => {
  inFolder((dir) => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'lawcheck.yml'), example('ci-workflow') + '\n');
    const run = spawnSync('docker', ['run', '--rm', '-v', `${dir}:/repo:ro`, '-w', '/repo', ACTIONLINT, '-oneline', '.github/workflows/lawcheck.yml'], { encoding: 'utf8' });
    if (run.error) throw new Error(`could not run: docker (${run.error.message})`);
    assert.equal(`${run.stdout}${run.stderr}`, '');
    assert.equal(run.status, 0);
  });
});
