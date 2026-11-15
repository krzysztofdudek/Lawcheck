import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineVerdict } from './baseline.ts';
import { startTool } from '../harness/start.ts';

const RUNS = 10;
const ATTEMPTS = 3;
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(ROOT, 'tests', 'stability', 'fixture');
const DEFAULT_OUT = join(ROOT, 'tests', 'stability', 'result.json');
const REVIEWER_ERRORS = new Set(['reviewer-unreachable', 'reviewer-bad-answer']);

interface Label {
  file: string;
  rule: string;
  label: 'pass' | 'fail';
  borderline: boolean;
}

interface Attempt {
  run: number;
  attempt: number;
  exit: number | null;
  calls_made: number | null;
  errors: { code: string; file: string | null }[];
}

interface Finding {
  code: string;
  file: string;
  message: string;
}

const labels = JSON.parse(readFileSync(join(ROOT, 'tests', 'stability', 'labels.json'), 'utf8')) as Label[];

function stop(code: number, message: string): never {
  process.stderr.write(`stability: ${message}\n`);
  process.exit(code);
}

function present(name: string): string | null {
  const value = process.env[name];
  return value === undefined || value === '' ? null : value;
}

const provider = present('LAWCHECK_STABILITY_PROVIDER') ?? 'openai-compatible';
if (provider !== 'openai-compatible' && provider !== 'claude-code') stop(2, 'LAWCHECK_STABILITY_PROVIDER takes openai-compatible or claude-code');
const endpoint = provider === 'openai-compatible' ? present('LAWCHECK_REVIEWER_ENDPOINT') : null;
const model = present('LAWCHECK_STABILITY_MODEL');
const key = present('LAWCHECK_REVIEWER_KEY');
if (provider === 'openai-compatible') {
  const missing = [endpoint === null ? 'LAWCHECK_REVIEWER_ENDPOINT' : null, model === null ? 'LAWCHECK_STABILITY_MODEL' : null].filter(Boolean);
  if (missing.length > 0) stop(2, `set ${missing.join(' and ')}`);
}
const note = present('LAWCHECK_STABILITY_NOTE');
const out = present('LAWCHECK_STABILITY_OUT') ?? DEFAULT_OUT;

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, env: GIT_ENV, stdio: ['ignore', 'ignore', 'pipe'] });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${String(result.stderr).trim()}`);
}

async function attempt(): Promise<{ exit: number | null; document: any }> {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-stability-'));
  try {
    cpSync(FIXTURE, dir, { recursive: true });
    writeFileSync(join(dir, '.lawcheck', 'config.yaml'), `reviewer:\n  provider: ${provider}\n${model === null ? '' : `  model: ${JSON.stringify(model)}\n`}`);
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'fixture']);
    const env = { ...process.env };
    delete env.LAWCHECK_BASE;
    const result = await startTool(dir, ['check', '--review', '--json'], env, { budget: 'STABILITY_RUN_BUDGET_MS' }).ended;
    let document: any = null;
    try {
      document = JSON.parse(result.stdout);
    } catch {
      document = null;
    }
    return { exit: result.code, document };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const labelled = new Set(labels.map((label) => `${label.file}\u0000${label.rule}`));
const attempts: Attempt[] = [];
const verdicts: ('pass' | 'fail')[][] = labels.map(() => []);
const messages: string[][][] = labels.map(() => []);

for (let run = 1; run <= RUNS; run++) {
  let done = false;
  for (let number = 1; number <= ATTEMPTS && !done; number++) {
    let outcome: { exit: number | null; document: any };
    try {
      outcome = await attempt();
    } catch (error) {
      stop(2, `run ${run}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const { exit, document } = outcome;
    if ((exit === 0 || exit === 1) && document?.schema === 'lawcheck-check/0') {
      const findings = document.findings as Finding[];
      if (findings.some((f) => f.code === 'not-reviewed' || f.code === 'too-large-to-review')) stop(2, `run ${run}: a review was not asked`);
      if (findings.some((f) => !labelled.has(`${f.file}\u0000${f.code}`))) stop(2, `run ${run}: a finding names a file and rule the labels do not hold`);
      const failing = labels.map((label) => findings.filter((f) => f.file === label.file && f.code === label.rule));
      const failingPairs = failing.filter((list) => list.length > 0).length;
      if (document.reviews.passes_recorded + failingPairs !== labels.length) {
        stop(2, `run ${run}: ${document.reviews.passes_recorded} passes and ${failingPairs} failing pairs do not make ${labels.length}`);
      }
      failing.forEach((list, index) => {
        verdicts[index]!.push(list.length > 0 ? 'fail' : 'pass');
        messages[index]!.push(list.map((f) => f.message));
      });
      attempts.push({ run, attempt: number, exit, calls_made: document.reviews.calls_made, errors: [] });
      done = true;
    } else if (exit === 2 && document?.schema === 'lawcheck-error/1') {
      const errors = (document.errors as { code: string; file: string | null }[]).map((e) => ({ code: e.code, file: e.file }));
      if (errors.length === 0 || !errors.every((e) => REVIEWER_ERRORS.has(e.code))) {
        stop(2, `run ${run}: lawcheck could not conclude: ${errors.map((e) => e.code).join(', ')}`);
      }
      attempts.push({ run, attempt: number, exit, calls_made: null, errors });
      process.stderr.write(`stability: run ${run}, attempt ${number} failed: ${errors.map((e) => `${e.code} at ${e.file}`).join(', ')}\n`);
    } else {
      stop(2, `run ${run}: lawcheck ended with ${exit} and no document`);
    }
  }
  if (!done) stop(1, `run ${run} failed ${ATTEMPTS} times; nothing is written`);
  process.stderr.write(`stability: run ${run} of ${RUNS} done\n`);
}

const share = (x: number) => Math.round(x * 1000) / 1000;
const groups = {
  all: labels.map((_, index) => index),
  clear: labels.flatMap((label, index) => (label.borderline ? [] : [index])),
  borderline: labels.flatMap((label, index) => (label.borderline ? [index] : [])),
};

function runPairs(list: string[]): number {
  let same = 0;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (list[i] === list[j]) same++;
  return same;
}

const pairsOfRuns = (RUNS * (RUNS - 1)) / 2;
const agreement = (indexes: number[]) => {
  const agreeing = indexes.filter((index) => verdicts[index]!.every((v) => v === verdicts[index]![0])).length;
  return { pairs: indexes.length, agreeing, share: share(agreeing / indexes.length) };
};
const pairwise = (indexes: number[]) => share(indexes.reduce((sum, index) => sum + runPairs(verdicts[index]!) / pairsOfRuns, 0) / indexes.length);
const labelMatch = (indexes: number[]) => {
  const all = indexes.length * RUNS;
  const matching = indexes.reduce((sum, index) => sum + verdicts[index]!.filter((v) => v === labels[index]!.label).length, 0);
  return { verdicts: all, matching, share: share(matching / all) };
};

const baseline = labels.map((label) => baselineVerdict(label.rule, readFileSync(join(FIXTURE, label.file), 'utf8')));
const baselineMatch = (indexes: number[]) => {
  const matching = indexes.filter((index) => baseline[index] === labels[index]!.label).length;
  return { verdicts: indexes.length, matching, share: share(matching / indexes.length) };
};

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
const result = {
  schema: 'lawcheck-stability/1',
  date: new Date().toISOString().slice(0, 10),
  lawcheck: manifest.version,
  verdict_format: 'lawcheck-verdict/1',
  provider,
  model,
  temperature_sent: provider === 'claude-code' ? null : 0,
  note,
  runs: RUNS,
  agreement: { all: agreement(groups.all), clear: agreement(groups.clear), borderline: agreement(groups.borderline) },
  pairwise_agreement: { all: pairwise(groups.all), clear: pairwise(groups.clear), borderline: pairwise(groups.borderline) },
  label_match: { all: labelMatch(groups.all), clear: labelMatch(groups.clear), borderline: labelMatch(groups.borderline) },
  baseline: {
    pairwise_agreement: { all: 1, clear: 1, borderline: 1 },
    label_match: { all: baselineMatch(groups.all), clear: baselineMatch(groups.clear), borderline: baselineMatch(groups.borderline) },
  },
  attempts,
  pairs: labels.map((label, index) => ({
    file: label.file,
    rule: label.rule,
    label: label.label,
    borderline: label.borderline,
    verdicts: verdicts[index],
    messages: messages[index],
    baseline: baseline[index],
  })),
};

function strings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') found.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, found);
  else if (typeof value === 'object' && value !== null) for (const item of Object.values(value)) strings(item, found);
  return found;
}

const leaks = strings(result).filter((text) => (key !== null && text.includes(key)) || (endpoint !== null && text.includes(endpoint)) || text.includes('://'));
if (leaks.length > 0) stop(2, `the result would hold the key, the endpoint or an address in ${leaks.length} strings; nothing is written`);

writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
const line = (name: string, group: 'all' | 'clear' | 'borderline') =>
  `${name}: pairwise agreement ${result.pairwise_agreement[group]}, agreement ${result.agreement[group].agreeing}/${result.agreement[group].pairs} (${result.agreement[group].share}), label match ${result.label_match[group].matching}/${result.label_match[group].verdicts} (${result.label_match[group].share})`;
const baselineLine = (group: 'all' | 'clear' | 'borderline') =>
  `baseline ${group}: label match ${result.baseline.label_match[group].matching}/${result.baseline.label_match[group].verdicts} (${result.baseline.label_match[group].share})`;
process.stdout.write(
  [line('all', 'all'), line('clear', 'clear'), line('borderline', 'borderline'), baselineLine('all'), baselineLine('clear'), baselineLine('borderline')].join('\n') + '\n',
);
