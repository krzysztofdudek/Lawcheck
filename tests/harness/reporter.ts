import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOWEST_SHOWN } from '../numbers.ts';
import { INVARIANTS } from './invariants.ts';
import { promiseOf, testIds } from './promises.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLOSING = 'if the promise changed, change the spec row first; the guard then accepts a new expectation';

interface Failed {
  name: string;
  file: string;
  error: any;
}

const where = (file: string | undefined) => (file ? relative(ROOT, file.startsWith('file:') ? fileURLToPath(file) : file).split('\\').join('/') : '?');

function rootCause(error: any): any {
  let e = error;
  while (e && e.code === 'ERR_TEST_FAILURE' && e.cause) e = e.cause;
  return e ?? error;
}

function messageOf(error: any): string {
  const e = rootCause(error);
  if (e === undefined || e === null) return 'no error was reported';
  if (typeof e === 'string') return e;
  const text = typeof e.message === 'string' && e.message !== '' ? e.message : String(e);
  return text;
}

function clip(text: string, lines: number): string[] {
  const all = text.split('\n');
  const kept = all.slice(0, lines).map((line) => (line.length > 300 ? line.slice(0, 300) + '...' : line));
  if (all.length > lines) kept.push(`... ${all.length - lines} more lines`);
  return kept;
}

const quote = (s: string) => JSON.stringify(s);
const shell = (s: string) => (/^[\w./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

function block(failed: Failed, seeds: Map<string, string>): string[] {
  const ids = testIds(failed.name);
  const file = where(failed.file);
  const message = messageOf(failed.error);
  const head = ids.length > 0 ? ids.join(', ') : failed.name.slice(0, 80);
  const out: string[] = [];
  const rerun = `rerun    npm run t -- ${ids.length > 0 ? shell(ids[0]!) : file}`;
  const missing = /^could not run: (.*)/s.exec(message);
  if (missing !== null) {
    out.push(`RED      ${head}  ${file}`, `could not run  ${clip(missing[1]!, 3).join(' ')}`, rerun);
    return out;
  }
  out.push(`RED      ${head}  ${file}`);
  if (ids.length === 0) out.push(`promise  none: the name "${failed.name.slice(0, 120)}" carries no spec row, invariant or finding id`);
  for (const id of ids) {
    const promised = promiseOf(id);
    out.push(promised === null ? `promise  ${id} names no row of spec/*.md or tests/findings.md` : `promise  ${promised.where}: ${quote(promised.text)}`);
  }
  const broke = /^(harness-[a-z0-9]+): /.exec(message);
  if (broke !== null && INVARIANTS[broke[1]!]) out.push(`broke    ${broke[1]}: ${INVARIANTS[broke[1]!]}`);
  const got = clip(message, 14);
  out.push(`got      ${got[0]}`, ...got.slice(1).map((line) => `         ${line}`));
  const counter = /Counterexample: (.*)/.exec(message);
  const seed = /seed: (-?\d+)/.exec(message)?.[1] ?? seeds.get(failed.file);
  if (seed !== undefined) out.push(`input    seed ${seed}${counter ? `, shrunk to ${counter[1]}` : ''}`);
  out.push(rerun, CLOSING);
  return out;
}

export default async function* reporter(source: AsyncIterable<{ type: string; data: any }>): AsyncGenerator<string> {
  const failed: Failed[] = [];
  const times: { ms: number; name: string; file: string }[] = [];
  const files = new Set<string>();
  const seeds = new Map<string, string>();
  const counts = { passed: 0, failed: 0, skipped: 0, todo: 0 };
  for await (const event of source) {
    const data = event.data ?? {};
    if (event.type === 'test:stdout' || event.type === 'test:stderr') {
      const seen = /^seed (-?\d+)$/m.exec(String(data.message ?? ''));
      if (seen !== null && data.file) seeds.set(data.file, seen[1]!);
      continue;
    }
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    if (data.details?.type === 'suite') {
      if (event.type === 'test:fail' && data.details?.error?.failureType !== 'subtestsFailed') {
        failed.push({ name: data.name, file: data.file, error: data.details.error });
        counts.failed++;
      }
      continue;
    }
    if (data.nesting !== 0) continue;
    if (data.file) files.add(data.file);
    const fileItself = data.file !== undefined && (data.name === data.file || data.name === where(data.file));
    if (fileItself && event.type === 'test:pass') continue;
    if (data.skip !== undefined) counts.skipped++;
    else if (data.todo !== undefined) counts.todo++;
    else if (event.type === 'test:pass') counts.passed++;
    else {
      counts.failed++;
      failed.push({ name: data.name, file: data.file, error: data.details?.error });
    }
    times.push({ ms: data.details?.duration_ms ?? 0, name: data.name, file: data.file });
  }
  const total = counts.passed + counts.failed + counts.skipped + counts.todo;
  const parts = [`${counts.passed} passed`, `${counts.failed} failed`];
  if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
  if (counts.todo > 0) parts.push(`${counts.todo} todo`);
  const lines: string[] = [];
  const started = Number(process.env.LAWCHECK_STARTED);
  const took = Number.isFinite(started) && started > 0 ? Date.now() - started : null;
  lines.push(`ran ${files.size} test files, ${total} tests: ${parts.join(', ')}${took === null ? '' : `, in ${(took / 1000).toFixed(1)} s`}`);
  const target = Number(process.env.LAWCHECK_TARGET_MS);
  if (took !== null && target > 0 && took > target) lines.push(`past the target of ${target / 1000} s for this speed (tests/numbers.ts)`);
  for (const [file, seed] of seeds) lines.push(`seed ${seed}  ${where(file)}`);
  times.sort((a, b) => b.ms - a.ms);
  if (times.length > 0) {
    lines.push('', 'slowest');
    for (const t of times.slice(0, SLOWEST_SHOWN)) lines.push(`${String(Math.round(t.ms)).padStart(8)} ms  ${t.name.slice(0, 90)}  ${where(t.file)}`);
  }
  for (const f of failed) lines.push('', ...block(f, seeds));
  yield lines.join('\n') + '\n';
}
