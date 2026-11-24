import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { environmentRefusal, gitNow, gitRefusal, runtimeNow, runtimeRefusal } from './environment.js';
import type { Runtime } from './environment.js';
import { findProgram } from './programs.js';
import { join } from 'node:path';
import { documentOf, noWords, text as flagText, usageError } from './args.js';
import type { Arguments, CheckContext, Result } from './args.js';
import { CONFIG, runnerLine } from './config.js';
import type { ReviewerConfig } from './config.js';
import { gitNext, listFiles, NoGit, showPrefix, workTreeProblem } from './files.js';
import { walk } from './law.js';
import type { Law } from './law.js';
import { commandIn, forCommand, nextOfErrors, placeOf, plural, shown, sortErrors } from './output.js';
import type { ErrorItem } from './output.js';
import { checkAnswer } from './prompt.js';
import { createProvider } from './providers/index.js';
import { hide } from './keys.js';
import type { Env } from './providers/index.js';
import type { Provider } from './provider.js';
import { LANGUAGES, loadGrammars, ownersOf, readerOf, readUses, siblingsOf } from './readers.js';
import type { ScriptView } from './readers.js';
import { belowPart, configErrors, findRoot, LAW, lawsBelow, lawErrors, onceReader, ruleFileErrors, Stop, theChange, touchesLaw, typingErrors } from './setup.js';
import type { Change, Kinds, Read } from './setup.js';
import type { TypedFile } from './types.js';
import { extensionOf, listInForce } from './uses.js';

export type State = 'ok' | 'note' | 'fail' | 'skip';

export interface Next {
  command: string | null;
  text: string;
}

export interface Check {
  id: string;
  state: State;
  message: string;
  details?: string[];
  next: Next | null;
}

export const TEST_PROMPT = 'Answer with this JSON object and nothing else: {"verdict": "pass", "findings": []}';

const IDS = ['node', 'git', 'law', 'config', 'types', 'base', 'law-change', 'readers', 'reviewer'] as const;

const WAITS: Record<string, string[]> = {
  node: [],
  git: [],
  law: ['git'],
  config: ['git', 'law-file'],
  types: ['law'],
  base: ['git', 'law-file'],
  'law-change': ['base'],
  readers: ['types'],
  reviewer: ['law', 'config'],
};

function next(text: string, given?: string): Next {
  return { command: commandIn(text, given), text };
}

function firstOf(errors: ErrorItem[]): { message: string; next: Next } {
  const first = sortErrors(errors)[0]!;
  const place = placeOf(first.file, first.line);
  const more = errors.length > 1 ? `; and ${errors.length - 1} more` : '';
  return { message: `${place === null ? '' : `${place}  `}${first.message}${more}`, next: next(nextOfErrors(errors, 'doctor'), first.command) };
}

export interface Inputs {
  cwd: string;
  env: Env;
  base: string | null;
  reviewer: boolean;
  nodeVersion?: string;
  grammarDir?: string;
  runtime?: Runtime;
  gitText?: () => string | null;
}

// The program each runner starts first; its install line is the one the runner table of docs/config.md gives.
const RUNNER_PROGRAMS: Record<string, string> = { global: 'lawcheck', npx: 'npx', pnpm: 'pnpm', yarn: 'yarn', bun: 'bun' };

interface Found {
  root: string | null;
  law: Law | null;
  kinds: Kinds | null;
  files: string[];
  read: Read | null;
  config: ReviewerConfig | null;
  typed: TypedFile[];
  change: Change | null;
}

export async function runChecks(inputs: Inputs): Promise<Check[]> {
  const checks = new Map<string, Check>();
  const found: Found = { root: findRoot(inputs.cwd), law: null, kinds: null, files: [], read: null, config: null, typed: [], change: null };
  const passed = (id: string) => (id === 'law-file' ? found.root !== null : ['ok', 'note'].includes(checks.get(id)?.state ?? ''));
  const set = (id: string, state: State, message: string, nextStep: Next | null = null, details: string[] = []): void => {
    checks.set(id, { id, state, message, ...(details.length === 0 ? {} : { details }), next: nextStep });
  };

  const steps: Record<string, () => Promise<void> | void> = {
    node: () => {
      const runtime = { ...(inputs.runtime ?? runtimeNow()), ...(inputs.nodeVersion === undefined ? {} : { node: inputs.nodeVersion }) };
      const refused = runtimeRefusal(runtime);
      if (refused !== null) return set('node', 'fail', refused.message, next(forCommand(refused.next!, 'doctor')));
      set('node', 'ok', `Node ${runtime.node}; Lawcheck needs 24 or later`);
    },
    git: () => {
      const dir = found.root ?? inputs.cwd;
      const version = (inputs.gitText ?? (() => gitNow(dir)))();
      const old = version === null ? null : gitRefusal(version);
      if (old !== null) return set('git', 'fail', old.message, next(forCommand(old.next!, 'doctor')));
      let problem: string | null;
      try {
        problem = workTreeProblem(dir);
      } catch (error) {
        if (!(error instanceof NoGit)) throw error;
        problem = error.message;
      }
      if (problem !== null) {
        const fix = gitNext(dir, problem);
        return set('git', 'fail', problem, fix === undefined ? next('run lawcheck doctor inside a git work tree, with git on the PATH') : next(forCommand(fix.next, 'doctor'), fix.command));
      }
      if (found.root === null) return set('git', 'ok', 'a git work tree');
      const prefix = showPrefix(found.root);
      set('git', 'ok', `a git work tree, and the law's root is ${prefix === '' ? 'its top' : `${prefix} below its top`}`);
    },
    law: () => {
      if (found.root === null) {
        const below = lawsBelow(inputs.cwd);
        if (below.length > 0) return set('law', 'fail', `no .lawcheck/law.yaml in this directory or any above it${belowPart(below)}`, next(`cd ${below[0]}, where a law is, then run lawcheck doctor again`));
        return set('law', 'fail', 'no .lawcheck/law.yaml in this directory or any above it', next('lawcheck init  (only when the user wants a law here)'));
      }
      const read = lawErrors(found.root);
      if ('errors' in read) {
        const first = firstOf(read.errors);
        return set('law', 'fail', first.message, first.next);
      }
      const rules = ruleFileErrors(found.root, read.law);
      found.files = rules.files;
      found.read = rules.read;
      if (rules.errors.length > 0) {
        const first = firstOf(rules.errors);
        return set('law', 'fail', first.message, first.next);
      }
      found.law = read.law;
      found.kinds = rules.kinds;
      let types = 0;
      walk(read.law.types, () => types++);
      const scripts = rules.kinds.scripts.size;
      const reviewers = rules.kinds.reviewers.size;
      const summary = `.lawcheck/law.yaml: ${plural(types, 'type')}, ${plural(read.law.rules.size, 'rule')} (${scripts} script, ${reviewers} reviewer)`;
      if (rules.files.includes(LAW) || lstatSync(join(found.root, '.lawcheck')).isSymbolicLink()) return set('law', 'ok', summary);
      set('law', 'note', `${summary}; git ignores it, so no other checkout has the law`, next(`remove the line that ignores ${LAW}, as \`git check-ignore -v ${LAW}\` shows, then run lawcheck doctor again`));
    },
    config: () => {
      const read = configErrors(found.root!);
      if ('errors' in read) {
        const first = firstOf(read.errors);
        return set('config', 'fail', first.message, first.next);
      }
      found.config = read.config;
      const configured = read.config;
      if (!existsSync(join(found.root!, CONFIG))) return set('config', 'ok', 'no .lawcheck/config.yaml; every setting has its default');
      const named = runnerLine(readFileSync(join(found.root!, CONFIG), 'utf8'))?.value;
      const program = named === undefined ? undefined : RUNNER_PROGRAMS[named];
      const at = program === undefined ? null : findProgram(program, inputs.env);
      if (program !== undefined && at === null) {
        return set('config', 'fail', `.lawcheck/config.yaml: runner ${named}, and ${program} is not on the PATH`, next(`install ${program}, or ask the user to set runner to the way this repository starts Lawcheck, then run lawcheck doctor again`));
      }
      const runner = program === undefined ? '' : `; runner ${named}, ${program} at ${at}`;
      if (configured.provider === null) return set('config', 'ok', `.lawcheck/config.yaml: no reviewer set${runner}`);
      set('config', 'ok', `.lawcheck/config.yaml: reviewer ${configured.provider}${configured.model === null ? '' : `, model ${configured.model}`}${runner}`);
    },
    types: () => {
      const { typed, errors } = typingErrors(found.root!, found.law!, found.files, found.read ?? onceReader(found.root!));
      if (errors.length > 0) {
        const first = firstOf(errors);
        return set('types', 'fail', first.message, first.next);
      }
      found.typed = typed;
      set('types', 'ok', `${typed.length} of ${plural(found.files.length, 'file')} ${typed.length === 1 ? 'has' : 'have'} a type`);
    },
    base: () => {
      const files = found.files.length > 0 ? found.files : listFiles(found.root!);
      try {
        found.change = theChange(found.root!, files, inputs.base, inputs.env as NodeJS.ProcessEnv);
      } catch (error) {
        if (!(error instanceof Stop)) throw error;
        const first = firstOf(error.errors);
        return set('base', 'fail', first.message, first.next);
      }
      const { base, from, changed } = found.change;
      if (base === null) {
        return set('base', 'note', 'no base: no --base, LAWCHECK_BASE or origin/HEAD, so a plain check counts every file as changed', next('pass --base <branch>, or set LAWCHECK_BASE'));
      }
      set('base', 'ok', `${base}, from ${from}; the change holds ${plural(changed.size, 'file')}`);
    },
    'law-change': () => {
      const change = found.change!;
      if (change.base === null) return set('law-change', 'ok', 'no base, so a plain check judges every file');
      const touched = [...change.changed].filter(touchesLaw).sort();
      if (touched.length === 0) return set('law-change', 'ok', 'the change does not touch the law');
      const shown = touched.slice(0, 3).join(', ') + (touched.length > 3 ? `, and ${touched.length - 3} more` : '');
      const command = `lawcheck check --full${inputs.base === null ? '' : ` --base ${inputs.base}`}`;
      set(
        'law-change',
        'note',
        `the change touches the law: ${shown}; a plain check judges only the files that changed`,
        next(`${command}  (lists what the law finds in the rest of the code, as debt)`),
      );
    },
    readers: async () => {
      const failure = await loadGrammars(inputs.grammarDir);
      if (failure !== null) return set('readers', 'fail', failure.message, next(failure.next!));
      const grammars = `the ${LANGUAGES.length} grammars load`;
      let anyList = false;
      walk(found.law!.types, (type) => {
        if (type.mayUse !== null) anyList = true;
      });
      if (!anyList) return set('readers', 'ok', `no type has may_use, so no use is read; ${grammars}`);
      const siblings = siblingsOf(found.files);
      const languages = new Map<string, number>();
      const unread: string[] = [];
      const toRead: { path: string; view: ScriptView | null }[] = [];
      for (const file of found.typed) {
        if (listInForce(file.type) === null) continue;
        const reader = readerOf(file.path, file.text, siblings);
        if (!reader.reader) {
          unread.push(file.path);
          continue;
        }
        toRead.push({ path: file.path, view: reader.view });
        const language = reader.view?.language ?? extensionOf(file.path).slice(1);
        languages.set(language, (languages.get(language) ?? 0) + 1);
      }
      let configs: { file: string; message: string }[] = [];
      if (toRead.length > 0) {
        const { bytes, ownerOf } = ownersOf(found.files, found.read ?? onceReader(found.root!), found.typed);
        const outcome = await readUses({
          root: found.root!,
          files: found.files,
          bytes,
          ownerOf,
          read: toRead,
          cacheWrites: false,
          ...(inputs.grammarDir === undefined ? {} : { grammarDir: inputs.grammarDir }),
        });
        if ('error' in outcome) {
          const first = firstOf([outcome.error]);
          return set('readers', 'fail', first.message, first.next);
        }
        configs = outcome.unreadable;
      }
      const messages: string[] = [];
      let fix: string | null = null;
      if (unread.length > 0) {
        const counts = new Map<string, number>();
        for (const path of unread) counts.set(extensionOf(path), (counts.get(extensionOf(path)) ?? 0) + 1);
        const parts = [...counts.keys()].sort().map((extension) => `${counts.get(extension)} ${extension}`);
        messages.push(`${plural(unread.length, 'file')} ${unread.length === 1 ? 'is' : 'are'} not read for uses: ${parts.join(', ')}, so check warns uses-not-read`);
        fix = 'lawcheck docs languages';
      }
      if (configs.length > 0) {
        const read = [...languages.values()].reduce((sum, count) => sum + count, 0);
        const parts = [...languages.keys()].sort().map((language) => `${language} ${languages.get(language)}`);
        if (unread.length === 0) messages.push(`uses are read in ${plural(read, 'file')}${parts.length === 0 ? '' : `: ${parts.join(', ')}`}; ${grammars}`);
        messages.push(`${plural(configs.length, 'configuration file')} could not be read, so the uses that go through ${configs.length === 1 ? 'it' : 'them'} are not followed`);
        fix = `fix ${configs.length === 1 ? configs[0]!.file : 'the files named above'} so that ${configs.length === 1 ? 'it parses' : 'they parse'}, then run lawcheck doctor again`;
      }
      if (messages.length > 0) return set('readers', 'note', messages.join('; '), next(fix!), configs.map((config) => config.message));
      const read = [...languages.values()].reduce((sum, count) => sum + count, 0);
      const parts = [...languages.keys()].sort().map((language) => `${language} ${languages.get(language)}`);
      set('readers', 'ok', `uses are read in ${plural(read, 'file')}${parts.length === 0 ? '' : `: ${parts.join(', ')}`}; ${grammars}`);
    },
    reviewer: async () => {
      const config = found.config!;
      const count = found.kinds!.reviewers.size;
      const rules = plural(count, 'reviewer rule');
      if (config.provider === null) {
        if (inputs.reviewer) {
          return set('reviewer', 'fail', 'no reviewer is set, so --reviewer has nothing to call', next('ask the user to set reviewer.provider and reviewer.model in .lawcheck/config.yaml, then run lawcheck doctor --reviewer'));
        }
        if (count === 0) return set('reviewer', 'ok', 'no reviewer rule, so no reviewer is needed');
        return set('reviewer', 'fail', `${rules} and no reviewer set, so their files stay not-reviewed`, next('ask the user to set reviewer.provider and reviewer.model in .lawcheck/config.yaml, then run lawcheck doctor'));
      }
      if (count === 0 && !inputs.reviewer) return set('reviewer', 'ok', 'no reviewer rule, so no reviewer is needed');
      const provider: Provider = createProvider(config, inputs.env)!;
      const problem = provider.ready();
      if (problem !== null) return set('reviewer', 'fail', `${rules}; ${config.provider} cannot be called: ${problem}`, next(`${provider.fix()}, then run lawcheck doctor`));
      let at = '';
      if (provider.probe !== undefined) {
        const probed = await provider.probe();
        if ('problem' in probed) return set('reviewer', 'fail', `${rules}; ${config.provider} cannot be called: ${probed.problem}`, next(`${probed.fix}, then run lawcheck doctor`));
        at = ` at ${probed.at}`;
      }
      if (!inputs.reviewer) return set('reviewer', 'ok', `${rules}; ${config.provider} can be called${at} (lawcheck doctor --reviewer makes one call)`);
      const asked = await provider.ask(TEST_PROMPT);
      if ('failure' in asked) return set('reviewer', 'fail', `${rules}; ${config.provider} did not answer a test call: ${hide(asked.failure)}`, next(`${asked.fix}, then run lawcheck doctor --reviewer`));
      const checked = checkAnswer(asked.answer, 0);
      if ('problem' in checked || checked.verdict !== 'pass') {
        const what = 'problem' in checked ? 'answered with no verdict' : 'answered fail to a test call that asks for pass';
        return set('reviewer', 'fail', `${rules}; ${config.provider} ${what}: ${[...hide(asked.answer)].slice(0, 200).join('')}`, next(`ask the user to check reviewer.model in .lawcheck/config.yaml or to choose another model, then run lawcheck doctor --reviewer`));
      }
      set('reviewer', 'ok', `${rules}; ${config.provider} answered a test call`);
    },
  };

  for (const id of IDS) {
    const missing = WAITS[id]!.find((wait) => !passed(wait));
    if (missing !== undefined) {
      set(id, 'skip', `needs ${missing === 'law-file' ? 'law' : missing}`);
      continue;
    }
    await steps[id]!();
  }
  return IDS.map((id) => checks.get(id)!);
}

export function doctorText(checks: Check[], refused: string | null = null): string {
  const problems = checks.filter((c) => c.state === 'fail').length;
  const notes = checks.filter((c) => c.state === 'note').length;
  const notePart = notes === 0 ? '' : `, ${plural(notes, 'note')}`;
  const first = problems === 0 ? `lawcheck: PASS  ${plural(checks.length, 'check')}${notePart}` : `lawcheck: FAIL  ${plural(checks.length, 'check')}, ${plural(problems, 'problem')}${notePart}`;
  const lines = [refused === null ? first : `lawcheck: ERROR  ${refused}`, ''];
  for (const check of checks) {
    lines.push(`${check.state}  ${check.id}  ${shown(check.message)}`);
    for (const detail of check.details ?? []) lines.push(`  ${shown(detail)}`);
    if ((check.state === 'note' || check.state === 'fail') && check.next !== null) lines.push(`  next: ${shown(check.next.text)}`);
  }
  return lines.join('\n') + '\n';
}

export async function doctor(args: Arguments, context: CheckContext, json: boolean): Promise<Result> {
  const extra = noWords(args);
  if (extra !== null) return usageError(extra, json, 'doctor');
  const runtime = context.runtime ?? runtimeNow();
  const checks = await runChecks({ cwd: context.cwd, env: context.env, base: flagText(args, '--base'), reviewer: args.flags.has('--reviewer'), runtime });
  const failed = checks.some((check) => check.state === 'fail');
  // A refused environment leads the output, as it leads every other command's; the rows below still say what else holds.
  const refused = environmentRefusal(runtime, () => gitNow(context.cwd));
  const stdout = json ? documentOf({ schema: 'lawcheck-doctor/0', result: failed ? 'fail' : 'pass', checks }) : doctorText(checks, refused?.message ?? null);
  return { code: failed ? 2 : 0, stdout };
}
