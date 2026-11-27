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
  command: ['commands'],
  flag: ['commands'],
  'exit code': ['commands', 'change'],
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
  assert.ok(named[0]!.startsWith('commands: --planted-flag (flag) is no heading and no first cell of a table row of docs/commands.md'), named[0]);
  assert.ok(named[1]!.startsWith('codes: planted-code (code) is no heading and no first cell of a table row of docs/codes.md'), named[1]);
});

test('question 95: control, an entry of the list that its page holds, an entry that names no item, and an entry given twice are each named', () => {
  const problems = problemsOf(itemsOf(readRepo), readRepo, [...NOT_YET_COVERED, 'codes: usage', 'commands: --no-such-flag', 'codes: usage']);
  assert.ok(problems.includes('codes: usage (code) is on the list of items not yet covered, and docs/codes.md now holds it: remove it from the list and lower DOCS_NOT_COVERED'));
  assert.ok(problems.includes('commands: --no-such-flag is on the list of items not yet covered and is no item of the code: remove it'));
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

const readText = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

// Ruling cursor-bez-sesji: no session of Cursor has run the plugin, so a text about Cursor says only that Cursor loads it through its support for Claude Code plugins and that no session has run it.
const CURSOR_TEXTS = ['CHANGELOG.md', 'docs/changelog.md', 'docs/other-tools.md', 'docs/other-agents.md', 'docs/plugin.md', 'docs/cursor.md'];

test('test 1310: every text about Cursor says that no session of Cursor has run the plugin and claims nothing of the hooks or entries Cursor would need (control)', () => {
  for (const page of CURSOR_TEXTS) {
    const text = readText(page);
    assert.match(text, /[Nn]o session of Cursor (has|ran)/, `${page} says that no session of Cursor has run the plugin`);
    assert.ok(!text.includes('.cursor/hooks.json'), `${page} claims nothing of the entries that Cursor's hooks need`);
  }
  assert.ok(!readText('docs/cursor.md').includes('| `PostToolUse` |'), 'docs/cursor.md has no table of what each hook does in Cursor');
  assert.ok(readText('docs/cursor.md').includes('Cursor loads a plugin only when `enabledPlugins` holds `true` for it'));
  for (const page of ['README.md', 'docs/index.md']) assert.ok(!readText(page).includes('Cursor'), `${page} leaves Cursor to docs/cursor.md, so it is no text about Cursor`);
});

test('test 1311: the Copilot CLI texts of docs/copilot-cli.md and other-tools say that the check after an edit never ran in the recorded sessions, the README and the docs home leave it to that page, and the record shows it (control)', () => {
  const record = JSON.parse(readText('tests/agent/result-copilot.json')) as { arms: Record<string, { list: Array<{ log: Array<{ caller: string }> }> }> };
  const callers = new Set(Object.values(record.arms).flatMap((arm) => arm.list.flatMap((session) => session.log.map((call) => call.caller))));
  assert.ok(callers.has('stop'), 'the record holds sessions in which the check before the end of a turn ran');
  assert.ok(!callers.has('edit'), 'no recorded Copilot CLI session ran the check after an edit');
  assert.ok(readText('docs/copilot-cli.md').includes('The trial below had 24 sessions with the check after an edit. In each of them, the agent wrote every file with a shell command, so that check never ran.'));
  assert.ok(readText('docs/copilot-cli.md').includes('In the 24 sessions with the hook after an edit, the agent wrote every file with a shell command, so that hook never ran a check.'));
  for (const page of ['README.md', 'docs/index.md']) assert.ok(!readText(page).includes('24 recorded sessions'), `${page} leaves the 24 sessions to docs/copilot-cli.md`);
  assert.ok(readText('docs/other-tools.md').includes('and in Copilot CLI before the agent ends its turn'));
});
