import { test } from 'node:test';
import { platformSkip } from '../harness/tool.ts';
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

const NO_CONSOLE_WHY = 'Only the command layer writes to the terminal.';
const NO_TODO_WHY = 'A TODO without an issue number gets forgotten.';

// The grammar of spec/check-slice.md, section 6, for a run that fails on one finding and for exit 2 with one error.
function failing(place: string, rest: string, why: string): string {
  return [`lawcheck: FAIL  1 error in 1 changed file (against main)`, '', `${place}  ${rest}`, `  why:  ${why}`, '', `next: fix ${place}`, ''].join('\n');
}

function errors(line: string, why: string, next: string): string {
  return ['lawcheck: ERROR  1 error', '', line, `  why:  ${why}`, '', `next: ${next}`, ''].join('\n');
}

const finding = (f: { code: string; severity: string; debt: boolean; file: string; line: number; type: string; message: string; why: string }) => ({
  code: f.code, rule: f.code, severity: f.severity, blocking: f.severity === 'error', debt: f.debt, file: f.file, line: f.line, type: f.type, message: f.message, why: f.why,
});

// The document of spec/check-slice.md, section 6, with its three debt findings, and the keys the later slices add: law_changed, unresolved and reviews.
const TEST41 = {
  schema: 'lawcheck-check/0',
  result: 'fail',
  scope: { mode: 'full', base: 'main', files: 1, law_changed: false },
  summary: { errors: 1, warnings: 1, debt: 3, waivers: 1, unresolved: 0 },
  findings: [
    finding({ code: 'no-console', severity: 'error', debt: false, file: 'src/core/discount.ts', line: 2, type: 'library', message: 'writes to the terminal with console.log', why: NO_CONSOLE_WHY }),
    finding({ code: 'no-todo', severity: 'warning', debt: false, file: 'src/core/discount.ts', line: 3, type: 'library', message: 'TODO without an issue number', why: NO_TODO_WHY }),
    finding({ code: 'no-console', severity: 'warning', debt: true, file: 'src/core/price.ts', line: 2, type: 'library', message: 'writes to the terminal with console.log', why: NO_CONSOLE_WHY }),
    finding({ code: 'no-todo', severity: 'warning', debt: true, file: 'src/core/tax.ts', line: 1, type: 'library', message: 'TODO without an issue number', why: NO_TODO_WHY }),
    finding({ code: 'no-todo', severity: 'warning', debt: true, file: 'tools/release.mjs', line: 2, type: 'script', message: 'TODO without an issue number', why: NO_TODO_WHY }),
  ],
  waivers: [{ file: 'src/core/discount.ts', line: 4, rule: 'no-console', debt: false, waived: 1, reason: 'the pricing team reads this warning until 2.0' }],
  unresolved: [],
  reviews: { missing: 0, calls_made: 0, passes_recorded: 0 },
  next: { command: null, text: 'fix src/core/discount.ts:2' },
};

const BASE_NOPE = [
  'lawcheck: ERROR  1 error',
  '',
  "error[base-unreachable]  the base 'nope' names no commit here",
  '  why:  without its base a change cannot be told from debt',
  '',
  'next: pass --base with a branch or a commit that exists here',
  '',
].join('\n');


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
  { name: 'test 6', args: BASE, arrange: (p) => append(p.root, 'src/core/price.ts', '// end\n'), expect: exactly(1, failing('src/core/price.ts:2', 'error[no-console]  writes to the terminal with console.log', NO_CONSOLE_WHY)) },
  { name: 'test 12', args: BASE, arrange: (p) => write(p.root, 'src/core/żółw.ts', 'console.log(1);\n'), expect: exactly(1, failing('src/core/żółw.ts:1', 'error[no-console]  writes to the terminal with console.log', NO_CONSOLE_WHY)) },
  { name: 'test 13', args: BASE, arrange: (p) => git(p.repo, 'mv', 'src/core/price.ts', 'src/core/cost.ts'), expect: exactly(1, failing('src/core/cost.ts:2', 'error[no-console]  writes to the terminal with console.log', NO_CONSOLE_WHY)) },
  {
    name: 'test 20',
    args: BASE,
    arrange: (p) => rmSync(join(p.root, '.lawcheck/rules/no-todo.mjs')),
    expect: exactly(
      2,
      errors(
        ".lawcheck/law.yaml:6  error[rule-missing-file]  the rule 'no-todo' has neither .lawcheck/rules/no-todo.mjs nor .lawcheck/rules/no-todo.md",
        'a rule without its file would never be checked',
        'write the rule files the law names, or take their rules out of the law, then run lawcheck check',
      ),
    ),
  },
  {
    name: 'test 22',
    args: BASE,
    options: { onMain: (s) => setRule(s, 'no-console', "export function check() { throw new Error('x'); }\n") },
    arrange: (p) => append(p.root, 'src/core/price.ts', '// end\n'),
    expect: exactly(2, errors('.lawcheck/rules/no-console.mjs  error[rule-crashed]  throws on src/core/price.ts: x', 'a broken rule says nothing about the code', 'fix .lawcheck/rules/no-console.mjs, then run lawcheck check')),
  },
  {
    name: 'test 28',
    args: BASE,
    options: { onMain: (s) => setRule(s, 'no-console', "import { readFileSync } from 'node:fs';\nexport function check() { return [{ message: readFileSync('README.md', 'utf8').trim() }]; }\n") },
    arrange: (p) => write(p.root, D_PATH, D),
    expect: exactly(
      1,
      [
        'lawcheck: FAIL  1 error, 2 warnings in 1 changed file (against main), 1 waiver',
        '',
        'src/core/discount.ts  error[no-console]  # Sample',
        `  why:  ${NO_CONSOLE_WHY}`,
        'src/core/discount.ts:3  warning[no-todo]  TODO without an issue number',
        `  why:  ${NO_TODO_WHY}`,
        "src/core/discount.ts:4  warning[waiver-unused]  the waiver of 'no-console' drops no finding",
        '  why:  a waiver that drops nothing would hide the next finding on its line',
        '',
        'next: fix src/core/discount.ts',
        '',
      ].join('\n'),
    ),
  },
  {
    name: 'test 29',
    args: BASE,
    options: { onMain: (s) => setRule(s, 'no-todo', "export function check({ repo }) { return [{ message: repo.filesOf('source').join(' ') }]; }\n") },
    arrange: (p) => append(p.root, 'src/cli/main.ts', '// end\n'),
    expect: exactly(0, ['lawcheck: PASS  1 warning in 1 changed file (against main)', '', 'src/cli/main.ts  warning[no-todo]  src/cli/main.ts src/core/price.ts src/core/tax.ts', `  why:  ${NO_TODO_WHY}`, ''].join('\n')),
  },
  {
    name: 'test 31',
    args: BASE,
    arrange: (p) => write(p.root, D_PATH, D.replace("  console.log('discount', net);", "  // lawcheck-waive no-console -- support reads this line\n  console.log('discount', net);")),
    expect: exactly(0, ['lawcheck: PASS  1 warning in 1 changed file (against main), 2 waivers', '', 'src/core/discount.ts:4  warning[no-todo]  TODO without an issue number', `  why:  ${NO_TODO_WHY}`, ''].join('\n')),
  },
  { name: 'test 38', args: ['check', '--base', 'nope'], expect: exactly(2, BASE_NOPE) },
  {
    name: 'test 41',
    args: ['check', '--full', '--base', 'main', '--json'],
    arrange: (p) => write(p.root, D_PATH, D),
    expect: (run) => {
      assert.deepEqual(JSON.parse(run.stdout), TEST41);
      assert.equal(run.stdout.endsWith('}\n'), true);
      assert.equal(run.stderr, '');
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
          assert.match(run.stdout, new RegExp(`^next: install ${HOISTED} in a node_modules below the root, then run lawcheck check$`, 'm'));
          assert.equal(run.stderr, '');
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

test('S2-2: a node_modules at the root that links to a folder outside it is refused in the same words', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
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
    assert.match(run.stdout, new RegExp(`^next: install ${HOISTED} in a node_modules below the root, then run lawcheck check$`, 'm'));
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

test('S5-5: at the top of a monorepo whose law lives in pkg/, not-initialized names that law and the step that gets further, and doctor says the same', async () => {
  await inTemp(async (dir) => {
    const top = SHAPES[1]!.make(dir, {}).top;
    write(top, `pkg/${D_PATH}`, D);
    const run = await lawcheck(top, BASE);
    assert.equal(
      run.stdout,
      errors(
        'error[not-initialized]  no .lawcheck/law.yaml in this directory or any above it; the laws below it are in pkg',
        'without a law there is nothing to check the code against',
        'cd pkg, where a law is, then run lawcheck check',
      ),
    );
    assert.equal(run.code, 2);
    assert.deepEqual(JSON.parse((await lawcheck(top, [...BASE, '--json'])).stdout).next, { command: null, text: 'cd pkg, where a law is, then run lawcheck check' });
    const doctor = await lawcheck(top, ['doctor']);
    assert.match(doctor.stdout, /^fail  law  no \.lawcheck\/law\.yaml in this directory or any above it; the laws below it are in pkg\n  next: cd pkg, where a law is, then run lawcheck doctor again$/m);
    const further = await lawcheck(join(top, 'pkg'), BASE);
    assert.equal(further.stdout, TEST4);
  });
});

test('S5-5: control, a directory with no law anywhere keeps the next line that sends the user to init', async () => {
  await inTemp(async (dir) => {
    git(dir, 'init', '-q', '-b', 'main');
    write(dir, 'README.md', '# x\n');
    const doctor = await lawcheck(dir, ['doctor']);
    assert.match(doctor.stdout, /^fail  law  no \.lawcheck\/law\.yaml in this directory or any above it\n  next: lawcheck init  \(only when the user wants a law here\)$/m);
  });
});
