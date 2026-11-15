import { join } from 'node:path';
import { comparePaths, trackedLinks, workTreeTop } from './files.js';
import { hide } from './keys.js';
import type { ReviewerConfig } from './config.js';
import type { Law } from './law.js';
import { fixNext, plural, sortFindings, WHY } from './output.js';
import type { ErrorItem, Finding, Next, Report, Unresolved, WaiverEntry } from './output.js';
import { buildPrompt, cleanMessage, FRAME, size } from './prompt.js';
import type { AnswerFinding } from './prompt.js';
import { createProvider } from './providers/index.js';
import { readerOf, readUses, siblingsOf, Unreadable } from './readers.js';
import type { ScriptView } from './readers.js';
import { call, preflight } from './review.js';
import type { Ask } from './review.js';
import { crashNext, linksOut, runAll, runnerProblem, runRule } from './rules.js';
import type { RawFinding } from './rules.js';
import { filesOfTypes, isBinary } from './types.js';
import { bytesOf, selectTargets } from './try.js';
import { loadConfig, loadLaw, loadRuleFiles, locate, requireGit, RULES_DIR, LAW, stopped, theChange, touchesLaw, typeAll } from './setup.js';
import type { Kinds, Read, ReviewerRule } from './setup.js';
import { judgeUses, listInForce, notRead } from './uses.js';
import type { Forbidden, NotRead, Target } from './uses.js';
import type { TypedFile } from './types.js';
import type { Runtime } from './environment.js';
import { readFailure, readVerdicts, reviewKey, VerdictWriter } from './verdicts.js';
import { parseWaivers, waive } from './waivers.js';
import type { Waiver, WaiverProblem } from './waivers.js';

export { findRoot } from './setup.js';

export interface CheckOptions {
  full: boolean;
  base: string | null;
  review?: boolean;
  again?: boolean;
  maxCalls?: number | null;
  paths?: string[];
}

export interface CheckContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  warn?: (line: string) => void;
  runtime?: Runtime;
}

export type CheckOutcome = { errors: ErrorItem[] } | { report: Report };

export async function check(options: CheckOptions, context: CheckContext): Promise<CheckOutcome> {
  return stopped(async () => {
    const root = locate(context.cwd);
    requireGit(root);
    const law = loadLaw(root);
    const config = loadConfig(root);
    const { files, read, kinds } = loadRuleFiles(root, law, false);
    const named = options.paths !== undefined && options.paths.length > 0;
    const chosen = named ? selectTargets(root, context.cwd, options.paths!, files, (path) => isBinary(bytesOf(read, path)), true) : null;
    const typed = typeAll(root, law, files, read, kinds.unreadable);
    return checkAt(root, options, context, { law, config, files, read, kinds, typed, chosen });
  });
}

interface Front {
  law: Law;
  config: ReviewerConfig;
  files: string[];
  read: Read;
  kinds: Kinds;
  typed: TypedFile[];
  chosen: string[] | null;
}

function linkError(link: { path: string; target: string }): ErrorItem {
  return { code: 'link-outside-root', file: link.path, line: null, message: `the link leads to ${link.target}, outside the git work tree and Lawcheck's folder, and a script rule could read through it` };
}

async function checkAt(root: string, options: CheckOptions, context: CheckContext, front: Front): Promise<CheckOutcome> {
  const { law, config, files, read, kinds, typed, chosen } = front;
  const named = chosen !== null;
  const { base, changed } = named ? { base: null, changed: new Set(chosen) } : theChange(root, files, options.base, context.env, options.full);
  const lawChanged = base !== null && [...changed].some(touchesLaw);

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
  const unsupported = tasks.length === 0 ? null : runnerProblem(root);
  if (unsupported !== null) return { errors: [{ code: 'path-unsupported', file: null, line: null, message: unsupported }] };
  const out = tasks.length === 0 ? [] : linksOut(root, workTreeTop(root), trackedLinks(root));
  if (out.length > 0) return { errors: out.map(linkError) };
  const outcomes = await runAll(tasks);
  const crashes: ErrorItem[] = [];
  const raw: RawFinding[] = [];
  for (const { rule, outcome } of outcomes) {
    if ('broken' in outcome) return { errors: [{ code: 'runner-failed', file: null, line: null, message: outcome.broken }] };
    if ('crash' in outcome) {
      const next = crashNext(outcome.crash);
      crashes.push({ code: 'rule-crashed', file: `${RULES_DIR}${rule}.mjs`, line: null, message: outcome.crash, ...(next === undefined ? {} : { next }) });
    }
    else raw.push(...outcome.findings);
  }
  if (crashes.length > 0) return { errors: crashes };

  const uses = await readTheUses(root, files, read, typed, run, changed);
  if ('errors' in uses) return { errors: uses.errors };

  const ruleIds = new Set([...law.rules.keys(), 'forbidden-use']);
  const waiversOf = new Map(run.map((file) => [file.path, parseWaivers(file.lines, ruleIds)]));
  const review = `lawcheck check --review${options.base === null ? '' : ` --base ${hide(options.base)}`}`;
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
    const result = await call(asks, provider!, writer, { cap, parallel: config.parallel, timeoutSeconds: config.timeout });
    if (result.failed.length > 0) {
      const again = 'run the same command again; what was answered is kept, so it asks only the rest';
      return {
        errors: result.failed.map((f) => ({ code: f.code, file: f.ask.file, line: null, message: f.message, ...(f.fix === undefined ? {} : { next: `${f.fix}, then ${again}` }) })),
      };
    }
    for (const answered of result.answered) reviewerRaw(answered.ask.file, answered.ask.rule, answered.findings);
    callsMade = result.sent;
    passesRecorded = writer.added;
    missing = [];
  }
  for (const ask of missing) {
    builtIn.push({ code: 'not-reviewed', rule: ask.rule, file: ask.file, message: `${ask.rule} has no verdict for this content` });
  }

  const report = judge(law, run, raw, builtIn, uses, waiversOf, kinds.reviewers, changed, base, named ? 'paths' : options.full ? 'full' : 'change');
  report.reviews = {
    missing: [...report.findings, ...report.debt].filter((f) => f.code === 'not-reviewed').length,
    calls_made: callsMade,
    passes_recorded: passesRecorded,
  };
  report.next = nextOf(report, config, cap, review);
  report.lawChanged = lawChanged;
  if (lawChanged && !options.full) {
    report.note = `note: the law changed in this change; lawcheck check --full${options.base === null ? '' : ` --base ${options.base}`} shows what it finds in the rest of the code`;
  }
  return { report };
}

interface UsesRead {
  forbidden: Forbidden[];
  notRead: NotRead[];
  unresolved: Unresolved[];
}

async function readTheUses(
  root: string,
  files: string[],
  read: Read,
  typed: TypedFile[],
  run: TypedFile[],
  changed: Set<string>,
): Promise<UsesRead | { errors: ErrorItem[] }> {
  const out: UsesRead = { forbidden: [], notRead: [], unresolved: [] };
  const siblings = siblingsOf(files);
  const toRead: { path: string; view: ScriptView | null }[] = [];
  const unread: { path: string; type: TypedFile['type']; debt: boolean }[] = [];
  for (const file of run) {
    if (listInForce(file.type) === null) continue;
    const reader = readerOf(file.path, file.text, siblings);
    if (reader.reader) toRead.push({ path: file.path, view: reader.view });
    else unread.push({ path: file.path, type: file.type, debt: !changed.has(file.path) });
  }
  out.notRead = notRead(unread);
  if (toRead.length === 0) return out;

  const known = new Set(files);
  const typedByPath = new Map(typed.map((file) => [file.path, file]));
  const bytes = (path: string) => {
    try {
      return read(path);
    } catch (error) {
      throw new Unreadable(path, (error as NodeJS.ErrnoException).code ?? 'an error');
    }
  };
  const ownerOf = (path: string) => {
    const file = typedByPath.get(path);
    if (file !== undefined) return file.type.id;
    if (!known.has(path)) return undefined;
    return isBinary(bytes(path)) ? '#binary' : '#untyped';
  };
  const outcome = await readUses({ root, files, bytes, ownerOf, read: toRead });
  if ('error' in outcome) return { errors: [outcome.error] };

  const targetOf = (path: string): Target => {
    const file = typedByPath.get(path);
    if (file !== undefined) return { kind: 'typed', type: file.type };
    return ownerOf(path) === '#binary' ? { kind: 'binary' } : { kind: 'untyped' };
  };
  for (const file of run) {
    const found = outcome.uses.get(file.path);
    if (found === undefined) continue;
    const judged = judgeUses(file.path, file.type, found, targetOf);
    out.forbidden.push(...judged.forbidden);
    const debt = !changed.has(file.path);
    for (const item of judged.unresolved) out.unresolved.push({ ...item, debt });
  }
  out.unresolved.sort((a, b) => comparePaths(a.file, b.file) || a.line - b.line || comparePaths(a.what, b.what));
  return out;
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
  uses: UsesRead,
  waiversOf: Map<string, { waivers: Waiver[]; problems: WaiverProblem[] }>,
  reviewers: Map<string, ReviewerRule>,
  changed: Set<string>,
  base: string | null,
  mode: Report['mode'],
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
    const severity = !isDebt && rule.status === 'enforced' && mode !== 'paths' ? 'error' : 'warning';
    place({ code: item.code, rule: rule.id, severity, debt: isDebt, file: item.file, type: byPath.get(item.file)!.type.id, message: item.message, why: WHY[item.code]! });
  }

  for (const item of uses.forbidden) {
    if (waive(waiversOf.get(item.file)!.waivers, 'forbidden-use', item.line)) continue;
    const isDebt = !changed.has(item.file);
    place({
      code: 'forbidden-use',
      rule: null,
      severity: isDebt ? 'warning' : 'error',
      debt: isDebt,
      file: item.file,
      line: item.line,
      type: byPath.get(item.file)!.type.id,
      message: item.message,
      why: WHY['forbidden-use']!,
    });
  }

  for (const item of uses.notRead) {
    place({ code: 'uses-not-read', rule: null, severity: 'warning', debt: item.debt, file: LAW, line: item.type.line, type: item.type.id, message: item.message, why: WHY['uses-not-read']! });
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
    mode,
    base,
    changed: changed.size,
    findings: sortFindings(change),
    debt: sortFindings(debt),
    waivers,
    unresolved: uses.unresolved,
  };
}
