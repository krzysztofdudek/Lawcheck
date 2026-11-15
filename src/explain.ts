import { lstatSync } from 'node:fs';
import { onDisk } from './names.js';
import { documentOf, errorResult, text as flagText, usageError } from './args.js';
import type { Arguments, Result } from './args.js';
import type { CheckContext } from './check.js';
import type { ReviewerConfig } from './config.js';
import { ignoresPath, nestedReason, repositoryHolding } from './files.js';
import { compilePattern } from './glob.js';
import { takesWaivers } from './law.js';
import type { Law, TypeDef } from './law.js';
import { plural, shown } from './output.js';
import { mayUsePart, ruleKind, walk } from './prime.js';
import { buildPrompt, FRAME, size } from './prompt.js';
import { readerOf, siblingsOf } from './readers.js';
import { loadConfig, loadLaw, loadRuleFiles, locate, fromCwd, nearPart, requireGit, RULES_DIR, stopped, typeAll, typingErrors, Stop, usage } from './setup.js';
import type { Kinds, Read } from './setup.js';
import { decode, filesOfTypes, isBinary, splitLines } from './types.js';
import { listInForce } from './uses.js';
import { readFailure, readVerdicts, reviewKey, VERDICTS } from './verdicts.js';
import { parseWaivers } from './waivers.js';

type Review = 'reviewed' | 'failed' | 'too-large' | 'not-reviewed';

const REVIEW_TEXT: Record<Review, string> = {
  reviewed: 'reviewed',
  failed: 'failed earlier',
  'too-large': 'too large to review',
  'not-reviewed': 'not reviewed',
};

const NO_LIST = 'any file; no type on the way up has may_use';
const LIMIT = 50;

interface RuleItem {
  id: string;
  kind: 'script' | 'reviewer';
  status: string;
  why: string;
  from: string;
  review: Review | null;
}

interface Matched {
  type: string;
  pattern: string;
  content: string | null;
}

export interface FileAnswer {
  path: string;
  exists: boolean;
  type: TypeDef | null;
  chain: TypeDef[];
  none: string | null;
  matched: Matched[];
  notMatched: { type: string; content: string }[];
  then: string | null;
  uses: { read: boolean; language: string | null } | null;
  rules: RuleItem[];
  waivers: { line: number; rule: string; reason: string }[];
}

interface Ctx {
  root: string;
  law: Law;
  config: ReviewerConfig;
  listed: Set<string>;
  files: string[];
  read: Read;
  kinds: Kinds;
}

export function names(ids: string[]): string {
  return ids.length <= 1 ? (ids[0] ?? '') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
}

function untyped(path: string, exists: boolean, none: string | null, then: string | null = null): FileAnswer {
  return { path, exists, type: null, chain: [], none, matched: [], notMatched: [], then, uses: null, rules: [], waivers: [] };
}

function firstPlain(type: TypeDef, path: string): string {
  return type.paths.find((pattern) => !pattern.startsWith('!') && compilePattern(pattern).test(path)) ?? type.paths[0]!;
}

function chainOf(type: TypeDef): TypeDef[] {
  const chain: TypeDef[] = [];
  for (let at: TypeDef | null = type; at !== null; at = at.parent) chain.unshift(at);
  return chain;
}

function rulesOf(ctx: Ctx, chain: TypeDef[], review: ((rule: string) => Review) | null): RuleItem[] {
  const out: RuleItem[] = [];
  for (const type of chain) {
    for (const id of type.rules) {
      if (out.some((item) => item.id === id)) continue;
      const rule = ctx.law.rules.get(id)!;
      const kind = ruleKind(ctx.kinds, id);
      out.push({ id, kind, status: rule.status, why: rule.why, from: type.id, review: kind === 'reviewer' && review !== null ? review(id) : null });
    }
  }
  return out;
}

function usesOf(ctx: Ctx, type: TypeDef, path: string, text: string): FileAnswer['uses'] {
  if (listInForce(type) === null) return null;
  const reader = readerOf(path, text, siblingsOf(ctx.files));
  if (!reader.reader) return { read: false, language: null };
  const dot = path.lastIndexOf('.');
  return { read: true, language: reader.view?.language ?? path.slice(dot + 1) };
}

function reviewState(ctx: Ctx, path: string, text: string, waivers: ReturnType<typeof parseWaivers>['waivers']): (rule: string) => Review {
  const verdicts = readVerdicts(ctx.root);
  const lineCount = splitLines(text).length;
  return (id) => {
    const reviewer = ctx.kinds.reviewers.get(id)!;
    const why = ctx.law.rules.get(id)!.why;
    const key = reviewKey({ frame: FRAME, ruleId: id, why, ruleText: reviewer.text, context: reviewer.context, filePath: path, fileText: text });
    if (verdicts.has(`${key} ${id}`)) return 'reviewed';
    if (readFailure(ctx.root, key, id, lineCount) !== null) return 'failed';
    const waived = [...new Set(waivers.filter((w) => w.rule === id && w.covers !== null).map((w) => w.covers!))].sort((a, b) => a - b);
    const prompt = buildPrompt({ why, ruleText: reviewer.text, context: reviewer.context, filePath: path, fileText: text, waived });
    return size(prompt) > ctx.config.maxChars ? 'too-large' : 'not-reviewed';
  };
}

const BEHIND = 'it lies behind a symbolic link, which has no type';

function behindLink(root: string, path: string): boolean {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    try {
      if (lstatSync(onDisk(root, parts.slice(0, i).join('/'))).isSymbolicLink()) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function existing(ctx: Ctx, path: string, symlink: boolean): FileAnswer {
  if (behindLink(ctx.root, path)) return untyped(path, true, BEHIND);
  const nested = repositoryHolding(ctx.root, path, ctx.listed);
  if (nested !== null) return untyped(path, true, nestedReason(nested));
  if (!ctx.listed.has(path)) return untyped(path, true, 'git ignores it, so Lawcheck never sees it');
  if (symlink) return untyped(path, true, 'it is a symbolic link, which has no type');
  if (path === VERDICTS) return untyped(path, true, 'Lawcheck writes this file, and it has no type');
  if (!ctx.law.types.some((type) => type.matches(path))) return untyped(path, true, "no type's paths match it, so no rule judges it");
  let bytes: Uint8Array;
  try {
    bytes = ctx.read(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'an error';
    throw new Stop([{ code: 'file-unreadable', file: path, line: null, message: `the file cannot be read (${code})` }]);
  }
  if (isBinary(bytes)) return untyped(path, true, 'it is binary, which has no type');
  const text = decode(bytes);
  const chain: TypeDef[] = [];
  let notMatched: TypeDef[] = [];
  let level = ctx.law.types;
  for (;;) {
    const byPath = level.filter((type) => type.matches(path));
    const hits = byPath.filter((type) => type.content === null || type.content.test(text));
    if (hits.length > 1) {
      return untyped(path, true, `it matches ${names(hits.map((t) => t.id))} at one level (type-overlap); check stops with exit 2 until a ! pattern in one of them leaves it out`);
    }
    if (hits.length === 0) {
      if (chain.length === 0) return untyped(path, true, `it matches the paths of ${names(byPath.map((t) => t.id))} but not their content, so no rule judges it`);
      notMatched = byPath;
      break;
    }
    chain.push(hits[0]!);
    level = hits[0]!.types;
  }
  const type = chain[chain.length - 1]!;
  const ruleIds = new Set([...ctx.law.rules.keys(), 'forbidden-use']);
  const { waivers } = takesWaivers(type) ? parseWaivers(splitLines(text), ruleIds) : { waivers: [] };
  return {
    path,
    exists: true,
    type,
    chain,
    none: null,
    matched: chain.map((t) => ({ type: t.id, pattern: firstPlain(t, path), content: t.expression })),
    notMatched: notMatched.map((t) => ({ type: t.id, content: t.expression! })),
    then: null,
    uses: usesOf(ctx, type, path, text),
    rules: rulesOf(ctx, chain, reviewState(ctx, path, text, waivers)),
    waivers: waivers.map((w) => ({ line: w.line, rule: w.rule, reason: w.reason })),
  };
}

export function alternatives(hits: TypeDef[], deepest: TypeDef | null): { then: string; overlap: boolean } {
  const plain = hits.filter((type) => type.content === null);
  const withContent = hits.filter((type) => type.content !== null);
  if (plain.length >= 2) return { then: `any file here matches ${names(plain.map((t) => t.id))} at one level (type-overlap)`, overlap: true };
  if (plain.length === 1) {
    const only = plain[0]!.id;
    const parts = withContent.map((t) => `a type-overlap of ${only} and ${t.id} if its text matches "${t.expression}"`);
    return { then: `${parts.join('; ')}; otherwise ${only}`, overlap: false };
  }
  const parts = withContent.map((t) => `${t.id} if its text matches "${t.expression}"`);
  return { then: `${parts.join('; ')}; otherwise ${deepest?.id ?? 'none'}`, overlap: false };
}

export function walkPath(types: TypeDef[], path: string): { chain: TypeDef[]; stop: TypeDef[] } {
  const chain: TypeDef[] = [];
  let level = types;
  for (;;) {
    const hits = level.filter((type) => type.matches(path));
    if (hits.length === 1 && hits[0]!.content === null) {
      chain.push(hits[0]!);
      level = hits[0]!.types;
      continue;
    }
    return { chain, stop: hits };
  }
}

function absent(ctx: Ctx, path: string): FileAnswer {
  if (behindLink(ctx.root, path)) return untyped(path, false, BEHIND);
  const nested = repositoryHolding(ctx.root, path, ctx.listed);
  if (nested !== null) return untyped(path, false, nestedReason(nested));
  if (ignoresPath(ctx.root, path)) return untyped(path, false, 'git ignores this path, so Lawcheck would never see it');
  const { chain, stop } = walkPath(ctx.law.types, path);
  const deepest = chain[chain.length - 1] ?? null;
  if (deepest === null) {
    if (stop.length === 0) return untyped(path, false, "no type's paths match it, so no rule judges it");
    const { then, overlap } = alternatives(stop, null);
    return overlap ? untyped(path, false, then) : untyped(path, false, null, then);
  }
  return {
    path,
    exists: false,
    type: deepest,
    chain,
    none: null,
    matched: chain.map((t) => ({ type: t.id, pattern: firstPlain(t, path), content: t.expression })),
    notMatched: [],
    then: stop.length === 0 ? null : alternatives(stop, deepest).then,
    uses: usesOf(ctx, deepest, path, ''),
    rules: rulesOf(ctx, chain, null),
    waivers: [],
  };
}

function mayUseLine(type: TypeDef): string {
  return `  may use:  ${mayUsePart(type, '  ') ?? NO_LIST}`;
}

function mayUseJson(type: TypeDef | null): { types: string[]; from: string | null } | null {
  if (type === null) return null;
  const inForce = listInForce(type);
  if (inForce === null) return null;
  return { types: inForce.list, from: inForce.from === type ? null : inForce.from.id };
}

function ruleLines(rules: RuleItem[]): string[] {
  if (rules.length === 0) return ['  rules:  none'];
  return ['  rules:', ...rules.map((r) => `    ${r.id}  ${r.kind}  ${r.status}  from ${r.from}${r.review === null ? '' : `  ${REVIEW_TEXT[r.review]}`}  ${r.why}`)];
}

export function fileText(answer: FileAnswer): string {
  const lines = [answer.exists ? shown(answer.path) : `${shown(answer.path)}  (does not exist yet)`];
  const type = answer.type;
  if (type === null) {
    lines.push(answer.none !== null ? `  type:  none: ${answer.none}` : `  type:  depends on its text: ${answer.then}`);
    return lines.join('\n') + '\n';
  }
  lines.push(`  type:  ${type.id}  (${answer.chain.map((t) => t.id).join(' > ')})${type.about === null ? '' : `  ${shown(type.about)}`}`);
  const matched = answer.matched.map((m) => `${m.type} by "${shown(m.pattern)}"${m.content === null ? '' : ` and content "${shown(m.content)}"`}`);
  const not = answer.notMatched.map((n) => `not ${n.type}: content "${shown(n.content)}" does not match`);
  lines.push(`  matched:  ${[...matched, ...not].join(', ')}`);
  if (answer.then !== null) lines.push(`  then:  ${answer.then}`);
  lines.push(mayUseLine(type));
  if (answer.uses !== null) lines.push(`  uses:  ${answer.uses.read ? `read as ${answer.uses.language}` : 'not read: Lawcheck has no reader for this file'}`);
  lines.push(...ruleLines(answer.rules));
  if (answer.exists) {
    if (answer.waivers.length === 0) lines.push('  waivers:  none');
    else lines.push('  waivers:', ...answer.waivers.map((w) => `    ${shown(answer.path)}:${w.line}  ${w.rule}  ${shown(w.reason)}`));
  }
  return lines.join('\n') + '\n';
}

function fileJson(answer: FileAnswer): unknown {
  return {
    schema: 'lawcheck-explain/0',
    subject: 'file',
    path: answer.path,
    exists: answer.exists,
    type: answer.type?.id ?? null,
    chain: answer.chain.map((t) => t.id),
    about: answer.type?.about ?? null,
    none: answer.none,
    matched: answer.matched,
    not_matched: answer.notMatched,
    then: answer.then,
    may_use: mayUseJson(answer.type),
    uses: answer.uses,
    rules: answer.rules,
    waivers: answer.waivers,
  };
}

function list(lines: string[], files: string[]): void {
  for (const file of files.slice(0, LIMIT)) lines.push(`    ${file}`);
  if (files.length > LIMIT) lines.push(`    ... ${files.length - LIMIT} more (--json lists all)`);
}

function directory(ctx: Ctx, path: string, json: boolean): string {
  const below = path === '.' ? ctx.files : ctx.files.filter((file) => file.startsWith(`${path}/`));
  const { typed, errors } = typingErrors(ctx.root, ctx.law, below, ctx.read);
  if (errors.length > 0) throw new Stop(errors);
  const counts = new Map<string, number>();
  for (const file of typed) counts.set(file.type.id, (counts.get(file.type.id) ?? 0) + 1);
  const types: { type: string | null; files: number }[] = [];
  walk(ctx.law.types, (type) => {
    const count = counts.get(type.id);
    if (count !== undefined) types.push({ type: type.id, files: count });
  });
  if (below.length > typed.length) types.push({ type: null, files: below.length - typed.length });
  const label = path === '.' ? './' : `${path}/`;
  if (json) return documentOf({ schema: 'lawcheck-explain/0', subject: 'directory', path: label, files: below.length, types });
  const lines = [`${shown(label)}  ${plural(below.length, 'file')}`, ...types.map((t) => `  ${t.type ?? 'no type'}  ${plural(t.files, 'file')}`)];
  return lines.join('\n') + '\n';
}

function typeAnswer(ctx: Ctx, id: string, json: boolean): string {
  const type = ctx.law.byId.get(id)!;
  const typed = typeAll(ctx.root, ctx.law, ctx.files, ctx.read);
  const files = filesOfTypes(typed, ctx.law).get(id) ?? [];
  const chain = chainOf(type);
  const rules = rulesOf(ctx, chain, null);
  if (json) {
    return documentOf({
      schema: 'lawcheck-explain/0',
      subject: 'type',
      id,
      chain: chain.map((t) => t.id),
      about: type.about,
      paths: type.paths,
      content: type.expression,
      may_use: mayUseJson(type),
      rules: rules.map(({ review: _review, ...rest }) => rest),
      subtypes: type.types.map((t) => t.id),
      files,
    });
  }
  const lines = [`type ${id}  (${chain.map((t) => t.id).join(' > ')})${type.about === null ? '' : `  ${shown(type.about)}`}`, `  paths:  ${shown(type.paths.join(', '))}`];
  if (type.expression !== null) lines.push(`  content:  ${shown(type.expression)}`);
  lines.push(mayUseLine(type), ...ruleLines(rules));
  if (!takesWaivers(type)) lines.push('  waivers:  not read; a waiver marker in its files is text');
  lines.push(`  subtypes:  ${type.types.length === 0 ? 'none' : type.types.map((t) => t.id).join(', ')}`);
  lines.push(`  files:  ${files.length}`);
  list(lines, files);
  return lines.join('\n') + '\n';
}

function ruleAnswer(ctx: Ctx, id: string, json: boolean): string {
  const rule = ctx.law.rules.get(id)!;
  const kind = ruleKind(ctx.kinds, id);
  const typed = typeAll(ctx.root, ctx.law, ctx.files, ctx.read);
  const onTypes: string[] = [];
  walk(ctx.law.types, (type) => {
    if (type.rules.includes(id)) onTypes.push(type.id);
  });
  const bound = typed.filter((file) => file.rules.includes(id));
  const files = bound.map((file) => file.path);
  let reviewed: number | null = null;
  if (kind === 'reviewer') {
    const verdicts = readVerdicts(ctx.root);
    const reviewer = ctx.kinds.reviewers.get(id)!;
    reviewed = bound.filter((file) =>
      verdicts.has(`${reviewKey({ frame: FRAME, ruleId: id, why: rule.why, ruleText: reviewer.text, context: reviewer.context, filePath: file.path, fileText: file.text })} ${id}`),
    ).length;
  }
  const file = `${RULES_DIR}${id}.${kind === 'script' ? 'mjs' : 'md'}`;
  const context = rule.context === null ? null : rule.context.map((item) => item.path);
  if (json) {
    return documentOf({ schema: 'lawcheck-explain/0', subject: 'rule', id, kind, status: rule.status, why: rule.why, file, context, types: onTypes, files, reviewed });
  }
  const lines = [`rule ${id}  ${kind}  ${rule.status}`, `  why:  ${rule.why}`, `  file:  ${file}`];
  if (context !== null) lines.push(`  context:  ${context.join(', ')}`);
  if (onTypes.length === 0) {
    lines.push('  on types:  none; it judges no file until a type lists it', '  binds:  0 files');
    return lines.join('\n') + '\n';
  }
  lines.push(`  on types:  ${onTypes.join(', ')}`);
  const verdictPart = reviewed === null ? '' : `; ${reviewed} ${reviewed === 1 ? 'has' : 'have'} a verdict for their content`;
  lines.push(`  binds:  ${plural(files.length, 'file')}${verdictPart}`);
  list(lines, files);
  return lines.join('\n') + '\n';
}

// A file system that ignores case finds SRC/core/price.ts at src/core/price.ts, which git lists under that spelling alone; the answer is about the file git lists.
function spelledAsListed(root: string, path: string, listed: Set<string>): string {
  if (listed.has(path)) return path;
  let named: { dev: bigint; ino: bigint };
  try {
    named = lstatSync(onDisk(root, path), { bigint: true });
  } catch {
    return path;
  }
  const lower = path.toLowerCase();
  const same = [...listed].filter((other) => {
    if (other.toLowerCase() !== lower) return false;
    try {
      const stat = lstatSync(onDisk(root, other), { bigint: true });
      return stat.dev === named.dev && stat.ino === named.ino;
    } catch {
      return false;
    }
  });
  return same.length === 1 ? same[0]! : path;
}

export async function explain(args: Arguments, context: CheckContext, json: boolean): Promise<Result> {
  const typeId = flagText(args, '--type');
  const ruleId = flagText(args, '--rule');
  const given = args.words.length + (typeId === null ? 0 : 1) + (ruleId === null ? 0 : 1);
  if (given !== 1) return usageError('explain takes exactly one of a path, --type <id> and --rule <id>', json, 'explain');
  const outcome = await stopped(() => {
    const root = locate(context.cwd);
    requireGit(root);
    const law = loadLaw(root);
    if (typeId !== null && !law.byId.has(typeId)) throw usage(`the law has no type '${typeId}'${nearPart(typeId, [...law.byId.keys()])}`);
    if (ruleId !== null && !law.rules.has(ruleId)) throw usage(`the law has no rule '${ruleId}'${nearPart(ruleId, [...law.rules.keys()])}`);
    const config = loadConfig(root);
    const { listed, files, read, kinds } = loadRuleFiles(root, law);
    const ctx: Ctx = { root, law, config, listed, files, read, kinds };
    if (typeId !== null) return typeAnswer(ctx, typeId, json);
    if (ruleId !== null) return ruleAnswer(ctx, ruleId, json);
    const path = spelledAsListed(root, fromCwd(root, context.cwd, args.words[0]!), listed);
    if (path === '.') return directory(ctx, path, json);
    let stat: ReturnType<typeof lstatSync> | null = null;
    try {
      stat = lstatSync(onDisk(root, path));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'ENAMETOOLONG') throw error;
    }
    if (stat !== null && stat.isDirectory()) return directory(ctx, path, json);
    const answer = stat === null ? absent(ctx, path) : existing(ctx, path, stat.isSymbolicLink());
    return json ? documentOf(fileJson(answer)) : fileText(answer);
  });
  if (typeof outcome !== 'string') return errorResult(outcome.errors, json, 'explain');
  return { code: 0, stdout: outcome };
}
