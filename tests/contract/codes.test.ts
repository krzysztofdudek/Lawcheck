import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  inTemp,
  lawcheck,
  lawcheckAt,
  LAW,
  makeCopy,
  makeR,
  makeSample,
  makeU,
  U_LAW,
  newRepository,
  REVIEWER_CONFIG,
  setRule,
  write,
  type Run,
} from '../acceptance/helpers.ts';
import { CODES, WHY } from '../../dist/output.js';
import { main } from '../../dist/cli.js';

interface Follow {
  needle: string;
  cwd: string;
  argv: string[];
}

interface Ready {
  cwd: string;
  argv: string[];
  env?: NodeJS.ProcessEnv;
  cli?: string;
  follow?: Follow | null;
  hint?: { absent: string };
  stderr?: string;
  skip?: string;
}

interface Case {
  id: string;
  code: string;
  followOnly?: boolean;
  setup(dir: string, fake: Fake): Promise<Ready> | Ready;
}

const CALL = 'lawcheck: 1 reviewer call to openai-compatible\n';
const REVIEW = ['--review', '--base', 'main'];

function withLaw(repo: string, text: string): void {
  write(repo, '.lawcheck/law.yaml', text);
}

const posixOnly = process.platform === 'win32' || process.getuid?.() === 0 ? 'a file mode cannot make a file unreadable for root, nor on Windows' : undefined;

const CASES: Case[] = [
  { id: 'usage', code: 'usage', setup: (dir) => ({ cwd: makeSample(dir), argv: ['check', '--nope'], follow: { needle: 'lawcheck check --help', cwd: makeSample(join(dir, 'f')), argv: ['check', '--help'] } }) },
  { id: 'not-initialized', code: 'not-initialized', setup: (dir) => ({ cwd: newRepository(dir), argv: ['check'], follow: null }) },
  {
    id: 'not-initialized, as doctor tells it',
    code: 'not-initialized',
    followOnly: true,
    setup: (dir) => {
      const repo = newRepository(dir);
      return { cwd: repo, argv: ['doctor'], follow: { needle: 'lawcheck init', cwd: repo, argv: ['init'] } };
    },
  },
  {
    id: 'already-initialized',
    code: 'already-initialized',
    setup: (dir) => {
      const s = makeSample(dir);
      return { cwd: s, argv: ['init'], follow: { needle: 'lawcheck doctor', cwd: s, argv: ['doctor'] } };
    },
  },
  {
    id: 'no-git',
    code: 'no-git',
    setup: (dir) => {
      copySample(join(dir, 'plain'));
      return { cwd: join(dir, 'plain'), argv: ['check'], follow: null };
    },
  },
  {
    id: 'law-invalid',
    code: 'law-invalid',
    setup: (dir) => {
      const s = makeSample(dir);
      withLaw(s, 'lawcheck: 0.1.0\nrulez: {}\n');
      return { cwd: s, argv: ['check', '--base', 'main'], follow: null };
    },
  },
  {
    id: 'config-invalid',
    code: 'config-invalid',
    setup: (dir) => {
      const s = makeSample(dir);
      write(s, '.lawcheck/config.yaml', 'bogus: 1\n');
      return { cwd: s, argv: ['check', '--base', 'main'], follow: null };
    },
  },
  {
    id: 'rule-missing-file',
    code: 'rule-missing-file',
    setup: (dir) => {
      const s = makeSample(dir);
      rmSync(join(s, '.lawcheck/rules/no-todo.mjs'));
      return { cwd: s, argv: ['check', '--base', 'main'], follow: null };
    },
  },
  {
    id: 'rule-file-without-entry',
    code: 'rule-file-without-entry',
    setup: (dir) => {
      const s = makeSample(dir);
      write(s, '.lawcheck/rules/extra.mjs', 'export function check() { return []; }\n');
      return { cwd: s, argv: ['check', '--base', 'main'], follow: null };
    },
  },
  {
    id: 'file-unreadable',
    code: 'file-unreadable',
    setup: (dir) => {
      const s = makeSample(dir);
      if (posixOnly === undefined) chmodSync(join(s, 'src/core/price.ts'), 0o000);
      return { cwd: s, argv: ['check', '--base', 'main'], follow: null, skip: posixOnly };
    },
  },
  {
    id: 'type-overlap',
    code: 'type-overlap',
    setup: (dir) => {
      const s = makeSample(dir);
      withLaw(s, LAW + '  core:\n    paths: ["src/core/**"]\n');
      return { cwd: s, argv: ['check', '--base', 'main'], follow: null };
    },
  },
  {
    id: 'not-initialized, doctor, law.yaml is a directory',
    code: 'not-initialized',
    followOnly: true,
    setup: (dir) => {
      const repo = newRepository(dir);
      mkdirSync(join(repo, '.lawcheck/law.yaml'), { recursive: true });
      return { cwd: repo, argv: ['doctor'], follow: { needle: 'lawcheck init', cwd: repo, argv: ['init'] } };
    },
  },
  {
    id: 'base-unreachable, shallow clone, base passed',
    code: 'base-unreachable',
    setup: (dir) => {
      const origin = makeSample(dir);
      git(dir, 'clone', '-q', '--depth', '1', '--branch', 'work', `file://${origin}`, 'clone');
      const clone = join(dir, 'clone');
      return { cwd: clone, argv: ['check', '--base', 'origin/main'], follow: { needle: 'pass --base', cwd: clone, argv: ['check', '--base', 'origin/main'] } };
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
      return { cwd: join(repo, 'pkg'), argv: ['check', '--base', 'main'], hint: { absent: '--allow-fs' } };
    },
  },
  {
    id: 'base-unreachable',
    code: 'base-unreachable',
    setup: (dir) => {
      const s = makeSample(dir);
      return { cwd: s, argv: ['check', '--base', 'nope'], follow: { needle: 'pass --base', cwd: s, argv: ['check', '--base', 'main'] } };
    },
  },
  {
    id: 'rule-crashed',
    code: 'rule-crashed',
    setup: (dir) => {
      const s = makeSample(dir);
      write(s, D_PATH, D);
      setRule(s, 'no-console', 'export function check() { throw new Error("broken"); }\n');
      return { cwd: s, argv: ['check', '--base', 'main'], follow: null };
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
      return { cwd: u, argv: ['check', '--base', 'main'], cli: copy.cli, follow: null };
    },
  },
  {
    id: 'reviewer-not-configured',
    code: 'reviewer-not-configured',
    setup: (dir) => {
      const r = makeR(dir);
      write(r, F_PATH, F);
      rmSync(join(r, '.lawcheck/config.yaml'));
      return { cwd: r, argv: ['check', ...REVIEW], follow: null };
    },
  },
  {
    id: 'too-many-reviews',
    code: 'too-many-reviews',
    setup: (dir, fake) => {
      const r = makeR(dir);
      write(r, F_PATH, F);
      return { cwd: r, argv: ['check', ...REVIEW, '--max-calls', '0'], env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, follow: null };
    },
  },
  {
    id: 'reviewer-unreachable',
    code: 'reviewer-unreachable',
    setup: (dir, fake) => {
      const r = makeR(dir);
      write(r, F_PATH, F);
      fake.respond = () => ({ status: 400, body: '{}' });
      return { cwd: r, argv: ['check', ...REVIEW], env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, stderr: CALL, follow: null };
    },
  },
  {
    id: 'reviewer-bad-answer',
    code: 'reviewer-bad-answer',
    setup: (dir, fake) => {
      const r = makeR(dir);
      write(r, F_PATH, F);
      fake.respond = () => openai('this is no verdict');
      return { cwd: r, argv: ['check', ...REVIEW], env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, stderr: CALL, follow: null };
    },
  },
  { id: 'internal', code: 'internal', setup: (dir) => ({ cwd: makeSample(dir), argv: ['check', '--base', 'main'], follow: null }) },
  {
    id: 'not-reviewed',
    code: 'not-reviewed',
    setup: (dir, fake) => {
      const r = makeR(dir);
      write(r, F_PATH, F);
      return { cwd: r, argv: ['check', '--base', 'main'], env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, follow: { needle: 'lawcheck check --review --base main', cwd: r, argv: ['check', ...REVIEW] } };
    },
  },
  {
    id: 'too-large-to-review',
    code: 'too-large-to-review',
    setup: (dir, fake) => {
      const r = makeR(dir);
      write(r, F_PATH, F);
      write(r, '.lawcheck/config.yaml', REVIEWER_CONFIG + '  max_chars: 2126\n');
      return { cwd: r, argv: ['check', '--base', 'main'], env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, follow: null };
    },
  },
  {
    id: 'forbidden-use',
    code: 'forbidden-use',
    setup: (dir) => {
      const u = makeU(dir);
      write(u, E_PATH, E);
      return { cwd: u, argv: ['check', '--base', 'main'], follow: null };
    },
  },
  {
    id: 'uses-not-read',
    code: 'uses-not-read',
    setup: (dir) => {
      const u = makeU(dir);
      write(u, '.lawcheck/law.yaml', U_LAW.replace('"src/**/*.ts", ', '"src/**/*.ts", "src/**/*.json", '));
      write(u, 'src/core/data.json', '{}\n');
      return { cwd: u, argv: ['check', '--base', 'main'], follow: null };
    },
  },
  {
    id: 'waiver-unknown-rule',
    code: 'waiver-unknown-rule',
    setup: (dir) => {
      const s = makeSample(dir);
      write(s, D_PATH, 'export const a = 1; // lawcheck-waive no-such-rule -- a reason\n');
      return { cwd: s, argv: ['check', '--base', 'main'], follow: null };
    },
  },
  {
    id: 'waiver-without-reason',
    code: 'waiver-without-reason',
    setup: (dir) => {
      const s = makeSample(dir);
      write(s, D_PATH, "console.log(1); // lawcheck-waive no-console\n");
      return { cwd: s, argv: ['check', '--base', 'main'], follow: null };
    },
  },
  {
    id: 'waiver-unused',
    code: 'waiver-unused',
    setup: (dir) => {
      const s = makeSample(dir);
      write(s, D_PATH, 'export const a = 1; // lawcheck-waive no-console -- nothing here to drop\n');
      return { cwd: s, argv: ['check', '--base', 'main'], follow: null };
    },
  },
];

const CLEANUP: (() => void)[] = [];

function docsCodes(): { code: string; kind: string; why: string }[] {
  const page = readFileSync(new URL('../../docs/codes.md', import.meta.url), 'utf8');
  return page
    .split('\n')
    .filter((line) => /^\| `[a-z-]+` \|/.test(line))
    .map((row) => row.split(' | ').map((cell) => cell.replace(/^\| /, '').replace(/ \|$/, '')))
    .map((cells) => ({ code: cells[0]!.slice(1, -1), kind: cells[1]!, why: cells[3]! }));
}

function nextLine(stdout: string): string | null {
  const found = stdout.split('\n').map((line) => line.trimStart()).filter((line) => line.startsWith('next: '));
  return found.length === 0 ? null : found[found.length - 1]!.slice('next: '.length);
}

async function start(spec: Case, dir: string, fake: Fake): Promise<{ text: Run; json: Run; ready: Ready } | { skip: string }> {
  const ready = await spec.setup(dir, fake);
  if (ready.skip !== undefined) return { skip: ready.skip };
  const go = (argv: string[]) => (ready.cli === undefined ? lawcheck(ready.cwd, argv, ready.env ?? {}) : lawcheckAt(ready.cli, ready.cwd, argv, ready.env ?? {}));
  return { text: await go(ready.argv), json: await go([...ready.argv, '--json']), ready };
}

const PENDING: { id: string; finding: string }[] = [
  { id: 'not-initialized, doctor, law.yaml is a directory', finding: 'S5-5' },
  { id: 'base-unreachable, shallow clone, base passed', finding: 'S7-5' },
  { id: 'rule-crashed, rule imports from above the root', finding: 'S2-2' },
];
const MAX_PENDING = 3;

test('check-slice §6: the cases of the codes test, the CODES of the tool and the docs page name the same codes', () => {
  const documented = docsCodes();
  assert.equal(documented.length, 25);
  assert.deepEqual([...new Set(CASES.filter((c) => c.followOnly !== true).map((c) => c.code))].sort(), [...CODES].sort());
  assert.deepEqual(documented.map((d) => d.code).sort(), [...CODES].sort());
  for (const row of documented) assert.equal(row.why, WHY[row.code], row.code);
});

for (const spec of CASES.filter((c) => c.code !== 'internal')) {
  test(`check-slice §6: code ${spec.code}, case ${spec.id}, in text and in JSON, and the command its next line names`, async () => {
    const documented = docsCodes().find((d) => d.code === spec.code)!;
    const fake = await startFake();
    CLEANUP.length = 0;
    try {
      await inTemp(async (dir) => {
        const result = await start(spec, dir, fake);
        if ('skip' in result) return;
        const { text, json, ready } = result;
        const mark = `${spec.id}\n${text.stdout}`;
        assert.equal(text.stderr, ready.stderr ?? '', mark);
        assert.equal(json.stderr, ready.stderr ?? '', mark);
        const document = JSON.parse(json.stdout);
        if (spec.followOnly === true) assert.equal(document.schema, 'lawcheck-doctor/0', mark);
        else if (documented.kind === 'exit 2') {
          assert.equal(text.code, 2, mark);
          assert.equal(json.code, 2, mark);
          assert.ok(text.stdout.includes(`error[${spec.code}]`), mark);
          assert.ok(text.stdout.includes(`  why:  ${documented.why}`), mark);
          assert.equal(document.schema, 'lawcheck-error/1');
          assert.ok(document.errors.some((e: { code: string; why: string }) => e.code === spec.code && e.why === documented.why), json.stdout);
        } else {
          assert.ok(text.stdout.includes(`[${spec.code}]`), mark);
          assert.ok(document.findings.some((f: { code: string }) => f.code === spec.code), json.stdout);
        }
        const next = nextLine(text.stdout);
        if (ready.hint !== undefined) {
          const gets = !text.stdout.includes(ready.hint.absent);
          const pending = PENDING.find((p) => p.id === spec.id);
          if (pending === undefined) assert.ok(gets, `${mark}: the message holds ${ready.hint.absent}`);
          else assert.ok(!gets, `${spec.id} is pending as ${pending.finding} and now passes: take it out of the list`);
          return;
        }
        if (ready.follow === null || ready.follow === undefined) {
          assert.ok(next === null || !next.startsWith('lawcheck '), `${mark}: a next line that is a command needs a follow`);
          return;
        }
        assert.ok(next !== null && next.includes(ready.follow.needle), `${mark}: next names ${ready.follow.needle}`);
        const further = await lawcheck(ready.follow.cwd, ready.follow.argv, ready.env ?? {});
        const gets = further.code !== 2;
        const pending = PENDING.find((p) => p.id === spec.id);
        if (pending === undefined) assert.ok(gets, `${spec.id}: ${ready.follow.argv.join(' ')} does not get further:\n${further.stdout}`);
        else assert.ok(!gets, `${spec.id} is pending as ${pending.finding} and now gets further: take it out of the list`);
      });
    } finally {
      await fake.close();
      for (const remove of CLEANUP) remove();
    }
  });
}

test('check-slice §6: internal, in text and in JSON', async () => {
  const context = { cwd: '/', env: {} };
  const text = await main(['check'], context, async () => {
    throw new Error('the handler broke');
  });
  const json = await main(['check', '--json'], context, async () => {
    throw new Error('the handler broke');
  });
  const documented = docsCodes().find((d) => d.code === 'internal')!;
  assert.equal(text.code, 2);
  assert.ok(text.stdout.includes('error[internal]'));
  assert.ok(text.stdout.includes(`  why:  ${documented.why}`));
  assert.ok(JSON.parse(json.stdout).errors.some((e: { code: string; why: string }) => e.code === 'internal' && e.why === documented.why));
  assert.equal(nextLine(text.stdout), 'run lawcheck check again, and report the error if it stays');
});

test('check-slice §6: the pending list of next lines only shrinks', () => {
  assert.ok(PENDING.length <= MAX_PENDING);
  for (const pending of PENDING) assert.ok(CASES.some((c) => c.id === pending.id), pending.id);
  assert.equal(new Set(PENDING.map((p) => p.id)).size, PENDING.length);
});
