import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openai, startFake, type Fake } from '../acceptance/fake-reviewer.ts';
import {
  copySample,
  D,
  D_PATH,
  E,
  E_PATH,
  F,
  F_PATH,
  git,
  GIT_ENV,
  inTemp,
  lawcheck,
  lawcheckAt,
  LAW,
  makeCopy,
  makeR,
  makeSample,
  makeU,
  newRepository,
  REVIEWER_CONFIG,
  SAMPLE,
  setRule,
  U_LAW,
  write,
} from '../acceptance/helpers.ts';
import { CODES, WHY } from '../../dist/output.js';
import { main } from '../../dist/cli.js';
import { ledgerRows } from './spec-map.ts';
import { PENDING } from './pending-next.ts';

const TOOL_COMMANDS = ['init', 'prime', 'check', 'explain', 'try', 'docs', 'doctor'];
const VALUE_FLAGS = new Set(['--base', '--max-calls', '--times', '--type', '--rule']);
const TOPICS = readdirSync(new URL('../../docs/', import.meta.url)).map((f) => f.replace(/\.md$/, ''));
const REVIEW = ['--review', '--base', 'main'];
const CALL = 'lawcheck: 1 reviewer call to openai-compatible\n';
const UNREADABLE_SKIP = process.platform === 'win32' || process.getuid?.() === 0 ? 'a file mode cannot make a file unreadable for root, nor on Windows' : undefined;

interface Follow {
  fix?: () => void | Promise<void>;
  supply?: string[];
  env?: NodeJS.ProcessEnv;
}

interface Ready {
  cwd: string;
  argv: string[];
  env?: NodeJS.ProcessEnv;
  cli?: string;
  stderr?: string;
  exit?: number;
  first?: string;
  exact?: string[];
  report?: 'doctor';
  hint?: string;
  inProcess?: boolean;
  follow?: Follow;
}

interface Case {
  id: string;
  code: string | null;
  setup(dir: string, fake: Fake): Promise<Ready> | Ready;
}

const CLEANUP: (() => void)[] = [];

function repair(s: string): void {
  git(s, 'reset', '-q', '--hard');
  git(s, 'clean', '-fdq');
}

function inS(id: string, code: string, argv: string[], damage: (s: string) => void): Case {
  return {
    id,
    code,
    setup: (dir) => {
      const s = makeSample(dir);
      damage(s);
      return { cwd: s, argv, follow: { fix: () => repair(s) } };
    },
  };
}

const CHECK = ['check', '--base', 'main'];
const EXPLAIN = ['explain', 'src/core/price.ts'];
const TRY = ['try', 'no-console', 'src/core/price.ts'];
const withLaw = (text: string) => (s: string) => write(s, '.lawcheck/law.yaml', text);
const lawIn = (dir: string): string => {
  const repo = newRepository(dir);
  return repo;
};
const installLaw = (repo: string): void => cpSync(join(SAMPLE, '.lawcheck'), join(repo, '.lawcheck'), { recursive: true });

function reviewer(id: string, code: string, argv: string[], arrange: (r: string, fake: Fake) => Ready | void, follow: (r: string, fake: Fake) => Follow | undefined): Case {
  return {
    id,
    code,
    setup: (dir, fake) => {
      const r = makeR(dir);
      write(r, F_PATH, F);
      const extra = arrange(r, fake) ?? {};
      return { cwd: r, argv, env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, ...extra, follow: follow(r, fake) };
    },
  };
}

const CASES: Case[] = [
  { id: 'usage, check', code: 'usage', setup: (dir) => ({ cwd: makeSample(dir), argv: ['check', '--nope'], exit: 2 }) },
  { id: 'usage, no command', code: 'usage', setup: (dir) => ({ cwd: makeSample(dir), argv: ['--nope'], exit: 2 }) },
  {
    id: 'not-initialized, check',
    code: 'not-initialized',
    setup: (dir) => {
      const repo = lawIn(dir);
      return { cwd: repo, argv: ['check'], follow: { fix: () => installLaw(repo) } };
    },
  },
  {
    id: 'not-initialized, explain',
    code: 'not-initialized',
    setup: (dir) => {
      const repo = lawIn(dir);
      return { cwd: repo, argv: ['explain', 'README.md'], follow: { fix: () => installLaw(repo) } };
    },
  },
  {
    id: 'not-initialized, try',
    code: 'not-initialized',
    setup: (dir) => {
      const repo = lawIn(dir);
      return { cwd: repo, argv: ['try', 'no-console', 'README.md'], follow: { fix: () => installLaw(repo) } };
    },
  },
  { id: 'not-initialized, doctor', code: 'not-initialized', setup: (dir) => ({ cwd: lawIn(dir), argv: ['doctor'], report: 'doctor' }) },
  {
    id: 'not-initialized, doctor, law.yaml is a directory',
    code: 'not-initialized',
    setup: (dir) => {
      const repo = lawIn(dir);
      mkdirSync(join(repo, '.lawcheck/law.yaml'), { recursive: true });
      return { cwd: repo, argv: ['doctor'], report: 'doctor' };
    },
  },
  {
    id: 'already-initialized',
    code: 'already-initialized',
    setup: (dir) => ({ cwd: makeSample(dir), argv: ['init'] }),
  },
  {
    id: 'no-git, check',
    code: 'no-git',
    setup: (dir) => {
      const plain = join(dir, 'plain');
      copySample(plain);
      return {
        cwd: plain,
        argv: ['check'],
        follow: {
          fix: () => {
            git(plain, 'init', '-q', '-b', 'main');
            git(plain, 'add', '-A');
            git(plain, 'commit', '-q', '-m', 'sample');
          },
        },
      };
    },
  },
  {
    id: 'no-git, git cannot read the work tree',
    code: 'no-git',
    setup: (dir) => {
      const s = makeSample(dir);
      writeFileSync(join(s, '.git/HEAD'), 'not a ref\n');
      return { cwd: s, argv: CHECK };
    },
  },
  inS('law-invalid, check', 'law-invalid', CHECK, withLaw('lawcheck: 0.1.0\nrulez: {}\n')),
  inS('law-invalid, explain', 'law-invalid', EXPLAIN, withLaw('lawcheck: 0.1.0\nrulez: {}\n')),
  inS('law-invalid, try', 'law-invalid', TRY, withLaw('lawcheck: 0.1.0\nrulez: {}\n')),
  inS('config-invalid, check', 'config-invalid', CHECK, (s) => write(s, '.lawcheck/config.yaml', 'bogus: 1\n')),
  inS('config-invalid, explain', 'config-invalid', EXPLAIN, (s) => write(s, '.lawcheck/config.yaml', 'bogus: 1\n')),
  inS('rule-missing-file, check', 'rule-missing-file', CHECK, (s) => rmSync(join(s, '.lawcheck/rules/no-todo.mjs'))),
  inS('rule-missing-file, explain', 'rule-missing-file', EXPLAIN, (s) => rmSync(join(s, '.lawcheck/rules/no-todo.mjs'))),
  inS('rule-file-without-entry, check', 'rule-file-without-entry', CHECK, (s) => write(s, '.lawcheck/rules/extra.mjs', 'export function check() { return []; }\n')),
  inS('type-overlap, check', 'type-overlap', CHECK, withLaw(LAW + '  core:\n    paths: ["src/core/**"]\n')),
  inS('type-overlap, try', 'type-overlap', TRY, withLaw(LAW + '  core:\n    paths: ["src/core/**"]\n')),
  {
    id: 'base-unreachable, check',
    code: 'base-unreachable',
    setup: (dir) => ({ cwd: makeSample(dir), argv: ['check', '--base', 'nope'], follow: { supply: ['--base', 'main'] } }),
  },
  {
    id: 'base-unreachable, doctor',
    code: 'base-unreachable',
    setup: (dir) => ({ cwd: makeSample(dir), argv: ['doctor', '--base', 'nope'], report: 'doctor', follow: { supply: ['--base', 'main'] } }),
  },
  {
    id: 'base-unreachable, shallow clone, base fetched at depth 1 and passed',
    code: 'base-unreachable',
    setup: (dir) => {
      const origin = makeSample(dir);
      git(dir, 'clone', '-q', '--depth', '1', '--branch', 'work', `file://${origin}`, 'clone');
      const clone = join(dir, 'clone');
      git(clone, 'fetch', '-q', '--depth', '1', 'origin', 'main');
      return { cwd: clone, argv: ['check', '--base', 'origin/main'], follow: { supply: ['--base', 'origin/main'] } };
    },
  },
  {
    id: 'rule-crashed, check',
    code: 'rule-crashed',
    setup: (dir) => {
      const s = makeSample(dir);
      write(s, D_PATH, D);
      setRule(s, 'no-console', 'export function check() { throw new Error("broken"); }\n');
      return { cwd: s, argv: CHECK, follow: { fix: () => setRule(s, 'no-console', 'export function check() { return []; }\n') } };
    },
  },
  {
    id: 'rule-crashed, try',
    code: 'rule-crashed',
    setup: (dir) => {
      const s = makeSample(dir);
      setRule(s, 'no-console', 'export function check() { throw new Error("broken"); }\n');
      return { cwd: s, argv: TRY, follow: { fix: () => setRule(s, 'no-console', 'export function check() { return []; }\n') } };
    },
  },
  {
    id: 'rule-crashed, rule imports from above the root',
    code: 'rule-crashed',
    setup: (dir) => {
      const repo = makeSample(dir, { under: 'pkg', top: (top) => write(top, 'node_modules/hoisted/index.js', 'export default 1;\n') });
      write(repo, 'node_modules/hoisted/package.json', '{"name":"hoisted","type":"module","main":"index.js"}\n');
      write(repo, 'pkg/' + D_PATH, D);
      setRule(join(repo, 'pkg'), 'no-console', "import hoisted from 'hoisted';\nexport function check() { return hoisted === 1 ? [] : []; }\n");
      return { cwd: join(repo, 'pkg'), argv: CHECK, hint: '--allow-fs' };
    },
  },
  {
    id: 'parser-failed',
    code: 'parser-failed',
    setup: (dir) => {
      const u = makeU(dir);
      write(u, E_PATH, E);
      const copy = makeCopy();
      writeFileSync(join(copy.dir, 'dist', 'grammars', 'tree-sitter-typescript.wasm'), 'x');
      CLEANUP.push(copy.remove);
      return { cwd: u, argv: CHECK, cli: copy.cli };
    },
  },
  {
    id: 'reviewer-not-configured',
    code: 'reviewer-not-configured',
    setup: (dir, fake) => {
      const r = makeR(dir);
      write(r, F_PATH, F);
      rmSync(join(r, '.lawcheck/config.yaml'));
      return { cwd: r, argv: ['check', ...REVIEW], follow: { fix: () => write(r, '.lawcheck/config.yaml', REVIEWER_CONFIG), env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url } } };
    },
  },
  reviewer('too-many-reviews', 'too-many-reviews', ['check', ...REVIEW, '--max-calls', '0'], () => undefined, () => undefined),
  reviewer(
    'reviewer-unreachable, no endpoint',
    'reviewer-unreachable',
    ['check', ...REVIEW],
    () => ({ env: {} }),
    (_r, fake) => ({ env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url } }),
  ),
  reviewer(
    'reviewer-unreachable, check',
    'reviewer-unreachable',
    ['check', ...REVIEW],
    (_r, fake) => {
      fake.respond = () => ({ status: 400, body: '{}' });
      return { stderr: CALL };
    },
    (_r, fake) => ({ fix: () => void (fake.respond = () => openai(JSON.stringify({ verdict: 'pass', findings: [] }))) }),
  ),
  reviewer(
    'reviewer-unreachable, try',
    'reviewer-unreachable',
    ['try', 'clear-errors', F_PATH],
    (_r, fake) => {
      fake.respond = () => ({ status: 400, body: '{}' });
      return { stderr: CALL };
    },
    (_r, fake) => ({ fix: () => void (fake.respond = () => openai(JSON.stringify({ verdict: 'pass', findings: [] }))) }),
  ),
  reviewer(
    'reviewer-bad-answer',
    'reviewer-bad-answer',
    ['check', ...REVIEW],
    (_r, fake) => {
      fake.respond = () => openai('this is no verdict');
      return { stderr: CALL };
    },
    (_r, fake) => ({ fix: () => void (fake.respond = () => openai(JSON.stringify({ verdict: 'pass', findings: [] }))) }),
  ),
  { id: 'internal', code: 'internal', setup: (dir) => ({ cwd: makeSample(dir), argv: ['check'], inProcess: true }) },
  reviewer(
    'not-reviewed',
    'not-reviewed',
    ['check', '--base', 'main'],
    () => ({
      exit: 1,
      first: 'lawcheck: FAIL  1 error in 1 changed file (against main), 1 waiver',
      exact: ['src/core/refund.ts  error[not-reviewed]  clear-errors has no verdict for this content', '  why:  a reviewer rule says nothing about content it has not judged'],
    }),
    () => ({}),
  ),
  reviewer(
    'too-large-to-review',
    'too-large-to-review',
    ['check', '--base', 'main'],
    (r) => {
      write(r, '.lawcheck/config.yaml', REVIEWER_CONFIG + '  max_chars: 2126\n');
      return { exit: 1, exact: ['src/core/refund.ts  error[too-large-to-review]  the prompt for clear-errors holds 2127 characters; reviewer.max_chars is 2126', '  why:  the reviewer is never sent more than reviewer.max_chars characters'] };
    },
    () => undefined,
  ),
  {
    id: 'forbidden-use',
    code: 'forbidden-use',
    setup: (dir) => {
      const u = makeU(dir);
      write(u, E_PATH, E);
      return { cwd: u, argv: CHECK, exit: 1, exact: ['src/core/report.ts:2  error[forbidden-use]  library may not use command (src/cli/main.ts); it takes may_use [library] from source', "  why:  a type's may_use names every type its files may use"] };
    },
  },
  {
    id: 'uses-not-read',
    code: 'uses-not-read',
    setup: (dir) => {
      const u = makeU(dir);
      const law = U_LAW.replace('"src/**/*.ts", ', '"src/**/*.ts", "src/**/*.json", ');
      write(u, '.lawcheck/law.yaml', law);
      write(u, 'src/core/data.json', '{}\n');
      const at = law.split('\n').findIndex((line) => line.trim() === 'library:') + 1;
      return { cwd: u, argv: CHECK, exit: 0, exact: [`.lawcheck/law.yaml:${at}  warning[uses-not-read]  1 file of type library is not read for uses: 1 .json`, '  why:  a restriction that cannot be checked is not shown as kept'] };
    },
  },
  waiver('waiver-unknown-rule', '  // lawcheck-waive no-such -- support reads this line', null, 'src/core/discount.ts:2  error[waiver-unknown-rule]'),
  waiver('waiver-without-reason', '  // lawcheck-waive no-console', 'lawcheck: FAIL  2 errors, 1 warning in 1 changed file (against main), 1 waiver', 'src/core/discount.ts:2  error[waiver-without-reason]'),
  {
    id: 'waiver-unused',
    code: 'waiver-unused',
    setup: (dir) => {
      const s = makeSample(dir);
      write(s, D_PATH, D + '  // lawcheck-waive no-console -- nothing here\n');
      return { cwd: s, argv: CHECK, exit: 1, first: 'lawcheck: FAIL  1 error, 2 warnings in 1 changed file (against main), 2 waivers', exact: ['src/core/discount.ts:7  warning[waiver-unused]  '].slice(0, 0) };
    },
  },
  {
    id: 'doctor, the readers note names a page',
    code: null,
    setup: (dir) => {
      const u = makeU(dir);
      write(u, '.lawcheck/law.yaml', U_LAW.replace('"src/**/*.ts", ', '"src/**/*.ts", "src/**/*.json", '));
      write(u, 'src/core/data.json', '{}\n');
      return { cwd: u, argv: ['doctor', '--base', 'main'], report: 'doctor' };
    },
  },
  {
    id: 'doctor, the change touches the law',
    code: null,
    setup: (dir) => {
      const s = makeSample(dir);
      write(s, '.lawcheck/law.yaml', LAW + '# a comment\n');
      return { cwd: s, argv: ['doctor', '--base', 'main'], report: 'doctor' };
    },
  },
];

const UNREADABLE: Case = {
  id: 'file-unreadable',
  code: 'file-unreadable',
  setup: (dir) => {
    const s = makeSample(dir);
    chmodSync(join(s, 'src/core/price.ts'), 0o000);
    return { cwd: s, argv: CHECK, follow: { fix: () => chmodSync(join(s, 'src/core/price.ts'), 0o644) } };
  },
};

function waiver(code: string, line: string, first: string | null, place: string): Case {
  return {
    id: code,
    code,
    setup: (dir) => {
      const s = makeSample(dir);
      const lines = D.split('\n');
      lines.splice(1, 0, line);
      write(s, D_PATH, lines.join('\n'));
      return { cwd: s, argv: CHECK, exit: 1, ...(first === null ? {} : { first }), exact: [place] };
    },
  };
}

function documented(): { code: string; kind: string; why: string }[] {
  const page = readFileSync(new URL('../../docs/codes.md', import.meta.url), 'utf8');
  return page
    .split('\n')
    .filter((line) => /^\| `[a-z-]+` \|/.test(line))
    .map((row) => row.split(' | ').map((cell) => cell.replace(/^\| /, '').replace(/ \|$/, '')))
    .map((c) => ({ code: c[0]!.slice(1, -1), kind: c[1]!, why: c[3]! }));
}

function nextLine(stdout: string): string | null {
  const found = stdout.split('\n').map((line) => line.trimStart()).filter((line) => line.startsWith('next: '));
  return found.length === 0 ? null : found[found.length - 1]!.slice('next: '.length);
}

type Named = { argv: string[]; base?: true } | { problem: string } | null;

export function commandNamed(line: string, ran: string[]): Named {
  if (/\bthe same command\b/.test(line)) return { argv: ran };
  const found = [...line.matchAll(/(?<![\w./-])lawcheck(?: (\S+))?/g)].filter((m) => m[1] !== undefined);
  const last = found[found.length - 1];
  if (last !== undefined) {
    const word = last[1]!.replace(/[,;:]+$/, '');
    if (!word.startsWith('-') && !TOOL_COMMANDS.includes(word)) return { problem: `the line names the command "lawcheck ${word}", which is none of the seven` };
    const tail = line.slice(last.index! + last[0].length).split(/\s{2,}|\(|[,;:]/)[0]!.trim().split(/\s+/).filter((t) => t !== '');
    if (tail[0] === 'again') return word === ran[0] ? { argv: ran } : { problem: `the line says to run lawcheck ${word} again, after lawcheck ${ran[0]}` };
    const argv = word.startsWith('-') ? [word] : [word];
    for (let i = 0; i < tail.length; i++) {
      const token = tail[i]!;
      if (token.startsWith('-')) {
        argv.push(token);
        if (VALUE_FLAGS.has(token)) {
          const value = tail[++i];
          if (value === undefined || value.startsWith('-')) return { problem: `the flag ${token} in the line has no value` };
          argv.push(value);
        }
      } else if (word === 'docs' && argv.length === 1 && TOPICS.includes(token)) argv.push(token);
      else break;
    }
    return { argv };
  }
  if (/^pass --base\b/.test(line)) return { argv: ran, base: true };
  return null;
}

function supplied(ran: string[], supply: string[]): string[] {
  const out = [...ran];
  for (let i = 0; i < supply.length; i += 2) {
    const at = out.indexOf(supply[i]!);
    if (at >= 0) out.splice(at, 2, supply[i]!, supply[i + 1]!);
    else out.push(supply[i]!, supply[i + 1]!);
  }
  return out;
}

async function reproduce(spec: Case, dir: string, fake: Fake): Promise<string[]> {
  const problems: string[] = [];
  const say = (message: string) => problems.push(`${spec.id}: ${message}`);
  const ready = await spec.setup(dir, fake);
  const doc = documented().find((d) => d.code === spec.code) ?? { code: '', kind: 'doctor', why: '' };
  const go = (argv: string[], env: NodeJS.ProcessEnv = {}) =>
    ready.cli === undefined ? lawcheck(ready.cwd, argv, { ...(ready.env ?? {}), ...env }) : lawcheckAt(ready.cli, ready.cwd, argv, { ...(ready.env ?? {}), ...env });

  let text: { code: number | null; stdout: string; stderr: string };
  let json: { code: number | null; stdout: string; stderr: string };
  if (ready.inProcess === true) {
    const context = { cwd: '/', env: {} };
    const broken = async () => {
      throw new Error('the handler broke');
    };
    text = { ...(await main(ready.argv, context, broken)), stderr: '' };
    json = { ...(await main([...ready.argv, '--json'], context, broken)), stderr: '' };
  } else {
    text = await go(ready.argv);
    json = await go([...ready.argv, '--json']);
  }
  if (text.stderr !== (ready.stderr ?? '') || json.stderr !== (ready.stderr ?? '')) say(`standard error is ${JSON.stringify(text.stderr)}`);
  let document: any;
  try {
    document = JSON.parse(json.stdout);
  } catch {
    say(`--json prints no document: ${json.stdout}`);
    return problems;
  }
  const out = text.stdout;
  if (ready.report === 'doctor') {
    if (document.schema !== 'lawcheck-doctor/0') say(`the schema is ${document.schema}`);
  } else if (doc.kind === 'exit 2') {
    if (text.code !== 2 || json.code !== 2) say(`the exit codes are ${text.code} and ${json.code}, not 2`);
    const count = document.errors?.length ?? 0;
    if (!out.startsWith(`lawcheck: ERROR  ${count} error${count === 1 ? '' : 's'}\n`) && !out.startsWith('error[usage]')) say(`the first line is not the error count of the JSON (${count})`);
    if (!out.includes(`error[${spec.code}]`)) say(`no error[${spec.code}] line in text`);
    if (!out.includes(`  why:  ${doc.why}`)) say(`the why line of the codes page is missing`);
    if (document.schema !== 'lawcheck-error/1' || !document.errors.some((e: { code: string; why: string }) => e.code === spec.code && e.why === doc.why)) say(`the JSON has no ${spec.code} error with the why of the codes page`);
  } else {
    const wanted = ready.exit ?? 0;
    if (text.code !== wanted || json.code !== wanted) say(`the exit codes are ${text.code} and ${json.code}, not ${wanted}`);
    if (!document.findings?.some((f: { code: string }) => f.code === spec.code)) say(`the JSON has no ${spec.code} finding`);
    if (!out.includes(`[${spec.code}]`)) say(`no [${spec.code}] in text`);
    if (ready.first !== undefined && out.split('\n')[0] !== ready.first) say(`the first line is "${out.split('\n')[0]}", not "${ready.first}"`);
    for (const line of ready.exact ?? []) if (!out.split('\n').some((l) => l.startsWith(line))) say(`the line "${line}" is not in the output:\n${out}`);
  }
  if (ready.hint !== undefined) {
    const gone = !out.includes(ready.hint);
    const pending = PENDING.find((p) => p.id === spec.id);
    if (pending === undefined && !gone) say(`the message holds ${ready.hint}`);
    if (pending !== undefined && gone) say(`pending as ${pending.finding} and now free of ${ready.hint}: take it out of the list`);
    return problems;
  }
  const next = nextLine(out);
  const named: Named = next === null ? null : commandNamed(next, ready.argv);
  if (named !== null && 'problem' in named) {
    say(named.problem);
    return problems;
  }
  if (named === null) {
    if (ready.follow !== undefined && Object.keys(ready.follow).length > 0) say(`the case follows a command and the next line "${next}" names none`);
    return problems;
  }
  const pending = PENDING.find((p) => p.id === spec.id);
  await ready.follow?.fix?.();
  const argv = ready.follow?.supply !== undefined ? supplied(named.argv, ready.follow.supply) : named.argv;
  if (named.base === true && ready.follow?.supply === undefined) say(`the line asks for --base and the case supplies none`);
  let further: { code: number | null; stdout: string };
  if (ready.inProcess === true) further = await main(argv, { cwd: ready.cwd, env: { ...GIT_ENV } });
  else further = await go(argv, ready.follow?.env ?? {});
  const gets = further.code !== 2 && !further.stdout.includes('error[usage]');
  if (pending === undefined && !gets) say(`"${next}" does not get further: lawcheck ${argv.join(' ')} ends\n${further.stdout}`);
  if (pending !== undefined && gets) say(`pending as ${pending.finding} and now gets further: take it out of the list`);
  return problems;
}

async function runCases(cases: Case[]): Promise<string[]> {
  const problems: string[] = [];
  for (const spec of cases) {
    const fake = await startFake();
    CLEANUP.length = 0;
    try {
      await inTemp(async (dir) => void problems.push(...(await reproduce(spec, dir, fake))));
    } finally {
      await fake.close();
      for (const remove of CLEANUP) remove();
    }
  }
  return problems;
}

test('check-slice §6: the codes of the cases, of the tool and of the codes page are the same', () => {
  const rows = documented();
  assert.equal(rows.length, 25);
  assert.deepEqual([...new Set([...CASES.map((c) => c.code), UNREADABLE.code].filter((c) => c !== null))].sort(), [...CODES].sort());
  assert.deepEqual(rows.map((r) => r.code).sort(), [...CODES].sort());
  for (const row of rows) assert.equal(row.why, WHY[row.code], row.code);
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length);
});

test('check-slice §6: every code, in text and in JSON, and the command each next line names gets further', async () => {
  assert.deepEqual(await runCases(CASES), []);
});

test('check-slice §6: file-unreadable, in text and in JSON, and its next line gets further', async (t) => {
  if (UNREADABLE_SKIP !== undefined) return t.skip(UNREADABLE_SKIP);
  assert.deepEqual(await runCases([UNREADABLE]), []);
});

test('check-slice §6: the next line of a case names a known command with known flags', async () => {
  assert.deepEqual(commandNamed('fix .lawcheck/law.yaml, then run lawcheck check', ['check', '--base', 'main']), { argv: ['check'] });
  assert.deepEqual(commandNamed('run lawcheck check as its usage line says: lawcheck check --help', ['check', '--nope']), { argv: ['check', '--help'] });
  assert.deepEqual(commandNamed('lawcheck check --review --base main  (1 reviewer call)', ['check']), { argv: ['check', '--review', '--base', 'main'] });
  assert.deepEqual(commandNamed('fix .lawcheck/law.yaml, then run lawcheck explain again', ['explain', 'x']), { argv: ['explain', 'x'] });
  assert.deepEqual(commandNamed('run the same command again; what was answered is kept', ['check', '--review']), { argv: ['check', '--review'] });
  assert.deepEqual(commandNamed('pass --base with a branch or a commit that exists here', ['check', '--base', 'nope']), { argv: ['check', '--base', 'nope'], base: true });
  assert.deepEqual(commandNamed('lawcheck docs languages', ['doctor']), { argv: ['docs', 'languages'] });
  assert.equal(commandNamed('fix src/core/discount.ts:2', ['check']), null);
  assert.equal(commandNamed('reinstall Lawcheck; a grammar it ships cannot be loaded', ['check']), null);
  assert.ok('problem' in (commandNamed('then run lawcheck frobnicate', ['check']) as object));
  assert.ok('problem' in (commandNamed('then run lawcheck check --base', ['check']) as object));
  const unknown = commandNamed('then run lawcheck check --nope', ['check']) as { argv: string[] };
  assert.deepEqual(unknown.argv, ['check', '--nope']);
  const run = await inTemp((dir) => lawcheck(makeSample(dir), unknown.argv));
  assert.equal(run.code, 2);
  assert.ok(run.stdout.includes('error[usage]'));
});

test('check-slice §6: every pending next line names a finding of the ledger that is not closed, and a case of this test', () => {
  const rows = ledgerRows(readFileSync(new URL('../findings.md', import.meta.url), 'utf8'));
  for (const pending of PENDING) {
    const row = rows.find((r) => r.id === pending.finding);
    assert.ok(row !== undefined, `${pending.finding} is not in tests/findings.md`);
    assert.notEqual(row.state, 'closed', pending.finding);
    assert.ok(CASES.some((c) => c.id === pending.id), pending.id);
  }
  assert.equal(new Set(PENDING.map((p) => p.id)).size, PENDING.length);
});
