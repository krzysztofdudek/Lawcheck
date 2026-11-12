import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  changedPaths,
  comparePaths,
  defaultBase,
  GitFailed,
  hasHead,
  listFiles,
  mergeBase,
  NoGit,
  resolveCommit,
  workTreeProblem,
} from './files.js';
import { parseLaw } from './law.js';
import type { Law } from './law.js';
import { sortFindings, WHY } from './output.js';
import type { ErrorItem, Finding, Report, WaiverEntry } from './output.js';
import { runAll, runRule } from './rules.js';
import type { RawFinding } from './rules.js';
import { decode, filesOfTypes, typeFiles } from './types.js';
import type { TypedFile } from './types.js';
import { parseWaivers, waive } from './waivers.js';

export interface CheckOptions {
  full: boolean;
  base: string | null;
}

export interface CheckContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type CheckOutcome = { errors: ErrorItem[] } | { report: Report };

const LAW = '.lawcheck/law.yaml';
const RULES_DIR = '.lawcheck/rules/';

export class Internal extends Error {}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function findRoot(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    if (isFile(join(dir, LAW))) return realpathSync(dir);
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function errors(...items: ErrorItem[]): CheckOutcome {
  return { errors: items };
}

export async function check(options: CheckOptions, context: CheckContext): Promise<CheckOutcome> {
  const root = findRoot(context.cwd);
  if (root === null) {
    return errors({ code: 'not-initialized', file: null, line: null, message: `no ${LAW} in this directory or any above it` });
  }
  try {
    return await checkAt(root, options, context);
  } catch (error) {
    if (error instanceof NoGit) return errors({ code: 'no-git', file: null, line: null, message: error.message });
    if (error instanceof GitFailed) throw new Internal(error.message);
    throw error;
  }
}

async function checkAt(root: string, options: CheckOptions, context: CheckContext): Promise<CheckOutcome> {
  const notGit = workTreeProblem(root);
  if (notGit !== null) return errors({ code: 'no-git', file: null, line: null, message: notGit });

  let source: Uint8Array;
  try {
    source = readFileSync(join(root, LAW));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'an error';
    return errors({ code: 'law-invalid', file: LAW, line: 1, message: `the law cannot be read (${code})` });
  }
  const { law, problems } = parseLaw(decode(source));
  if (law === null) {
    return { errors: problems.map((p) => ({ code: 'law-invalid', file: LAW, line: p.line, message: p.message })) };
  }

  const files = listFiles(root);
  const ruleFiles = ruleFileProblems(law, files);
  if (ruleFiles.length > 0) return { errors: ruleFiles };

  const { typed, unreadable, overlaps } = typeFiles(root, files, law);
  if (unreadable.length > 0) return { errors: unreadable };
  if (overlaps.length > 0) return { errors: overlaps };

  const head = hasHead(root);
  const base = options.base ?? (context.env.LAWCHECK_BASE ? context.env.LAWCHECK_BASE : null) ?? defaultBase(root);
  let changed: Set<string>;
  if (base === null) {
    changed = new Set(files);
  } else {
    const unreachable = (message: string) => errors({ code: 'base-unreachable', file: null, line: null, message });
    if (!head) return unreachable(`the repository has no commit yet, so the base '${base}' cannot be reached`);
    const commit = resolveCommit(root, base);
    if (commit === null) return unreachable(`the base '${base}' names no commit here`);
    const fork = mergeBase(root, commit);
    if (fork === null) return unreachable(`the base '${base}' shares no history with HEAD`);
    const known = new Set(files);
    changed = new Set(changedPaths(root, fork).filter((path) => known.has(path)));
  }

  const run = options.full ? typed : typed.filter((file) => changed.has(file.path));
  run.sort((a, b) => comparePaths(a.path, b.path));
  const filesOf = filesOfTypes(typed, law);
  const tasks = [...law.rules.keys()]
    .map((rule) => ({ rule, files: run.filter((file) => file.rules.includes(rule)) }))
    .filter(({ files: bound }) => bound.length > 0)
    .map(({ rule, files: bound }) => async () => ({
      rule,
      outcome: await runRule({ root, rule, ruleFile: join(root, `${RULES_DIR}${rule}.mjs`), files: bound, filesOf }),
    }));
  const outcomes = await runAll(tasks);
  const crashes: ErrorItem[] = [];
  const raw: RawFinding[] = [];
  for (const { rule, outcome } of outcomes) {
    if ('crash' in outcome) crashes.push({ code: 'rule-crashed', file: `${RULES_DIR}${rule}.mjs`, line: null, message: outcome.crash });
    else raw.push(...outcome.findings);
  }
  if (crashes.length > 0) return { errors: crashes };

  return { report: judge(law, run, raw, changed, base, options.full) };
}

function ruleFileProblems(law: Law, files: string[]): ErrorItem[] {
  const present = new Set(files);
  const expected = new Set<string>();
  const out: ErrorItem[] = [];
  for (const rule of law.rules.values()) {
    const file = `${RULES_DIR}${rule.id}.mjs`;
    expected.add(file);
    if (!present.has(file)) out.push({ code: 'rule-missing-file', file: LAW, line: rule.line, message: `the rule '${rule.id}' has no file ${file}` });
  }
  for (const file of files) {
    if (!file.startsWith(RULES_DIR) || file.startsWith(`${RULES_DIR}lib/`) || expected.has(file)) continue;
    out.push({ code: 'rule-file-without-entry', file, line: null, message: 'the file is no rule of the law and lies outside .lawcheck/rules/lib/' });
  }
  return out;
}

function judge(law: Law, run: TypedFile[], raw: RawFinding[], changed: Set<string>, base: string | null, full: boolean): Report {
  const byPath = new Map(run.map((file) => [file.path, file]));
  const ruleIds = new Set(law.rules.keys());
  const waiversOf = new Map(run.map((file) => [file.path, parseWaivers(file.lines, ruleIds)]));
  const change: Finding[] = [];
  const debt: Finding[] = [];
  const place = (finding: Finding) => (finding.debt ? debt : change).push(finding);

  for (const item of raw) {
    const file = byPath.get(item.file)!;
    if (item.line !== undefined && waive(waiversOf.get(item.file)!.waivers, item.rule, item.line)) continue;
    const rule = law.rules.get(item.rule)!;
    const isDebt = !changed.has(item.file);
    const severity = !isDebt && rule.status === 'enforced' ? 'error' : 'warning';
    const finding: Finding = { code: rule.id, rule: rule.id, severity, debt: isDebt, file: item.file, type: file.type.id, message: item.message, why: rule.why };
    if (item.line !== undefined) finding.line = item.line;
    place(finding);
  }

  const waivers: WaiverEntry[] = [];
  for (const file of run) {
    const isDebt = !changed.has(file.path);
    const { waivers: valid, problems } = waiversOf.get(file.path)!;
    for (const problem of problems) {
      place({ code: problem.code, rule: null, severity: isDebt ? 'warning' : 'error', debt: isDebt, file: file.path, line: problem.line, type: file.type.id, message: problem.message, why: WHY[problem.code]! });
    }
    for (const waiver of valid) {
      waivers.push({ file: file.path, line: waiver.line, rule: waiver.rule, debt: isDebt, waived: waiver.waived, reason: waiver.reason });
      if (waiver.waived === 0) {
        place({ code: 'waiver-unused', rule: null, severity: 'warning', debt: isDebt, file: file.path, line: waiver.line, type: file.type.id, message: `the waiver of '${waiver.rule}' drops no finding`, why: WHY['waiver-unused']! });
      }
    }
  }

  return {
    mode: full ? 'full' : 'change',
    base,
    changed: changed.size,
    findings: sortFindings(change),
    debt: sortFindings(debt),
    waivers,
  };
}
