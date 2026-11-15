import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { append, D, D_PATH, findingLines, git, inTemp, lawcheck, makeSample, NOTHING_CHANGED, setRule, TEST3, TEST4, write } from '../acceptance/helpers.ts';
import type { Run } from '../acceptance/helpers.ts';
import { HOISTED, inShapes, SHAPES, WINDOWS } from './shapes.ts';
import type { Placed, Scenario } from './shapes.ts';

const BASE = ['check', '--base', 'main'];

function exactly(code: number, stdout: string): (run: Run) => void {
  return (run) => {
    assert.equal(run.stdout, stdout);
    assert.equal(run.code, code);
    assert.equal(run.stderr, '');
  };
}

function commit(placed: Placed, message: string): void {
  git(placed.repo, 'add', '-A', '.');
  git(placed.repo, 'commit', '-q', '-m', message);
}

const BASE_NOPE = [
  'lawcheck: ERROR  1 error',
  '',
  "error[base-unreachable]  the base 'nope' names no commit here",
  '  why:  without its base a change cannot be told from debt',
  '',
  'next: pass --base with a branch or a commit that exists here',
  '',
].join('\n');

const ONE_CRASH = /^lawcheck: ERROR  1 error\n\n\.lawcheck\/rules\/no-console\.mjs  error\[rule-crashed\]  throws on src\/core\/price\.ts: x\n/;

// The rows of spec/check-slice.md, section 8, that a shape could change: the change against the base, the files git lists, the rules' runner and its root, waivers, the exit codes and the JSON.
const CORE: Scenario[] = [
  { name: 'test 1', args: BASE, expect: exactly(0, NOTHING_CHANGED) },
  { name: 'test 2', args: BASE, arrange: (p) => append(p.root, 'src/cli/main.ts', "console.log('done');\n"), expect: exactly(0, 'lawcheck: PASS  1 changed file (against main)\n') },
  { name: 'test 3', args: ['check', '--full', '--base', 'main'], arrange: (p) => write(p.root, D_PATH, D), expect: exactly(1, TEST3) },
  { name: 'test 4', args: BASE, arrange: (p) => write(p.root, D_PATH, D), expect: exactly(1, TEST4) },
  {
    name: 'test 5',
    args: BASE,
    arrange: (p) => {
      write(p.root, D_PATH, D);
      commit(p, 'discount');
    },
    expect: exactly(1, TEST4),
  },
  {
    name: 'test 6',
    args: BASE,
    arrange: (p) => append(p.root, 'src/core/price.ts', '// end\n'),
    expect: (run) => {
      assert.deepEqual(findingLines(run.stdout), ['src/core/price.ts:2  error[no-console]  writes to the terminal with console.log']);
      assert.equal(run.code, 1);
    },
  },
  {
    name: 'test 12',
    args: BASE,
    arrange: (p) => write(p.root, 'src/core/żółw.ts', 'console.log(1);\n'),
    expect: (run) => {
      assert.deepEqual(findingLines(run.stdout), ['src/core/żółw.ts:1  error[no-console]  writes to the terminal with console.log']);
      assert.equal(run.code, 1);
    },
  },
  {
    name: 'test 13',
    args: BASE,
    arrange: (p) => git(p.repo, 'mv', 'src/core/price.ts', 'src/core/cost.ts'),
    expect: (run) => {
      assert.equal(run.stdout.split('\n')[0], 'lawcheck: FAIL  1 error in 1 changed file (against main)');
      assert.deepEqual(findingLines(run.stdout), ['src/core/cost.ts:2  error[no-console]  writes to the terminal with console.log']);
      assert.equal(run.code, 1);
    },
  },
  {
    name: 'test 20',
    args: BASE,
    arrange: (p) => rmSync(join(p.root, '.lawcheck/rules/no-todo.mjs')),
    expect: (run) => {
      assert.match(run.stdout, /^\.lawcheck\/law\.yaml:6  error\[rule-missing-file\]  /m);
      assert.equal(run.code, 2);
    },
  },
  {
    name: 'test 22',
    args: BASE,
    options: { onMain: (s) => setRule(s, 'no-console', "export function check() { throw new Error('x'); }\n") },
    arrange: (p) => append(p.root, 'src/core/price.ts', '// end\n'),
    expect: (run) => {
      assert.match(run.stdout, ONE_CRASH);
      assert.equal(run.code, 2);
    },
  },
  {
    name: 'test 28',
    args: BASE,
    options: { onMain: (s) => setRule(s, 'no-console', "import { readFileSync } from 'node:fs';\nexport function check() { return [{ message: readFileSync('README.md', 'utf8').trim() }]; }\n") },
    arrange: (p) => write(p.root, D_PATH, D),
    expect: (run) => {
      assert.ok(findingLines(run.stdout).includes('src/core/discount.ts  error[no-console]  # Sample'), run.stdout);
      assert.equal(run.code, 1);
    },
  },
  {
    name: 'test 29',
    args: BASE,
    options: { onMain: (s) => setRule(s, 'no-todo', "export function check({ repo }) { return [{ message: repo.filesOf('source').join(' ') }]; }\n") },
    arrange: (p) => append(p.root, 'src/cli/main.ts', '// end\n'),
    expect: (run) => {
      assert.deepEqual(findingLines(run.stdout), ['src/cli/main.ts  warning[no-todo]  src/cli/main.ts src/core/price.ts src/core/tax.ts']);
      assert.equal(run.code, 0);
    },
  },
  {
    name: 'test 31',
    args: BASE,
    arrange: (p) => write(p.root, D_PATH, D.replace("  console.log('discount', net);", "  // lawcheck-waive no-console -- support reads this line\n  console.log('discount', net);")),
    expect: (run) => {
      assert.equal(run.stdout.split('\n')[0], 'lawcheck: PASS  1 warning in 1 changed file (against main), 2 waivers');
      assert.deepEqual(findingLines(run.stdout), ['src/core/discount.ts:4  warning[no-todo]  TODO without an issue number']);
      assert.equal(run.code, 0);
    },
  },
  { name: 'test 38', args: ['check', '--base', 'nope'], expect: exactly(2, BASE_NOPE) },
  {
    name: 'test 41',
    args: ['check', '--full', '--base', 'main', '--json'],
    arrange: (p) => write(p.root, D_PATH, D),
    expect: (run) => {
      const document = JSON.parse(run.stdout);
      assert.equal(document.result, 'fail');
      assert.deepEqual(document.scope, { mode: 'full', base: 'main', files: 1, law_changed: false });
      assert.deepEqual(document.findings.map((f: { file: string; line?: number; debt: boolean }) => `${f.file}:${f.line ?? ''}:${f.debt}`), [
        'src/core/discount.ts:2:false',
        'src/core/discount.ts:3:false',
        'src/core/price.ts:2:true',
        'src/core/tax.ts:1:true',
        'tools/release.mjs:2:true',
      ]);
      assert.equal(run.code, 1);
    },
  },
];

const inShape = async (index: number) => assert.deepEqual(await inShapes(CORE, [SHAPES[index]!]), []);

test("I-shape-1: the core rows of check give the spec's output with the law at the top, from the root and from below it", () => inShape(0));

test("I-shape-1: the core rows of check give the spec's output with the law in pkg/ of a monorepo, node_modules hoisted above it", () => inShape(1));

test("I-shape-1: the core rows of check give the spec's output in a linked worktree, from the root and from below it", () => inShape(2));

test("I-shape-1: the core rows of check give the spec's output at a root path with a space and a non-ASCII letter", () => inShape(3));

test("I-shape-1: the core rows of check give the spec's output at a root reached through a symbolic link", () => inShape(4));

const IMPORTS_HOISTED = `import { hoisted } from '${HOISTED}';\nexport function check() { return [{ message: hoisted }]; }\n`;
const OUTSIDE = "outside the root and Lawcheck's folder, and a rule may read nothing else";

test('S2-2: a rule that imports a package from a node_modules above the root is refused in words that name the limit, never a flag', async () => {
  const [inPackage] = SHAPES.filter((shape) => shape.name.includes('pkg/'));
  const problems = await inShapes(
    [
      {
        name: 'S2-2',
        args: BASE,
        options: { onMain: (s) => setRule(s, 'no-console', IMPORTS_HOISTED) },
        arrange: (p) => write(p.root, D_PATH, D),
        expect: (run) => {
          const crash = run.stdout.split('\n').find((line) => line.includes('error[rule-crashed]')) ?? '';
          assert.ok(crash.startsWith('.lawcheck/rules/no-console.mjs  error[rule-crashed]  fails to load: reads '), crash);
          assert.ok(crash.includes(`node_modules`) && crash.endsWith(OUTSIDE), crash);
          assert.doesNotMatch(run.stdout, /--allow-fs|Use --/);
          assert.match(run.stdout, /^next: fix \.lawcheck\/rules\/no-console\.mjs, then run lawcheck check$/m);
          assert.equal(run.code, 2);
        },
      },
    ],
    [inPackage!],
  );
  assert.deepEqual(problems, []);
});

test('S2-2: control, the same rule loads the same package from a node_modules below the root', async () => {
  const problems = await inShapes(
    [
      {
        name: 'S2-2 control',
        args: BASE,
        options: { onMain: (s) => setRule(s, 'no-console', IMPORTS_HOISTED) },
        arrange: (p) => write(p.root, D_PATH, D),
        expect: (run) => {
          assert.deepEqual(findingLines(run.stdout), [
            'src/core/discount.ts  error[no-console]  from a hoisted package',
            'src/core/discount.ts:3  warning[no-todo]  TODO without an issue number',
            "src/core/discount.ts:4  warning[waiver-unused]  the waiver of 'no-console' drops no finding",
          ]);
          assert.equal(run.code, 1);
        },
      },
    ],
    SHAPES.filter((shape) => !shape.name.includes('pkg/')),
  );
  assert.deepEqual(problems, []);
});

test('S2-2: a node_modules at the root that links to a folder outside it is refused in the same words', { skip: WINDOWS ? 'a junction on Windows is resolved before Node checks the path' : false }, async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir, { onMain: (repo) => setRule(repo, 'no-console', IMPORTS_HOISTED) });
    write(dir, `elsewhere/node_modules/${HOISTED}/package.json`, JSON.stringify({ name: HOISTED, type: 'module', main: 'index.js' }) + '\n');
    write(dir, `elsewhere/node_modules/${HOISTED}/index.js`, "export const hoisted = 'from a hoisted package';\n");
    symlinkSync(join(dir, 'elsewhere', 'node_modules'), join(s, 'node_modules'), 'dir');
    write(s, D_PATH, D);
    const run = await lawcheck(s, BASE);
    const crash = run.stdout.split('\n').find((line) => line.includes('error[rule-crashed]')) ?? '';
    assert.ok(crash.startsWith(`.lawcheck/rules/no-console.mjs  error[rule-crashed]  fails to load: reads ${join(dir, 'elsewhere', 'node_modules')}`), crash);
    assert.ok(crash.endsWith(OUTSIDE), crash);
    assert.equal(run.code, 2);
  });
});

test('S2-2: a rule that writes a file is refused in words that name what it did', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir, { onMain: (repo) => setRule(repo, 'no-console', "import { writeFileSync } from 'node:fs';\nexport function check() { writeFileSync('out.txt', 'x'); return []; }\n") });
    write(s, D_PATH, D);
    const run = await lawcheck(s, BASE);
    // Node names the path as the rule gave it, and on Windows as a whole path with the \\?\ prefix.
    assert.match(run.stdout, /^\.lawcheck\/rules\/no-console\.mjs  error\[rule-crashed\]  throws on src\/core\/discount\.ts: writes (\\\\\?\\\S+\\)?out\.txt, and a rule may write no file$/m);
    assert.doesNotMatch(run.stdout, /--allow-fs/);
    assert.equal(run.code, 2);
  });
});
