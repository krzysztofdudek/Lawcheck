import { join } from 'node:path';
import { comparePaths, nestedReason, nestedRepositories, repositoryHolding } from './files.js';
import { compilePattern } from './glob.js';
import { hide, SIGNING_KEY } from './keys.js';
import type { ReviewerConfig } from './config.js';
import { patternFor, takesWaivers } from './law.js';
import type { Law } from './law.js';
import { addedWaiversLine, blocking, fixNext, plural, sortFindings, WHY } from './output.js';
import type { ErrorItem, Finding, Next, Report, Unresolved, WaiverEntry } from './output.js';
import { buildPrompt, cleanMessage, FRAME, size } from './prompt.js';
import type { AnswerFinding } from './prompt.js';
import { createProvider } from './providers/index.js';
import { ownersOf, readerOf, readUses, ruleReads, siblingsOf } from './readers.js';
import type { ScriptView } from './readers.js';
import { atBase, kindsAt, lawAt, lawChangeLine, lawChanges, localConfigOfChange, packagesOfChange, writeRules } from './lawchange.js';
import type { LawAt } from './lawchange.js';
import { call, preflight } from './review.js';
import type { Ask } from './review.js';
import { contextOf, crashError, FindingBudget, resolveCompanions, rulesDeadline, runAll, runnerErrors, runRule, slowMessage, tooManyFindings } from './rules.js';
import type { CompanionRun, CopyOfRules, RawFinding, RuleOutcome } from './rules.js';
import { decode, filesOfTypes, isBinary, splitLines } from './types.js';
import { bytesOf, fromCwd, loadConfig, loadLaw, loadRuleFiles, locate, requireGit, RULES_DIR, LAW, selectTargets, Stop, stopped, theChange, touchesLaw, typingErrors, workFiles } from './setup.js';
import type { Kinds, Read, ReviewerRule } from './setup.js';
import { judgeUses, listInForce, notRead } from './uses.js';
import type { Forbidden, NotRead, Target } from './uses.js';
import type { TypedFile } from './types.js';
import type { CheckContext } from './args.js';
import { countPasses, FULL_NEXT, readFailure, readPasses, reviewKey, signingKey, Unwritable, VERDICTS, VerdictsFull, VerdictsUnreadable, VerdictWriter } from './verdicts.js';
import type { Passes, Signer } from './verdicts.js';
import { addedWaivers, parseWaivers, waive, waivedLines } from './waivers.js';
import { count, mib, points, RUN_FINDINGS, RUN_MESSAGE_CHARS, USES_FILE_BYTES } from './limits.js';
import { step } from './progress.js';
import type { Waiver, WaiverProblem } from './waivers.js';

export { findRoot } from './setup.js';

export interface CheckOptions {
  full: boolean;
  strict?: boolean;
  base: string | null;
  lawFrom?: string | null;
  review?: boolean;
  again?: boolean;
  maxCalls?: number | null;
  paths?: string[];
}

export type CheckOutcome = { errors: ErrorItem[]; calls?: number } | { report: Report };

export async function check(options: CheckOptions, context: CheckContext): Promise<CheckOutcome> {
  return stopped(async () => {
    const root = locate(context.cwd);
    requireGit(root);
    const from = typeof options.lawFrom === 'string' ? lawAt(root, options.lawFrom) : null;
    const law = from === null ? loadLaw(root) : from.law;
    const config = from === null ? loadConfig(root) : from.config;
    const { listed, files, read, kinds } = from === null ? loadRuleFiles(root, law, false) : rulesOf(root, from);
    const named = options.paths !== undefined && options.paths.length > 0;
    const chosen = named ? selectTargets(root, context.cwd, options.paths!, files, (path) => isBinary(bytesOf(read, path)), true) : null;
    const { typed, untyped, errors } = typingErrors(root, law, files, read, kinds.unreadable);
    if (errors.length > 0) throw new Stop(errors);
    const elsewhere = named ? inOtherRepositories(root, context.cwd, options.paths!, chosen!, listed) : [];
    const loads = kinds.scripts.size > 0 || [...kinds.reviewers.values()].some((reviewer) => reviewer.companion !== null);
    const copy = from !== null && loads ? writeRules(root, from) : null;
    try {
      const ofCopy: CopyOfRules | undefined = copy === null ? undefined : { folder: copy.folder, ref: from!.ref, again: againCommand(options) };
      return await checkAt(root, options, context, { law, config, listed, files, read, kinds, typed, untyped, chosen, elsewhere, modules: copy?.folder ?? root, copy: ofCopy });
    } finally {
      copy?.release();
    }
  });
}

function againCommand(options: CheckOptions): string {
  return `lawcheck check${options.full ? ' --full' : ''}${options.strict === true ? ' --strict' : ''}${options.review === true ? ' --review' : ''}${options.base === null ? '' : ` --base ${hide(options.base)}`} --law-from ${hide(options.lawFrom!)}`;
}

function rulesOf(root: string, from: LawAt): { listed: Set<string>; files: string[]; read: Read; kinds: Kinds } {
  const work = workFiles(root);
  localConfigOfChange(root, work.listed);
  packagesOfChange(work.listed, from.ref);
  return { ...work, kinds: kindsAt(from, work.files, work.read).kinds };
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
  untyped: string[];
  chosen: string[] | null;
  modules: string;
  copy?: CopyOfRules;
}

async function checkAt(root: string, options: CheckOptions, context: CheckContext, front: Front): Promise<CheckOutcome> {
  const { law, config, files, read, kinds, typed, chosen } = front;
  const named = chosen !== null;
  const { base, changed } = named ? { base: null, changed: new Set(chosen) } : theChange(root, files, options.base, context.env, options.full);
  const lawChanged = base !== null && [...changed].some(touchesLaw);

  const run = options.full ? typed : typed.filter((file) => changed.has(file.path));
  run.sort((a, b) => comparePaths(a.path, b.path));
  const untyped = (options.full ? front.untyped : front.untyped.filter((path) => changed.has(path))).map((path) => ({ file: path, message: untypedMessage(law, path) }));
  const filesOf = filesOfTypes(typed, law);
  const budget = new FindingBudget();
  const deadline = rulesDeadline();
  const reads = ruleReads({ root, files, ...ownersOf(files, read, typed) });
  const tasks = [...kinds.scripts]
    .map((rule) => ({ rule, files: run.filter((file) => file.rules.includes(rule)) }))
    .filter(({ files: bound }) => bound.length > 0)
    .map(({ rule, files: bound }) => async (): Promise<{ rule: string; outcome: RuleOutcome }> => ({
      rule,
      outcome: deadline.signal.aborted
        ? { slow: slowMessage('not started') }
        : await runRule({ root, rule, ruleFile: join(front.modules, `${RULES_DIR}${rule}.mjs`), files: bound, filesOf, budget, signal: deadline.signal, serve: reads(bound, `the script rule ${rule}`) }),
    }));
  const paired = [...kinds.reviewers].filter(([, reviewer]) => reviewer.companion !== null).map(([rule]) => ({ rule, files: run.filter((file) => file.rules.includes(rule)) })).filter(({ files: bound }) => bound.length > 0);
  if (tasks.length > 0 || paired.length > 0) {
    const errors = runnerErrors(root);
    if (errors.length > 0) return { errors };
  }
  const outcomes = await runAll(tasks);
  const crashes: ErrorItem[] = [];
  const raw: RawFinding[] = [];
  for (const { rule, outcome } of outcomes) {
    if ('broken' in outcome) return { errors: [{ code: 'runner-failed', file: null, line: null, message: outcome.broken }] };
    if ('crash' in outcome) crashes.push(crashError(`${RULES_DIR}${rule}.mjs`, outcome, front.copy)); else if ('slow' in outcome) crashes.push({ code: 'rules-too-slow', file: `${RULES_DIR}${rule}.mjs`, line: null, message: outcome.slow });
    else for (const finding of outcome.findings) raw.push(finding);
  }
  if (crashes.length > 0) {
    deadline.clear();
    return { errors: crashes };
  }
  if (budget.passed()) {
    deadline.clear();
    return { errors: tooManyFindings(budget) };
  }
  const companionRun = { root, modules: front.modules, files, read, filesOf, serve: reads, signal: deadline.signal, copy: front.copy };
  const resolved = await resolveCompanions(companionRun, kinds.reviewers, paired);
  deadline.clear();
  if ('errors' in resolved) return { errors: resolved.errors };
  const companions = resolved.companions;

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
  for (const item of untyped) tally(item.file, item.message);
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
  const review = `lawcheck check${options.strict === true ? ' --strict' : ''} --review${options.base === null ? '' : ` --base ${hide(options.base)}`}${typeof options.lawFrom === 'string' ? ` --law-from ${hide(options.lawFrom)}` : ''}`;
  const cap = options.maxCalls ?? config.maxCalls;

  const roomOf = () => verdictRoom(root, law, typed, kinds, companionRun);
  let verdicts: Passes;
  try {
    verdicts = readPasses(root, law.signers);
  } catch (error) {
    if (!(error instanceof VerdictsUnreadable) || !error.cause.startsWith('it holds more')) throw error;
    const room = await roomOf();
    if (typeof room !== 'string') return { errors: room };
    return { errors: [{ code: 'file-unreadable', file: VERDICTS, line: null, message: `the file cannot be read (${error.cause}); ${room}`, next: FULL_NEXT }] };
  }
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
      const waived = waivedLines(waiversOf.get(file.path)!.waivers, rule);
      const context = contextOf(reviewer, companions, rule, file.path);
      const key = reviewKey({ frame: FRAME, ruleId: rule, why, ruleText: reviewer.text, context, filePath: file.path, fileText: file.text, waived, companion: reviewer.companion });
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
      const prompt = buildPrompt({ why, ruleText: reviewer.text, context, filePath: file.path, fileText: file.text, waived });
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
    const signing = law.signers === null ? { signer: null } : signerOf(law.signers, context.env, review);
    const blocked = [...preflight(provider, config, cap, asks.length, review), ...('problem' in signing ? [signing.problem] : [])];
    if (blocked.length > 0 || 'problem' in signing) return { errors: blocked };
    const writer = new VerdictWriter(root, signing.signer);
    try {
      writer.ready(asks.map((ask) => ask.rule));
    } catch (error) {
      if (!(error instanceof VerdictsFull)) throw error;
      const room = await roomOf();
      if (typeof room !== 'string') return { errors: room };
      return { errors: [{ code: 'file-unwritable', file: VERDICTS, line: null, message: `cannot be written (${error.cause}); ${room}`, next: FULL_NEXT }] };
    }
    context.warn?.(`lawcheck: ${plural(asks.length, 'reviewer call')} to ${config.provider}`);
    let result: Awaited<ReturnType<typeof call>>;
    try {
      result = await call(asks, provider!, writer, { cap, parallel: config.parallel, timeoutSeconds: config.timeout });
    } catch (error) {
      if (!(error instanceof Unwritable)) throw error;
      let room = '';
      if (error instanceof VerdictsFull) {
        const known = await roomOf();
        if (typeof known !== 'string') return { errors: known };
        room = `; ${known}`;
      }
      return { errors: [{ code: 'file-unwritable', file: error.path, line: null, message: `cannot be written (${error.cause}), so the answers of the reviewer calls this run made are lost${room}`, ...(error.next === null ? {} : { next: error.next }) }] };
    }
    callsMade = result.sent;
    if (result.failed.length > 0) {
      const again = 'run the same command again; what was answered is kept, so it asks only the rest';
      return {
        errors: result.failed.map((f) => ({ code: f.code, file: f.ask.file, line: null, message: f.message, ...(f.fix === undefined ? {} : { next: `${f.fix}, then ${again}` }) })),
        calls: callsMade,
      };
    }
    for (const answered of result.answered) {
      let chars = 0;
      for (const finding of answered.findings) chars += points(finding.message);
      if (budget.addAt(answered.findings.length, chars)) return { errors: [tooManyAt(answered.ask.file, budget)], calls: callsMade };
      reviewerRaw(answered.ask.file, answered.ask.rule, answered.findings);
    }
    passesRecorded = writer.added;
    missing = [];
  }
  for (const ask of missing) {
    const message = verdicts.uncounted(`${ask.key} ${ask.rule}`) ? `${ask.rule} has a pass for this content that no signer of the law signed` : `${ask.rule} has no verdict for this content`;
    if (budget.addAt(1, points(message))) return { errors: [tooManyAt(ask.file, budget)] };
    builtIn.push({ code: 'not-reviewed', rule: ask.rule, file: ask.file, message });
  }

  step('judging the findings');
  const added = base === null ? null : addedInChange(root, base, run, changed, waiversOf, ruleIds);
  const report = judge(law, run, raw, builtIn, uses, untyped, waiversOf, added, kinds.reviewers, changed, base, named ? 'paths' : options.full ? 'full' : 'change', options.strict === true);
  report.reviews = {
    missing: [...report.findings, ...report.debt].filter((f) => f.code === 'not-reviewed').length,
    calls_made: callsMade,
    passes_recorded: passesRecorded,
  };
  report.next = nextOf(report, config, cap, review);
  report.lawChanged = lawChanged;
  const notes: string[] = [];
  if (lawChanged) {
    const told = lawChanges(root, base!, files, changed);
    const from = typeof options.lawFrom === 'string' ? options.lawFrom : null;
    if (!options.full && from === null) notes.push(`note: the law changed in this change; lawcheck check --full${options.base === null ? '' : ` --base ${options.base}`} shows what it finds in the rest of the code`);
    if (told.length > 0) {
      report.lawChanges = told;
      notes.push(lawChangeLine(told, from === null ? 'this change edits the law that judges it' : `this change edits its own law, and the law of ${from} judged it`));
    }
  }
  const addedLine = addedWaiversLine(report.waivers);
  if (addedLine !== null) notes.push(addedLine);
  if (!named) {
    const unseen = unseenRepositories(root, front.listed, law);
    if (unseen !== null) notes.push(unseen);
  }
  notes.push(...front.elsewhere);
  report.note = notes.length === 0 ? null : notes.join('\n');
  return { report };
}

// A run that records a pass the law would not count pays for calls that leave every file not-reviewed, so the key is checked before the first call.
function signerOf(signers: ReadonlyMap<string, string>, env: NodeJS.ProcessEnv, review: string): { signer: Signer } | { problem: ErrorItem } {
  const refused = (message: string, next: string): { problem: ErrorItem } => ({ problem: { code: 'not-a-signer', file: null, line: null, message, next: `${next}, then run ${review}` } });
  const setIt = `ask the user to set ${SIGNING_KEY} to the signing key of a signer that .lawcheck/law.yaml names`;
  const text = env[SIGNING_KEY] ?? '';
  if (text === '') return refused(`the law names signers and ${SIGNING_KEY} is not set, so this run could record no pass that counts`, setIt);
  const own = signingKey(text);
  if (own === null) return refused(`${SIGNING_KEY} holds no Ed25519 signing key: it takes 43 characters of base64url`, setIt);
  const name = [...signers].find(([, key]) => key === own.publicKey)?.[0];
  if (name === undefined) return refused(`the key in ${SIGNING_KEY} belongs to no signer of the law; its public key is ${own.publicKey}`, `ask the user whether to add a signer with this public key to signers in .lawcheck/law.yaml, or to set ${SIGNING_KEY} to the key of a signer the law names`);
  return { signer: { name, key: own.key } };
}

// A waiver is read only in a file whose type takes waivers, so a marker in a file no type takes, or one under ignored, waives nothing and is not named; the law-change note names the pattern that put the file there.
function addedInChange(root: string, base: string, run: TypedFile[], changed: Set<string>, waiversOf: Map<string, { waivers: Waiver[] }>, ruleIds: Set<string>): Set<Waiver> | null {
  const read = atBase(root, base);
  if (read === null) return null;
  const added = new Set<Waiver>();
  const waived = run.filter((file) => waiversOf.get(file.path)!.waivers.length > 0 && changed.has(file.path));
  const atFork = read(waived.map((file) => file.path));
  for (const file of waived) {
    const now = waiversOf.get(file.path)!.waivers;
    const bytes = atFork.get(file.path) ?? null;
    const lines = bytes === null || isBinary(bytes) ? [] : splitLines(decode(bytes));
    for (const waiver of addedWaivers(now, file.lines, parseWaivers(lines, ruleIds).waivers, lines)) added.add(waiver);
  }
  return added;
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

// What the reviews of this tree need of a full verdicts file, worked out with no call: its passes, those the files of the tree need, and the calls a review of every file of the law would take.
async function verdictRoom(root: string, law: Law, typed: TypedFile[], kinds: Kinds, run: CompanionRun): Promise<string | ErrorItem[]> {
  const paired = [...kinds.reviewers].filter(([, reviewer]) => reviewer.companion !== null).map(([rule]) => ({ rule, files: typed.filter((file) => file.rules.includes(rule)) })).filter(({ files }) => files.length > 0);
  // The run guarded the runner only for the files it judges, and this counts every file of the law, so a run that judged none of a companion's files has not guarded it.
  if (paired.length > 0) {
    const errors = runnerErrors(root);
    if (errors.length > 0) return errors;
  }
  const resolved = await resolveCompanions({ ...run, signal: undefined }, kinds.reviewers, paired);
  if ('errors' in resolved) return resolved.errors;
  const needed = new Set<string>();
  const ruleIds = new Set([...law.rules.keys(), 'forbidden-use']);
  for (const file of typed) {
    let waivers: Waiver[] | null = null;
    for (const rule of file.rules) {
      const reviewer = kinds.reviewers.get(rule);
      if (reviewer === undefined) continue;
      waivers ??= takesWaivers(file.type) ? parseWaivers(file.lines, ruleIds).waivers : [];
      const why = law.rules.get(rule)!.why;
      const waived = waivedLines(waivers, rule);
      const context = contextOf(reviewer, resolved.companions, rule, file.path);
      needed.add(`${reviewKey({ frame: FRAME, ruleId: rule, why, ruleText: reviewer.text, context, filePath: file.path, fileText: file.text, waived, companion: reviewer.companion })} ${rule}`);
    }
  }
  const counted = countPasses(root, needed);
  return `of its ${count(counted.held)} ${counted.held === 1 ? 'pass' : 'passes'} the files of this tree need ${count(counted.needed)}, and a review of every file of this law would take ${plural(needed.size, 'reviewer call')}`;
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

function untypedMessage(law: Law, path: string): string {
  return `the file lies under required (${patternFor(law.required, path)}) and no type of the law takes it`;
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

  const typedByPath = new Map(typed.map((file) => [file.path, file]));
  const { bytes, ownerOf } = ownersOf(files, read, typed);
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
  const stopping = blocking(report);
  if (stopping.length === 0) return null;
  const other = stopping.find((f) => f.code !== 'not-reviewed');
  if (other !== undefined) return { command: null, text: fixNext(other) };
  const count = stopping.filter((f) => f.code === 'not-reviewed').length;
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
  untyped: { file: string; message: string }[],
  waiversOf: Map<string, { waivers: Waiver[]; problems: WaiverProblem[] }>,
  added: Set<Waiver> | null,
  reviewers: Map<string, ReviewerRule>,
  changed: Set<string>,
  base: string | null,
  mode: Report['mode'],
  strict: boolean,
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
    const severity = (!isDebt || strict) && rule.status === 'enforced' ? 'error' : 'warning';
    const finding: Finding = { code: rule.id, rule: rule.id, severity, debt: isDebt, file: item.file, type: file.type.id, message: item.message, why: rule.why };
    if (item.line !== undefined) finding.line = item.line;
    place(finding);
  }

  for (const item of builtIn) {
    const rule = law.rules.get(item.rule)!;
    const isDebt = !changed.has(item.file);
    const severity = (!isDebt || strict) && rule.status === 'enforced' && mode !== 'paths' ? 'error' : 'warning';
    place({ code: item.code, rule: rule.id, severity, debt: isDebt, file: item.file, type: byPath.get(item.file)!.type.id, message: item.message, why: WHY[item.code]! });
  }

  for (const item of uses.forbidden) {
    if (waive(waiversOf.get(item.file)!.waivers, 'forbidden-use', item.line)) continue;
    const isDebt = !changed.has(item.file);
    place({
      code: 'forbidden-use',
      rule: null,
      severity: isDebt && !strict ? 'warning' : 'error',
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
    place({ code: 'uses-not-read', rule: null, severity: isDebt && !strict ? 'warning' : 'error', debt: isDebt, file: item.file, type: item.type, message: item.message, why: WHY['uses-not-read']! });
  }

  for (const item of untyped) {
    const isDebt = !changed.has(item.file);
    place({ code: 'untyped-file', rule: null, severity: isDebt && !strict ? 'warning' : 'error', debt: isDebt, file: item.file, type: '', message: item.message, why: WHY['untyped-file']! });
  }

  for (const item of uses.notRead) {
    place({ code: 'uses-not-read', rule: null, severity: 'warning', debt: item.debt, file: LAW, line: item.type.line, type: item.type.id, message: item.message, why: WHY['uses-not-read']! });
  }

  const waivers: WaiverEntry[] = [];
  for (const file of run) {
    const isDebt = !changed.has(file.path);
    const { waivers: valid, problems } = waiversOf.get(file.path)!;
    for (const problem of problems) {
      place({ code: problem.code, rule: null, severity: isDebt && !strict ? 'warning' : 'error', debt: isDebt, file: file.path, line: problem.line, type: file.type.id, message: problem.message, why: WHY[problem.code]! });
    }
    for (const waiver of valid) {
      waivers.push({ file: file.path, line: waiver.line, rule: waiver.rule, debt: isDebt, waived: waiver.waived, reason: waiver.reason, added: added === null ? null : added.has(waiver) });
      if (waiver.waived === 0 && !reviewers.has(waiver.rule)) {
        const taken = valid.find((other) => other !== waiver && other.rule === waiver.rule && other.covers === waiver.covers && other.waived > 0);
        const because = taken === undefined ? '' : `; the waiver on line ${taken.line} already drops the findings of that line`;
        place({ code: 'waiver-unused', rule: null, severity: 'warning', debt: isDebt, file: file.path, line: waiver.line, type: file.type.id, message: `the waiver of '${waiver.rule}' drops no finding${because}`, why: WHY['waiver-unused']! });
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
