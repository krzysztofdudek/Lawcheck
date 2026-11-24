import { realpathSync as realMain } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { git, resolve } from './git.ts';
import { parse } from './cli.ts';

const GUARD = 'tests/guard';

export function runFromBase(repo: string, baseRev: string, headRev: string, json: boolean): { code: number; stdout: string; stderr: string } {
  const base = resolve(repo, baseRev);
  if (!base) {
    if (/^0+$/.test(baseRev)) return { code: 0, stdout: `suite guard: not judged  no base commit (${baseRev})\n`, stderr: '' };
    return { code: 2, stdout: '', stderr: `suite guard: could not run: the base '${baseRev}' is not a commit in ${repo}\n` };
  }
  const files = git(repo, ['ls-tree', '-r', '-z', '--name-only', base, '--', GUARD]).split('\0').filter(Boolean);
  if (!files.includes(`${GUARD}/cli.ts`)) {
    const ledger = git(repo, ['ls-tree', '--name-only', base, '--', 'tests/weakenings.md']).trim();
    if (files.length > 0 || ledger) return { code: 1, stdout: `suite guard: could not run  the base ${base.slice(0, 7)} holds ${files.length > 0 ? GUARD : 'tests/weakenings.md'} but no ${GUARD}/cli.ts\n`, stderr: '' };
    return { code: 0, stdout: `suite guard: not judged  the base ${base.slice(0, 7)} has no suite guard yet\n`, stderr: '' };
  }
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-guard-'));
  try {
    for (const file of files) {
      const target = join(dir, file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, git(repo, ['cat-file', 'blob', `${base}:${file}`]));
    }
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: 'C' };
    if (process.env.SYSTEMROOT) env.SYSTEMROOT = process.env.SYSTEMROOT;
    const run = spawnSync(process.execPath, [join(dir, GUARD, 'cli.ts'), '--repo', repo, '--base', base, '--head', headRev, ...(json ? ['--json'] : [])], {
      cwd: dir,
      env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    if (run.error) return { code: 2, stdout: run.stdout ?? '', stderr: `suite guard: could not run the base's guard: ${run.error.message}\n` };
    return { code: run.status ?? 2, stdout: run.stdout, stderr: run.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && realMain(process.argv[1]) === import.meta.filename) {
  const args = parse(process.argv.slice(2));
  if (typeof args === 'string') {
    process.stderr.write(`suite guard: ${args}\nusage: node tests/guard/from-base.ts [--repo <dir>] [--base <rev>] [--head <rev>] [--json]\n`);
    process.exit(2);
  }
  try {
    const result = runFromBase(resolvePath(args.repo), args.base, args.head, args.json);
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.code;
  } catch (error) {
    process.stderr.write(`suite guard: could not run: ${(error as Error).message}\n`);
    process.exitCode = 2;
  }
}
