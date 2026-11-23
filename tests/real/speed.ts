import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTool } from '../harness/start.ts';
import { ONE_FILE_CHECK_MS, SPEED_RUNS } from '../numbers.ts';

// The two repositories of the measurement of 2026-11-15 that gave the slowest check of one changed file, at the commits it used: guava, 6.1 s, and Newtonsoft.Json, 4.2 s.
const REPOSITORIES = [
  {
    id: 'guava',
    url: 'https://github.com/google/guava.git',
    commit: 'fce80fd984c8227262a63972ccc68ae6f2ad0519',
    pattern: '**/*.java',
    inner: 'guava/src/com/google/common/base/**',
    edit: 'guava/src/com/google/common/base/Strings.java',
    rename: 'guava/src/com/google/common/annotations/GwtCompatible.java',
    remove: 'guava/src/com/google/common/annotations/VisibleForTesting.java',
  },
  {
    id: 'Newtonsoft.Json',
    url: 'https://github.com/JamesNK/Newtonsoft.Json.git',
    commit: '52fa3aef1f2cadcd3a3f874251eddc98d3efbbaa',
    pattern: '**/*.cs',
    inner: 'Src/Newtonsoft.Json/*.cs',
    edit: 'Src/Newtonsoft.Json/JsonConvert.cs',
    rename: 'Src/Newtonsoft.Json/Utilities/StringUtils.cs',
    remove: 'Src/Newtonsoft.Json/Utilities/MiscellaneousUtils.cs',
  },
];

class FetchFailed extends Error {}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-c', 'user.name=speed', '-c', 'user.email=speed@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new FetchFailed(`git ${args.join(' ')} exited with ${result.status}: ${(result.stderr || result.stdout).trim().split('\n')[0]}`);
  return result.stdout;
}

interface Run {
  code: number | null;
  stdout: string;
  ms: number;
}

async function check(dir: string, args: string[]): Promise<Run> {
  const run = await startTool(dir, ['check', ...args, '--json'], process.env, { budget: 'REAL_RUN_BUDGET_MS' }).ended;
  return { code: run.code, stdout: run.stdout, ms: run.ms };
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

async function measure(repository: (typeof REPOSITORIES)[number]): Promise<{ lines: string[]; problems: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), `lawcheck-speed-${repository.id}-`));
  const lines: string[] = [];
  const problems: string[] = [];
  const cold = () => rmSync(join(dir, '.lawcheck', '.local'), { recursive: true, force: true });
  // The same run with the packs of the run before it and with none must print the same document and exit with the same code.
  const same = async (what: string, args: string[]): Promise<Run> => {
    const warm = await check(dir, args);
    cold();
    const fresh = await check(dir, args);
    if (warm.code !== fresh.code || warm.stdout !== fresh.stdout) problems.push(`${what}: the run with the cache gives exit ${warm.code} and ${warm.stdout.length} characters, the run without it exit ${fresh.code} and ${fresh.stdout.length} characters`);
    else {
      const findings = (JSON.parse(fresh.stdout) as { findings?: unknown[] }).findings?.length ?? 0;
      lines.push(`${what}: the same output with the cache and without it, exit ${warm.code}, ${findings} findings, sha256 ${createHash('sha256').update(fresh.stdout).digest('hex').slice(0, 12)} (${(warm.ms / 1000).toFixed(2)} s with, ${(fresh.ms / 1000).toFixed(2)} s without)`);
    }
    return fresh;
  };
  try {
    git(dir, ['init', '-q']);
    git(dir, ['remote', 'add', 'origin', repository.url]);
    git(dir, ['fetch', '-q', '--depth', '1', '--no-tags', 'origin', repository.commit]);
    git(dir, ['checkout', '-q', repository.commit]);
    mkdirSync(join(dir, '.lawcheck'));
    // The inner type may use only itself, so the changed file uses other files against the law, and renaming or deleting one of them changes the findings.
    writeFileSync(
      join(dir, '.lawcheck', 'law.yaml'),
      `lawcheck: 0.1.0\n\ntypes:\n  code:\n    about: Every file of the language.\n    paths: ["${repository.pattern}"]\n    may_use: [code]\n    types:\n      inner:\n        about: One folder.\n        paths: ["${repository.inner}"]\n        may_use: [inner]\n`,
    );
    git(dir, ['add', '.lawcheck/law.yaml']);
    git(dir, ['commit', '-q', '-m', 'law']);

    await same('every file', ['--full', '--base', 'HEAD']);
    appendFileSync(join(dir, repository.edit), '\n// lawcheck speed\n');
    const changed = await same('one changed file', ['--base', 'HEAD']);
    const warm: number[] = [];
    for (let i = 0; i < SPEED_RUNS; i++) {
      const run = await check(dir, ['--base', 'HEAD']);
      if (run.code !== changed.code || run.stdout !== changed.stdout) problems.push(`one changed file: warm run ${i + 1} differs from the run without the cache`);
      warm.push(run.ms);
    }
    const took = median(warm);
    lines.push(`one changed file: median ${(took / 1000).toFixed(2)} s over ${SPEED_RUNS} runs with the cache (${warm.map((ms) => (ms / 1000).toFixed(2)).join(', ')}), ${(changed.ms / 1000).toFixed(2)} s without it`);
    if (took > ONE_FILE_CHECK_MS) problems.push(`one changed file: median ${took} ms, more than ${ONE_FILE_CHECK_MS} ms`);
    renameSync(join(dir, repository.rename), join(dir, repository.rename.replace(/(\.[a-z]+)$/, 'Moved$1')));
    await same('one changed and one renamed file', ['--base', 'HEAD']);
    rmSync(join(dir, repository.remove));
    await same('one changed, one renamed and one deleted file', ['--base', 'HEAD']);
    await same('every file after the three changes', ['--full', '--base', 'HEAD']);
    return { lines, problems };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let failed = false;
for (const repository of REPOSITORIES) {
  let result: { lines: string[]; problems: string[] };
  try {
    result = await measure(repository);
  } catch (error) {
    if (error instanceof FetchFailed) {
      process.stdout.write(`${repository.id}: cannot be fetched: ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
  process.stdout.write(`${repository.id}: ${result.problems.length === 0 ? 'within the limit' : 'fails'}\n`);
  for (const line of result.lines) process.stdout.write(`  ${line}\n`);
  for (const problem of result.problems) process.stdout.write(`  ${problem}\n`);
  if (result.problems.length > 0) failed = true;
}
process.exit(failed ? 1 : 0);
