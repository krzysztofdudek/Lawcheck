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
  startLawcheck,
  U_LAW,
  write,
} from '../acceptance/helpers.ts';
import { MiB, sparse, textHead } from '../limits/support.ts';
import { CODES, WHY } from '../../dist/output.js';
import { main } from '../../dist/cli.js';
import { codesPage, exampleOf, partsProblems, shownRun } from './codes-page.ts';


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
  leads?: string;
  inProcess?: boolean;
  // A line of standard error the run prints once it is under way; the run is then sent SIGTERM.
  stop?: RegExp;
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
  { id: 'usage, docs, a topic that does not exist', code: 'usage', setup: (dir) => ({ cwd: makeSample(dir), argv: ['docs', 'codez'], exit: 2 }) },
  { id: 'usage, check', code: 'usage', setup: (dir) => ({ cwd: makeSample(dir), argv: ['check', '--nope'], exit: 2 }) },
  { id: 'usage, no command', code: 'usage', setup: (dir) => ({ cwd: makeSample(dir), argv: ['--nope'], exit: 2, leads: '--help' }) },
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
  { id: 'not-initialized, doctor', code: 'not-initialized', setup: (dir) => ({ cwd: lawIn(dir), argv: ['doctor'], report: 'doctor', leads: 'init' }) },
  {
    id: 'not-initialized, doctor, law.yaml is a directory',
    code: 'not-initialized',
    setup: (dir) => {
      const repo = lawIn(dir);
      mkdirSync(join(repo, '.lawcheck/law.yaml'), { recursive: true });
      return { cwd: repo, argv: ['doctor'], report: 'doctor', leads: 'init' };
    },
  },
  {
    id: 'already-initialized',
    code: 'already-initialized',
    setup: (dir) => ({ cwd: makeSample(dir), argv: ['init'], leads: 'doctor' }),
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
  {
    id: 'too-large-to-review, the cap set on main',
    code: 'too-large-to-review',
    setup: (dir, fake) => {
      const r = makeR(dir, { onMain: (m) => write(m, '.lawcheck/config.yaml', REVIEWER_CONFIG + '  max_chars: 2126\n') });
      write(r, F_PATH, F);
      return { cwd: r, argv: ['check', '--base', 'main'], env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, exit: 1, exact: ['src/core/refund.ts  error[too-large-to-review]  the prompt for clear-errors holds 2127 characters; reviewer.max_chars is 2126'] };
    },
  },
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
    id: 'untyped-file',
    code: 'untyped-file',
    setup: (dir) => {
      const s = makeSample(dir, { onMain: (m) => write(m, '.lawcheck/law.yaml', LAW.replace('rules:\n', 'required: ["src/**"]\n\nrules:\n')) });
      write(s, 'src/gen/helpers.js', 'export const help = 1;\n');
      return { cwd: s, argv: CHECK, exit: 1, exact: ['src/gen/helpers.js  error[untyped-file]  the file lies under required (src/**) and no type of the law takes it', '  why:  a file that no type takes is judged by no rule, so a folder under required may hold none'] };
    },
  },
  {
    id: 'uses-not-read, the law on main',
    code: 'uses-not-read',
    setup: (dir) => {
      const law = U_LAW.replace('"src/**/*.ts", ', '"src/**/*.ts", "src/**/*.json", ');
      const u = makeU(dir, { onMain: (m) => write(m, '.lawcheck/law.yaml', law) });
      write(u, 'src/core/data.json', '{}\n');
      const at = law.split('\n').findIndex((line) => line.trim() === 'library:') + 1;
      return { cwd: u, argv: CHECK, exit: 0, exact: [`.lawcheck/law.yaml:${at}  warning[uses-not-read]  1 file of type library is not read for uses: 1 .json`] };
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
  alone('waiver-unknown-rule', 'export const s = 1; // lawcheck-waive no-such -- support reads this line', 1),
  alone('waiver-without-reason', 'export const s = 1; // lawcheck-waive no-console', 1),
  alone('waiver-unused', 'export const s = 1; // lawcheck-waive no-console -- nothing here', 0),
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
      return { cwd: u, argv: ['doctor', '--base', 'main'], report: 'doctor', leads: 'docs' };
    },
  },
  {
    id: 'doctor, the change touches the law',
    code: null,
    setup: (dir) => {
      const s = makeSample(dir);
      write(s, '.lawcheck/law.yaml', LAW + '# a comment\n');
      return { cwd: s, argv: ['doctor', '--base', 'main'], report: 'doctor', leads: 'check' };
    },
  },
];

const HELD = "export function check() { console.error('runner ' + process.pid); while (true) {} }\n";
const MANY = 'export function check() { return Array.from({ length: 200001 }, () => ({ message: "m" })); }\n';
const CS = (s: string) => write(s, '.lawcheck/law.yaml', `${LAW}  cs:\n    paths: ["cs/app/**"]\n    may_use: [cs]\n`);

function bigDeclarations(s: string): void {
  let body = 'class C { void m() { int x = f(';
  while (body.length < 64 * 1024) body += 'a < b, ';
  write(s, 'cs/gen/Big.cs', body);
  write(s, 'cs/app/App.cs', 'class App { }\n');
}

// Each reaches its limit as its numbered test in tests/limits does, at the limit the tool ships.
const LIMIT_CASES: Case[] = [
  inS('file-too-large, a text file past 16 MiB', 'file-too-large', CHECK, (s) => sparse(s, 'src/core/edge.ts', textHead('export const a = 1;\n'), 16 * MiB + 1)),
  inS('text-too-large, the files of a run past 128 MiB of text', 'text-too-large', CHECK, (s) => {
    for (let i = 1; i <= 9; i++) sparse(s, `src/core/big/t${i}.ts`, textHead(''), 15 * MiB);
  }),
  inS('too-many-findings, a rule that returns 200,001', 'too-many-findings', CHECK, (s) => {
    setRule(s, 'no-console', MANY);
    write(s, 'src/core/many.ts', 'export const m = 1;\n');
  }),
  {
    id: 'file-unwritable, init where .lawcheck is a file',
    code: 'file-unwritable',
    setup: (dir) => {
      const repo = newRepository(dir, { '.lawcheck': 'x\n' });
      return { cwd: repo, argv: ['init'], follow: { fix: () => rmSync(join(repo, '.lawcheck')) } };
    },
  },
  inS('memory-too-large, a file read for what it declares', 'memory-too-large', CHECK, (s) => {
    CS(s);
    bigDeclarations(s);
  }),
];

const STOPPED: Case = {
  id: 'stopped, SIGTERM while a rule spins',
  code: 'stopped',
  setup: (dir) => {
    const s = makeSample(dir);
    setRule(s, 'no-console', HELD);
    write(s, 'src/core/discount.ts', 'export const d = 1;\n');
    return { cwd: s, argv: CHECK, stop: /^runner \d+$/m, stderr: /^runner \d+\n$/, follow: { fix: () => repair(s) } };
  },
};

// The two codes whose limits are minutes of run time, which no test entry shortens: tests 251 and 255 reach them whole every night, and their next lines are followed by no test until the finding each names is fixed.
const UNREACHED: { code: string; test: string; finding: string }[] = [
  { code: 'rules-too-slow', test: 'tests/limits/large.nightly.test.ts > test 251: S2-5, rules that take 29 seconds a file are stopped when the script rules of the run pass 600 seconds', finding: 'R-89' },
  { code: 'step-too-slow', test: 'tests/limits/large.nightly.test.ts > test 255: S1-1, a step that never ends, typing against a content pattern that backtracks, ends as step-too-slow after 30 seconds', finding: 'R-89' },
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

// The Example of each waiver code on docs/codes.md is its finding with no other finding beside it.
function alone(code: string, line: string, exit: number): Case {
  return {
    id: `${code}, alone in a file of one line`,
    code,
    setup: (dir) => {
      const s = makeSample(dir);
      write(s, 'src/core/shipping.ts', `${line}\n`);
      return { cwd: s, argv: CHECK, exit, exact: [`src/core/shipping.ts:1  ${exit === 1 ? 'error' : 'warning'}[${code}]`] };
    },
  };
}

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

// The Example of a code on docs/codes.md is the output of the first case of that code.
function firstCase(code: string): Case | undefined {
  return [...CASES, ...LIMIT_CASES, STOPPED, UNREADABLE].find((c) => c.code === code);
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

// What a command that a next line names leads to: a check or a doctor answers with PASS or FAIL, init creates, docs prints a page, --help prints usage.
export function leadsTo(argv: string[], run: { code: number | null; stdout: string }): string | null {
  const first = run.stdout.split('\n')[0]!;
  const [command] = argv;
  if (argv.includes('--help') || command === '--help') return run.code === 0 && first.startsWith('usage: lawcheck') ? null : `no usage on standard output, exit ${run.code}`;
  if (command === 'check' || command === 'doctor') return (run.code === 0 || run.code === 1) && /^lawcheck: (PASS|FAIL)  /.test(first) ? null : `no PASS or FAIL line, exit ${run.code}: ${first}`;
  if (command === 'init') return run.code === 0 && /^lawcheck: created /m.test(run.stdout) ? null : `init created nothing, exit ${run.code}: ${first}`;
  if (command === 'docs') return run.code === 0 && /^(# |lawcheck docs: )/.test(first) ? null : `no page, exit ${run.code}: ${first}`;
  if (command === 'explain' || command === 'try') return (run.code === 0 || run.code === 1) && !/^error\[/m.test(run.stdout) ? null : `an error, exit ${run.code}: ${first}`;
  return `no rule for what ${command} leads to`;
}

async function reproduce(spec: Case, dir: string, fake: Fake): Promise<string[]> {
  const problems: string[] = [];
  const say = (message: string) => problems.push(`${spec.id}: ${message}`);
  const ready = await spec.setup(dir, fake);
  const doc = documented().find((d) => d.code === spec.code) ?? { code: '', kind: 'doctor', why: '' };
  const expecting = ready.stderr === undefined ? {} : { stderr: ready.stderr };
  const stopped = async (argv: string[]) => {
    const running = startLawcheck(ready.cwd, argv, { env: ready.env ?? {}, ...expecting });
    await running.output(ready.stop!, 'stderr');
    running.kill('SIGTERM');
    return running.ended;
  };
  const go = (argv: string[], env: NodeJS.ProcessEnv = {}, first = false, cwd = ready.cwd) =>
    first && ready.stop !== undefined
      ? stopped(argv)
      : ready.cli === undefined
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
  if (spec.code !== null && firstCase(spec.code) === spec) {
    const shown = shownRun(ready.argv, out, dir);
    if (exampleOf(codesPage(), spec.code) !== shown) say(`the Example of ${spec.code} in docs/codes.md is not the output of this case, which is:\n${shown}`);
  }
  if (ready.report === 'doctor') {
    if (document.schema !== 'lawcheck-doctor/0') say(`the schema is ${document.schema}`);
  } else if (doc.kind === 'exit 2') {
    if (text.code !== 2 || json.code !== 2) say(`the exit codes are ${text.code} and ${json.code}, not 2`);
    const count = document.errors?.length ?? 0;
    if (ready.first !== undefined) {
      if (out.split('\n')[0] !== ready.first) say(`the first line is "${out.split('\n')[0]}", not "${ready.first}"`);
    } else if (!out.startsWith(`lawcheck: ERROR  ${count} error${count === 1 ? '' : 's'}${document.calls_made === undefined ? '' : `, ${document.calls_made} reviewer call${document.calls_made === 1 ? '' : 's'}`}\n`) && !out.startsWith('error[usage]')) say(`the first line is not the error count of the JSON (${count})`);
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
  if (ready.report !== 'doctor') {
    const wanted = doc.kind === 'exit 2' || ready.exit === 1;
    if (wanted && next === null) say('the output has no next: line');
    const jsonNext = document.next as { command: string | null; text: string } | null | undefined;
    if (next !== null && (jsonNext === null || jsonNext === undefined || jsonNext.text !== next)) say(`the JSON next is ${JSON.stringify(jsonNext)} and the text next is "${next}"`);
    if (next === null && jsonNext !== null && jsonNext !== undefined && jsonNext.text !== undefined && wanted) say(`the JSON has a next and the text has none`);
    if (jsonNext !== null && jsonNext !== undefined && jsonNext.command !== null && jsonNext.command !== undefined && !(next ?? '').includes(jsonNext.command)) say(`the JSON next.command "${jsonNext.command}" is not in the text next "${next}"`);
  }
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
    const expected = ready.leads ?? ready.argv[0];
    if (argv[0] !== expected && !(expected === '--help' && argv[0] === '--help')) say(`the line "${next}" names lawcheck ${argv[0]}, and this case leads to ${expected}`);
    if (argv.includes('--help') && spec.code !== 'usage') say(`the line "${next}" sends the user to ${argv.join(' ')}, which only the next line of usage may do`);
    const gets = leadsTo(argv, further) === null;
    const stuck = pending !== undefined && pending.command === text;
    if (stuck) matched = true;
    if (!stuck && !gets) say(`"${next}" does not get further: ${text}: ${leadsTo(argv, further)}\n${further.stdout}`);
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
  findings: ['forbidden-use', 'uses-not-read', 'untyped-file', 'waiver-', 'doctor,'],
};

const inGroup = (group: string): Case[] => CASES.filter((c) => GROUPS[group]!.some((prefix) => c.id.startsWith(prefix)));

test('check-slice §6: the codes of the cases, of the tool and of the codes page are the same, and every case is in one group', () => {
  const rows = documented();
  assert.equal(rows.length, CODES.size);
  assert.deepEqual([...new Set([...[...CASES, ...LIMIT_CASES, STOPPED].map((c) => c.code), UNREADABLE.code, ...UNREACHED.map((u) => u.code)].filter((c) => c !== null))].sort(), [...CODES].sort());
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

test('tests 232, 233, 236, 241 and 277: file-too-large, text-too-large, too-many-findings, file-unwritable and memory-too-large, in text and in JSON, and the commands their next lines name', async () => {
  assert.deepEqual(await runCases(LIMIT_CASES), []);
});

test('test 239: stopped, in text and in JSON, and the command its next line names', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  assert.deepEqual(await runCases([STOPPED]), []);
});

const FINDING_ID = /^(?:S\d+-\d+|R-\d+|U-\d+|T[1-8])$/;

test('R-89: a code no case reaches per push names the finding it waits on and the nightly test that reaches it', () => {
  for (const unreached of UNREACHED) {
    assert.ok(CODES.has(unreached.code), unreached.code);
    assert.match(unreached.finding, FINDING_ID, unreached.code);
    const [file, name] = unreached.test.split(' > ');
    const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.ok(text.includes(`test('${name}'`), unreached.test);
    assert.ok(text.includes(unreached.code), `${file} reaches no ${unreached.code}`);
  }
});

test('check-slice §6: file-unreadable, in text and in JSON, and its next line gets further', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  assert.deepEqual(await runCases([UNREADABLE]), []);
});

test('R-56: every command a next line names is read with its flags and arguments, and an unknown one fails', async () => {
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

test('R-55: every pending next line names its case, code, exact command and the finding it waits on', () => {
  for (const pending of PENDING) {
    assert.deepEqual(Object.keys(pending).sort(), ['case', 'code', 'command', 'finding']);
    assert.match(pending.finding, FINDING_ID, pending.case);
    assert.ok(CASES.some((c) => c.id === pending.case && c.code === pending.code), `${pending.case} with the code ${pending.code}`);
  }
  assert.equal(new Set(PENDING.map((p) => p.case)).size, PENDING.length);
});

test('test 580: every code has its heading on docs/codes.md, with Meaning, Typical cause, Fix and Example in that order, and the Example a block that opens with its command', () => {
  assert.deepEqual(partsProblems(codesPage(), CODES), []);
});

test('test 581: the rail of test 580 names a code whose Fix is taken out, and a code whose Example has no block (control)', () => {
  const page = codesPage();
  const section = page.indexOf('## law-invalid\n');
  const fix = page.indexOf('**Fix**', section);
  const example = page.indexOf('**Example**', section);
  const noFix = page.slice(0, fix) + page.slice(example);
  assert.deepEqual(partsProblems(noFix, ['usage', 'law-invalid', 'config-invalid']), ['law-invalid: the parts are Meaning, Typical cause, Example, and they must be Meaning, Typical cause, Fix, Example, in that order']);
  const block = page.indexOf('```text', example);
  const noBlock = page.slice(0, block) + page.slice(page.indexOf('```\n', block + 1) + 4);
  assert.deepEqual(partsProblems(noBlock, ['law-invalid']), ['law-invalid: the Example is no text block that opens with a $ lawcheck command']);
});

test('test 582: the Example of every code is the output of its first case here, or of the nightly test that reaches the code', () => {
  for (const code of CODES) {
    const unreached = UNREACHED.find((u) => u.code === code);
    if (unreached === undefined) {
      assert.ok(firstCase(code) !== undefined, code);
      continue;
    }
    const [file, name] = unreached.test.split(' > ');
    const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    const body = text.slice(text.indexOf(`test('${name}'`), text.indexOf('\ntest(', text.indexOf(`test('${name}'`) + 1));
    assert.equal(comparisonProblem(body, code), null, unreached.test);
  }
  assert.match(comparisonProblem("  if (cores >= 3) assert.equal(shownRun(argv, out, s), exampleOf(codesPage(), 'rules-too-slow'));\n", 'rules-too-slow')!, /under a condition/);
});

function comparisonProblem(body: string, code: string): string | null {
  const line = body.split('\n').find((l) => l.includes(`exampleOf(codesPage(), '${code}')`));
  if (line === undefined) return `compares no output with the Example of ${code}`;
  return /^\s*assert\.equal\(shownRun\(/.test(line) ? null : `compares the Example of ${code} under a condition: ${line.trim()}`;
}
