import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMANDS, readArguments } from '../../dist/args.js';
import { CONFIG, PROVIDERS, RUNNERS } from '../../dist/config.js';
import { CODES } from '../../dist/output.js';
import { LAW, RULES_DIR } from '../../dist/setup.js';
import { ATTRIBUTES, LOCAL, VERDICTS } from '../../dist/verdicts.js';
import { SIGN_IN_VARIABLES } from '../../dist/providers/program.js';
import { LANGUAGES } from '../../dist/readers.js';
import { DOCS_NOT_COVERED } from '../numbers.ts';
import { ROOT, walk } from '../harness/sets.ts';

const PAGES: Record<string, string[]> = {
  command: ['cli'],
  flag: ['cli'],
  'exit code': ['cli', 'change'],
  'law key': ['law'],
  'config key': ['config'],
  runner: ['config'],
  variable: ['config'],
  provider: ['providers'],
  language: ['languages'],
  'waiver code': ['waivers'],
  code: ['codes'],
  'JSON document': ['json'],
  'JSON field': ['json'],
  hook: ['plugin'],
  setting: ['plugin'],
  file: ['files'],
};

// Lawcheck sets these for the programs it starts, and a user never does: LAWCHECK_REVIEW_CALL marks the processes of one reviewer call so that Lawcheck can end them, and GIT_CONFIG_COUNT carries the settings Lawcheck gives git.
const INTERNAL_VARIABLES = ['LAWCHECK_REVIEW_CALL', 'GIT_CONFIG_COUNT'];

// The items no page holds yet, as '<page>: <name>'. It may only shrink: the rail fails on an entry that its page now holds, and DOCS_NOT_COVERED in tests/numbers.ts counts it.
const NOT_YET_COVERED: string[] = [
  'cli: init',
  'cli: prime',
  'cli: check',
  'cli: explain',
  'cli: try',
  'cli: docs',
  'cli: doctor',
  'cli: --version',
  'cli: --help',
  'cli: --json',
  'cli: --full',
  'cli: --base',
  'cli: --review',
  'cli: --again',
  'cli: --max-calls',
  'cli: --type',
  'cli: --rule',
  'cli: --times',
  'cli: --dry-run',
  'cli: --reviewer',
  'cli: 0',
  'cli: 1',
  'cli: 2',
  'law: lawcheck',
  'law: rules',
  'law: types',
  'law: why',
  'law: status',
  'law: context',
  'law: about',
  'law: paths',
  'law: content',
  'law: waivers',
  'config: reviewer',
  'config: LAWCHECK_REVIEWER_KEY',
  'config: LAWCHECK_REVIEWER_ENDPOINT',
  'config: LAWCHECK_BASE',
  'config: ANTHROPIC_API_KEY',
  'config: GOOGLE_API_KEY',
  'config: OPENAI_API_KEY',
  'config: ANTHROPIC_AUTH_TOKEN',
  'config: CLAUDE_CODE_OAUTH_TOKEN',
  'config: CODEX_API_KEY',
  'config: GEMINI_API_KEY',
  'config: COPILOT_GITHUB_TOKEN',
  'config: GH_TOKEN',
  'config: GITHUB_TOKEN',
  'config: COPILOT_PROVIDER_API_KEY',
  'config: COPILOT_PROVIDER_API_KEY_COMMAND',
  'config: COPILOT_PROVIDER_BEARER_TOKEN',
  'json: checks',
  'json: subject',
  'json: root',
  'json: created',
  'json: kept',
  'json: text',
  'json: step',
  'json: characters',
  'plugin: SessionStart',
  'plugin: UserPromptSubmit',
  'plugin: PostToolUse',
  'plugin: Stop',
  'plugin: check_after_edit',
  'plugin: check_before_stop',
  'config: CI',
  'json: scope.mode',
  'json: scope.base',
  'json: scope.files',
  'json: scope.law_changed',
  'json: scope.law_changes',
  'json: summary.errors',
  'json: summary.warnings',
  'json: summary.debt',
  'json: summary.waivers',
  'json: summary.unresolved',
  'json: findings.code',
  'json: findings.rule',
  'json: findings.severity',
  'json: findings.blocking',
  'json: findings.debt',
  'json: findings.file',
  'json: findings.line',
  'json: findings.type',
  'json: findings.message',
  'json: findings.why',
  'json: waivers.file',
  'json: waivers.line',
  'json: waivers.rule',
  'json: waivers.debt',
  'json: waivers.waived',
  'json: waivers.reason',
  'json: unresolved.file',
  'json: unresolved.line',
  'json: unresolved.what',
  'json: unresolved.answer',
  'json: unresolved.reason',
  'json: unresolved.candidates',
  'json: unresolved.debt',
  'json: reviews.missing',
  'json: reviews.calls_made',
  'json: reviews.passes_recorded',
  'json: next.command',
  'json: next.text',
  'json: topics',
  'json: topics.id',
  'json: topics.title',
  'json: id',
  'json: title',
  'json: checks.id',
  'json: checks.state',
  'json: checks.message',
  'json: checks.next',
  'json: checks.next.command',
  'json: checks.next.text',
  'json: errors.code',
  'json: errors.file',
  'json: errors.line',
  'json: errors.message',
  'json: errors.why',
  'json: path',
  'json: exists',
  'json: chain',
  'json: about',
  'json: none',
  'json: matched',
  'json: matched.type',
  'json: matched.pattern',
  'json: matched.content',
  'json: not_matched',
  'json: not_matched.type',
  'json: not_matched.content',
  'json: then',
  'json: may_use',
  'json: may_use.types',
  'json: may_use.from',
  'json: uses',
  'json: uses.read',
  'json: uses.language',
  'json: rules',
  'json: rules.id',
  'json: rules.kind',
  'json: rules.status',
  'json: rules.why',
  'json: rules.from',
  'json: rules.review',
  'json: types',
  'json: types.type',
  'json: types.files',
  'json: paths',
  'json: content',
  'json: subtypes',
  'json: kind',
  'json: status',
  'json: why',
  'json: context',
  'json: reviewed',
  'json: summary.findings',
  'json: summary.files_with_findings',
  'json: summary.waived',
  'json: summary.calls_made',
  'json: runs.file',
  'json: runs.attempt',
  'json: runs.verdict',
  'json: runs.findings',
  'json: runs.findings.line',
  'json: runs.findings.message',
  'json: runs.findings.severity',
  'json: runs.waived',
  'json: runs.answer',
  'json: runs.prompt_chars',
  'files: .lawcheck/config.yaml',
  'files: .lawcheck/.gitignore',
  'files: .lawcheck/law.yaml',
  'files: .lawcheck/rules/',
  'files: .lawcheck/verdicts',
  'files: .lawcheck/.gitattributes',
  'files: .lawcheck/.local',
];

type Item = { kind: string; name: string };
type Read = (path: string) => string | null;

const readRepo: Read = (path) => {
  const file = join(ROOT, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

function source(read: Read, path: string): string {
  const text = read(path);
  if (text === null) throw new Error(`${path} is missing`);
  return text;
}

function strings(text: string): string[] {
  return [...text.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

function block(text: string, pattern: RegExp, path: string): string {
  const found = pattern.exec(text);
  if (found === null) throw new Error(`${path}: ${pattern} finds nothing`);
  return found[1]!;
}

type Schema = { $ref?: string; properties?: Record<string, Schema | boolean>; items?: Schema; oneOf?: Schema[]; anyOf?: Schema[]; allOf?: Schema[]; then?: Schema; else?: Schema; definitions?: Record<string, Schema> };

// A nested field is named by its path of keys, as findings.code or checks.state, whether it sits in an object or in the items of a list.
function fieldsOf(node: Schema | boolean | undefined, root: Schema, prefix: string): string[] {
  if (typeof node !== 'object') return [];
  const at = node.$ref === undefined ? node : root.definitions![node.$ref.replace('#/definitions/', '')]!;
  const out: string[] = [];
  for (const [key, child] of Object.entries(at.properties ?? {})) {
    const name = prefix === '' ? key : `${prefix}.${key}`;
    if (name !== 'schema') out.push(name);
    out.push(...fieldsOf(child, root, name));
  }
  for (const branch of [...(at.oneOf ?? []), ...(at.anyOf ?? []), ...(at.allOf ?? []), at.then, at.else, at.items]) out.push(...fieldsOf(branch, root, prefix));
  return out;
}

function arrayOf(read: Read, path: string, name: string): string[] {
  return strings(block(source(read, path), new RegExp(`const ${name}\\b[^=]*=\\s*\\[([^\\]]*)\\]`), path));
}

function itemsOf(read: Read): Item[] {
  const args = source(read, 'src/args.ts');
  const flags = block(args, /const FLAGS[^=]*=\s*\{([\s\S]*?)\n\};/, 'src/args.ts');
  const sources = walk(join(ROOT, 'src'), (name) => name.endsWith('.ts')).map((path) => source(read, path)).join('\n');
  const programs = block(source(read, 'src/providers/program.ts'), /const SIGN_IN_VARIABLES[^=]*=\s*\{([\s\S]*?)\};/, 'src/providers/program.ts');
  const schemas = readdirSync(join(ROOT, 'tests/harness/schemas')).filter((file) => file.endsWith('.json')).sort();
  const groups: Record<string, string[]> = {
    command: [...arrayOf(read, 'src/args.ts', 'COMMANDS'), ...[...source(read, 'src/main.ts').matchAll(/argv\[0\] === '(--[a-z-]+)'/g)].map((m) => m[1]!)],
    flag: strings(flags).filter((word) => word.startsWith('--')),
    'exit code': [...args.matchAll(/Exit (\d+):/g)].map((m) => m[1]!),
    'law key': ['TOP_KEYS', 'RULE_KEYS', 'TYPE_KEYS'].flatMap((name) => arrayOf(read, 'src/law.ts', name)),
    'config key': ['TOP_KEYS', 'REVIEWER_KEYS'].flatMap((name) => arrayOf(read, 'src/config.ts', name)),
    runner: arrayOf(read, 'src/config.ts', 'RUNNERS'),
    variable: [
      ...[...sources.matchAll(/['"`](LAWCHECK_[A-Z0-9_]+)['"`]|\benv\.([A-Z][A-Z0-9_]*)\b/g)].map((m) => (m[1] ?? m[2])!).filter((name) => !INTERNAL_VARIABLES.includes(name)),
      ...[...sources.matchAll(/ownKey\(env, '[^']+', [^,]+, '([A-Z0-9_]+)'\)/g)].map((m) => m[1]!),
      ...strings(programs),
    ],
    provider: arrayOf(read, 'src/config.ts', 'PROVIDERS'),
    language: arrayOf(read, 'src/readers.ts', 'LANGUAGES'),
    code: [...block(source(read, 'src/output.ts'), /const WHY[^=]*=\s*\{([\s\S]*?)\n\};/, 'src/output.ts').matchAll(/^\s+'?([a-z][a-z-]*)'?:/gm)].map((m) => m[1]!),
    'JSON document': schemas.map((file) => file.replace(/-(\d+)\.json$/, '/$1')),
    'JSON field': schemas.flatMap((file) => {
      const schema = JSON.parse(source(read, `tests/harness/schemas/${file}`)) as Schema;
      return fieldsOf(schema, schema, '');
    }),
    hook: Object.keys((JSON.parse(source(read, 'plugin/hooks/hooks.json')) as { hooks: object }).hooks),
    file: [...sources.matchAll(/const [A-Z_]+ = '(\.lawcheck\/[^']*)'/g)].map((m) => m[1]!),
    setting: Object.keys((JSON.parse(source(read, 'plugin/.claude-plugin/plugin.json')) as { userConfig: object }).userConfig),
  };
  groups['waiver code'] = groups.code!.filter((code) => code.startsWith('waiver-'));
  const out: Item[] = [];
  for (const [kind, names] of Object.entries(groups)) {
    if (names.length === 0) throw new Error(`no ${kind} is read from the code`);
    for (const name of [...new Set(names)]) out.push({ kind, name });
  }
  return out;
}

function holds(page: string, name: string): boolean {
  let fenced = false;
  for (const line of page.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const place = /^#{1,6}\s+(.*?)\s*$/.exec(line)?.[1] ?? /^\|\s*([^|]*?)\s*\|/.exec(line)?.[1];
    if (place === undefined) continue;
    const plain = place.replaceAll('`', '');
    if (plain === name || plain.startsWith(`${name} `)) return true;
  }
  return false;
}

function problemsOf(items: Item[], read: Read, list: string[]): string[] {
  const problems: string[] = [];
  const wanted = new Map<string, string>();
  for (const { kind, name } of items) for (const page of PAGES[kind]!) wanted.set(`${page}: ${name}`, kind);
  const listed = new Set<string>();
  for (const entry of list) {
    if (listed.has(entry)) problems.push(`${entry} is twice on the list of items not yet covered`);
    listed.add(entry);
    if (!wanted.has(entry)) problems.push(`${entry} is on the list of items not yet covered and is no item of the code: remove it`);
  }
  for (const [entry, kind] of wanted) {
    const page = entry.slice(0, entry.indexOf(': '));
    const name = entry.slice(page.length + 2);
    const text = read(`docs/${page}.md`);
    const held = text !== null && holds(text, name);
    if (held && listed.has(entry)) problems.push(`${entry} (${kind}) is on the list of items not yet covered, and docs/${page}.md now holds it: remove it from the list and lower DOCS_NOT_COVERED`);
    if (!held && !listed.has(entry)) problems.push(`${entry} (${kind}) is no heading and no first cell of a table row of docs/${page}.md${text === null ? ', which does not exist' : ''}`);
  }
  return problems;
}

test('question 95: every item the code holds as data is a heading, or the first cell of a table row, of its page in docs/, alone or followed by a space, or is on the list of items not yet covered, and no entry of that list is held', () => {
  assert.deepEqual(problemsOf(itemsOf(readRepo), readRepo, NOT_YET_COVERED), []);
});

test('question 95: the list of items not yet covered is as long as DOCS_NOT_COVERED in tests/numbers.ts, which may only fall', () => {
  assert.equal(NOT_YET_COVERED.length, DOCS_NOT_COVERED);
});

test('question 95: what the rail reads from the source text is what the built code holds', () => {
  const items = itemsOf(readRepo);
  const of = (kind: string) => items.filter((i) => i.kind === kind).map((i) => i.name).sort();
  assert.deepEqual(of('command'), [...COMMANDS, '--version', '--help'].sort());
  assert.deepEqual(of('code'), [...CODES].sort());
  assert.deepEqual(of('provider'), [...PROVIDERS].sort());
  assert.deepEqual(of('runner'), [...RUNNERS].sort());
  assert.deepEqual(of('language'), [...LANGUAGES].sort());
  for (const path of [LAW, RULES_DIR, CONFIG, VERDICTS, ATTRIBUTES, LOCAL]) assert.ok(of('file').includes(path), path);
  for (const name of Object.values(SIGN_IN_VARIABLES).flat()) assert.ok(of('variable').includes(name), name);
  const known = (flag: string) => COMMANDS.some((command) => {
    const read = readArguments([command, flag, '1']);
    return !('problem' in read) || !read.problem.startsWith('unknown flag');
  });
  for (const flag of of('flag')) assert.ok(known(flag), `${flag} is no flag of the parser`);
});

test('question 95: a flag planted in the argument parser and a code planted in the codes registry, held by no page, are named (control)', () => {
  const planted: Read = (path) => {
    const text = readRepo(path);
    if (path === 'src/args.ts') return text!.replace("check: { '--full': 'switch',", "check: { '--planted-flag': 'switch', '--full': 'switch',");
    if (path === 'src/output.ts') return text!.replace("  usage: 'the tool", "  'planted-code': 'a planted code',\n  usage: 'the tool");
    return text;
  };
  const items = itemsOf(planted);
  assert.ok(items.some((i) => i.kind === 'flag' && i.name === '--planted-flag'));
  assert.ok(items.some((i) => i.kind === 'code' && i.name === 'planted-code'));
  const problems = problemsOf(items, planted, NOT_YET_COVERED);
  const named = problems.filter((p) => p.includes('planted'));
  assert.equal(named.length, 2);
  assert.ok(named[0]!.startsWith('cli: --planted-flag (flag) is no heading and no first cell of a table row of docs/cli.md'), named[0]);
  assert.ok(named[1]!.startsWith('codes: planted-code (code) is no heading and no first cell of a table row of docs/codes.md'), named[1]);
});

test('question 95: control, an entry of the list that its page holds, an entry that names no item, and an entry given twice are each named', () => {
  const problems = problemsOf(itemsOf(readRepo), readRepo, [...NOT_YET_COVERED, 'codes: usage', 'cli: --no-such-flag', 'codes: usage']);
  assert.ok(problems.includes('codes: usage (code) is on the list of items not yet covered, and docs/codes.md now holds it: remove it from the list and lower DOCS_NOT_COVERED'));
  assert.ok(problems.includes('cli: --no-such-flag is on the list of items not yet covered and is no item of the code: remove it'));
  assert.ok(problems.includes('codes: usage is twice on the list of items not yet covered'));
});

test('question 95: control, a name is held by a heading or a first cell, alone, in backticks or followed by a space, and not inside a fence, a later cell or a longer word', () => {
  assert.ok(holds('## --full and debt', '--full'));
  assert.ok(holds('| `law-invalid` | exit 2 |', 'law-invalid'));
  assert.ok(holds('### `--base <ref>`', '--base'));
  assert.ok(!holds('```\n# --full\n```', '--full'));
  assert.ok(!holds('| top | `rules` | no |', 'rules'));
  assert.ok(!holds('## --full-run', '--full'));
  assert.ok(!holds('The flag --full', '--full'));
});
