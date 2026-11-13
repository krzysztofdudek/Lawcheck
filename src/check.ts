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
import { CONFIG, readConfig } from './config.js';
import type { ReviewerConfig } from './config.js';
import { parseLaw } from './law.js';
import type { Law } from './law.js';
import { fixNext, plural, sortFindings, WHY } from './output.js';
import type { ErrorItem, Finding, Next, Report, WaiverEntry } from './output.js';
import { buildPrompt, cleanMessage, FRAME, size } from './prompt.js';
import type { AnswerFinding } from './prompt.js';
import { createProvider } from './providers/index.js';
import { call, preflight } from './review.js';
import type { Ask } from './review.js';
import { runAll, runRule } from './rules.js';
import type { RawFinding } from './rules.js';
import { decode, filesOfTypes, isBinary, typeFiles } from './types.js';
import type { TypedFile } from './types.js';
import { readFailure, readVerdicts, reviewKey, VERDICTS, VerdictWriter } from './verdicts.js';
import { parseWaivers, waive } from './waivers.js';
import type { Waiver, WaiverProblem } from './waivers.js';

export interface CheckOptions {
  full: boolean;
  base: string | null;
  review?: boolean;
  again?: boolean;
  maxCalls?: number | null;
}

export interface CheckContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  warn?: (line: string) => void;
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

type Read = (path: string) => Uint8Array;

function onceReader(root: string): Read {
  const reads = new Map<string, Uint8Array | Error>();
  return (path) => {
    let entry = reads.get(path);
    if (entry === undefined) {
      try {
        entry = readFileSync(join(root, path));
      } catch (error) {
        entry = error as Error;
      }
      reads.set(path, entry);
    }
    if (entry instanceof Error) throw entry;
    return entry;
  };
}

function unreadable(path: string, error: unknown): ErrorItem {
  const code = (error as NodeJS.ErrnoException).code ?? 'an error';
  return { code: 'file-unreadable', file: path, line: null, message: `the file cannot be read (${code})` };
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

  const configured = readConfig(root);
  if ('problems' in configured) {
    return { errors: configured.problems.map((p) => ({ code: 'config-invalid', file: CONFIG, line: p.line, message: p.message })) };
  }
  const config = configured.config;

  const files = listFiles(root);
  const read = onceReader(root);
  const kinds = ruleKinds(law, files, read);
  if (kinds.errors.length > 0) return { errors: kinds.errors };

  const { typed, unreadable: unreadableFiles, overlaps } = typeFiles(
    root,
    files.filter((path) => path !== VERDICTS),
    law,
    read,
  );
  const cannotRead = [...unreadableFiles];
  for (const item of kinds.unreadable) if (!cannotRead.some((known) => known.file === item.file)) cannotRead.push(item);
  if (cannotRead.length > 0) return { errors: cannotRead };
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
  const tasks = [...kinds.scripts]
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

  const ruleIds = new Set(law.rules.keys());
  const waiversOf = new Map(run.map((file) => [file.path, parseWaivers(file.lines, ruleIds)]));
  const review = `lawcheck check --review${options.base === null ? '' : ` --base ${options.base}`}`;
  const cap = options.maxCalls ?? config.maxCalls;

  const verdicts = readVerdicts(root);
  const asks: Ask[] = [];
  const builtIn: BuiltIn[] = [];
  const reviewerRaw = (file: string, rule: string, findings: AnswerFinding[]) => {
    for (const finding of findings) {
      const item: RawFinding = { rule, file, message: cleanMessage(finding.message) };
      if (finding.line !== null) item.line = finding.line;
      raw.push(item);
    }
  };
  for (const file of run) {
    const bound = file.rules.filter((rule) => kinds.reviewers.has(rule)).sort(comparePaths);
    for (const rule of bound) {
      const reviewer = kinds.reviewers.get(rule)!;
      const why = law.rules.get(rule)!.why;
      const key = reviewKey({ frame: FRAME, ruleId: rule, why, ruleText: reviewer.text, context: reviewer.context, filePath: file.path, fileText: file.text });
      if (verdicts.has(`${key} ${rule}`)) continue;
      const lineCount = file.lines.length;
      if (!options.again) {
        const cached = readFailure(root, key, rule, lineCount);
        if (cached !== null) {
          reviewerRaw(file.path, rule, cached);
          continue;
        }
      }
      const covered = waiversOf.get(file.path)!.waivers.filter((w) => w.rule === rule && w.covers !== null).map((w) => w.covers!);
      const waived = [...new Set(covered)].sort((a, b) => a - b);
      const prompt = buildPrompt({ why, ruleText: reviewer.text, context: reviewer.context, filePath: file.path, fileText: file.text, waived });
      const characters = size(prompt);
      if (characters > config.maxChars) {
        builtIn.push({
          code: 'too-large-to-review',
          rule,
          file: file.path,
          message: `the prompt for ${rule} holds ${characters} characters; reviewer.max_chars is ${config.maxChars}`,
        });
        continue;
      }
      asks.push({ file: file.path, rule, key, prompt, lineCount, waived: new Set(waived) });
    }
  }

  let callsMade = 0;
  let passesRecorded = 0;
  let missing = asks;
  if (options.review && asks.length > 0) {
    const provider = createProvider(config, context.env);
    const blocked = preflight(provider, config, cap, asks.length, review);
    if (blocked.length > 0) return { errors: blocked };
    context.warn?.(`lawcheck: ${plural(asks.length, 'reviewer call')} to ${config.provider}`);
    const writer = new VerdictWriter(root);
    const result = await call(asks, provider!, writer, { cap, parallel: config.parallel });
    if (result.failed.length > 0) {
      return { errors: result.failed.map((f) => ({ code: f.code, file: f.ask.file, line: null, message: f.message })) };
    }
    for (const answered of result.answered) reviewerRaw(answered.ask.file, answered.ask.rule, answered.findings);
    callsMade = result.sent;
    passesRecorded = writer.added;
    missing = [];
  }
  for (const ask of missing) {
    builtIn.push({ code: 'not-reviewed', rule: ask.rule, file: ask.file, message: `${ask.rule} has no verdict for this content` });
  }

  const report = judge(law, run, raw, builtIn, waiversOf, kinds.reviewers, changed, base, options.full);
  report.reviews = {
    missing: [...report.findings, ...report.debt].filter((f) => f.code === 'not-reviewed').length,
    calls_made: callsMade,
    passes_recorded: passesRecorded,
  };
  report.next = nextOf(report, config, cap, review);
  return { report };
}

function nextOf(report: Report, config: ReviewerConfig, cap: number, review: string): Next | null {
  const blocking = report.findings.filter((f) => f.severity === 'error');
  if (blocking.length === 0) return null;
  const other = blocking.find((f) => f.code !== 'not-reviewed');
  if (other !== undefined) return { command: null, text: fixNext(other) };
  const count = report.findings.filter((f) => f.code === 'not-reviewed').length;
  if (config.provider === null) {
    return { command: null, text: `set reviewer.provider and reviewer.model in .lawcheck/config.yaml, then run ${review}` };
  }
  if (count > cap) {
    return { command: null, text: `${count} reviewer calls are needed and reviewer.max_calls is ${cap}; raising the limit is the user's decision` };
  }
  return { command: review, text: `${review}  (${plural(count, 'reviewer call')})` };
}

export interface ReviewerRule {
  text: string;
  context: { path: string; text: string }[];
}

interface Kinds {
  errors: ErrorItem[];
  unreadable: ErrorItem[];
  scripts: Set<string>;
  reviewers: Map<string, ReviewerRule>;
}

function ruleKinds(law: Law, files: string[], read: Read): Kinds {
  const present = new Set(files);
  const expected = new Set<string>();
  const out: Kinds = { errors: [], unreadable: [], scripts: new Set(), reviewers: new Map() };
  const invalid = (line: number, message: string) => out.errors.push({ code: 'law-invalid', file: LAW, line, message });
  for (const rule of law.rules.values()) {
    const script = `${RULES_DIR}${rule.id}.mjs`;
    const prose = `${RULES_DIR}${rule.id}.md`;
    expected.add(script);
    expected.add(prose);
    const hasScript = present.has(script);
    const hasProse = present.has(prose);
    if (!hasScript && !hasProse) {
      out.errors.push({ code: 'rule-missing-file', file: LAW, line: rule.line, message: `the rule '${rule.id}' has neither ${script} nor ${prose}` });
      continue;
    }
    if (hasScript && hasProse) {
      out.errors.push({
        code: 'rule-file-without-entry',
        file: prose,
        line: null,
        message: `the rule '${rule.id}' already has its script ${script}`,
        next: `keep one of ${script} and ${prose}, then run lawcheck check`,
      });
      continue;
    }
    if (hasScript) {
      out.scripts.add(rule.id);
      if (rule.context !== null) invalid(rule.contextLine!, `the script rule '${rule.id}' takes no 'context'; only a reviewer rule does`);
      continue;
    }
    let text: string | null = null;
    try {
      text = decode(read(prose));
    } catch (error) {
      out.errors.push(unreadable(prose, error));
    }
    if (text !== null && text.trim() === '') {
      out.errors.push({ code: 'rule-missing-file', file: LAW, line: rule.line, message: `the file ${prose} of the rule '${rule.id}' holds only whitespace` });
    }
    const context: { path: string; text: string }[] = [];
    for (const item of rule.context ?? []) {
      if (!present.has(item.path)) {
        invalid(item.line, `'context' of rule '${rule.id}' names '${item.path}', which is no file git lists here`);
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = read(item.path);
      } catch (error) {
        if (!out.unreadable.some((known) => known.file === item.path)) out.unreadable.push(unreadable(item.path, error));
        continue;
      }
      if (isBinary(bytes)) invalid(item.line, `'context' of rule '${rule.id}' names '${item.path}', which is binary`);
      else context.push({ path: item.path, text: decode(bytes) });
    }
    if (text !== null) out.reviewers.set(rule.id, { text, context });
  }
  for (const file of files) {
    if (!file.startsWith(RULES_DIR) || file.startsWith(`${RULES_DIR}lib/`) || expected.has(file)) continue;
    out.errors.push({ code: 'rule-file-without-entry', file, line: null, message: 'the file is no rule of the law and lies outside .lawcheck/rules/lib/' });
  }
  return out;
}

interface BuiltIn {
  code: 'not-reviewed' | 'too-large-to-review';
  rule: string;
  file: string;
  message: string;
}

function judge(
  law: Law,
  run: TypedFile[],
  raw: RawFinding[],
  builtIn: BuiltIn[],
  waiversOf: Map<string, { waivers: Waiver[]; problems: WaiverProblem[] }>,
  reviewers: Map<string, ReviewerRule>,
  changed: Set<string>,
  base: string | null,
  full: boolean,
): Report {
  const byPath = new Map(run.map((file) => [file.path, file]));
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

  for (const item of builtIn) {
    const rule = law.rules.get(item.rule)!;
    const isDebt = !changed.has(item.file);
    const severity = !isDebt && rule.status === 'enforced' ? 'error' : 'warning';
    place({ code: item.code, rule: rule.id, severity, debt: isDebt, file: item.file, type: byPath.get(item.file)!.type.id, message: item.message, why: WHY[item.code]! });
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
      if (waiver.waived === 0 && !reviewers.has(waiver.rule)) {
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
