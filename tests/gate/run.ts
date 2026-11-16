import { resolve as resolveMain } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { git, resolve } from '../guard/git.ts';
import { tempDir } from './copy.ts';
import { assertionCounts, testIds } from './pack.ts';
import { redOnBase, renderRed } from './red-on-base.ts';

const USAGE = 'usage: npm run gate -- [--repo <dir>] [--base <rev>] [--head <rev>] [--modules <dir with node_modules>]';

function guardFromBase(repo: string, base: string, head: string): { code: number; text: string; judged?: boolean } {
  const files = git(repo, ['ls-tree', '-r', '-z', '--name-only', base, '--', 'tests/guard']).split('\0').filter(Boolean);
  if (!files.includes('tests/guard/from-base.ts')) {
    const ledger = git(repo, ['ls-tree', '--name-only', base, '--', 'tests/weakenings.md']).trim();
    if (files.length > 0 || ledger) return { code: 1, text: `suite guard: could not run  the base ${base.slice(0, 7)} holds ${files.length > 0 ? 'tests/guard' : 'tests/weakenings.md'} but no tests/guard/from-base.ts\n` };
    return { code: 0, text: `suite guard: not judged  the base ${base.slice(0, 7)} has no suite guard yet\n`, judged: false };
  }
  const tmp = tempDir('gate-guard');
  try {
    for (const file of files) {
      mkdirSync(dirname(join(tmp.dir, file)), { recursive: true });
      writeFileSync(join(tmp.dir, file), git(repo, ['cat-file', 'blob', `${base}:${file}`]));
    }
    const run = spawnSync(process.execPath, [join(tmp.dir, 'tests/guard/from-base.ts'), '--repo', repo, '--base', base, '--head', head], { cwd: tmp.dir, encoding: 'utf8' });
    return { code: run.status ?? 2, text: `${run.stdout ?? ''}${run.stderr ?? ''}${run.error ? `${run.error.message}\n` : ''}` };
  } finally {
    tmp.done();
  }
}

function commitSet(repo: string): { code: number; command: string } {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync('npm', ['test'], { cwd: repo, env, stdio: 'inherit', shell: process.platform === 'win32' });
  return { code: run.status ?? 2, command: 'npm test' };
}

if (process.argv[1] !== undefined && resolveMain(process.argv[1]) === import.meta.filename) {
  const argv = process.argv.slice(2);
  const opts: { [k: string]: string } = { repo: process.cwd(), base: 'main', head: 'HEAD' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]!.replace(/^--/, '');
    if (!['repo', 'base', 'head', 'modules'].includes(key) || argv[i + 1] === undefined) {
      process.stderr.write(`gate: unknown argument '${argv[i]}'\n${USAGE}\n`);
      process.exit(2);
    }
    opts[key] = argv[i + 1]!;
  }
  const repo = resolvePath(opts.repo!);
  const base = resolve(repo, opts.base!);
  const head = resolve(repo, opts.head!);
  if (!base || !head) {
    process.stderr.write(`gate: could not run: '${!base ? opts.base : opts.head}' is not a commit in ${repo}\n`);
    process.exit(2);
  }
  const mergeBase = git(repo, ['merge-base', base, head]).trim();
  const status = git(repo, ['status', '--porcelain']).trim();
  const tests = commitSet(repo);
  const guard = guardFromBase(repo, base, head);
  const red = redOnBase(repo, base, head, resolvePath(opts.modules ?? repo));
  const out = [
    '',
    `== the reviewer's pack: ${mergeBase.slice(0, 7)}..${head.slice(0, 7)} (base ${opts.base} at ${base.slice(0, 7)})`,
    '',
    '1. Test ids added, changed and removed, each with its promise',
    '',
    testIds(repo, mergeBase, head, red.rows),
    '2. Red on base',
    '',
    renderRed(red),
    '3. Mutants on the changed lines',
    '',
    'not built yet: layer 9 comes after the Stryker spike. Until then the reviewer\'s own break of section 18 stands in for it.',
    '',
    '4. The suite guard, taken from the base',
    '',
    guard.text,
    '5. Assertions in each changed test file',
    '',
    assertionCounts(repo, mergeBase, head),
  ];
  if (status) out.push(`note: the working tree has changes that are not committed; the guard, red on base and the pack read commit ${head.slice(0, 7)}, the commit set ran on the working tree`, '');
  const red0 = red.rows.filter((r) => r.verdict === 'red' || r.verdict === 'file did not load').length;
  const verdicts = [
    `suite guard ${guard.judged === false ? 'not judged: no guard on the base yet' : guard.code === 0 ? 'passed' : guard.code === 1 ? 'refused weakenings or could not run' : 'could not run'}`,
    `commit set (${tests.command}) ${tests.code === 0 ? 'passed' : 'failed'}`,
    `${red0} of ${red.rows.length} new or changed tests red on the base`,
  ];
  const passed = guard.code === 0 && tests.code === 0;
  out.push(`gate: ${passed ? 'PASS' : 'FAIL'}  ${verdicts.join('; ')}`);
  process.stdout.write(`${out.join('\n')}\n`);
  process.exit(passed ? 0 : 1);
}
