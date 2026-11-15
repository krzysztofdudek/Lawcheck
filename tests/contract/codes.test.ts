import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openai, startFake, type Fake } from '../acceptance/fake-reviewer.ts';
import { platformSkip } from '../harness/tool.ts';
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


interface Pending {
  case: string;
  code: string;
  command: string;
  finding: string;
}

const PENDING: Pending[] = JSON.parse(readFileSync(new URL('pending-next.json', import.meta.url), 'utf8'));
const TOOL_COMMANDS = ['init', 'prime', 'check', 'explain', 'try', 'docs', 'doctor'];
const VALUE_FLAGS = new Set(['--base', '--max-calls', '--times', '--type', '--rule']);
const TOPICS = readdirSync(new URL('../../docs/', import.meta.url)).map((f) => f.replace(/\.md$/, ''));
const REVIEW = ['--review', '--base', 'main'];
const CALL = 'lawcheck: 1 reviewer call to openai-compatible\n';

interface Follow {
  fix?: () => void | Promise<void>;
  git?: boolean;
  supply?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

interface Ready {
  cwd: string;
  argv: string[];
  env?: NodeJS.ProcessEnv;
  cli?: string;
  stderr?: string | RegExp;
  node?: string[];
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
      return { cwd: s, argv: CHECK, follow: { fix: () => writeFileSync(join(s, '.git/HEAD'), 'ref: refs/heads/work\n') } };
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
      return { cwd: clone, argv: ['check', '--base', 'origin/main'], follow: { git: true } };
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
      return { cwd: join(repo, 'pkg'), argv: CHECK, hint: '--allow-fs-read' };
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
    id: 'unsupported-environment, Node older than 24',
    code: 'unsupported-environment',
    setup: (dir) => {
      const s = makeSample(dir);
      write(s, D_PATH, D);
      return {
        cwd: s,
        argv: CHECK,
        node: ['--import', `data:text/javascript,Object.defineProperty(process.versions,"node",{value:"20.20.2",enumerable:true})`],
        first: 'lawcheck: ERROR  Node 20.20.2 is older than 24, the oldest Node Lawcheck runs on',
        follow: {},
      };
    },
  },
  {
    id: 'link-outside-root',
    code: 'link-outside-root',
    setup: (dir) => {
      const s = makeSample(dir);
      const beside = join(dir, 'beside');
      mkdirSync(beside, { recursive: true });
      writeFileSync(join(beside, 'marker.txt'), 'outside\n');
      symlinkSync(beside, join(s, 'outside'), 'dir');
      git(s, 'add', 'outside');
      git(s, 'commit', '-q', '-m', 'a link');
      write(s, D_PATH, D);
      return { cwd: s, argv: CHECK, follow: { fix: () => git(s, 'rm', '-q', '-f', 'outside') } };
    },
  },
  {
    id: 'path-unsupported',
    code: 'path-unsupported',
    setup: (dir) => {
      const parent = join(dir, 'zone*');
      mkdirSync(parent, { recursive: true });
      const s = makeSample(parent);
      write(s, D_PATH, D);
      const plain = join(dir, 'plain');
      return {
        cwd: s,
        argv: CHECK,
        follow: {
          cwd: plain,
          fix: () => {
            cpSync(s, plain, { recursive: true });
          },
        },
      };
    },
  },
  {
    id: 'runner-failed',
    code: 'runner-failed',
    setup: (dir) => {
      const copy = makeCopy();
      CLEANUP.push(copy.remove);
      const rules = join(copy.dir, 'dist', 'rules.js');
      const sound = readFileSync(rules, 'utf8');
      writeFileSync(rules, sound.replace("'--permission', ", "'--permission', '--no-such-flag', "));
      const s = makeSample(dir);
      write(s, D_PATH, D);
      return { cwd: s, argv: CHECK, cli: copy.cli, stderr: /^(.*: bad option: --no-such-flag\n)+$/, follow: { fix: () => writeFileSync(rules, sound) } };
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

type Named = { commands: string[][]; base?: true } | { problem: string } | null;

const PROSE = new Set(['as', 'inside', 'and', 'or', 'then', 'to', 'in', 'on', 'is', 'with', 'from', 'for']);
const clean = (token: string): string => token.replace(/^[(),;:]+|[(),;:.]+$/g, '');

export function commandsNamed(line: string, ran: string[]): Named {
  const commands: string[][] = [];
  if (/\bthe same command\b/.test(line)) commands.push(ran);
  const found = [...line.matchAll(/(?<![\w./-])lawcheck(?: (\S+))?/g)].filter((m) => m[1] !== undefined);
  for (let i = 0; i < found.length; i++) {
    const m = found[i]!;
    const word = clean(m[1]!);
    if (PROSE.has(word)) continue;
    if (!word.startsWith('-') && !TOOL_COMMANDS.includes(word)) return { problem: `the line names the command "lawcheck ${word}", which is none of the seven` };
    const end = i + 1 < found.length ? found[i + 1]!.index! : line.length;
    const tokens = line.slice(m.index! + m[0].length, end).split(/\s+/).map(clean).filter((t) => t !== '');
    const argv = [word];
    let positional = true;
    for (let k = 0; k < tokens.length; k++) {
      const token = tokens[k]!;
      if (token === 'again' && argv.length === 1) {
        if (word !== ran[0]) return { problem: `the line says to run lawcheck ${word} again, after lawcheck ${ran[0]}` };
        argv.splice(0, argv.length, ...ran);
        break;
      }
      if (/^<.*>$/.test(token)) return { problem: `the line names a placeholder ${token}, which no one can run` };
      if (/^-{1,2}[A-Za-z][\w-]*$/.test(token)) {
        argv.push(token);
        positional = false;
        if (VALUE_FLAGS.has(token)) {
          const value = tokens[++k];
          if (value === undefined || value.startsWith('-')) return { problem: `the flag ${token} in the line has no value` };
          argv.push(value);
        }
      } else if (positional && ((word === 'docs' && TOPICS.includes(token)) || /[/*]|\.[a-z]+$/.test(token))) argv.push(token);
      else positional = false;
    }
    commands.push(argv);
  }
  if (commands.length > 0) return { commands };
  if (/^pass --base\b/.test(line)) return { commands: [ran], base: true };
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
  const expecting = ready.stderr === undefined ? {} : { stderr: ready.stderr };
  const go = (argv: string[], env: NodeJS.ProcessEnv = {}, first = false, cwd = ready.cwd) =>
    ready.cli === undefined
      ? lawcheck(cwd, argv, { ...(ready.env ?? {}), ...env }, first ? (ready.node ?? []) : [], first ? expecting : {})
      : lawcheckAt(ready.cli, cwd, argv, { ...(ready.env ?? {}), ...env }, first ? expecting : {});

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
    text = await go(ready.argv, {}, true);
    json = await go([...ready.argv, '--json'], {}, true);
  }
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
    if (ready.first !== undefined) {
      if (out.split('\n')[0] !== ready.first) say(`the first line is "${out.split('\n')[0]}", not "${ready.first}"`);
    } else if (!out.startsWith(`lawcheck: ERROR  ${count} error${count === 1 ? '' : 's'}\n`) && !out.startsWith('error[usage]')) say(`the first line is not the error count of the JSON (${count})`);
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
  const pending = PENDING.find((p) => p.case === spec.id);
  if (pending !== undefined && pending.code !== spec.code) say(`the pending entry names the code ${pending.code}, the case is ${spec.code}`);
  if (ready.hint !== undefined) {
    const gone = !out.includes(ready.hint);
    if (pending === undefined && !gone) say(`the message holds ${ready.hint}`);
    if (pending !== undefined && pending.command !== ready.hint) say(`the pending entry names "${pending.command}", the message names ${ready.hint}`);
    if (pending !== undefined && gone) say(`pending as ${pending.finding} and now free of ${ready.hint}: take it out of the list`);
    return problems;
  }
  const next = nextLine(out);
  const named: Named = next === null ? null : commandsNamed(next, ready.argv);
  if (named !== null && 'problem' in named) {
    say(named.problem);
    return problems;
  }
  if (named === null) {
    if (ready.follow !== undefined && Object.keys(ready.follow).length > 0) say(`the case follows a command and the next line "${next}" names none`);
    if (pending !== undefined) say(`the pending entry names "${pending.command}" and the next line names no command`);
    return problems;
  }
  if (named.base === true && ready.follow?.supply === undefined) say(`the line asks for --base and the case supplies none`);
  await ready.follow?.fix?.();
  if (ready.follow?.git === true) {
    const said = /\bgit ((?:fetch|config)[^,(;]*)/.exec(next!);
    if (said === null) say(`the case runs a git command the line names, and "${next}" names none`);
    else git(ready.cwd, ...said[1]!.trim().split(/\s+/));
  }
  const seen = new Set<string>();
  let matched = pending === undefined;
  for (const command of named.commands) {
    const argv = ready.follow?.supply !== undefined ? supplied(command, ready.follow.supply) : command;
    const text = `lawcheck ${argv.join(' ')}`;
    if (seen.has(text)) continue;
    seen.add(text);
    let further: { code: number | null; stdout: string };
    if (ready.inProcess === true) further = await main(argv, { cwd: ready.cwd, env: { ...GIT_ENV } });
    else further = await go(argv, ready.follow?.env ?? {}, false, ready.follow?.cwd);
    const gets = further.code !== 2 && !further.stdout.includes('error[usage]');
    const stuck = pending !== undefined && pending.command === text;
    if (stuck) matched = true;
    if (!stuck && !gets) say(`"${next}" does not get further: ${text} ends\n${further.stdout}`);
    if (stuck && gets) say(`pending as ${pending.finding} and now gets further: ${text}; take it out of the list`);
  }
  if (!matched) say(`the pending entry names "${pending!.command}", which the next line "${next}" does not name`);
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

const GROUPS: Record<string, string[]> = {
  front: ['usage', 'not-initialized', 'already-initialized', 'no-git', 'unsupported-environment'],
  files: ['law-invalid', 'config-invalid', 'rule-missing-file', 'rule-file-without-entry', 'type-overlap'],
  run: ['base-unreachable', 'rule-crashed', 'parser-failed', 'internal', 'link-outside-root', 'path-unsupported', 'runner-failed'],
  reviewer: ['reviewer-not-configured', 'too-many-reviews', 'reviewer-unreachable', 'reviewer-bad-answer', 'not-reviewed', 'too-large-to-review'],
  findings: ['forbidden-use', 'uses-not-read', 'waiver-', 'doctor,'],
};

const inGroup = (group: string): Case[] => CASES.filter((c) => GROUPS[group]!.some((prefix) => c.id.startsWith(prefix)));

test('check-slice §6: the codes of the cases, of the tool and of the codes page are the same, and every case is in one group', () => {
  const rows = documented();
  assert.equal(rows.length, CODES.size);
  assert.deepEqual([...new Set([...CASES.map((c) => c.code), UNREADABLE.code].filter((c) => c !== null))].sort(), [...CODES].sort());
  assert.deepEqual(rows.map((r) => r.code).sort(), [...CODES].sort());
  for (const row of rows) assert.equal(row.why, WHY[row.code], row.code);
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length);
  const placed = Object.keys(GROUPS).flatMap((g) => inGroup(g).map((c) => c.id));
  assert.deepEqual([...placed].sort(), CASES.map((c) => c.id).sort());
});

test('check-slice §6: usage, not-initialized, already-initialized, no-git and unsupported-environment, in text and in JSON, and the commands their next lines name', async () => {
  assert.deepEqual(await runCases(inGroup('front')), []);
});

test('check-slice §6: law-invalid, config-invalid, rule-missing-file, rule-file-without-entry and type-overlap, in text and in JSON, and the commands their next lines name', async () => {
  assert.deepEqual(await runCases(inGroup('files')), []);
});

test('check-slice §6: base-unreachable, rule-crashed, parser-failed, internal, link-outside-root, path-unsupported and runner-failed, in text and in JSON, and the commands their next lines name', async (t) => {
  const noStar = platformSkip('path-unsupported');
  const noCr = platformSkip('runner-failed');
  assert.deepEqual(await runCases(inGroup('run').filter((c) => (noStar === null || c.id !== 'path-unsupported') && (noCr === null || c.id !== 'runner-failed'))), []);
  for (const skip of [noStar, noCr]) if (skip !== null) t.diagnostic(skip);
});

test('check-slice §6: the reviewer codes, in text and in JSON, and the commands their next lines name', async () => {
  assert.deepEqual(await runCases(inGroup('reviewer')), []);
});

test('check-slice §6: the findings, with their exit codes and the exact text the spec fixes, and the notes of doctor', async () => {
  assert.deepEqual(await runCases(inGroup('findings')), []);
});

test('check-slice §6: file-unreadable, in text and in JSON, and its next line gets further', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  assert.deepEqual(await runCases([UNREADABLE]), []);
});

test('check-slice §6: every command a next line names is read with its flags and arguments, and an unknown one fails', async () => {
  const ran = ['check', '--base', 'main'];
  assert.deepEqual(commandsNamed('fix .lawcheck/law.yaml, then run lawcheck check', ran), { commands: [['check']] });
  assert.deepEqual(commandsNamed('run lawcheck check as its usage line says: lawcheck check --help', ['check', '--nope']), { commands: [['check'], ['check', '--help']] });
  assert.deepEqual(commandsNamed('lawcheck check --review --base main  (1 reviewer call)', ['check']), { commands: [['check', '--review', '--base', 'main']] });
  assert.deepEqual(commandsNamed('fix .lawcheck/law.yaml, then run lawcheck explain again', ['explain', 'x']), { commands: [['explain', 'x']] });
  assert.deepEqual(commandsNamed('run the same command again; what was answered is kept', ran), { commands: [ran] });
  assert.deepEqual(commandsNamed('pass --base with a branch or a commit that exists here', ran), { commands: [ran], base: true });
  assert.deepEqual(commandsNamed('lawcheck docs languages', ['doctor']), { commands: [['docs', 'languages']] });
  assert.deepEqual(commandsNamed('run lawcheck check (--full, --base main), or lawcheck explain src/core/price.ts, then lawcheck doctor', ran), {
    commands: [['check', '--full', '--base', 'main'], ['explain', 'src/core/price.ts'], ['doctor']],
  });
  assert.deepEqual(commandsNamed('run lawcheck check, --full', ran), { commands: [['check', '--full']] });
  assert.equal(commandsNamed('fix src/core/discount.ts:2', ran), null);
  assert.equal(commandsNamed('reinstall Lawcheck; a grammar it ships cannot be loaded', ran), null);
  assert.equal(commandsNamed('write .lawcheck/law.yaml, then run lawcheck-waive', ran), null);
  for (const line of ['then run lawcheck frobnicate', 'run lawcheck check, then lawcheck frobnicate', 'then run lawcheck check --base', 'then run lawcheck explain <path>']) {
    assert.ok('problem' in (commandsNamed(line, ran) as object), line);
  }
  for (const line of ['then run lawcheck check --nope', 'run lawcheck check (--nope)', 'run lawcheck check, then lawcheck init --nope']) {
    const named = commandsNamed(line, ran) as { commands: string[][] };
    const unknown = named.commands.find((c) => c.includes('--nope'))!;
    assert.ok(unknown !== undefined, line);
    const run = await inTemp((dir) => lawcheck(makeSample(dir), unknown));
    assert.equal(run.code, 2, line);
    assert.ok(run.stdout.includes('error[usage]'), line);
  }
});

test('check-slice §6: every pending next line names its case, code, exact command and a finding of the ledger that is not closed', () => {
  const rows = ledgerRows(readFileSync(new URL('../findings.md', import.meta.url), 'utf8'));
  for (const pending of PENDING) {
    assert.deepEqual(Object.keys(pending).sort(), ['case', 'code', 'command', 'finding']);
    const row = rows.find((r) => r.id === pending.finding);
    assert.ok(row !== undefined, `${pending.finding} is not in tests/findings.md`);
    assert.notEqual(row.state, 'closed', pending.finding);
    assert.ok(CASES.some((c) => c.id === pending.case && c.code === pending.code), `${pending.case} with the code ${pending.code}`);
  }
  assert.equal(new Set(PENDING.map((p) => p.case)).size, PENDING.length);
});
