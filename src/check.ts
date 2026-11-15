import { join } from 'node:path';
import { comparePaths, nestedReason, nestedRepositories, repositoryHolding, trackedLinks, workTreeTop } from './files.js';
import { compilePattern } from './glob.js';
import { hide } from './keys.js';
import type { ReviewerConfig } from './config.js';
import { takesWaivers } from './law.js';
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
import { crashNext, FindingBudget, linksOut, rulesDeadline, runAll, runnerProblem, runRule, slowMessage } from './rules.js';
import type { RawFinding, RuleOutcome } from './rules.js';
import { filesOfTypes, isBinary } from './types.js';
import { bytesOf, selectTargets } from './try.js';
import { fromCwd, loadConfig, loadLaw, loadRuleFiles, locate, requireGit, RULES_DIR, LAW, stopped, theChange, touchesLaw, typeAll } from './setup.js';
import type { Kinds, Read, ReviewerRule } from './setup.js';
import { judgeUses, listInForce, notRead } from './uses.js';
import type { Forbidden, NotRead, Target } from './uses.js';
import type { TypedFile } from './types.js';
import type { Runtime } from './environment.js';
import { readFailure, readVerdicts, reviewKey, Unwritable, VerdictWriter } from './verdicts.js';
import { parseWaivers, waive } from './waivers.js';
import { count, mib, points, readError, RUN_FINDINGS, RUN_MESSAGE_CHARS, USES_FILE_BYTES } from './limits.js';
import { step } from './progress.js';
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
    const { listed, files, read, kinds } = loadRuleFiles(root, law, false);
    const named = options.paths !== undefined && options.paths.length > 0;
    const chosen = named ? selectTargets(root, context.cwd, options.paths!, files, (path) => isBinary(bytesOf(read, path)), true) : null;
    const typed = typeAll(root, law, files, read, kinds.unreadable);
    const elsewhere = named ? inOtherRepositories(root, context.cwd, options.paths!, chosen!, listed) : [];
    return checkAt(root, options, context, { law, config, listed, files, read, kinds, typed, chosen, elsewhere });
  });
}

interface Front {
  law: Law;
  listed: Set<string>;
  elsewhere: string[];
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
  const budget = new FindingBudget();
  const deadline = rulesDeadline();
  const tasks = [...kinds.scripts]
    .map((rule) => ({ rule, files: run.filter((file) => file.rules.includes(rule)) }))
    .filter(({ files: bound }) => bound.length > 0)
    .map(({ rule, files: bound }) => async (): Promise<{ rule: string; outcome: RuleOutcome }> => ({
      rule,
      outcome: deadline.signal.aborted
        ? { slow: slowMessage('not started') }
        : await runRule({ root, rule, ruleFile: join(root, `${RULES_DIR}${rule}.mjs`), files: bound, filesOf, budget, signal: deadline.signal }),
    }));
  const unsupported = tasks.length === 0 ? null : runnerProblem(root);
  if (unsupported !== null) return { errors: [{ code: 'path-unsupported', file: null, line: null, message: unsupported }] };
  const out = tasks.length === 0 ? [] : linksOut(root, workTreeTop(root), trackedLinks(root));
  if (out.length > 0) return { errors: out.map(linkError) };
  const outcomes = await runAll(tasks);
  deadline.clear();
  const crashes: ErrorItem[] = [];
  const raw: RawFinding[] = [];
  for (const { rule, outcome } of outcomes) {
    if ('broken' in outcome) return { errors: [{ code: 'runner-failed', file: null, line: null, message: outcome.broken }] };
    if ('crash' in outcome) {
      const next = crashNext(outcome.crash);
      crashes.push({ code: 'rule-crashed', file: `${RULES_DIR}${rule}.mjs`, line: null, message: outcome.crash, ...(next === undefined ? {} : { next }) });
    } else if ('slow' in outcome) crashes.push({ code: 'rules-too-slow', file: `${RULES_DIR}${rule}.mjs`, line: null, message: outcome.slow });
    else for (const finding of outcome.findings) raw.push(finding);
  }
  if (crashes.length > 0) return { errors: crashes };
  if (budget.passed()) return { errors: tooManyFindings(budget) };

  const uses = await readTheUses(root, files, read, typed, run, changed);
  if ('errors' in uses) return { errors: uses.errors };
  const byFile = new Map<string, { count: number; chars: number }>();
  const tally = (path: string, text: string) => {
    const own = byFile.get(path) ?? { count: 0, chars: 0 };
    byFile.set(path, { count: own.count + 1, chars: own.chars + points(text) });
  };
  for (const item of uses.forbidden) tally(item.file, item.message);
  for (const item of uses.unresolved) tally(item.file, item.what);
  for (const item of uses.notRead) tally(LAW, item.message);
  for (const item of uses.tooLarge) tally(item.file, item.message);
  for (const path of [...byFile.keys()].sort(comparePaths)) {
    const own = byFile.get(path)!;
    if (budget.addAt(own.count, own.chars)) return { errors: [tooManyAt(path, budget)] };
  }

  const ruleIds = new Set([...law.rules.keys(), 'forbidden-use']);
  const waiversOf = new Map<string, ReturnType<typeof parseWaivers>>();
  for (const file of run) {
    const parsed = takesWaivers(file.type) ? parseWaivers(file.lines, ruleIds) : { waivers: [], problems: [] };
    waiversOf.set(file.path, parsed);
    let chars = 0;
    for (const problem of parsed.problems) chars += points(problem.message);
    for (const waiver of parsed.waivers) chars += points(waiver.reason);
    if (budget.addAt(parsed.problems.length + parsed.waivers.length, chars)) return { errors: [tooManyAt(file.path, budget)] };
  }
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
          let chars = 0;
          for (const finding of cached) chars += points(finding.message);
          if (budget.addAt(cached.length, chars)) return { errors: [tooManyAt(file.path, budget)] };
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
    const writer = new VerdictWriter(root);
    writer.ready(asks.map((ask) => ask.rule));
    context.warn?.(`lawcheck: ${plural(asks.length, 'reviewer call')} to ${config.provider}`);
    let result: Awaited<ReturnType<typeof call>>;
    try {
      result = await call(asks, provider!, writer, { cap, parallel: config.parallel, timeoutSeconds: config.timeout });
    } catch (error) {
      if (!(error instanceof Unwritable)) throw error;
      return { errors: [{ code: 'file-unwritable', file: error.path, line: null, message: `cannot be written (${error.cause}), so the answers of the reviewer calls this run made are lost`, ...(error.next === null ? {} : { next: error.next }) }] };
    }
    if (result.failed.length > 0) {
      const again = 'run the same command again; what was answered is kept, so it asks only the rest';
      return {
        errors: result.failed.map((f) => ({ code: f.code, file: f.ask.file, line: null, message: f.message, ...(f.fix === undefined ? {} : { next: `${f.fix}, then ${again}` }) })),
      };
    }
    for (const answered of result.answered) {
      let chars = 0;
      for (const finding of answered.findings) chars += points(finding.message);
      if (budget.addAt(answered.findings.length, chars)) return { errors: [tooManyAt(answered.ask.file, budget)] };
      reviewerRaw(answered.ask.file, answered.ask.rule, answered.findings);
    }
    callsMade = result.sent;
    passesRecorded = writer.added;
    missing = [];
  }
  for (const ask of missing) {
    const message = `${ask.rule} has no verdict for this content`;
    if (budget.addAt(1, points(message))) return { errors: [tooManyAt(ask.file, budget)] };
    builtIn.push({ code: 'not-reviewed', rule: ask.rule, file: ask.file, message });
  }

  step('judging the findings');
  const report = judge(law, run, raw, builtIn, uses, waiversOf, kinds.reviewers, changed, base, named ? 'paths' : options.full ? 'full' : 'change');
  report.reviews = {
    missing: [...report.findings, ...report.debt].filter((f) => f.code === 'not-reviewed').length,
    calls_made: callsMade,
    passes_recorded: passesRecorded,
  };
  report.next = nextOf(report, config, cap, review);
  report.lawChanged = lawChanged;
  const notes: string[] = [];
  if (lawChanged && !options.full) {
    notes.push(`note: the law changed in this change; lawcheck check --full${options.base === null ? '' : ` --base ${options.base}`} shows what it finds in the rest of the code`);
  }
  if (!named) {
    const unseen = unseenRepositories(root, front.listed, law);
    if (unseen !== null) notes.push(unseen);
  }
  notes.push(...front.elsewhere);
  report.note = notes.length === 0 ? null : notes.join('\n');
  return { report };
}

// A named path below a submodule or a repository of its own selects nothing, and the note says why rather than a bare count of 0.
function inOtherRepositories(root: string, cwd: string, words: string[], chosen: string[], listed: Set<string>): string[] {
  const notes: string[] = [];
  for (const word of words) {
    let path: string;
    try {
      path = fromCwd(root, cwd, word);
    } catch {
      continue;
    }
    const nested = repositoryHolding(root, path, listed);
    if (nested !== null && !chosen.includes(path)) notes.push(`note: ${path} ${nestedReason(nested).replace(/^it /, '')}`);
  }
  return notes;
}

// A type whose paths reach into a submodule or a repository of its own judges none of its files, and saying so is the one sign of it (stress finding S1-9).
function unseenRepositories(root: string, listed: Set<string>, law: Law): string | null {
  const plain = law.types.flatMap((type) => type.paths.filter((pattern) => !pattern.startsWith('!'))).map(compilePattern);
  const reached = nestedRepositories(root, listed).filter(({ dir }) => plain.some((pattern) => pattern.reaches(`${dir}/`)));
  if (reached.length === 0) return null;
  const named = reached.slice(0, 3).map(({ dir, submodule }) => `${dir} (${submodule ? 'a submodule' : 'a repository of its own'})`);
  const more = reached.length > 3 ? ` and ${reached.length - 3} more` : '';
  return `note: the paths of a type reach into ${named.join(', ')}${more}; Lawcheck does not look into another repository, so no file there is judged`;
}

export function tooManyFindings(budget: FindingBudget): ErrorItem[] {
  const all = `the rules of a run may return ${count(RUN_FINDINGS)} findings with ${count(RUN_MESSAGE_CHARS)} characters of message in all, and they returned ${count(budget.total)} with ${count(budget.chars)}`;
  const items: ErrorItem[] = [];
  for (const [rule, own] of budget.byRule) {
    if (own.count === 0) continue;
    items.push({ code: 'too-many-findings', file: `${RULES_DIR}${rule}.mjs`, line: null, message: `returns ${count(own.count)} findings with ${count(own.chars)} characters of message in this run; ${all}` });
  }
  return items;
}

function tooManyAt(path: string, budget: FindingBudget): ErrorItem {
  return {
    code: 'too-many-findings',
    file: path,
    line: null,
    message: `brings the findings of this run to ${count(budget.total)} with ${count(budget.chars)} characters of message, more than the ${count(RUN_FINDINGS)} findings with ${count(RUN_MESSAGE_CHARS)} characters one run may hold`,
    next: `narrow the types whose files bring so many findings, then run lawcheck check`,
  };
}

interface UsesRead {
  forbidden: Forbidden[];
  notRead: NotRead[];
  unresolved: Unresolved[];
  tooLarge: { file: string; message: string; type: string }[];
}

async function readTheUses(
  root: string,
  files: string[],
  read: Read,
  typed: TypedFile[],
  run: TypedFile[],
  changed: Set<string>,
): Promise<UsesRead | { errors: ErrorItem[] }> {
  const out: UsesRead = { forbidden: [], notRead: [], unresolved: [], tooLarge: [] };
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
      throw new Unreadable(path, readError(path, error));
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
  for (const { path, bytes, uses } of outcome.skipped) {
    const size = `the file holds ${count(bytes)} bytes, more than the ${mib(USES_FILE_BYTES)} a file whose uses are read may hold`;
    const message = uses ? `its uses are not read: ${size}` : `the uses of it are not judged: it is read for what it declares, and ${size}`;
    out.tooLarge.push({ file: path, message, type: typedByPath.get(path)?.type.id ?? '' });
  }

  const targetOf = (path: string): Target => {
    const file = typedByPath.get(path);
    if (file !== undefined) return { kind: 'typed', type: file.type };
    return ownerOf(path) === '#binary' ? { kind: 'binary' } : { kind: 'untyped' };
  };
  for (const file of run) {
    const found = outcome.uses.get(file.path);
    if (found === undefined) continue;
    const judged = judgeUses(file.path, file.type, found, targetOf);
    for (const item of judged.forbidden) out.forbidden.push(item);
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
    return { command: null, text: `ask the user to set reviewer.provider and reviewer.model in .lawcheck/config.yaml, then run ${review}` };
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

  for (const item of uses.tooLarge) {
    const isDebt = !changed.has(item.file);
    if (isDebt && mode !== 'full') continue;
    place({ code: 'uses-not-read', rule: null, severity: isDebt ? 'warning' : 'error', debt: isDebt, file: item.file, type: item.type, message: item.message, why: WHY['uses-not-read']! });
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
