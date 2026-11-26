import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { version as lawcheckVersion } from './args.js';
import { LOCAL } from './verdicts.js';
import { getLanguageForExtension, primaryExtensionForLanguage, relationLanguageForPath } from '@chrisdudek/runes/grammars';
import {
  assembleCsharpCandidates,
  buildCsharpProjectScopes,
  buildCsharpReachability,
  extractCsharpRefs,
  extractorForLanguage,
  listedFileView,
  makeResolvePathToFile,
  makeResolver,
  sfcScriptView,
  SymbolTable,
  version as runesVersion,
} from '@chrisdudek/runes/relations';
import type { Classification, CsharpExtract, DetectedDep, FileView, ParsedFile, TargetHint } from '@chrisdudek/runes/relations';
import { comparePaths } from './files.js';
import { firstLine } from './law.js';
import type { ErrorItem } from './output.js';
import { decode, isBinary } from './types.js';
import { alive, holding, step } from './progress.js';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import * as TreeSitter from 'web-tree-sitter';
import { createParserHost, fileSha256 } from '@chrisdudek/runes/ast';
import { cores, memoryTotal, PARSE_THREAD_BYTES, readError, spare, treeMemoryBound, USES_FILE_BYTES } from './limits.js';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import type { TypedFile } from './types.js';

export type Reason = 'unfollowed' | 'unowned';

export type Answer =
  | { kind: 'file'; file: string }
  | { kind: 'outside' }
  | { kind: 'ambiguous'; what: string; candidates: string[] }
  | { kind: 'none'; what: string; reason: Reason | null; candidates: string[] };

export interface Use {
  line: number;
  answer: Answer;
}

export interface ScriptView {
  language: string;
  parsePath: string;
  content: string;
}

export type Reader = { reader: false } | { reader: true; view: ScriptView | null };

export interface Host {
  getParser(extension: string): Promise<unknown>;
  withParsedFile<T>(filePath: string, content: string, fn: (tree: ParsedFile['tree']) => T | Promise<T>, language?: string): Promise<T>;
  newParser(): ReturnType<NonNullable<ParsedFile['newParser']>>;
  grammarDigestForLanguage?(language: string): string | undefined;
}

export interface Runes {
  createHost(grammarDir: string): Host;
  extractorForLanguage: typeof extractorForLanguage;
  extractCsharpRefs: typeof extractCsharpRefs;
  assembleCsharpCandidates: typeof assembleCsharpCandidates;
  buildCsharpProjectScopes: typeof buildCsharpProjectScopes;
  buildCsharpReachability: typeof buildCsharpReachability;
  makeResolver: typeof makeResolver;
  makeResolvePathToFile: typeof makeResolvePathToFile;
  identity(): string;
}

export const GRAMMARS = join(dirname(fileURLToPath(new URL('../package.json', import.meta.url))), 'dist', 'grammars');

export const RUNES: Runes = {
  createHost: parserHost,
  extractorForLanguage,
  extractCsharpRefs,
  assembleCsharpCandidates,
  buildCsharpProjectScopes,
  buildCsharpReachability,
  makeResolver,
  makeResolvePathToFile,
  identity: () => JSON.stringify([lawcheckVersion(), runesVersion]),
};

export class Unreadable extends Error {
  readonly item: ErrorItem;

  constructor(
    readonly path: string,
    cause: string | ErrorItem,
  ) {
    const item = typeof cause === 'string' ? { code: 'file-unreadable', file: path, line: null, message: `the file cannot be read (${cause})` } : cause;
    super(`${path}: ${item.message}`);
    this.item = item;
  }
}

export function unreadableError(error: Unreadable): ErrorItem {
  return error.item;
}

const SFC = new Set(['.vue', '.svelte']);

const GROUPS: Record<string, string> = { java: 'jvm', kotlin: 'jvm', csharp: 'csharp', ruby: 'ruby', rust: 'rust' };

export function siblingsOf(files: string[]): (path: string) => string[] {
  const byDir = new Map<string, string[]>();
  for (const file of files) {
    const dir = posix.dirname(file);
    let names = byDir.get(dir);
    if (names === undefined) byDir.set(dir, (names = []));
    names.push(posix.basename(file));
  }
  return (path) => byDir.get(posix.dirname(path)) ?? [];
}

function languageOfPath(path: string, siblings: (path: string) => string[]): string | null {
  return relationLanguageForPath(path, () => siblings(path));
}

export function readerOf(path: string, text: string, siblings: (path: string) => string[], runes: Runes = RUNES): Reader {
  if (SFC.has(extname(path).toLowerCase())) {
    const view = sfcScriptView(path, text);
    return { reader: true, view: view === null ? null : { language: view.language, parsePath: view.parsePath, content: view.content } };
  }
  const language = languageOfPath(path, siblings);
  if (language === null || runes.extractorForLanguage(language) === undefined) return { reader: false };
  return { reader: true, view: { language, parsePath: path, content: text } };
}

export function what(hint: TargetHint): string {
  return hint.kind === 'path' ? hint.specifier : hint.symbolKey;
}

export function answerOf(classified: Classification, candidates: readonly TargetHint[]): Answer {
  if (classified.kind === 'resolved') return { kind: 'file', file: classified.resolvedFile };
  const first = candidates[0] === undefined ? '' : what(candidates[0]);
  if (classified.kind === 'ambiguous') return { kind: 'ambiguous', what: first, candidates: [...(classified.candidates ?? [])] };
  switch (classified.reason) {
    case 'outside':
      return { kind: 'outside' };
    case 'unowned':
      return { kind: 'none', what: first, reason: 'unowned', candidates: classified.resolvedFile === undefined ? [] : [classified.resolvedFile] };
    case 'unfollowed':
      return { kind: 'none', what: first, reason: 'unfollowed', candidates: [] };
    default:
      return { kind: 'none', what: first, reason: null, candidates: [] };
  }
}

export interface ReadInput {
  root: string;
  files: string[];
  bytes: (path: string) => Uint8Array;
  ownerOf: (path: string) => string | undefined;
  read: { path: string; view: ScriptView | null }[];
  grammarDir?: string;
  cacheWrites?: boolean;
  // Who asked for the read, such as the script rule no-todo, when a rule did; the steps name it, so memory-too-large names a step that fits the read.
  asker?: string;
  // A rule's read is shared by every rule of the run, so a file whose use reaches a file that cannot be read fails alone, and the other files keep the uses they get read alone.
  ownFailures?: boolean;
}

export type ReadOutcome = { uses: Map<string, Use[]>; skipped: Skipped[]; unreadable: UnreadableConfig[] } | { error: ErrorItem };

export interface UnreadableConfig {
  file: string;
  line: number | null;
  message: string;
}

// A file past the limit of a file whose uses are read: one the run judges (uses), or one read only for what it declares.
export interface Skipped {
  path: string;
  bytes: number;
  uses: boolean;
}

class Stop extends Error {
  constructor(readonly item: ErrorItem) {
    super(item.message);
  }
}

function readerFailure(language: string, path: string, error: unknown): Stop {
  if (error instanceof Unreadable) return new Stop(unreadableError(error));
  return new Stop({
    code: 'parser-failed',
    file: path,
    line: null,
    message: `the ${language} reader fails on this file: ${firstLine(error)}`,
    next: `report the failure of the ${language} reader on ${path}; until it is fixed, no ${language} use can be judged`,
  });
}

export async function readUses(input: ReadInput, runes: Runes = RUNES): Promise<ReadOutcome> {
  try {
    const skipped: Skipped[] = [];
    const unreadable: UnreadableConfig[] = [];
    return { uses: await readAll(input, runes, skipped, unreadable), skipped, unreadable };
  } catch (error) {
    if (error instanceof Stop) return { error: error.item };
    if (error instanceof Unreadable) return { error: unreadableError(error) };
    throw error;
  }
}

interface Parse {
  path: string;
  view: ScriptView;
  declarations: boolean;
  uses: boolean;
}

type GlobalFacts = { globalPrefixes: string[]; globalAliases: [string, string][]; globalStatics: string[] };

// What a file of a name-binding group gives the run besides its own uses: the keys it declares and, in C#, its global usings.
interface Declared {
  keys: string[];
  csharp: GlobalFacts | null;
}

const PACK_FORMAT = 'lawcheck-readers/1';
// The pack of guava, 3,267 files of Java and Kotlin, holds 0.7 MB, so the bound leaves room for some 300,000 files; a pack of 420 MB ended a run with memory-too-large.
const PACK_BYTES = 64 * 1024 * 1024;

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

function declaredOf(value: unknown): Declared | null {
  if (!Array.isArray(value) || value.length !== 2 || !strings(value[0])) return null;
  if (value[1] === null) return { keys: value[0], csharp: null };
  const facts = value[1] as unknown[];
  if (!Array.isArray(facts) || facts.length !== 3 || !strings(facts[0]) || !strings(facts[2])) return null;
  if (!Array.isArray(facts[1]) || !facts[1].every((pair) => Array.isArray(pair) && pair.length === 2 && strings(pair))) return null;
  return { keys: value[0], csharp: { globalPrefixes: facts[0], globalAliases: facts[1] as [string, string][], globalStatics: facts[2] } };
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

// The cache of what each file of a group declares, one pack per group in .lawcheck/.local/readers. A pack is trusted only where git lists nothing under .lawcheck/.local and no folder on its way is a link or another repository, so no commit can plant one; an entry is found by a hash of everything its parse depends on, so a stale or foreign entry is never found. Any fault in reading or writing a pack only costs the parse.
class DeclaredCache {
  private readonly dir: string;
  private readonly loaded = new Map<string, Map<string, Declared>>();
  private readonly kept = new Map<string, Map<string, Declared>>();
  private readonly missed = new Set<string>();
  private readonly prefixes = new Map<string, string | null>();

  private constructor(
    private readonly root: string,
    private readonly host: Host,
    private readonly runes: Runes,
    private readonly writes: boolean,
  ) {
    this.dir = join(root, LOCAL, 'readers');
  }

  static open(root: string, files: string[], host: Host, runes: Runes, writes: boolean): DeclaredCache | null {
    if (host.grammarDigestForLanguage === undefined) return null;
    // A file system that ignores case shows the files git lists under .lawcheck/.LOCAL at .lawcheck/.local.
    if (files.some((path) => path.toLowerCase() === LOCAL || path.toLowerCase().startsWith(`${LOCAL}/`))) return null;
    try {
      for (const dir of ['.lawcheck', LOCAL, `${LOCAL}/readers`]) {
        const stat = lstatSync(join(root, dir), { throwIfNoEntry: false });
        if (stat === undefined) {
          if (dir === '.lawcheck') return null;
          break;
        }
        if (!stat.isDirectory() || lstatSync(join(root, dir, '.git'), { throwIfNoEntry: false }) !== undefined) return null;
      }
    } catch {
      return null;
    }
    return new DeclaredCache(root, host, runes, writes);
  }

  key(language: string, path: string, content: string): string | null {
    let prefix = this.prefixes.get(language);
    if (prefix === undefined) {
      try {
        const digest = this.host.grammarDigestForLanguage!(language);
        const extractor = this.runes.extractorForLanguage(language);
        prefix = digest === undefined || extractor === undefined ? null : JSON.stringify([PACK_FORMAT, this.runes.identity(), extractor.rev, digest, language]);
      } catch {
        prefix = null;
      }
      this.prefixes.set(language, prefix);
    }
    if (prefix === null) return null;
    return createHash('sha256').update(prefix, 'utf8').update('\0').update(path, 'utf8').update('\0').update(content, 'utf8').digest('hex');
  }

  get(group: string, key: string): Declared | undefined {
    const found = this.pack(group).get(key);
    if (found !== undefined) this.keep(group, key, found);
    return found;
  }

  put(group: string, key: string, declared: Declared): void {
    if (!this.pack(group).has(key)) this.missed.add(group);
    this.keep(group, key, declared);
  }

  private pack(group: string): Map<string, Declared> {
    let pack = this.loaded.get(group);
    if (pack === undefined) this.loaded.set(group, (pack = this.read(group)));
    return pack;
  }

  private keep(group: string, key: string, declared: Declared): void {
    let kept = this.kept.get(group);
    if (kept === undefined) this.kept.set(group, (kept = new Map()));
    kept.set(key, declared);
  }

  private read(group: string): Map<string, Declared> {
    const out = new Map<string, Declared>();
    try {
      const path = join(this.dir, group);
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size > PACK_BYTES) return out;
      const text = readFileSync(path, 'utf8');
      const end = text.indexOf('\n');
      if (end < 0 || text.slice(0, end) !== `${PACK_FORMAT} ${sha256(text.slice(end + 1))}`) return out;
      const body = JSON.parse(text.slice(end + 1)) as unknown;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return out;
      for (const [key, value] of Object.entries(body)) {
        const declared = declaredOf(value);
        if (declared === null) return new Map();
        out.set(key, declared);
      }
    } catch {
      return new Map();
    }
    return out;
  }

  // A run that read every file keeps only its own entries, so a pack holds at most one entry for each file of its group; a run a reader failure stopped keeps the entries it did not reach as well.
  write(complete: boolean): void {
    if (!this.writes) return;
    for (const [group, kept] of this.kept) {
      const loaded = this.loaded.get(group) ?? new Map<string, Declared>();
      if (!this.missed.has(group) && (!complete || kept.size === loaded.size)) continue;
      const entries = complete ? kept : new Map([...loaded, ...kept]);
      const body = JSON.stringify(Object.fromEntries([...entries].map(([key, { keys, csharp }]) => [key, [keys, csharp === null ? null : [csharp.globalPrefixes, csharp.globalAliases, csharp.globalStatics]]])));
      this.save(group, `${PACK_FORMAT} ${sha256(body)}\n${body}`);
    }
  }

  private save(group: string, text: string): void {
    const path = join(this.dir, group);
    const temporary = join(this.dir, `.${group}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    try {
      mkdirSync(this.dir, { recursive: true });
      const ignore = join(this.root, LOCAL, '.gitignore');
      if (lstatSync(ignore, { throwIfNoEntry: false }) === undefined) writeFileSync(ignore, '*\n');
      const existing = lstatSync(path, { throwIfNoEntry: false });
      if (existing !== undefined && !existing.isFile()) return;
      writeFileSync(temporary, text);
      renameSync(temporary, path);
    } catch {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // A folder that refuses this removal refused the write too; the next run's pack replaces nothing of it.
      }
    }
  }
}

async function readAll(input: ReadInput, runes: Runes, skipped: Skipped[], unreadable: UnreadableConfig[]): Promise<Map<string, Use[]>> {
  const out = new Map<string, Use[]>();
  const parses = new Map<string, Parse>();
  for (const { path, view } of input.read) {
    out.set(path, []);
    if (view !== null) parses.set(path, { path, view, declarations: false, uses: true });
  }
  if (parses.size === 0) return out;

  const text = (path: string) => decode(input.bytes(path));
  const siblings = siblingsOf(input.files);
  const groups = new Set([...parses.values()].map((p) => GROUPS[p.view.language]).filter((g) => g !== undefined));
  if (groups.size > 0) {
    for (const path of input.files) {
      if (SFC.has(extname(path).toLowerCase())) continue;
      const language = languageOfPath(path, siblings);
      if (language === null || !groups.has(GROUPS[language] ?? '')) continue;
      const known = parses.get(path);
      if (known !== undefined) {
        known.declarations = true;
        continue;
      }
      const bytes = input.bytes(path);
      if (isBinary(bytes)) continue;
      parses.set(path, { path, view: { language, parsePath: path, content: decode(bytes) }, declarations: true, uses: false });
    }
  }

  const view: FileView = listedFileView(input.files, text);
  const host = runes.createHost(input.grammarDir ?? GRAMMARS);
  const loaded = new Set<string>();
  const symbolTable = new SymbolTable();
  const detected = new Map<string, DetectedDep[]>();
  const csharp = new Map<string, CsharpExtract>();
  const globals = new Map<string, GlobalFacts>();
  const asked = input.asker === undefined ? '' : ` for ${input.asker}`;
  const cache = groups.size > 0 ? DeclaredCache.open(input.root, input.files, host, runes, input.cacheWrites !== false) : null;

  for (const parse of [...parses.values()].sort((a, b) => comparePaths(a.path, b.path))) {
    step(parse.uses ? `reading the uses of ${parse.path}${asked}` : `reading what ${parse.path} declares${asked}`);
    const { language, parsePath, content } = parse.view;
    // A file past the limit is not parsed, and the run names it: one whose uses it judges, as not read; one read only for what it declares, as a file whose uses by others are not judged.
    const size = Buffer.byteLength(content, 'utf8');
    if (size > USES_FILE_BYTES) {
      skipped.push({ path: parse.path, bytes: size, uses: parse.uses });
      if (parse.uses) out.delete(parse.path);
      continue;
    }
    const group = GROUPS[language];
    const key = cache !== null && parse.declarations && group !== undefined ? cache.key(language, parse.path, content) : null;
    const known = key === null || parse.uses ? undefined : cache!.get(group!, key);
    if (known !== undefined) {
      for (const symbolKey of known.keys) symbolTable.declare(language, symbolKey, parse.path);
      if (known.csharp !== null) globals.set(parse.path, known.csharp);
      continue;
    }
    if (!loaded.has(language)) {
      try {
        await host.getParser(primaryExtensionForLanguage(language) ?? '');
      } catch (error) {
        cache?.write(false);
        throw new Stop({
          code: 'parser-failed',
          file: null,
          line: null,
          message: grammarProblem(language, error),
          next: 'reinstall Lawcheck; a grammar it ships cannot be loaded',
        });
      }
      loaded.add(language);
    }
    const override = getLanguageForExtension(extname(parsePath)) === language ? undefined : language;
    // The step names its file only from here, so the memory it may add counts from the parse and not from the grammar loaded before it.
    step(parse.uses ? `reading the uses of ${parse.path}${asked}` : `reading what ${parse.path} declares${asked}`, parse.path);
    try {
      await host.withParsedFile(
        parsePath,
        content,
        (tree) => {
          const parsed: ParsedFile = { path: parse.path, content, tree, language, newParser: host.newParser };
          const extractor = runes.extractorForLanguage(language);
          if (extractor === undefined) throw new Error(`no extractor for ${language}`);
          const keys: string[] = [];
          if (parse.declarations) {
            for (const declared of extractor.declarations(parsed)) {
              symbolTable.declare(language, declared.symbolKey, parse.path);
              keys.push(declared.symbolKey);
            }
          }
          let facts: GlobalFacts | null = null;
          if (language === 'csharp') {
            const extract = runes.extractCsharpRefs(parsed);
            facts = { globalPrefixes: extract.scope.globalPrefixes, globalAliases: [...extract.scope.globalAliases.entries()], globalStatics: extract.scope.globalStatics };
            globals.set(parse.path, facts);
            if (parse.uses) csharp.set(parse.path, extract);
          } else if (parse.uses) detected.set(parse.path, extractor.uses(parsed));
          if (key !== null) cache!.put(group!, key, { keys, csharp: facts });
        },
        override,
      );
    } catch (error) {
      cache?.write(false);
      throw readerFailure(language, parse.path, error);
    }
  }
  // From here no file is parsed, so the memory the run gains belongs to no file, and a file found in the cache must not change which file the last parse leaves named.
  step(`resolving the uses${asked}`);
  cache?.write(true);

  const reachOf = () => runes.buildCsharpReachability(input.root, [...globals.keys()], { files: view });
  let reach: ReturnType<typeof buildCsharpReachability> | undefined;
  if (globals.size > 0) {
    let scopes: ReturnType<typeof buildCsharpProjectScopes>;
    try {
      const facts = [...globals].map(([path, global]) => ({ path, ...global }));
      scopes = runes.buildCsharpProjectScopes(input.root, facts, { files: view });
      reach = reachOf();
    } catch (error) {
      if (error instanceof Unreadable) throw error;
      throw new Stop({
        code: 'parser-failed',
        file: null,
        line: null,
        message: `the C# project reader fails: ${firstLine(error)}`,
        next: 'report the failure of the C# project reader; until it is fixed, no C# use can be judged',
      });
    }
    for (const [path, extract] of csharp) {
      const scope = scopes.get(path);
      try {
        detected.set(
          path,
          runes.assembleCsharpCandidates(extract, {
            projectGlobalUsings: scope?.usings ?? [],
            projectGlobalUsingAliases: scope?.aliases ?? [],
            projectGlobalStatics: scope?.statics ?? [],
          }),
        );
      } catch (error) {
        throw readerFailure('csharp', path, error);
      }
    }
  }

  const ownerIndex = { ownerOf: input.ownerOf };
  const resolverOf = () =>
    runes.makeResolver({
      ownerIndex,
      symbolTable,
      resolvePathToFile: runes.makeResolvePathToFile(input.root, input.ownerOf, undefined, {
        files: view,
        onDiagnostic: (diagnostic) => {
          if (diagnostic.code === 'config-unreadable') unreadable.push({ file: diagnostic.file, line: diagnostic.line ?? null, message: diagnostic.message });
        },
      }),
      ...(reach === undefined ? {} : { reach }),
    });
  let resolver = resolverOf();

  for (const path of [...out.keys()].sort(comparePaths)) {
    const parse = parses.get(path);
    if (parse === undefined) continue;
    const uses = out.get(path)!;
    const lineOf = ownLine(parse.view.content);
    for (const use of detected.get(path) ?? []) {
      let classified: Classification;
      try {
        classified = resolver.classifyUse(use.candidates, path, parse.view.language);
      } catch (error) {
        if (input.ownFailures === true && error instanceof Unreadable) {
          out.delete(path);
          // Runes keeps what the resolver and the reach of C# have read, and a read that throws part-way leaves the entry it was making half built, so a later file would take its uses from it as if the read had ended; the files after this one get new ones.
          if (reach !== undefined) reach = reachOf();
          resolver = resolverOf();
          break;
        }
        throw readerFailure(parse.view.language, path, error);
      }
      uses.push({ line: lineOf(use.line), answer: answerOf(classified, use.candidates) });
    }
  }
  return out;
}

// Runes ends a line at a lone CR too, while a file's lines here end only at LF and CRLF (the lines of docs/script-rules.md), so its line is moved to the line that holds its start.
export function ownLine(content: string): (line: number) => number {
  if (!/\r(?!\n)/.test(content)) return (line) => line;
  const starts = [1];
  let lf = 0;
  for (let i = 0; i < content.length; i++) {
    const c = content.charCodeAt(i);
    if (c === 10) lf++;
    if (c === 10 || (c === 13 && content.charCodeAt(i + 1) !== 10)) starts.push(lf + 1);
  }
  return (line) => starts[line - 1] ?? line;
}

export const LANGUAGES = ['typescript', 'tsx', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin', 'csharp', 'c', 'cpp', 'php', 'ruby'];

// Runes tells the developer of Lawcheck to run its build, which no user of an installed Lawcheck can do.
function grammarProblem(language: string, error: unknown): string {
  return `the grammar of ${language} cannot be loaded: ${firstLine(error).replace(/[;,.]?\s*build it with buildGrammars[^]*$/, '')}`;
}

export async function loadGrammars(grammarDir: string = GRAMMARS, runes: Runes = RUNES): Promise<ErrorItem | null> {
  const host = runes.createHost(grammarDir);
  for (const language of LANGUAGES) {
    try {
      await host.getParser(primaryExtensionForLanguage(language) ?? '');
    } catch (error) {
      return {
        code: 'parser-failed',
        file: null,
        line: null,
        message: grammarProblem(language, error),
        next: 'reinstall Lawcheck; a grammar it ships cannot be loaded',
      };
    }
  }
  return null;
}

export type Absent = 'too-large' | 'no-reader' | 'reader-failed';

// A tree crosses to the rule runner as numbers, NODE_INTS to a node in preorder (parent, type, field, named, start, end, line, column), so neither side recurses on a deep tree; src/runner.ts reads the same layout.
export const NODE_INTS = 8;

export interface FlatTree {
  types: string[];
  fields: string[];
  nodes: Int32Array;
}

type Tree = ParsedFile['tree'];

function parserHost(grammarDir: string) {
  return createParserHost({
    runtime: TreeSitter,
    runtimeIdentity: () => fileSha256(fileURLToPath(import.meta.resolve('web-tree-sitter/web-tree-sitter.wasm'))),
    grammarDirs: [grammarDir],
  });
}

function flatten(tree: Tree): FlatTree {
  const types = new Map<string, number>();
  const fields = new Map<string, number>();
  const id = (names: Map<string, number>, name: string) => {
    let at = names.get(name);
    if (at === undefined) names.set(name, (at = names.size));
    return at;
  };
  let nodes = new Int32Array(NODE_INTS * 1024);
  let count = 0;
  const parents: number[] = [];
  const cursor = tree.walk();
  try {
    for (;;) {
      if ((count + 1) * NODE_INTS > nodes.length) {
        const grown = new Int32Array(nodes.length * 2);
        grown.set(nodes);
        nodes = grown;
      }
      const field = cursor.currentFieldName;
      const start = cursor.startPosition;
      nodes.set(
        [parents.at(-1) ?? -1, id(types, cursor.nodeType), field === null ? -1 : id(fields, field), cursor.nodeIsNamed ? 1 : 0, cursor.startIndex, cursor.endIndex, start.row + 1, start.column],
        count * NODE_INTS,
      );
      const self = count++;
      if (cursor.gotoFirstChild()) {
        parents.push(self);
        continue;
      }
      while (!cursor.gotoNextSibling()) {
        if (!cursor.gotoParent()) return { types: [...types.keys()], fields: [...fields.keys()], nodes: nodes.slice(0, count * NODE_INTS) };
        parents.pop();
      }
    }
  } finally {
    cursor.delete();
  }
}

// What a parse of the pool gives when the pool has ended: the caller then parses the file itself, in its turn and under the step that names the file.
const ALONE = Symbol('alone');

// How long one file may take in the pool. A parse past it ends the pool, and the file is parsed again under its own step, where the limit of a step names it.
const PARSE_MS = 5_000;

interface Job {
  id: number;
  path: string;
  content: string;
  language?: string;
  settle: (tree: FlatTree | null | typeof ALONE) => void;
  timer?: NodeJS.Timeout;
}

// The threads that parse the trees of a run, at most as many as the machine gives cores. The memory guard of the tool reads the memory of the whole process, so it cannot tell which of several files parsed at once takes too much, and the threads hold memory while they wait too: while the pool has threads the guard asks the reader to end it instead (src/progress.ts), and so does a parse that takes too long or a thread that fails. Every file then goes through the tool's own parse, one at a time, where a file that takes too much memory or time is named as before.
class ParsePool {
  ended = false;
  private readonly idle: Worker[] = [];
  private readonly loaded = new Map<Worker, Set<string>>();
  private readonly all = new Set<Worker>();
  private readonly waiting: Job[] = [];
  private readonly running = new Map<Worker, Job>();
  private next = 0;

  constructor(
    private readonly grammarDir: string,
    private readonly size: number,
    private readonly onStart: () => void,
  ) {}

  parse(path: string, content: string, language: string | undefined): Promise<FlatTree | null | typeof ALONE> {
    if (this.ended) return Promise.resolve(ALONE);
    return new Promise((settle) => {
      this.waiting.push({ id: this.next++, path, content, ...(language === undefined ? {} : { language }), settle });
      this.onStart();
      this.pump();
    });
  }

  // Whether a thread has parsed a file with this ending: a file of a language the pool has not met goes to the pool only with enough others to parse.
  knows(path: string): boolean {
    const key = extname(path);
    for (const keys of this.loaded.values()) if (keys.has(key)) return true;
    return false;
  }

  // Each thread loads the grammar of a language when it first parses one, and a grammar takes memory in every thread that holds it. So a file goes to an idle thread that has parsed its language, else to a new thread, else to any idle thread, and a repository of many languages loads each grammar in few threads.
  private pump(): void {
    while (this.waiting.length > 0) {
      const job = this.waiting[0]!;
      const key = extname(job.path);
      const knows = this.idle.findIndex((one) => this.loaded.get(one)!.has(key));
      const worker = knows >= 0 ? this.idle.splice(knows, 1)[0]! : this.all.size < this.size ? this.start() : (this.idle.pop() ?? null);
      if (worker === null) return;
      this.loaded.get(worker)!.add(key);
      this.waiting.shift();
      this.running.set(worker, job);
      job.timer = setTimeout(() => void this.end(), PARSE_MS);
      worker.postMessage({ id: job.id, path: job.path, content: job.content, language: job.language });
    }
  }

  private start(): Worker {
    const worker = new Worker(new URL(import.meta.url), { workerData: { parseTrees: this.grammarDir }, stdout: false, stderr: false });
    this.all.add(worker);
    this.loaded.set(worker, new Set());
    worker.on('message', (message: { id: number; tree: FlatTree | null }) => {
      const job = this.running.get(worker);
      if (job === undefined || job.id !== message.id) return;
      clearTimeout(job.timer);
      this.running.delete(worker);
      this.idle.push(worker);
      alive();
      job.settle(message.tree);
      this.pump();
    });
    worker.on('error', () => void this.end());
    worker.on('exit', () => {
      if (!this.ended) void this.end();
    });
    // After the listeners, since a listener for messages holds the process again: an idle pool must not keep a finished command from ending.
    worker.unref();
    return worker;
  }

  // Ends every thread and gives each file still in the pool back to its caller.
  async end(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    const left = [...this.running.values(), ...this.waiting];
    for (const job of left) clearTimeout(job.timer);
    this.running.clear();
    this.waiting.length = 0;
    await Promise.all([...this.all].map((worker) => worker.terminate().catch(() => undefined)));
    this.all.clear();
    for (const job of left) job.settle(ALONE);
  }
}


export type TreeAnswer = { language: string; tree: FlatTree; absent: null } | { language: string | null; tree: null; absent: Absent };

export type RuleUse = { line: number; type?: string | null } & Answer;

export type UsesAnswer = { uses: RuleUse[]; absent: null } | { uses: null; absent: Absent };


// The trees a run gives back are garbage until V8 collects them, and it would collect them only when it next needs room, while the thread that watches reads the memory of the process now. So the run collects at once. Node gives a program no call for that unless it starts with --expose-gc; set while it runs, the flag gives the call to a new context.
function collect(): void {
  try {
    setFlagsFromString('--expose-gc');
    (runInNewContext('gc') as () => void)();
  } catch {
    // Without the call the memory comes back when V8 next collects.
  }
}

// How many files are parsed ahead of the one a rule asked for, and how many must be left to parse before the pool starts.
const AHEAD = 32;
const POOL_FROM = 8;
// The most threads the pool has, on any machine: each holds a JavaScript realm and the grammars it loaded, which count toward the memory the run may hold.
const POOL_THREADS = 4;

export interface Owners {
  bytes: (path: string) => Uint8Array;
  ownerOf: (path: string) => string | undefined;
  typeOf: (path: string) => string | null;
}

export function ownersOf(files: string[], read: (path: string) => Uint8Array, typed: TypedFile[]): Owners {
  const known = new Set(files);
  const typedByPath = new Map(typed.map((file) => [file.path, file.type.id]));
  const bytes = (path: string) => {
    try {
      return read(path);
    } catch (error) {
      throw new Unreadable(path, readError(path, error));
    }
  };
  const ownerOf = (path: string) => {
    const type = typedByPath.get(path);
    if (type !== undefined) return type;
    if (!known.has(path)) return undefined;
    return isBinary(bytes(path)) ? '#binary' : '#untyped';
  };
  return { bytes, ownerOf, typeOf: (path) => typedByPath.get(path) ?? null };
}

export interface RuleReadsInput extends Owners {
  root: string;
  files: string[];
  grammarDir?: string;
  treeBytes?: number;
  threads?: number;
}

export interface RuleFileText {
  path: string;
  text: string;
}

export type Serve = (what: 'tree' | 'uses', file: RuleFileText) => Promise<TreeAnswer | UsesAnswer>;

export type Reads = (bound: RuleFileText[], asker?: string) => Serve;

// The first ask of a rule reads the uses of every file it judges in the run that no rule has asked for before, at once, so a name-binding group is parsed once per batch and not once per file.
export function ruleReads(input: RuleReadsInput, runes: Runes = RUNES): Reads {
  const siblings = siblingsOf(input.files);
  let host: Host | null = null;

  // A tree depends on the path and the text of its file and on nothing of the rule that asks, so every rule of the run takes the tree of the first parse. A tree is found only under its own path and for the same text, and it is kept only while the kept trees stay within their bound; a failed parse is never kept.
  const trees = new Map<string, { text: string; answer: TreeAnswer }>();
  const room = spare();
  const bound = input.treeBytes ?? Math.min(treeMemoryBound(memoryTotal()), Math.floor(room / 4));
  let kept = 0;
  const known = (file: RuleFileText): TreeAnswer | undefined => {
    const held = trees.get(file.path);
    return held !== undefined && held.text === file.text ? held.answer : undefined;
  };

  // When the run comes near the memory it may hold, the thread that watches asks for what the reader can give back: the kept trees and the threads of the pool. From then on the run keeps no tree and parses each file for the rule that asks, one at a time, as it did before trees were kept.
  let keeping = bound;
  const release = async (): Promise<void> => {
    keeping = 0;
    full = true;
    kept = 0;
    trees.clear();
    await pool?.end();
    collect();
  };
  const keep = (file: RuleFileText, language: string, flat: FlatTree): TreeAnswer => {
    const answer: TreeAnswer = { language, tree: flat, absent: null };
    if (trees.has(file.path)) return answer;
    if (kept + flat.nodes.byteLength > keeping) full = true;
    else {
      if (trees.size === 0) holding(release);
      trees.set(file.path, { text: file.text, answer });
      kept += flat.nodes.byteLength;
    }
    return answer;
  };

  // What a file's tree is without a parse, or the text to parse.
  const parsable = (file: RuleFileText): TreeAnswer | ScriptView => {
    const reader = readerOf(file.path, file.text, siblings, runes);
    if (!reader.reader || reader.view === null) return { language: null, tree: null, absent: 'no-reader' };
    if (Buffer.byteLength(reader.view.content, 'utf8') > USES_FILE_BYTES) return { language: reader.view.language, tree: null, absent: 'too-large' };
    return reader.view;
  };
  const override = (view: ScriptView) => (getLanguageForExtension(extname(view.parsePath)) === view.language ? undefined : view.language);

  const tree = async (file: RuleFileText, asker: string | undefined): Promise<TreeAnswer> => {
    const held = known(file);
    if (held !== undefined) return held;
    const view = parsable(file);
    if ('absent' in view) return view;
    host ??= runes.createHost(input.grammarDir ?? GRAMMARS);
    step(`reading the tree of ${file.path}${asker === undefined ? '' : ` for ${asker}`}`, file.path);
    try {
      return keep(file, view.language, await host.withParsedFile(view.parsePath, view.content, flatten, override(view)));
    } catch {
      return { language: view.language, tree: null, absent: 'reader-failed' };
    }
  };

  // A rule that asks for the tree of one of its files will most likely ask for the next ones, so a pool of threads parses those ahead, several at once, and every rule of the run takes them from there. The pool starts only when POOL_FROM files or more are left to parse, so the check of a few files starts no thread, and it parses nothing ahead once the kept trees have reached their bound. Only the readers of this package cross to a thread, so a run with other readers parses in its turn, and so does a run that has one processor.
  const threads = input.threads ?? Math.min(cores(), Math.floor(room / 4 / PARSE_THREAD_BYTES));
  const pool = runes === RUNES && threads > 1 ? new ParsePool(input.grammarDir ?? GRAMMARS, Math.min(threads, POOL_THREADS), () => holding(release)) : null;
  const parsing = new Map<string, { text: string; answer: Promise<TreeAnswer> }>();
  let full = false;
  const pooled = (file: RuleFileText, asker: string | undefined): Promise<TreeAnswer> => {
    const going = parsing.get(file.path);
    if (going !== undefined && going.text === file.text) return going.answer;
    const view = parsable(file);
    if ('absent' in view) return Promise.resolve(view);
    const answer = pool!.parse(view.parsePath, view.content, override(view)).then((flat): TreeAnswer | Promise<TreeAnswer> => {
      if (parsing.get(file.path)?.answer === answer) parsing.delete(file.path);
      if (flat === ALONE) return inTurn(() => tree(file, asker));
      return flat === null ? { language: view.language, tree: null, absent: 'reader-failed' } : keep(file, view.language, flat);
    });
    answer.catch(() => undefined);
    if (going === undefined) parsing.set(file.path, { text: file.text, answer });
    return answer;
  };
  // Only files with the ending of the file asked for are parsed ahead, so the pool starts for a language that has many files to parse and a thread loads no grammar for a few files of another one.
  const ahead = (file: RuleFileText, list: RuleFileText[], at: number): RuleFileText[] => {
    const out = [file];
    if (full) return out;
    const ending = extname(file.path);
    for (let next = at + 1; next < list.length && out.length < AHEAD; next++) {
      const other = list[next]!;
      if (extname(other.path) === ending && known(other) === undefined && !parsing.has(other.path)) out.push(other);
    }
    return out;
  };

  const failed: UsesAnswer = { uses: null, absent: 'reader-failed' };
  const tooLarge = (view: ScriptView | null) => view !== null && Buffer.byteLength(view.content, 'utf8') > USES_FILE_BYTES;

  // Reading each file alone after a failure would parse a whole name-binding group once per file, so a failure on a judged file takes that file out of the batch, and any other failure splits the batch by language or group and fails the part that shares it.
  const read = async (judged: { path: string; view: ScriptView | null }[], out: Map<string, UsesAnswer>, split: boolean, asker: string | undefined): Promise<void> => {
    let left = judged;
    while (left.length > 0) {
      const outcome = await readUses({ root: input.root, files: input.files, bytes: input.bytes, ownerOf: input.ownerOf, read: left, ownFailures: true, ...(input.grammarDir === undefined ? {} : { grammarDir: input.grammarDir }), ...(asker === undefined ? {} : { asker }) }, runes);
      if (!('error' in outcome)) {
        for (const [path, uses] of outcome.uses) {
          out.set(path, { uses: uses.map(({ line, answer }) => (answer.kind === 'file' ? { line, ...answer, type: input.typeOf(answer.file) } : { line, ...answer })), absent: null });
        }
        return;
      }
      const at = outcome.error.file;
      if (at !== null && left.some((one) => one.path === at)) {
        out.set(at, failed);
        left = left.filter((one) => one.path !== at);
        continue;
      }
      const parts = new Map<string, typeof left>();
      for (const one of left) {
        const language = one.view?.language ?? '';
        const key = GROUPS[language] ?? language;
        parts.set(key, [...(parts.get(key) ?? []), one]);
      }
      if (!split || parts.size === 1) {
        for (const one of left) out.set(one.path, failed);
        return;
      }
      for (const part of parts.values()) await read(part, out, false, asker);
      return;
    }
  };

  // The uses of a file do not depend on the batch that reads them, so every rule of the run takes them from the one read that first reached the file.
  const answers = new Map<string, Promise<UsesAnswer>>();

  // A read waits for a grammar between the step that names its file and the parse, and a second read let in then writes its own step, so the memory guard would name the wrong file and the wrong rule; the reads of a run take turns.
  let turn: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const done = turn.then(work);
    turn = done.catch(() => undefined);
    return done;
  };

  return (bound, asker) => {
    let asked = false;
    const readBound = () => {
      const judged = bound.flatMap((file) => {
        if (answers.has(file.path)) return [];
        const reader = readerOf(file.path, file.text, siblings, runes);
        return reader.reader && !tooLarge(reader.view) ? [{ path: file.path, view: reader.view }] : [];
      });
      if (judged.length === 0) return;
      const out = new Map<string, UsesAnswer>();
      const batch = inTurn(() => read(judged, out, true, asker));
      for (const { path } of judged) {
        const answer = batch.then(() => out.get(path) ?? failed);
        // A failure of the read reaches every rule that asks for one of its files; a file no rule asks for again must not end the run as a rejection nobody handled.
        answer.catch(() => undefined);
        answers.set(path, answer);
      }
    };
    let places: Map<string, number> | null = null;
    return async (what, file) => {
      if (what === 'tree') {
        const held = known(file);
        if (held !== undefined) return held;
        if (pool === null || pool.ended) return inTurn(() => tree(file, asker));
        places ??= new Map(bound.map((one, at) => [one.path, at]));
        const files = ahead(file, bound, places.get(file.path) ?? bound.length);
        if (files.length < POOL_FROM && !pool.knows(file.path) && !parsing.has(file.path)) return inTurn(() => tree(file, asker));
        const [own] = files.map((one) => pooled(one, asker));
        return own!;
      }
      const reader = readerOf(file.path, file.text, siblings, runes);
      if (!reader.reader) return { uses: null, absent: 'no-reader' };
      if (tooLarge(reader.view)) return { uses: null, absent: 'too-large' };
      if (!asked) {
        asked = true;
        readBound();
      }
      return (await answers.get(file.path)) ?? failed;
    };
  };
}

// This module is also the program of each thread of the pool: started with the folder of the grammars, it parses one file at a time, as the tool itself does, and gives the tree back without a copy.
const parseTrees = isMainThread ? undefined : (workerData as { parseTrees?: string } | null)?.parseTrees;
if (parseTrees !== undefined) {
  const host = parserHost(parseTrees);
  parentPort!.on('message', (job: { id: number; path: string; content: string; language?: string }) => {
    host.withParsedFile(job.path, job.content, flatten, job.language).then(
      (tree) => parentPort!.postMessage({ id: job.id, tree }, [tree.nodes.buffer as ArrayBuffer]),
      () => parentPort!.postMessage({ id: job.id, tree: null }),
    );
  });
}
