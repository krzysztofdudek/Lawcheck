import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI = join(ROOT, 'dist', 'cli.js');
const HERE = join(ROOT, 'tests', 'real');

const REPOSITORIES = [
  { id: 'hono', url: 'https://github.com/honojs/hono.git', commit: 'f6fbaf0299c48eea9e656e03e2ffe7ac755e8823', listUnresolved: true },
  { id: 'gson', url: 'https://github.com/google/gson.git', commit: 'a961b0fe088f8558d00cc1b56e506a3656907a91', listUnresolved: true },
];

class FetchFailed extends Error {}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new FetchFailed(`git ${args.join(' ')} exited with ${result.status}: ${(result.stderr || result.stdout).trim().split('\n')[0]}`);
  return result.stdout;
}

function place(finding: { file: string; line?: number }): string {
  return finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
}

function unresolvedLine(u: { file: string; line: number; answer: string; reason: string | null; what: string; candidates: string[] }): string {
  const answer = u.reason === null ? u.answer : `${u.answer} ${u.reason}`;
  return `${u.file}:${u.line}  ${answer}  ${u.what}${u.candidates.length === 0 ? '' : `  [${u.candidates.join(', ')}]`}`;
}

function measure(repository: (typeof REPOSITORIES)[number]): { lines: string[]; problems: string[] } {
  const dir = mkdtempSync(join(tmpdir(), `lawcheck-real-${repository.id}-`));
  try {
    git(dir, ['init', '-q']);
    git(dir, ['remote', 'add', 'origin', repository.url]);
    git(dir, ['fetch', '-q', '--depth', '1', '--no-tags', 'origin', repository.commit]);
    git(dir, ['checkout', '-q', repository.commit]);
    const head = git(dir, ['rev-parse', 'HEAD']).trim();
    if (head !== repository.commit) throw new FetchFailed(`HEAD is ${head}, not ${repository.commit}`);
    mkdirSync(join(dir, '.lawcheck'));
    writeFileSync(join(dir, '.lawcheck', 'law.yaml'), readFileSync(join(HERE, `${repository.id}.yaml`)));
    git(dir, ['add', '.lawcheck/law.yaml']);
    const run = spawnSync(process.execPath, [CLI, 'check', '--full', '--base', 'HEAD', '--json'], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 30 });
    const problems: string[] = [];
    if (run.status !== 0) problems.push(`lawcheck exited with ${run.status}`);
    let document: any;
    try {
      document = JSON.parse(run.stdout);
    } catch {
      return { lines: [], problems: [...problems, `lawcheck printed no JSON: ${run.stdout.split('\n')[0]}`] };
    }
    if (document.schema !== 'lawcheck-check/0') return { lines: [], problems: [...problems, `lawcheck printed ${JSON.stringify(document.errors ?? document)}`] };
    const change = document.findings.filter((f: any) => !f.debt);
    if (change.length > 0) problems.push(`the change holds ${change.length} findings`);
    const changeUnresolved = document.unresolved.filter((u: any) => !u.debt);
    if (changeUnresolved.length > 0) problems.push(`the change holds ${changeUnresolved.length} unresolved uses`);
    const lines = document.findings.filter((f: any) => f.debt).map((f: any) => `${place(f)}  ${f.severity}[${f.code}]  ${f.message}`);
    const count = (keep: (u: any) => boolean) => document.unresolved.filter(keep).length;
    const ambiguous = count((u) => u.answer === 'ambiguous');
    const unfollowed = count((u) => u.reason === 'unfollowed');
    const unowned = count((u) => u.reason === 'unowned');
    const noReason = count((u) => u.answer === 'none' && u.reason === null);
    lines.push(`unresolved: ${document.unresolved.length} (${ambiguous} ambiguous, ${unfollowed} unfollowed, ${unowned} unowned, ${noReason} without a reason)`);
    if (repository.listUnresolved) for (const u of document.unresolved) lines.push(unresolvedLine(u));
    return { lines, problems };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function compare(actual: string[], expected: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
    if (actual[i] === expected[i]) continue;
    out.push(`line ${i + 1}: expected ${expected[i] === undefined ? 'nothing' : JSON.stringify(expected[i])}, got ${actual[i] === undefined ? 'nothing' : JSON.stringify(actual[i])}`);
    if (out.length === 10) break;
  }
  return out;
}

let failed = false;
for (const repository of REPOSITORIES) {
  const started = Date.now();
  let result: { lines: string[]; problems: string[] };
  try {
    result = measure(repository);
  } catch (error) {
    if (error instanceof FetchFailed) {
      process.stdout.write(`${repository.id}: cannot be fetched: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
  const expected = readFileSync(join(HERE, `${repository.id}.expected`), 'utf8').split('\n');
  if (expected[expected.length - 1] === '') expected.pop();
  const problems = [...result.problems, ...compare(result.lines, expected)];
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  process.stdout.write(`${repository.id}: ${problems.length === 0 ? 'matches' : 'does not match'} (${seconds} s)\n`);
  for (const problem of problems) process.stdout.write(`  ${problem}\n`);
  if (problems.length > 0) failed = true;
}
process.exit(failed ? 1 : 0);
