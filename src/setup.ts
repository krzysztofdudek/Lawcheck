import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { changedPaths, defaultBase, GitFailed, gitNext, hasHead, fetchesEveryBranch, isShallow, listedPaths, listFiles, mergeBase, NoGit, remoteNames, resolveCommit, workTreeProblem } from './files.js';
import { CONFIG, readConfig } from './config.js';
import type { ReviewerConfig } from './config.js';
import { nearestKey, parseLaw } from './law.js';
import type { Law } from './law.js';
import type { ErrorItem } from './output.js';
import { decode, isBinary, typeFiles } from './types.js';
import type { TypedFile } from './types.js';
import { VERDICTS } from './verdicts.js';
import { keyEnvironment } from './keys.js';
import { createProvider } from './providers/index.js';

export const LAW = '.lawcheck/law.yaml';
export const RULES_DIR = '.lawcheck/rules/';

export class Internal extends Error {}

export class Stop extends Error {
  constructor(readonly errors: ErrorItem[]) {
    super(errors[0]?.message ?? 'stopped');
  }
}

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

export type Read = (path: string) => Uint8Array;

export function onceReader(root: string): Read {
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

export function unreadable(path: string, error: unknown): ErrorItem {
  const code = (error as NodeJS.ErrnoException).code ?? 'an error';
  return { code: 'file-unreadable', file: path, line: null, message: `the file cannot be read (${code})` };
}

// The laws git lists below a folder that has none, as at the top of a monorepo whose law lives in one package.
export function lawsBelow(cwd: string): string[] {
  try {
    return [...listedPaths(cwd)].filter((path) => path.endsWith(`/${LAW}`)).map((path) => path.slice(0, -LAW.length - 1)).sort();
  } catch {
    return [];
  }
}

export function belowPart(folders: string[]): string {
  const shown = folders.slice(0, 3).join(', ') + (folders.length > 3 ? `, and ${folders.length - 3} more` : '');
  return `; the laws below it are in ${shown}`;
}

export function notInitialized(cwd?: string): ErrorItem {
  const below = cwd === undefined ? [] : lawsBelow(cwd);
  const message = `no ${LAW} in this directory or any above it`;
  if (below.length === 0) return { code: 'not-initialized', file: null, line: null, message };
  return { code: 'not-initialized', file: null, line: null, message: message + belowPart(below), next: `cd ${below[0]}, where a law is, then run lawcheck check` };
}

export function usage(message: string): Stop {
  return new Stop([{ code: 'usage', file: null, line: null, message }]);
}

export function nearPart(word: string, known: string[]): string {
  const near = nearestKey(word, known);
  return near === null ? '' : ` (did you mean '${near}'?)`;
}

export function repoPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

export function fromCwd(root: string, cwd: string, word: string): string {
  const path = repoPath(root, resolve(realpathSync(resolve(cwd)), word));
  if (path === '..' || path.startsWith('../') || isAbsolute(path)) throw usage(`the path '${word}' lies outside the root of the law`);
  return path === '' ? '.' : path;
}

export function locate(cwd: string): string {
  const root = findRoot(cwd);
  if (root === null) throw new Stop([notInitialized(cwd)]);
  return root;
}

export function requireGit(root: string): void {
  const problem = workTreeProblem(root);
  if (problem !== null) throw new Stop([noGit(root, problem)]);
}

export function noGit(dir: string, problem: string): ErrorItem {
  const fix = gitNext(dir, problem);
  return { code: 'no-git', file: null, line: null, message: problem, ...(fix === undefined ? {} : fix) };
}

export function lawErrors(root: string): { law: Law } | { errors: ErrorItem[] } {
  let source: Uint8Array;
  try {
    source = readFileSync(join(root, LAW));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'an error';
    return { errors: [{ code: 'law-invalid', file: LAW, line: 1, message: `the law cannot be read (${code})` }] };
  }
  const { law, problems } = parseLaw(decode(source));
  if (law === null) {
    if (linked(root, LAW)) return { errors: [{ code: 'law-invalid', file: LAW, line: null, message: LINKED(LAW) }] };
    return { errors: problems.map((p) => ({ code: 'law-invalid', file: LAW, line: p.line, message: p.message })) };
  }
  return { law };
}

export const LINKED = (file: string) => `${file} is read through a symbolic link and is not valid; the message of a linked file shows none of its text`;

export function linked(root: string, file: string): boolean {
  try {
    return realpathSync(join(root, file)) !== join(root, file);
  } catch {
    return false;
  }
}

export function loadLaw(root: string): Law {
  const read = lawErrors(root);
  if ('errors' in read) throw new Stop(read.errors);
  return read.law;
}

export function configErrors(root: string): { config: ReviewerConfig } | { errors: ErrorItem[] } {
  const configured = readConfig(root);
  if ('problems' in configured) {
    if (linked(root, CONFIG)) return { errors: [{ code: 'config-invalid', file: CONFIG, line: null, message: LINKED(CONFIG) }] };
    return { errors: configured.problems.map((p) => ({ code: 'config-invalid', file: CONFIG, line: p.line, message: p.message })) };
  }
  if (configured.config.provider !== null) createProvider(configured.config, keyEnvironment());
  return { config: configured.config };
}

export function loadConfig(root: string): ReviewerConfig {
  const read = configErrors(root);
  if ('errors' in read) throw new Stop(read.errors);
  return read.config;
}

export interface RuleFiles {
  listed: Set<string>;
  files: string[];
  read: Read;
  kinds: Kinds;
}

export function ruleFileErrors(root: string, law: Law): RuleFiles & { errors: ErrorItem[] } {
  const listed = listedPaths(root);
  const files = listFiles(root, listed);
  const read = onceReader(root);
  const kinds = ruleKinds(law, files, read);
  return { listed, files, read, kinds, errors: kinds.errors.length > 0 ? kinds.errors : kinds.unreadable };
}

export function loadRuleFiles(root: string, law: Law, withContext = true): RuleFiles {
  const loaded = ruleFileErrors(root, law);
  if (loaded.kinds.errors.length > 0) throw new Stop(loaded.kinds.errors);
  if (withContext && loaded.kinds.unreadable.length > 0) throw new Stop(loaded.kinds.unreadable);
  return loaded;
}

export function typingErrors(root: string, law: Law, files: string[], read: Read, extra: ErrorItem[] = []): { typed: TypedFile[]; errors: ErrorItem[] } {
  const { typed, unreadable: unreadableFiles, overlaps } = typeFiles(
    root,
    files.filter((path) => path !== VERDICTS),
    law,
    read,
  );
  const cannotRead = [...unreadableFiles];
  for (const item of extra) if (!cannotRead.some((known) => known.file === item.file)) cannotRead.push(item);
  if (cannotRead.length > 0) return { typed, errors: cannotRead };
  return { typed, errors: overlaps };
}

export function typeAll(root: string, law: Law, files: string[], read: Read, extra: ErrorItem[] = []): TypedFile[] {
  const { typed, errors } = typingErrors(root, law, files, read, extra);
  if (errors.length > 0) throw new Stop(errors);
  return typed;
}

export type BaseSource = '--base' | 'LAWCHECK_BASE' | 'origin/HEAD';

export interface Change {
  base: string | null;
  from: BaseSource | null;
  changed: Set<string>;
}

export function theChange(root: string, files: string[], option: string | null, env: NodeJS.ProcessEnv, full = false): Change {
  const head = hasHead(root);
  let base: string | null = option;
  let from: BaseSource | null = option === null ? null : '--base';
  if (base === null && env.LAWCHECK_BASE) {
    base = env.LAWCHECK_BASE;
    from = 'LAWCHECK_BASE';
  }
  if (base === null) {
    base = defaultBase(root);
    if (base !== null) from = 'origin/HEAD';
  }
  const unreachable = (message: string, next?: string, command?: string) =>
    new Stop([{ code: 'base-unreachable', file: null, line: null, message, ...(next === undefined ? {} : { next }), ...(command === undefined ? {} : { command }) }]);
  if (base === null) {
    if (!full && inCI(env)) {
      throw unreachable(
        'no base in this CI job: no --base, no LAWCHECK_BASE and no origin/HEAD, and a plain check without one would count every file as changed',
        `pass --base origin/<the branch the change goes into> or set LAWCHECK_BASE, with the history fetched (${FETCH_ALL}); or judge every file with lawcheck check --full`,
      );
    }
    return { base, from, changed: new Set(files) };
  }
  const taken = from === 'origin/HEAD' ? ', which origin/HEAD names,' : '';
  const fromHead = from === 'origin/HEAD' ? 'pass --base with a branch or a commit that exists here, or point origin/HEAD at one with git remote set-head origin --auto' : undefined;
  const missing = (message: string) => {
    if (isShallow(root)) return unreachable(`${message}, and this clone is shallow`, ...fetchNext(root, base, true));
    const [next, command] = fetchNext(root, base, false);
    return command === undefined ? unreachable(message, fromHead, fromHead && 'git remote set-head origin --auto') : unreachable(`${message}; this clone did not fetch that branch`, next, command);
  };
  if (!head) throw unreachable(`the repository has no commit yet, so the base '${base}' cannot be reached`);
  const commit = resolveCommit(root, base);
  if (commit === null) {
    if (/^0{40}(0{24})?$/.test(base)) {
      throw unreachable(`the base '${base}' is git's commit of zeros, which a push of a new branch names as the commit before it`, 'pass --base with the branch the new one was made from, such as origin/main, then run lawcheck check');
    }
    if (base.endsWith('/')) {
      throw unreachable(`the base '${base}' names no commit here: the branch name after the last / is empty, as when the variable that should hold it is empty`, 'pass --base with a branch or a commit that exists here');
    }
    throw missing(`the base '${base}'${taken} names no commit here`);
  }
  const fork = mergeBase(root, commit);
  if (fork === null) {
    if (isShallow(root)) throw unreachable(`the base '${base}'${taken} shares no history with HEAD in this clone, which is shallow`, ...fetchNext(root, base, true));
    throw unreachable(`the base '${base}'${taken} shares no history with HEAD`, fromHead, fromHead && 'git remote set-head origin --auto');
  }
  const known = new Set(files);
  return { base, from, changed: new Set(changedPaths(root, fork).filter((path) => known.has(path))) };
}

// Variables that CI services set for every job, beside CI itself, which some leave out.
export const CI_VARIABLES = ['GITHUB_ACTIONS', 'GITLAB_CI', 'TF_BUILD', 'JENKINS_URL', 'BUILDKITE', 'CIRCLECI', 'TRAVIS', 'BITBUCKET_BUILD_NUMBER', 'TEAMCITY_VERSION', 'APPVEYOR', 'DRONE', 'CODEBUILD_BUILD_ID', 'BUILD_ID', 'WOODPECKER'];

const OFF = ['', '0', 'false', 'no', 'off'];

export function inCI(env: NodeJS.ProcessEnv): boolean {
  if (env.CI !== undefined) return !OFF.includes(env.CI.trim().toLowerCase());
  return CI_VARIABLES.some((name) => !OFF.includes((env[name] ?? '').trim().toLowerCase()));
}

const FETCH_ALL = 'fetch-depth: 0 in actions/checkout, GIT_DEPTH: 0 in GitLab CI, fetchDepth: 0 in Azure Pipelines';

function fetchNext(root: string, base: string, shallow: boolean): [string, string | undefined] {
  const remote = remoteNames(root).find((name) => base.startsWith(`${name}/`) && base.length > name.length + 1);
  const branch = remote === undefined ? '' : base.slice(remote.length + 1);
  if (remote === undefined || /[\s'"\\]/.test(branch) || (!shallow && fetchesEveryBranch(root, remote))) return shallow ? [`fetch the history: git fetch --unshallow (${FETCH_ALL}), then run lawcheck check`, 'git fetch --unshallow'] : [`pass --base with a branch or a commit that exists here`, undefined];
  const fetch = `git fetch${shallow ? ' --unshallow' : ''} ${remote} +refs/heads/${branch}:refs/remotes/${remote}/${branch}`;
  return [`fetch ${shallow ? 'the history' : 'the branch'}: ${fetch} (${FETCH_ALL}), then run lawcheck check`, fetch];
}

export function touchesLaw(path: string): boolean {
  return path === LAW || path.startsWith(RULES_DIR);
}

export async function stopped<T>(body: () => Promise<T> | T): Promise<T | { errors: ErrorItem[] }> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof Stop) return { errors: error.errors };
    if (error instanceof NoGit) return { errors: [{ code: 'no-git', file: null, line: null, message: error.message }] };
    if (error instanceof GitFailed) throw new Internal(error.message);
    throw error;
  }
}

export interface ReviewerRule {
  text: string;
  context: { path: string; text: string }[];
}

export interface Kinds {
  errors: ErrorItem[];
  unreadable: ErrorItem[];
  scripts: Set<string>;
  reviewers: Map<string, ReviewerRule>;
}

export function ruleKinds(law: Law, files: string[], read: Read): Kinds {
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
