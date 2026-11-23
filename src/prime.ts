import { CONFIG_BYTES, readWhole } from './limits.js';
import { decode } from './types.js';
import { join } from 'node:path';
import { documentOf, noWords, usageError } from './args.js';
import { CONFIG, readConfig, RUNNER_COMMANDS, runnerOf } from './config.js';
import type { Runner } from './config.js';
import type { Arguments, Result } from './args.js';
import type { CheckContext } from './check.js';
import type { Law, TypeDef } from './law.js';
import { plural, renderErrors, shown } from './output.js';
import { findRoot, loadLaw, loadRuleFiles, requireGit, stopped } from './setup.js';
import type { Kinds } from './setup.js';
import { listInForce } from './uses.js';

const PLAIN_PLAN = 'the file types and the rules each type keeps';
const PLAN_WITH_USES = 'the file types, the rules each type keeps, and which types may use which';

export const NO_REVIEWER = '- not-reviewed: no reviewer is set in .lawcheck/config.yaml, so a plain lawcheck check and CI fail on every file a reviewer rule judges. Tell the user once; setting a reviewer is the user\'s decision.';

export function firstPart(reviewers: boolean, mayUse: boolean, folders = false, noReviewer = false): string {
  return [
    `Lawcheck checks this repository's code against its law: ${mayUse ? PLAN_WITH_USES : PLAIN_PLAN}. The law is .lawcheck/law.yaml; rule files are in .lawcheck/rules/.`,
    '',
    'How to work here',
    '- Before you create a file, or first edit a file of a type new to you: lawcheck explain <path>',
    '- After you change code: lawcheck check. If it says "no base", run lawcheck check --base <the branch you started from>.',
    '- Exit 0: nothing blocks; warnings are advisory. Exit 1: the code breaks the law; fix the code. Exit 2: Lawcheck or the law is broken; fix what the error names, not the code.',
    '- Never report work as done while lawcheck check exits 1.',
    "- A failing run ends with a next line; do what it says. When it asks for something listed below as the user's, or a finding cannot be fixed in the code, ask the user.",
    ...(reviewers ? [noReviewer ? NO_REVIEWER : '- not-reviewed: fix every other finding first, then run lawcheck check --review'] : []),
    '- A plain check judges only changed files. After you change the law or a rule file, run lawcheck check --full and tell the user how many findings it lists outside your change.',
    '- Findings outside your change are debt. Leave them unless the user asks.',
    '',
    "Only on the user's word",
    '- a waiver comment: lawcheck-waive <rule> -- <reason> (lawcheck docs waivers), or taking a rule off a type',
    '- deleting a rule, or changing its status or its why',
    ...(mayUse ? ['- widening may_use'] : []),
    ...(folders ? ['- adding a pattern to ignored, or taking one from required'] : []),
    ...(reviewers ? ['- lawcheck check --review --again, or --max-calls above reviewer.max_calls'] : []),
    '- any edit of .lawcheck/verdicts or of .lawcheck/config.yaml',
    '',
    'You may, unasked',
    '- add a type for a new kind of file, or make a type finer',
    `- write a rule the user asked for, and try it first: lawcheck try <rule> <files>${reviewers ? '; a reviewer rule pays one call per file, so add --dry-run first' : ''}`,
    '',
  ].join('\n');
}

export const FIRST_PART = firstPart(true, true);

export const NO_LAW = [
  'Lawcheck is installed, and this directory has no law (.lawcheck/law.yaml here or above).',
  'Run lawcheck init only when the user asks for a law here.',
  '',
].join('\n');

export const BUDGET = 8000;
const MORE = 'More: lawcheck docs';
const SHORTENED = 'shortened to fit; lawcheck explain --type <id> shows a type in full, lawcheck explain --rule <id> a rule';

export function length(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

export function cut(text: string): string {
  const points = [...text];
  return points.length > 60 ? points.slice(0, 59).join('') + '…' : text;
}

export function mayUsePart(type: TypeDef, gap = ' '): string | null {
  const inForce = listInForce(type);
  if (inForce === null) return null;
  const list = inForce.list.length === 0 ? 'nothing' : inForce.list.join(', ');
  return inForce.from === type ? list : `${list}${gap}(from ${inForce.from.id})`;
}

export function walk(types: TypeDef[], visit: (type: TypeDef, depth: number) => void, depth = 0): void {
  for (const type of types) {
    visit(type, depth);
    walk(type.types, visit, depth + 1);
  }
}

export function ruleKind(kinds: Kinds, id: string): 'script' | 'reviewer' {
  return kinds.scripts.has(id) ? 'script' : 'reviewer';
}

function typeLine(type: TypeDef, depth: number, step: number): string {
  const short = step >= 3 && depth > 0;
  const parts = [type.id];
  if (!short) {
    parts.push(shown(type.paths.join(', ')));
    if (type.expression !== null) parts.push(`content: ${shown(type.expression)}`);
  }
  if (type.about !== null) parts.push(shown(step >= 2 ? cut(type.about) : type.about));
  if (type.rules.length > 0) parts.push(`rules: ${type.rules.join(', ')}`);
  const mayUse = mayUsePart(type);
  if (mayUse !== null) parts.push(`may use: ${mayUse}`);
  return '  '.repeat(depth) + parts.join('  ');
}

function listed(law: Law): Set<string> {
  const out = new Set<string>();
  walk(law.types, (type) => type.rules.forEach((rule) => out.add(rule)));
  return out;
}

function ruleLine(law: Law, kinds: Kinds, id: string, onTypes: Set<string>, step: number): string {
  const rule = law.rules.get(id)!;
  const parts = [id, ruleKind(kinds, id)];
  if (rule.status === 'advisory') parts.push('advisory');
  if (!onTypes.has(id)) parts.push('on no type');
  if (step < 3) parts.push(step >= 2 ? cut(rule.why) : rule.why);
  return parts.join('  ');
}

function rootLine(type: TypeDef): string {
  const parts = [type.id, type.paths.join(', ')];
  if (type.expression !== null) parts.push(`content: ${type.expression}`);
  if (type.about !== null) parts.push(shown(cut(type.about)));
  let subtypes = 0;
  const rules = new Set(type.rules);
  walk(type.types, (sub) => {
    subtypes++;
    sub.rules.forEach((rule) => rules.add(rule));
  });
  if (subtypes > 0) parts.push(`subtypes: ${subtypes}`);
  if (rules.size > 0) parts.push(`rules: ${rules.size}`);
  return parts.join('  ');
}

function header(law: Law): string {
  let count = 0;
  walk(law.types, () => count++);
  const lines = [`The law here: ${plural(count, 'type')}, ${plural(law.rules.size, 'rule')}`];
  if (law.required.patterns.length > 0) lines.push(`Every file under ${shown(law.required.patterns.join(', '))} needs a type; a file with none is untyped-file`);
  if (law.ignored.patterns.length > 0) lines.push(`Left out of the law: ${shown(law.ignored.patterns.join(', '))}`);
  return lines.join('\n');
}

function assemble(first: string, head: string, typeLines: string[], ruleLines: string[], last: string): string {
  return [first + head, ...typeLines, '', 'Rules', ...ruleLines, '', last, ''].join('\n');
}

export function startPart(root: string): string {
  let runner = 'global';
  try {
    const bytes = readWhole(join(root, CONFIG), CONFIG);
    if (bytes.length > CONFIG_BYTES) return '';
    runner = runnerOf(decode(bytes));
  } catch {
    return '';
  }
  return runner === 'global' || !Object.hasOwn(RUNNER_COMMANDS, runner) ? '' : ` Start it here as: ${RUNNER_COMMANDS[runner as Runner].words.join(' ')}`;
}

export function reviewerUnset(root: string): boolean {
  try {
    const read = readConfig(root);
    return 'config' in read && read.config.provider === null;
  } catch {
    return false;
  }
}

export function withStart(first: string, start: string): string {
  const end = first.indexOf('\n');
  return first.slice(0, end) + start + first.slice(end);
}

export function primeText(law: Law, kinds: Kinds, budget = BUDGET, start = '', noReviewer = false): { text: string; step: number } {
  const head = '\n' + header(law);
  let mayUse = false;
  walk(law.types, (type) => {
    if (type.mayUse !== null) mayUse = true;
  });
  const folders = law.required.patterns.length > 0 || law.ignored.patterns.length > 0;
  const first = withStart(firstPart([...law.rules.keys()].some((id) => ruleKind(kinds, id) === 'reviewer'), mayUse, folders, noReviewer), start);
  const onTypes = listed(law);
  const ids = [...law.rules.keys()];
  const fits = (text: string) => length(text) <= budget;
  for (const step of [1, 2, 3]) {
    const typeLines: string[] = [];
    walk(law.types, (type, depth) => typeLines.push(typeLine(type, depth, step)));
    const text = assemble(first, head, typeLines, ids.map((id) => ruleLine(law, kinds, id, onTypes, step)), step === 1 ? MORE : SHORTENED);
    if (fits(text)) return { text, step };
  }
  const roots = law.types.map(rootLine);
  const render = (count: number, idsLine: string) => {
    const lines = roots.slice(0, count);
    if (count < roots.length) lines.push(`... and ${plural(roots.length - count, 'more root type')}`);
    return assemble(first, head, lines, idsLine === '' ? [] : [idsLine], SHORTENED);
  };
  let idsLine = ids.join(', ');
  if (!fits(render(0, idsLine))) {
    let kept = ids.length - 1;
    const shortened = (k: number) => `${ids.slice(0, k).join(', ')}, and ${ids.length - k} more`;
    while (kept > 0 && !fits(render(0, shortened(kept)))) kept--;
    idsLine = kept === 0 ? '' : shortened(kept);
  }
  let count = 0;
  while (count < roots.length && fits(render(count + 1, idsLine))) count++;
  return { text: render(count, idsLine), step: 4 };
}

export async function prime(args: Arguments, context: CheckContext, json: boolean): Promise<Result> {
  const extra = noWords(args);
  if (extra !== null) return usageError(extra, json, 'prime');
  const root = findRoot(context.cwd);
  const answer = (text: string, step: number | null): Result => ({
    code: 0,
    stdout: json ? documentOf({ schema: 'lawcheck-prime/0', text, step, characters: length(text) }) : text,
  });
  if (root === null) return answer(NO_LAW, null);
  const outcome = await stopped(() => {
    requireGit(root);
    const law = loadLaw(root);
    const { kinds } = loadRuleFiles(root, law);
    return { law, kinds };
  });
  if ('errors' in outcome) {
    if (json) return { code: 2, stdout: renderErrors(outcome.errors, true, 'prime') };
    return { code: 2, stdout: withStart(FIRST_PART, startPart(root)) + '\n' + renderErrors(outcome.errors, false, 'prime', 20) };
  }
  const { text, step } = primeText(outcome.law, outcome.kinds, BUDGET, startPart(root), reviewerUnset(root));
  return answer(text, step);
}
