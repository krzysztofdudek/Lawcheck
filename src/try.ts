import { realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { documentOf, errorResult, number, usageError } from './args.js';
import type { Arguments, Result } from './args.js';
import type { CheckContext } from './check.js';
import { comparePaths, nestedReason, repositoryHolding, trackedLinks, workTreeTop } from './files.js';
import { onDisk } from './names.js';
import { compileList, patternProblem } from './glob.js';
import { CODES, plural, shown } from './output.js';
import { takesWaivers } from './law.js';
import type { ErrorItem } from './output.js';
import { ruleKind } from './prime.js';
import { buildPrompt, cleanMessage, size } from './prompt.js';
import { createProvider } from './providers/index.js';
import { call, NO_RECORD, preflight, remaining } from './review.js';
import type { Ask } from './review.js';
import { ownersOf, ruleReads } from './readers.js';
import { crashNext, FindingBudget, linksOut, rulesDeadline, runnerProblem, runRule } from './rules.js';
import type { RawFinding } from './rules.js';
import { tooManyFindings } from './check.js';
import type { RuleFile } from './rules.js';
import { fromCwd, loadConfig, loadLaw, loadRuleFiles, locate, nearPart, repoPath, requireGit, RULES_DIR, stopped, Stop, typeAll, usage } from './setup.js';
import type { Read } from './setup.js';
import { readError } from './limits.js';
import { decode, filesOfTypes, isBinary, splitLines } from './types.js';
import { parseWaivers, waive } from './waivers.js';

const LIMIT = 50;

function isPattern(word: string): boolean {
  return /[*?{]/.test(word);
}

function listedFile(root: string, cwd: string, word: string, files: string[]): boolean {
  try {
    return files.includes(fromCwd(root, cwd, word));
  } catch {
    return false;
  }
}

function isDirectory(path: string | Buffer): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function selectTargets(root: string, cwd: string, targets: string[], files: string[], binary: (path: string) => boolean, lenient = false, listed: Set<string> = new Set()): string[] {
  const chosen = new Set<string>();
  const here = repoPath(root, realpathSync(resolve(cwd)));
  class None extends Error {}
  const none = (word: string, why: string) => (lenient ? new None() : usage(`the target '${word}' selects no file: ${why}`));
  for (const word of targets) {
    try {
      select(word);
    } catch (error) {
      if (!(error instanceof None)) throw error;
    }
  }
  return [...chosen].sort(comparePaths);

  function select(word: string): void {
    if (isPattern(word) && !listedFile(root, cwd, word, files)) {
      const problem = patternProblem(word);
      if (problem !== null) throw usage(`the pattern '${word}' ${problem}`);
      const matches = compileList([here === '' ? word : `${here}/${word}`]);
      const hits = files.filter((file) => matches(file) && !binary(file));
      if (hits.length === 0) throw none(word, 'matches no file');
      hits.forEach((file) => chosen.add(file));
      return;
    }
    const path = fromCwd(root, cwd, word);
    if (files.includes(path)) {
      if (binary(path)) throw none(word, 'it is binary');
      chosen.add(path);
      return;
    }
    if (path === '.' || isDirectory(onDisk(root, path))) {
      const hits = files.filter((file) => (path === '.' || file.startsWith(`${path}/`)) && !binary(file));
      if (hits.length === 0) throw none(word, 'matches no file');
      hits.forEach((file) => chosen.add(file));
      return;
    }
    const nested = repositoryHolding(root, path, listed);
    throw none(word, nested === null ? 'git ignores it or it does not exist' : nestedReason(nested));
  }
}

interface Found {
  line?: number;
  message: string;
  severity: 'error' | 'warning';
}

interface Run {
  file: string;
  attempt: number;
  verdict: 'pass' | 'fail' | null;
  findings: Found[];
  waived: number;
  answer: string | null;
  prompt_chars: number | null;
}

interface Outcome {
  rule: string;
  kind: 'script' | 'reviewer';
  status: string;
  why: string;
  files: string[];
  times: number;
  dryRun: boolean;
  runs: Run[];
  calls: number;
  maxChars: number;
}

export function bytesOf(read: Read, path: string): Uint8Array {
  try {
    return read(path);
  } catch (error) {
    throw new Stop([readError(path, error)]);
  }
}

export async function tryRule(args: Arguments, context: CheckContext, json: boolean): Promise<Result> {
  const id = args.words[0];
  if (id === undefined) return usageError('try takes the id of a rule: lawcheck try <rule> [<path or pattern>...]', json, 'try');
  const targets = args.words.slice(1);
  const times = number(args, '--times');
  const maxCalls = number(args, '--max-calls');
  const dryRun = args.flags.has('--dry-run');
  if (times === 0) return usageError('the flag --times takes a number of at least 1', json, 'try');
  const outcome = await stopped(async (): Promise<Outcome> => {
    const root = locate(context.cwd);
    requireGit(root);
    const law = loadLaw(root);
    if (!law.rules.has(id)) {
      if (CODES.has(id)) throw usage(`'${id}' is a code of Lawcheck and no rule of the law; lawcheck check judges it`);
      throw usage(`the law has no rule '${id}'${nearPart(id, [...law.rules.keys()])}`);
    }
    const config = loadConfig(root);
    const { listed, files, read, kinds } = loadRuleFiles(root, law);
    const kind = ruleKind(kinds, id);
    if (kind === 'script' && (times !== null || dryRun || maxCalls !== null)) {
      throw usage(`--times, --dry-run and --max-calls go only with a reviewer rule, and ${id} is a script rule`);
    }
    if (dryRun && maxCalls !== null) throw usage('--max-calls does not go with --dry-run, which makes no call');
    if (kind === 'reviewer') {
      if (targets.length === 0) throw usage(`a reviewer rule is tried on the files you name, one call each: lawcheck try ${id} <file>...`);
      for (const word of targets) {
        if (isPattern(word) && !listedFile(root, context.cwd, word, files)) throw usage(`a reviewer rule takes files one by one, and '${word}' is a pattern`);
        const path = fromCwd(root, context.cwd, word);
        if (!files.includes(path) && (path === '.' || isDirectory(onDisk(root, path)))) throw usage(`a reviewer rule takes files one by one, and '${word}' is a directory`);
      }
    }
    const binary = (path: string) => isBinary(bytesOf(read, path));
    let chosen = selectTargets(root, context.cwd, targets, files, binary, false, listed);
    const typed = typeAll(root, law, files, read);
    const typeOf = new Map(typed.map((file) => [file.path, file.type]));
    if (targets.length === 0) {
      chosen = typed.filter((file) => file.rules.includes(id)).map((file) => file.path);
      if (chosen.length === 0) throw usage(`no file has a type that lists ${id}; name the files to try it on: lawcheck try ${id} <path or pattern>`);
    }
    const rule = law.rules.get(id)!;
    const severity = rule.status === 'enforced' ? 'error' : 'warning';
    const ruleIds = new Set([...law.rules.keys(), 'forbidden-use']);
    const ruleFiles: RuleFile[] = chosen.map((path) => {
      const text = decode(bytesOf(read, path));
      return { path, type: typeOf.get(path) ?? null, text, lines: splitLines(text) };
    });
    const waiversOf = new Map(ruleFiles.map((file) => [file.path, takesWaivers(file.type) ? parseWaivers(file.lines, ruleIds).waivers : []]));
    const result: Outcome = { rule: id, kind, status: rule.status, why: rule.why, files: chosen, times: times ?? 1, dryRun, runs: [], calls: 0, maxChars: config.maxChars };

    if (kind === 'script') {
      const unsupported = runnerProblem(root);
      if (unsupported !== null) throw new Stop([{ code: 'path-unsupported', file: null, line: null, message: unsupported }]);
      const out = linksOut(root, workTreeTop(root), trackedLinks(root));
      if (out.length > 0) {
        throw new Stop(out.map((link) => ({ code: 'link-outside-root', file: link.path, line: null, message: `the link leads to ${link.target}, outside the git work tree and Lawcheck's folder, and a script rule could read through it` })));
      }
      const budget = new FindingBudget();
      const deadline = rulesDeadline();
      const reads = ruleReads({ root, files, ...ownersOf(files, read, typed) });
      const ran = await runRule({ root, rule: id, ruleFile: join(root, `${RULES_DIR}${id}.mjs`), files: ruleFiles, filesOf: filesOfTypes(typed, law), budget, signal: deadline.signal, serve: reads(ruleFiles) });
      deadline.clear();
      if ('broken' in ran) throw new Stop([{ code: 'runner-failed', file: null, line: null, message: ran.broken }]);
      if ('crash' in ran) {
        const next = crashNext(ran.crash);
        throw new Stop([{ code: 'rule-crashed', file: `${RULES_DIR}${id}.mjs`, line: null, message: ran.crash, ...(next === undefined ? {} : { next }) }]);
      }
      if ('slow' in ran) throw new Stop([{ code: 'rules-too-slow', file: `${RULES_DIR}${id}.mjs`, line: null, message: ran.slow }]);
      if (budget.passed()) throw new Stop(tooManyFindings(budget));
      const byFile = new Map<string, RawFinding[]>();
      for (const item of ran.findings) {
        const list = byFile.get(item.file);
        if (list === undefined) byFile.set(item.file, [item]);
        else list.push(item);
      }
      for (const file of ruleFiles) {
        const run: Run = { file: file.path, attempt: 1, verdict: null, findings: [], waived: 0, answer: null, prompt_chars: null };
        for (const item of byFile.get(file.path) ?? []) {
          if (item.line !== undefined && waive(waiversOf.get(file.path)!, id, item.line)) {
            run.waived++;
            continue;
          }
          run.findings.push({ ...(item.line === undefined ? {} : { line: item.line }), message: item.message, severity });
        }
        result.runs.push(run);
      }
      return result;
    }

    const reviewer = kinds.reviewers.get(id)!;
    const prompts = ruleFiles.map((file) => {
      const covered = waiversOf.get(file.path)!.filter((w) => w.rule === id && w.covers !== null).map((w) => w.covers!);
      const waived = [...new Set(covered)].sort((a, b) => a - b);
      const prompt = buildPrompt({ why: rule.why, ruleText: reviewer.text, context: reviewer.context, filePath: file.path, fileText: file.text, waived });
      return { file, prompt, characters: size(prompt), waived: new Set(waived) };
    });
    const attempts = result.times;
    if (dryRun) {
      for (const item of prompts) {
        for (let attempt = 1; attempt <= attempts; attempt++) {
          result.runs.push({ file: item.file.path, attempt, verdict: null, findings: [], waived: 0, answer: null, prompt_chars: item.characters });
        }
      }
      return result;
    }
    const tooLarge: ErrorItem[] = prompts
      .filter((item) => item.characters > config.maxChars)
      .map((item) => ({
        code: 'too-large-to-review',
        file: item.file.path,
        line: null,
        message: `the prompt for ${id} holds ${item.characters} characters; reviewer.max_chars is ${config.maxChars}`,
        next: `try ${id} on a smaller file; raising reviewer.max_chars is the user's decision`,
      }));
    if (tooLarge.length > 0) throw new Stop(tooLarge);
    const cap = maxCalls ?? config.maxCalls;
    const provider = createProvider(config, context.env);
    const blocked = preflight(provider, config, cap, prompts.length * attempts, 'lawcheck check');
    if (blocked.length > 0) throw new Stop(blocked);
    context.warn?.(`lawcheck: ${plural(prompts.length * attempts, 'reviewer call')} to ${config.provider}`);
    const asks: Ask[] = [];
    const meta = new Map<Ask, { attempt: number; characters: number }>();
    for (const item of prompts) {
      for (let attempt = 1; attempt <= attempts; attempt++) {
        const ask: Ask = { file: item.file.path, rule: id, key: '', prompt: item.prompt, lineCount: item.file.lines.length, waived: item.waived };
        asks.push(ask);
        meta.set(ask, { attempt, characters: item.characters });
      }
    }
    const answered = await call(asks, provider!, NO_RECORD, { cap, parallel: config.parallel, timeoutSeconds: config.timeout });
    if (answered.failed.length > 0) {
      const again = 'run the same command again; try keeps no answer, so it makes every call again';
      throw new Stop(answered.failed.map((f) => ({ code: f.code, file: f.ask.file, line: null, message: f.message, next: f.fix === undefined ? again : `${f.fix}, then ${again}` })));
    }
    result.calls = answered.sent;
    for (const { ask, findings, answer } of answered.answered) {
      const left = remaining(findings, ask.waived);
      const { attempt, characters } = meta.get(ask)!;
      result.runs.push({
        file: ask.file,
        attempt,
        verdict: left.length === 0 ? 'pass' : 'fail',
        findings: left.map((f) => ({ ...(f.line === null ? {} : { line: f.line }), message: cleanMessage(f.message), severity })),
        waived: findings.length - left.length,
        answer,
        prompt_chars: characters,
      });
    }
    result.runs.sort((a, b) => comparePaths(a.file, b.file) || a.attempt - b.attempt);
    return result;
  });
  if ('errors' in outcome) return errorResult(outcome.errors, json, 'try');
  for (const run of outcome.runs) run.findings.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  const findings = outcome.runs.reduce((sum, run) => sum + run.findings.length, 0);
  const code = outcome.dryRun || findings === 0 ? 0 : 1;
  return { code, stdout: json ? tryJson(outcome) : tryText(outcome) };
}

function tryJson(outcome: Outcome): string {
  const withFindings = new Set(outcome.runs.filter((run) => run.findings.length > 0).map((run) => run.file));
  return documentOf({
    schema: 'lawcheck-try/0',
    rule: outcome.rule,
    files: outcome.files.length,
    summary: {
      findings: outcome.runs.reduce((sum, run) => sum + run.findings.length, 0),
      files_with_findings: withFindings.size,
      waived: outcome.runs.reduce((sum, run) => sum + run.waived, 0),
      calls_made: outcome.calls,
    },
    runs: outcome.runs,
    next: null,
  });
}

export function tryText(outcome: Outcome): string {
  const n = outcome.files.length;
  const findings = outcome.runs.reduce((sum, run) => sum + run.findings.length, 0);
  const waived = outcome.runs.reduce((sum, run) => sum + run.waived, 0);
  const withFindings = new Set(outcome.runs.filter((run) => run.findings.length > 0).map((run) => run.file)).size;
  let counts: string;
  if (outcome.dryRun) {
    const calls = outcome.runs.filter((run) => run.prompt_chars! <= outcome.maxChars).length;
    counts = `dry run: ${plural(calls, 'reviewer call')}, none made`;
  } else if (outcome.times > 1) {
    const fails = outcome.runs.filter((run) => run.verdict === 'fail').length;
    counts = `${plural(outcome.runs.length, 'answer')} for ${plural(n, 'file')}: ${fails} fail, ${outcome.runs.length - fails} pass`;
  } else if (findings > 0) {
    counts = `${plural(findings, 'finding')} in ${withFindings} of ${plural(n, 'file')}`;
  } else {
    counts = `nothing found in ${plural(n, 'file')}`;
  }
  const lines = [
    `lawcheck: try ${outcome.rule} (${outcome.kind} rule, ${outcome.status})  ${counts}${waived === 0 ? '' : `, ${waived} waived`}${outcome.calls === 0 ? '' : `, ${plural(outcome.calls, 'reviewer call')}`}`,
  ];
  if (outcome.dryRun) {
    lines.push('');
    for (const run of outcome.runs.filter((r) => r.attempt === 1)) {
      const chars = run.prompt_chars!;
      lines.push(
        chars > outcome.maxChars
          ? `${shown(run.file)}  too large: a prompt of ${chars} characters; reviewer.max_chars is ${outcome.maxChars}`
          : `${shown(run.file)}  ${plural(outcome.times, 'call')}, a prompt of ${chars} characters`,
      );
    }
    return lines.join('\n') + '\n';
  }
  let printed = 0;
  let why = false;
  let cutOff = false;
  const print = (run: Run, found: Found) => {
    if (printed === LIMIT) {
      cutOff = true;
      return;
    }
    printed++;
    lines.push(`${shown(run.file)}${found.line === null || found.line === undefined ? '' : `:${found.line}`}  ${found.severity}[${outcome.rule}]  ${shown(found.message)}`);
    if (!why) {
      why = true;
      lines.push(`  why:  ${outcome.why}`);
    }
  };
  if (outcome.times > 1) {
    lines.push('');
    for (const run of outcome.runs) {
      if (!cutOff) lines.push(`${shown(run.file)}  answer ${run.attempt} of ${outcome.times}: ${run.verdict}`);
      for (const found of run.findings) print(run, found);
    }
  } else if (findings > 0) {
    lines.push('');
    for (const run of outcome.runs) for (const found of run.findings) print(run, found);
  }
  if (findings > printed) lines.push(`... ${plural(findings - printed, 'more finding')} (--json lists all)`);
  return lines.join('\n') + '\n';
}
