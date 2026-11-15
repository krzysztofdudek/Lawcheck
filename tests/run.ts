import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { COMMIT_TARGET_MS, LOOP_TARGET_MS, SEED, SLOW_TESTS, TEST_BUDGET_MS } from './numbers.ts';
import type { Speed } from './numbers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TESTS = join(ROOT, 'tests');
const REPORTER = join(TESTS, 'harness', 'reporter.ts');
const HARNESS = pathToFileURL(join(TESTS, 'harness', 'tool.ts')).href;
const USAGE = 'usage: node tests/run.ts <loop|commit|nightly> [--group <name>] [--repeat <n>] [<test id or source file>...]';

const COMMIT_GROUPS: Record<string, string[]> = {
  core: ['unit', 'acceptance', 'contract', 'guard'],
  inputs: ['properties', 'security', 'limits'],
  environments: ['environments'],
};
const NIGHTLY_GROUPS: Record<string, string[]> = {
  properties: ['properties'],
  security: ['security'],
  limits: ['limits'],
  environments: ['environments'],
};

function fail(message: string): never {
  process.stderr.write(`${message}\n${USAGE}\n`);
  process.exit(2);
}

function couldNotRun(missing: string): never {
  process.stdout.write(`could not run: ${missing}\n`);
  process.exit(1);
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

const rel = (path: string) => relative(ROOT, path).split(sep).join('/');

function testFiles(speed: 'commit' | 'nightly', group: string | null): string[] {
  const groups = speed === 'nightly' ? NIGHTLY_GROUPS : COMMIT_GROUPS;
  if (group !== null && groups[group] === undefined) fail(`no group ${group} in the ${speed} set; the groups are ${Object.keys(groups).join(', ')}`);
  const dirs = group === null ? [...new Set(Object.values(groups).flat())] : groups[group]!;
  const nightly = (path: string) => path.endsWith('.nightly.test.ts');
  return dirs
    .flatMap((dir) => walk(join(TESTS, dir)))
    .filter((path) => (speed === 'nightly' ? nightly(path) : !nightly(path)))
    .map(rel)
    .sort();
}

interface Parsed {
  speed: Speed;
  group: string | null;
  repeat: number;
  targets: string[];
}

function parse(argv: string[]): Parsed {
  const [speed, ...rest] = argv;
  if (speed !== 'loop' && speed !== 'commit' && speed !== 'nightly') fail(speed === undefined ? 'name a speed' : `unknown speed ${speed}`);
  let group: string | null = null;
  let repeat = 1;
  const targets: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--group') {
      if (rest[i + 1] === undefined) fail('--group takes a name');
      group = rest[++i]!;
    } else if (arg === '--repeat') {
      const n = rest[++i];
      if (n === undefined || !/^[1-9]\d*$/.test(n)) fail('--repeat takes a whole number from 1');
      repeat = Number(n);
    } else if (arg.startsWith('--')) fail(`unknown option ${arg}`);
    else targets.push(arg);
  }
  if (speed === 'loop' && group !== null) fail('--group belongs to the commit and nightly sets');
  return { speed, group, repeat, targets };
}

function changedFiles(): string[] {
  const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const tracked = git(['diff', '--name-only', '-z', 'HEAD']).split('\0');
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0');
    return [...new Set([...tracked, ...untracked])].filter((path) => path !== '').sort();
  } catch (error) {
    couldNotRun(`git cannot read this checkout, so the loop cannot tell what changed (${String((error as { stderr?: unknown }).stderr ?? error).trim()}); name the files instead: npm run t -- src/<file>.ts`);
  }
}

function readMap(): Record<string, string[]> {
  return JSON.parse(readFileSync(join(TESTS, 'map.json'), 'utf8')) as Record<string, string[]>;
}

const ID = /^(tests? \d+|I-[a-z][a-z0-9]*-\d+|S\d+-\d+|U-\d+|R-\d+)$/;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function idPattern(id: string): string {
  const row = /^tests? (\d+)$/.exec(id);
  if (row !== null) return `/^tests? (\\d+(, | and ))*${row[1]}(?!\\d)/`;
  return `/(^|[^\\w-])${escape(id)}([^\\w-]|$)/`;
}

interface Plan {
  files: string[];
  patterns: string[];
  notes: string[];
}

function plan(parsed: Parsed): Plan {
  const files = new Set<string>();
  const patterns: string[] = [];
  const notes: string[] = [];
  const sets = parsed.speed === 'loop' ? [...testFiles('commit', null), ...testFiles('nightly', null)] : testFiles(parsed.speed, parsed.group);
  let targets = parsed.targets;
  if (parsed.speed === 'loop' && targets.length === 0) {
    targets = changedFiles();
    notes.push(targets.length === 0 ? 'git diff names no file' : `git diff names ${targets.join(', ')}`);
  }
  if (targets.length === 0) return { files: sets, patterns, notes };
  let map: Record<string, string[]> | null = null;
  const mapped = (path: string) => (map ??= readMap())[path];
  for (const target of targets) {
    if (ID.test(target)) {
      const id = target.replace(/^tests /, 'test ');
      const needle = new RegExp(idPattern(id).slice(1, -1).replace('^', "(^|['`])"));
      const holding = sets.filter((file) => needle.test(readFileSync(join(ROOT, file), 'utf8')));
      if (holding.length === 0) fail(`no test file holds a test named ${id}`);
      for (const file of holding) files.add(file);
      patterns.push(idPattern(id));
      continue;
    }
    const path = target.split('\\').join('/').replace(/^\.\//, '');
    if (path.endsWith('.test.ts')) {
      if (!existsSync(join(ROOT, path))) fail(`no test file ${path}`);
      files.add(path);
    } else if (path.startsWith('src/') && mapped(path) !== undefined) {
      for (const file of mapped(path)!) if (parsed.speed !== 'loop' ? sets.includes(file) : true) files.add(file);
    } else if (path.startsWith('src/')) fail(`tests/map.json has no entry for ${path}`);
    else notes.push(`no tests are mapped to ${path}`);
  }
  return { files: [...files].sort(), patterns, notes };
}

function newerThanBuild(): boolean {
  const built = join(ROOT, 'dist', 'cli.js');
  if (!existsSync(built) || !existsSync(join(ROOT, 'dist', 'grammars'))) return true;
  const at = statSync(built).mtimeMs;
  const stack = [join(ROOT, 'src')];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (statSync(path).mtimeMs > at) return true;
    }
  }
  return false;
}

function build(): void {
  if (!newerThanBuild()) return;
  process.stdout.write('build: src/ is newer than dist/\n');
  const npm = process.env.npm_execpath;
  const result = npm ? spawnSync(process.execPath, [npm, 'run', 'build'], { cwd: ROOT, stdio: 'inherit' }) : spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) couldNotRun('the build failed');
}

function main(): void {
  const began = Date.now();
  const parsed = parse(process.argv.slice(2));
  if (parsed.speed === 'loop') build();
  const { files, patterns, notes } = plan(parsed);
  for (const note of notes) process.stdout.write(`${note}\n`);
  const what = parsed.group === null ? `the ${parsed.speed} set` : `group ${parsed.group} of the ${parsed.speed} set`;
  if (files.length === 0) {
    process.stdout.write(`${what}: no test files to run, 0 tests\n`);
    return;
  }
  const seed = process.env.LAWCHECK_SEED ?? String(SEED);
  process.stdout.write(`${what}: ${files.length} test files, seed ${seed}${parsed.repeat > 1 ? `, ${parsed.repeat} times` : ''}\n`);
  const slowest = Math.max(TEST_BUDGET_MS, ...Object.values(SLOW_TESTS));
  const args = [
    '--test',
    `--import=${HARNESS}`,
    `--test-reporter=${REPORTER}`,
    '--test-reporter-destination=stdout',
    `--test-timeout=${slowest + TEST_BUDGET_MS}`,
    ...patterns.map((p) => `--test-name-pattern=${p}`),
    ...files,
  ];
  const target = parsed.speed === 'loop' ? LOOP_TARGET_MS : parsed.speed === 'commit' && parsed.targets.length === 0 && parsed.group === null ? COMMIT_TARGET_MS : null;
  const env = { ...process.env, LAWCHECK_SPEED: parsed.speed, LAWCHECK_SEED: seed, LAWCHECK_TARGET_MS: target === null ? '' : String(target) };
  let failed = false;
  for (let round = 1; round <= parsed.repeat; round++) {
    if (parsed.repeat > 1) process.stdout.write(`round ${round} of ${parsed.repeat}\n`);
    const result = spawnSync(process.execPath, args, { cwd: ROOT, env: { ...env, LAWCHECK_STARTED: String(round === 1 ? began : Date.now()) }, stdio: 'inherit' });
    if (result.status !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}

main();
