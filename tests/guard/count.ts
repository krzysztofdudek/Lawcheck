import { resolve as resolveMain } from 'node:path';
import { globSync, readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { readConstants } from './constants.ts';
import { loadConfig, type Config } from './guard.ts';
import { namePattern, readSource } from './source.ts';

export type Result = { name: string; ok: boolean; directive: 'skip' | 'todo' | null; reason: string };

export function readTapResults(text: string): Result[] {
  const out: Result[] = [];
  const unescape = (s: string): string => s.replace(/\\([\\#])/g, '$1');
  for (const line of text.split('\n')) {
    const m = /^ *(not ok|ok) \d+ - ((?:[^#\\]|\\.)*?)(?: # (SKIP|TODO)\b ?(.*))?$/.exec(line);
    if (m) out.push({ name: unescape(m[2]!.trim()), ok: m[1] === 'ok', directive: m[3] ? (m[3].toLowerCase() as 'skip' | 'todo') : null, reason: m[4] ? unescape(m[4]) : '' });
  }
  return out;
}

export type Missing = { id: string; file: string; why: string };

export function fewerThanDeclared(root: string, files: string[], results: Result[], config: Config = loadConfig()): Missing[] {
  const reasons = new Set<string>();
  try {
    const value = readConstants(readFileSync(join(root, config.platformReasons.file), 'utf8')).get(config.platformReasons.export);
    if (value?.kind === 'list') value.items.forEach((r) => reasons.add(r));
    if (value?.kind === 'records') value.items.forEach((r) => { if (r.reason) reasons.add(r.reason); });
  } catch {
    reasons.clear();
  }
  const missing: Missing[] = [];
  for (const file of files) {
    for (const t of readSource(readFileSync(join(root, file), 'utf8')).tests) {
      const pattern = namePattern(t.id, t.dynamic);
      const mine = results.filter((r) => pattern.test(r.name));
      if (mine.length === 0) { missing.push({ id: t.id, file: `${file}:${t.line}`, why: 'did not run' }); continue; }
      const unlisted = mine.filter((r) => r.directive === 'skip' && !reasons.has(r.reason));
      if (unlisted.length > 0 && unlisted.length === mine.length) missing.push({ id: t.id, file: `${file}:${t.line}`, why: `skipped with ${JSON.stringify(unlisted[0]!.reason)}, which is not a platform reason of ${config.platformReasons.export}` });
    }
  }
  return missing;
}

if (process.argv[1] !== undefined && resolveMain(process.argv[1]) === import.meta.filename) {
  const argv = process.argv.slice(2);
  let tap = '';
  let root = process.cwd();
  const globs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tap' && argv[i + 1]) tap = argv[++i]!;
    else if (argv[i] === '--root' && argv[i + 1]) root = resolvePath(argv[++i]!);
    else if (!argv[i]!.startsWith('--')) globs.push(argv[i]!);
    else {
      process.stderr.write(`suite guard: unknown argument '${argv[i]}'\nusage: node tests/guard/count.ts --tap <file> [--root <dir>] <test file glob>...\n`);
      process.exit(2);
    }
  }
  if (!tap || globs.length === 0) {
    process.stderr.write('usage: node tests/guard/count.ts --tap <file> [--root <dir>] <test file glob>...\n');
    process.exit(2);
  }
  const files = [...new Set(globs.flatMap((g) => globSync(g, { cwd: root }).map((f) => f.replace(/\\/g, '/'))))].sort();
  const missing = fewerThanDeclared(root, files, readTapResults(readFileSync(tap, 'utf8')));
  for (const m of missing) process.stdout.write(`REFUSED  fewer-tests  ${m.id}\nwhere    ${m.file}\nwhat     ${m.why} on ${process.platform}\nneeds    nothing passes it: a test the sources declare runs, or skips with a platform reason\n\n`);
  process.stdout.write(missing.length === 0
    ? `suite guard: PASS  every test of ${files.length} files ran on ${process.platform}, or skipped with a platform reason\n`
    : `suite guard: FAIL  ${missing.length} declared test${missing.length === 1 ? '' : 's'} did not run on ${process.platform}\n`);
  process.exit(missing.length === 0 ? 0 : 1);
}
