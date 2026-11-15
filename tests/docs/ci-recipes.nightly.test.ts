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
  const script = `command -v pnpm > /dev/null 2>&1 || npm install --global --no-audit --no-fund pnpm > /dev/null 2>&1 || { echo 'cell: could not run: npm install pnpm'; exit 3; }; cd /cell/repo && node tests/docs/ci-cell-main.ts ${kind} /cell/lawcheck.tgz`;
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
      assert.ok(run.lines.filter((line) => line.startsWith('ok ')).length >= 10, run.output);
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
