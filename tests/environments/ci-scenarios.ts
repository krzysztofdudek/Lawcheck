import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { example } from '../harness/examples.ts';
import { branch, checkout, commit, install, makeCell, newOrigin, push, removeCell, run, runWorkflow, sha, writeHook, zeros } from './ci-cell.ts';
import type { Cell, Kind, Origin, Ran } from './ci-cell.ts';

const BREACH = "console.log('breach');\n";
const NO_CONSOLE = 'writes to the terminal with console.log';
const AGAIN = (base: string) => `Checking again with the law of ${base}\n`;
const NOTE_LAW = 'note: this change edits the law that judges it: ';

export interface Outcome {
  name: string;
  problems: string[];
}

function last(steps: Ran[]): Ran {
  return steps[steps.length - 1]!;
}

function same(actual: unknown, expected: unknown, what: string, problems: string[]): void {
  if (actual !== expected) problems.push(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function installed(steps: Ran[], problems: string[]): void {
  const failed = steps.find((step) => step.code !== 0 && step.step.includes('install'));
  if (failed !== undefined) problems.push(`the install step ended with ${failed.code}: ${failed.stdout}${failed.stderr}`);
}

function at(cell: Cell, path: string): string {
  return cell.under === '' ? path : `${cell.under}/${path}`;
}

function pullRequest(cell: Cell, change: (o: Origin) => void): Origin {
  const o = newOrigin(cell);
  branch(o, 'checkout', '-q', '-b', 'feature');
  change(o);
  branch(o, 'checkout', '-q', 'main');
  commit(o, at(cell, 'README.md'), '\nA later line on main.\n', 'main moves on');
  branch(o, 'checkout', '-q', '-b', 'pr-merge');
  branch(o, 'merge', '-q', '--no-ff', 'feature', '-m', 'merge');
  push(o, 'main', 'feature', 'pr-merge');
  return o;
}

function put(cell: Cell, o: Origin, path: string, text: string): void {
  const file = join(o.builder, at(cell, path));
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}

function edit(cell: Cell, o: Origin, path: string, from: string, to: string): void {
  const file = join(o.builder, at(cell, path));
  const text = readFileSync(file, 'utf8');
  if (!text.includes(from)) throw new Error(`${path} has no "${from}"`);
  writeFileSync(file, text.replace(from, to));
}

function commitAll(o: Origin, message: string): void {
  branch(o, 'add', '-A');
  branch(o, 'commit', '-q', '-m', message);
}

function breaching(cell: Cell, o: Origin, message: string): void {
  put(cell, o, 'src/core/shipping.ts', BREACH);
  commitAll(o, message);
}

function pr(cell: Cell, name: string, change: (o: Origin) => void, check: (steps: Ran[], o: Origin, problems: string[]) => void, depth: number | null = null): Outcome {
  const problems: string[] = [];
  const o = pullRequest(cell, change);
  const there = checkout(cell, o, 'pr-merge', depth);
  const steps = runWorkflow(cell, there, { name: 'pull_request', baseRef: 'main' }, cell.under);
  installed(steps, problems);
  check(steps, o, problems);
  return { name: `${cell.kind}: pull request, ${name}`, problems };
}

function pushed(cell: Cell, name: string, build: (o: Origin) => string, before: (o: Origin) => string, check: (steps: Ran[], o: Origin, problems: string[]) => void, depth: number | null = null): Outcome {
  const problems: string[] = [];
  const o = newOrigin(cell);
  const earlier = before(o);
  build(o);
  const there = checkout(cell, o, 'main', depth);
  const steps = runWorkflow(cell, there, { name: 'push', before: earlier }, cell.under);
  installed(steps, problems);
  check(steps, o, problems);
  return { name: `${cell.kind}: push to main, ${name}`, problems };
}

function passes(steps: Ran[], expected: string, problems: string[]): void {
  const result = last(steps);
  same(result.code, 0, 'the exit code', problems);
  same(result.stdout, expected, 'the standard output', problems);
  same(result.stderr, '', 'the standard error', problems);
}

const PASS = (files: string, base: string) => `lawcheck: PASS  ${files} (against ${base})\n`;
const TWICE = (files: string, base: string) => PASS(files, base) + AGAIN(base) + PASS(files, base);

function prScenarios(cell: Cell): Outcome[] {
  const clean = (o: Origin) => commit(o, at(cell, 'src/cli/main.ts'), '// a comment\n', 'a comment');
  const breach = (o: Origin) => breaching(cell, o, 'a breach');
  const loosen = (o: Origin) => {
    edit(cell, o, '.lawcheck/law.yaml', '        rules: [no-console]\n', '        rules: []\n');
    breaching(cell, o, 'a breach, and the rule off the type');
  };
  const comment = (o: Origin) => {
    commit(o, at(cell, '.lawcheck/law.yaml'), '# a note\n', 'a note in the law');
  };
  const addRule = (o: Origin) => {
    put(cell, o, '.lawcheck/rules/extra.mjs', 'export function check() {\n  return [];\n}\n');
    edit(cell, o, '.lawcheck/law.yaml', '  no-todo:\n', '  extra:\n    why: An extra rule.\n  no-todo:\n');
    commitAll(o, 'a rule');
  };
  const waiver = (o: Origin) => {
    put(cell, o, 'src/core/shipping.ts', "console.log('x'); // lawcheck-waive no-console -- a legacy call\n");
    commit(o, at(cell, '.lawcheck/law.yaml'), '# a note\n', 'a note in the law');
    commitAll(o, 'a waiver');
  };
  const against = 'origin/main';
  const out: Outcome[] = [];
  out.push(pr(cell, 'a clean change', clean, (steps, _o, problems) => passes(steps, TWICE('1 changed file', against), problems)));
  out.push(
    pr(cell, 'a breach fails the job', breach, (steps, _o, problems) => {
      const result = last(steps);
      same(result.code, 1, 'the exit code', problems);
      const first = result.stdout.split('\n');
      same(first[0], `lawcheck: FAIL  1 error in 1 changed file (against ${against})`, 'the first line', problems);
      if (!first.includes(`${at(cell, 'src/core/shipping.ts')}:1  error[no-console]  ${NO_CONSOLE}`)) problems.push(`no finding line in ${result.stdout}`);
      same(result.stderr, '', 'the standard error', problems);
    }),
  );
  out.push(
    pr(cell, 'a breach and the rule taken off its type fails the second check, which says whose law it uses', loosen, (steps, _o, problems) => {
      const result = last(steps);
      same(result.code, 1, 'the exit code', problems);
      const found = result.stdout.split('\n');
      same(found[0], `lawcheck: PASS  2 changed files (against ${against})`, 'the first check passes', problems);
      if (!found.includes(`${NOTE_LAW}takes the rule no-console off the type library`)) problems.push(`the law-change line is missing: ${result.stdout}`);
      const label = found.indexOf(AGAIN(against).trim());
      if (label < 0 || found[label + 1] !== `lawcheck: FAIL  1 error in 1 changed file (against ${against})`) problems.push(`the second check is not labelled and failing: ${result.stdout}`);
    }),
  );
  out.push(
    pr(cell, 'a note in the law passes both checks', comment, (steps, _o, problems) => {
      const result = last(steps);
      same(result.code, 0, 'the exit code', problems);
      same(result.stdout.split('\n').filter((line) => line.startsWith('lawcheck: PASS')).length, 2, 'the checks that passed', problems);
      if (!result.stdout.includes(`${NOTE_LAW}edits .lawcheck/law.yaml without changing a rule or a type`)) problems.push(`the law-change line is missing: ${result.stdout}`);
    }),
  );
  out.push(
    pr(cell, 'a pull request that adds a rule passes both checks', addRule, (steps, _o, problems) => {
      const result = last(steps);
      same(result.code, 0, 'the exit code', problems);
      same(result.stdout.split('\n').filter((line) => line.startsWith('lawcheck: PASS')).length, 2, 'the checks that passed', problems);
      if (!result.stdout.includes(`${NOTE_LAW}adds the rule extra; adds .lawcheck/rules/extra.mjs`)) problems.push(`the law-change line is missing: ${result.stdout}`);
    }),
  );
  out.push(
    pr(cell, 'a waiver the change adds is named', waiver, (steps, _o, problems) => {
      const result = last(steps);
      same(result.code, 0, 'the exit code', problems);
      const line = `${NOTE_LAW}edits .lawcheck/law.yaml without changing a rule or a type; adds a waiver of no-console in ${at(cell, 'src/core/shipping.ts')}`;
      if (!result.stdout.includes(line)) problems.push(`the waiver is not named: ${result.stdout}`);
    }),
  );
  out.push(
    pr(
      cell,
      'a shallow checkout with no base is refused by name',
      clean,
      (steps, _o, problems) => {
        const result = last(steps);
        same(result.code, 2, 'the exit code', problems);
        same(
          result.stdout,
          [
            'lawcheck: ERROR  1 error',
            '',
            "error[base-unreachable]  the base 'origin/main' names no commit here, and this clone is shallow",
            '  why:  without its base a change cannot be told from debt',
            '',
            'next: fetch the history: git fetch --unshallow origin +refs/heads/main:refs/remotes/origin/main (fetch-depth: 0 in actions/checkout, GIT_DEPTH: 0 in GitLab CI, fetchDepth: 0 in Azure Pipelines), then run lawcheck check',
            '',
          ].join('\n'),
          'the message for a shallow clone that docs/ci.md describes',
          problems,
        );
        same(result.stderr, '', 'the standard error', problems);
      },
      1,
    ),
  );
  return out;
}

function pushScenarios(cell: Cell): Outcome[] {
  const out: Outcome[] = [];
  let before = '';
  let parent = '';
  const advance = (o: Origin): string => {
    parent = sha(o, 'main');
    commit(o, at(cell, 'src/cli/main.ts'), '// a comment\n', 'a comment');
    push(o, 'main');
    return sha(o, 'main');
  };
  out.push(
    pushed(
      cell,
      'the commits since the one before',
      advance,
      (o) => {
        before = sha(o, 'main');
        return before;
      },
      (steps, _o, problems) => passes(steps, TWICE('1 changed file', before), problems),
    ),
  );
  out.push(
    pushed(
      cell,
      'a force-push that removed the commit before is judged by its last commit',
      advance,
      () => 'b'.repeat(40),
      (steps, _o, problems) => passes(steps, TWICE('1 changed file', parent), problems),
    ),
  );
  out.push(
    pushed(
      cell,
      'an all-zero before falls back to the parent',
      advance,
      () => zeros(),
      (steps, _o, problems) => passes(steps, TWICE('1 changed file', parent), problems),
    ),
  );
  out.push(
    pushed(
      cell,
      'a direct push that takes a rule off its type and breaks it fails the second check',
      (o) => {
        parent = sha(o, 'main');
        edit(cell, o, '.lawcheck/law.yaml', '        rules: [no-console]\n', '        rules: []\n');
        breaching(cell, o, 'a breach, and the rule off the type');
        push(o, 'main');
        return sha(o, 'main');
      },
      (o) => sha(o, 'main'),
      (steps, _o, problems) => {
        const result = last(steps);
        same(result.code, 1, 'the exit code', problems);
        const found = result.stdout.split('\n');
        if (!found.includes(`${NOTE_LAW}takes the rule no-console off the type library`)) problems.push(`the law-change line is missing: ${result.stdout}`);
        if (!found.includes(`lawcheck: FAIL  1 error in 1 changed file (against ${parent})`)) problems.push(`the second check did not fail: ${result.stdout}`);
      },
    ),
  );
  let files = 0;
  const root = (breach: boolean) => (o: Origin) => {
    branch(o, 'checkout', '-q', '--orphan', 'root');
    branch(o, 'rm', '-q', '-rf', 'src/core', 'tools');
    if (breach) put(cell, o, 'src/core/shipping.ts', BREACH);
    branch(o, 'add', '-A');
    branch(o, 'commit', '-q', '-m', 'the root');
    branch(o, 'push', '-q', '--force', 'origin', 'root:main');
    files = branch(o, 'ls-files').split('\n').length;
    return sha(o, 'HEAD');
  };
  out.push(
    pushed(
      cell,
      'a root commit has no parent and is judged whole',
      root(false),
      () => zeros(),
      (steps, _o, problems) => passes(steps, `lawcheck: PASS  ${files} files (no base: every file counts as changed)\n\ndebt (outside this change): none\n`, problems),
    ),
  );
  out.push(
    pushed(
      cell,
      'a root commit with a breach fails',
      root(true),
      () => zeros(),
      (steps, _o, problems) => {
        const result = last(steps);
        same(result.code, 1, 'the exit code', problems);
        same(result.stdout.split('\n')[0], `lawcheck: FAIL  1 error in ${files} files (no base: every file counts as changed)`, 'the first line', problems);
      },
    ),
  );
  return out;
}

function queue(cell: Cell): Outcome {
  const problems: string[] = [];
  const o = pullRequest(cell, (origin) => commit(origin, 'src/cli/main.ts', '// a comment\n', 'a comment'));
  const base = sha(o, 'main');
  const there = checkout(cell, o, 'pr-merge');
  const steps = runWorkflow(cell, there, { name: 'merge_group', mergeBase: base });
  installed(steps, problems);
  passes(steps, TWICE('1 changed file', base), problems);
  return { name: `${cell.kind}: merge queue`, problems };
}

function hooks(cell: Cell): Outcome[] {
  const out: Outcome[] = [];
  const both = (run: { stdout: string; stderr: string }) => `${run.stdout}${run.stderr}`;
  const commitHook = () => {
    const problems: string[] = [];
    const o = newOrigin(cell);
    const there = checkout(cell, o, 'main', 0);
    same(install(cell, there.dir).code, 0, 'the install', problems);
    writeHook(there.dir, 'pre-commit', example('pre-commit-hook'));
    mkdirSync(join(there.dir, 'src', 'core'), { recursive: true });
    writeFileSync(join(there.dir, 'src/core/shipping.ts'), BREACH);
    const refused = run(there.dir, cell.env, 'git checkout -q -b topic && git add -A && git commit -qm breach');
    same(refused.code, 1, 'the commit with a breach', problems);
    if (!both(refused).includes(`src/core/shipping.ts:1  error[no-console]  ${NO_CONSOLE}`)) problems.push(`the hook did not report the breach: ${both(refused)}`);
    if (both(refused).includes('not found')) problems.push(`the hook could not start Lawcheck: ${both(refused)}`);
    const clean = run(there.dir, cell.env, `rm src/core/shipping.ts && printf '// a comment\\n' >> src/cli/main.ts && git commit -qam clean`);
    same(clean.code, 0, 'the clean commit', problems);
    same(both(clean), 'lawcheck: PASS  1 changed file (against origin/main)\n', 'the clean commit, what it printed', problems);
    return { name: `${cell.kind}: the pre-commit hook refuses a breach and lets a clean commit through`, problems };
  };
  const indexHook = () => {
    const problems: string[] = [];
    const o = newOrigin(cell);
    const there = checkout(cell, o, 'main', 0);
    same(install(cell, there.dir).code, 0, 'the install', problems);
    writeHook(there.dir, 'pre-commit', example('pre-commit-hook'));
    mkdirSync(join(there.dir, 'src', 'core'), { recursive: true });
    writeFileSync(join(there.dir, 'src/core/shipping.ts'), BREACH);
    const staged = run(there.dir, cell.env, 'git add -A && printf "export const x = 1;\\n" > src/core/shipping.ts && git commit -qm staged');
    same(staged.code, 0, 'a staged breach with a clean tree is committed, as the page says: the hook judges the tree and not the index', problems);
    return { name: `${cell.kind}: the pre-commit hook judges the working tree and not the index`, problems };
  };
  const pushHook = () => {
    const problems: string[] = [];
    const o = newOrigin(cell);
    push(o, 'main');
    branch(o, 'push', '-q', 'origin', 'main:refs/heads/old');
    const there = checkout(cell, o, 'main', 0);
    same(install(cell, there.dir).code, 0, 'the install', problems);
    writeHook(there.dir, 'pre-push', example('pre-push-hook'));
    const ok = run(there.dir, cell.env, `git checkout -q -b clean && printf '// a comment\\n' >> src/cli/main.ts && git commit -qam clean && git push -q origin clean`);
    same(ok.code, 0, 'a clean push', problems);
    const breach = run(there.dir, cell.env, `git checkout -q -b breach && mkdir -p src/core && printf "${BREACH.trim()}\\n" > src/core/shipping.ts && git add -A && git commit -qm breach && git push -q origin breach`);
    same(breach.code, 1, 'a push with a breach', problems);
    if (!both(breach).includes('error[no-console]')) problems.push(`the pre-push hook did not report the breach: ${both(breach)}`);
    const head = run(there.dir, cell.env, 'git push -q origin HEAD:elsewhere');
    same(head.code, 1, 'a push of HEAD with the breach in the tree', problems);
    const other = run(there.dir, cell.env, 'git push -q origin clean:another');
    same(other.code, 1, 'a push of another branch while the tree holds a breach: the hook judges the tree, as the page says', problems);
    const deleted = run(there.dir, cell.env, 'git push -q origin :refs/heads/old');
    same(deleted.code, 0, 'a push that deletes a branch, with the breach in the tree', problems);
    const tagged = run(there.dir, cell.env, 'git tag v1 && git push -q origin v1');
    same(tagged.code, 0, 'a push of a tag, with the breach in the tree', problems);
    return { name: `${cell.kind}: the pre-push hook refuses a push while the tree holds a breach, and a delete or a tag passes`, problems };
  };
  out.push(commitHook(), indexHook(), pushHook());
  return out;
}

function subfolder(cell: Cell): Outcome[] {
  const loosen = (o: Origin) => {
    edit(cell, o, '.lawcheck/law.yaml', '        rules: [no-console]\n', '        rules: []\n');
    breaching(cell, o, 'a breach, and the rule off the type');
  };
  return [
    pr(cell, 'a law below the top, a breach and the rule taken off its type fails the second check', loosen, (steps, _o, problems) => {
      const result = last(steps);
      same(result.code, 1, 'the exit code', problems);
      const found = result.stdout.split('\n');
      same(found[0], 'lawcheck: PASS  2 changed files (against origin/main)', 'the first check passes', problems);
      if (!found.includes('Checking again with the law of origin/main')) problems.push(`the second check did not run: ${result.stdout}`);
      if (!found.includes('lawcheck: FAIL  1 error in 1 changed file (against origin/main)')) problems.push(`the second check did not fail: ${result.stdout}`);
    }),
  ];
}

export function scenarios(kind: Kind, tarball: string): Outcome[] {
  const cell = makeCell(kind, tarball);
  const out: Outcome[] = [];
  try {
    out.push(...prScenarios(cell), ...pushScenarios(cell));
    if (kind === 'npm-lock') out.push(queue(cell), ...hooks(cell));
  } finally {
    removeCell(cell);
  }
  if (kind === 'npm-lock') {
    const below = makeCell(kind, tarball, 'pkg');
    try {
      out.push(...subfolder(below));
    } finally {
      removeCell(below);
    }
  }
  return out;
}
