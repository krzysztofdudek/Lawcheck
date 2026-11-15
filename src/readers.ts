import { dirname, extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as TreeSitter from 'web-tree-sitter';
import { createParserHost, fileSha256 } from '@chrisdudek/runes/ast';
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
} from '@chrisdudek/runes/relations';
import type { Classification, CsharpExtract, DetectedDep, FileView, ParsedFile, TargetHint } from '@chrisdudek/runes/relations';
import { comparePaths } from './files.js';
import { firstLine } from './law.js';
import type { ErrorItem } from './output.js';
import { decode, isBinary } from './types.js';
import { step } from './progress.js';
import { USES_FILE_BYTES } from './limits.js';

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
}

export const GRAMMARS = join(dirname(fileURLToPath(new URL('../package.json', import.meta.url))), 'dist', 'grammars');

export const RUNES: Runes = {
  createHost: (grammarDir) =>
    createParserHost({
      runtime: TreeSitter,
      runtimeIdentity: () => fileSha256(fileURLToPath(import.meta.resolve('web-tree-sitter/web-tree-sitter.wasm'))),
      grammarDirs: [grammarDir],
    }),
  extractorForLanguage,
  extractCsharpRefs,
  assembleCsharpCandidates,
  buildCsharpProjectScopes,
  buildCsharpReachability,
  makeResolver,
  makeResolvePathToFile,
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
}

export type ReadOutcome = { uses: Map<string, Use[]>; skipped: { path: string; bytes: number }[] } | { error: ErrorItem };

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
    const skipped: { path: string; bytes: number }[] = [];
    return { uses: await readAll(input, runes, skipped), skipped };
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

async function readAll(input: ReadInput, runes: Runes, skipped: { path: string; bytes: number }[]): Promise<Map<string, Use[]>> {
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

  for (const parse of [...parses.values()].sort((a, b) => comparePaths(a.path, b.path))) {
    step(`reading the uses of ${parse.path}`, parse.path);
    const { language, parsePath, content } = parse.view;
    // A file past the limit is not parsed: one whose uses the run judges is named as not read, and one read only for what it declares stays out, so a use of it shows as unresolved.
    const size = Buffer.byteLength(content, 'utf8');
    if (size > USES_FILE_BYTES) {
      if (parse.uses) {
        skipped.push({ path: parse.path, bytes: size });
        out.delete(parse.path);
      }
      continue;
    }
    if (!loaded.has(language)) {
      try {
        await host.getParser(primaryExtensionForLanguage(language) ?? '');
      } catch (error) {
        throw new Stop({
          code: 'parser-failed',
          file: null,
          line: null,
          message: `the grammar of ${language} cannot be loaded: ${firstLine(error)}`,
          next: 'reinstall Lawcheck; a grammar it ships cannot be loaded',
        });
      }
      loaded.add(language);
    }
    const override = getLanguageForExtension(extname(parsePath)) === language ? undefined : language;
    try {
      await host.withParsedFile(
        parsePath,
        content,
        (tree) => {
          const parsed: ParsedFile = { path: parse.path, content, tree, language, newParser: host.newParser };
          const extractor = runes.extractorForLanguage(language);
          if (extractor === undefined) throw new Error(`no extractor for ${language}`);
          if (parse.declarations) {
            for (const declared of extractor.declarations(parsed)) symbolTable.declare(language, declared.symbolKey, parse.path);
          }
          if (language === 'csharp') csharp.set(parse.path, runes.extractCsharpRefs(parsed));
          else if (parse.uses) detected.set(parse.path, extractor.uses(parsed));
        },
        override,
      );
    } catch (error) {
      throw readerFailure(language, parse.path, error);
    }
  }

  let reach: ReturnType<typeof buildCsharpReachability> | undefined;
  if (csharp.size > 0) {
    let scopes: ReturnType<typeof buildCsharpProjectScopes>;
    try {
      const facts = [...csharp].map(([path, extract]) => ({
        path,
        globalPrefixes: extract.scope.globalPrefixes,
        globalAliases: [...extract.scope.globalAliases.entries()],
        globalStatics: extract.scope.globalStatics,
      }));
      scopes = runes.buildCsharpProjectScopes(input.root, facts, { files: view });
      reach = runes.buildCsharpReachability(input.root, [...csharp.keys()], { files: view });
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
      if (!parses.get(path)!.uses) continue;
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
  const resolver = runes.makeResolver({
    ownerIndex,
    symbolTable,
    resolvePathToFile: runes.makeResolvePathToFile(input.root, input.ownerOf, undefined, { files: view }),
    ...(reach === undefined ? {} : { reach }),
  });

  for (const path of [...out.keys()].sort(comparePaths)) {
    const parse = parses.get(path);
    if (parse === undefined) continue;
    const uses = out.get(path)!;
    for (const use of detected.get(path) ?? []) {
      let classified: Classification;
      try {
        classified = resolver.classifyUse(use.candidates, path, parse.view.language);
      } catch (error) {
        throw readerFailure(parse.view.language, path, error);
      }
      uses.push({ line: use.line, answer: answerOf(classified, use.candidates) });
    }
  }
  return out;
}

export const LANGUAGES = ['typescript', 'tsx', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin', 'csharp', 'c', 'cpp', 'php', 'ruby'];

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
        message: `the grammar of ${language} cannot be loaded: ${firstLine(error)}`,
        next: 'reinstall Lawcheck; a grammar it ships cannot be loaded',
      };
    }
  }
  return null;
}
