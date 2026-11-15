import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { example } from '../harness/examples.ts';
import { branch, checkout, commit, install, makeCell, newOrigin, push, removeCell, run, runWorkflow, sha, writeHook, zeros } from './ci-cell.ts';
import type { Cell, Kind, Origin, Ran } from './ci-cell.ts';

const BREACH = "console.log('breach');\n";
const NO_CONSOLE = 'writes to the terminal with console.log';
const CLEAN = 'src/cli/main.ts';
const BREACH_FILE = 'src/core/shipping.ts';
const LAW = '.lawcheck/law.yaml';

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

function pullRequest(cell: Cell, change: (o: Origin) => void): Origin {
  const o = newOrigin(cell);
  branch(o, 'checkout', '-q', '-b', 'feature');
  change(o);
  branch(o, 'checkout', '-q', 'main');
  commit(o, 'README.md', '\nA later line on main.\n', 'main moves on');
  branch(o, 'checkout', '-q', '-b', 'pr-merge');
  branch(o, 'merge', '-q', '--no-ff', 'feature', '-m', 'merge');
  push(o, 'main', 'feature', 'pr-merge');
  return o;
}

function breaching(o: Origin, message: string): void {
  writeFileSync(join(o.builder, BREACH_FILE), BREACH);
  branch(o, 'add', '-A');
  branch(o, 'commit', '-q', '-m', message);
}

function pr(cell: Cell, name: string, change: (o: Origin) => void, check: (steps: Ran[], o: Origin, problems: string[]) => void, depth: number | null = null): Outcome {
  const problems: string[] = [];
  const o = pullRequest(cell, change);
  const at = checkout(cell, o, 'pr-merge', depth);
  const steps = runWorkflow(cell, at, { name: 'pull_request', baseRef: 'main' });
  installed(steps, problems);
  check(steps, o, problems);
  return { name: `${cell.kind}: pull request, ${name}`, problems };
}

function pushed(cell: Cell, name: string, build: (o: Origin) => string, before: (o: Origin) => string, check: (steps: Ran[], o: Origin, problems: string[]) => void, depth: number | null = null): Outcome {
  const problems: string[] = [];
  const o = newOrigin(cell);
  const earlier = before(o);
  build(o);
  const at = checkout(cell, o, 'main', depth);
  const steps = runWorkflow(cell, at, { name: 'push', before: earlier });
  installed(steps, problems);
  check(steps, o, problems);
  return { name: `${cell.kind}: push to main, ${name}`, problems };
}

function onlyCheck(steps: Ran[]): Ran {
  return last(steps);
}

function passes(steps: Ran[], expected: string, problems: string[]): void {
  const result = onlyCheck(steps);
  same(result.code, 0, 'the exit code', problems);
  same(result.stdout, expected, 'the standard output', problems);
  same(result.stderr, '', 'the standard error', problems);
}

function prScenarios(cell: Cell): Outcome[] {
  const clean = (o: Origin) => commit(o, CLEAN, '// a comment\n', 'a comment');
  const breach = (o: Origin) => breaching(o, 'a breach');
  const loosen = (o: Origin) => {
    const law = join(o.builder, LAW);
    writeFileSync(law, readFileSync(law, 'utf8').replace('        rules: [no-console]\n', '        rules: []\n'));
    breaching(o, 'a breach, and the rule off the type');
  };
  const comment = (o: Origin) => {
    commit(o, LAW, '# a note\n', 'a note in the law');
  };
  const against = 'against origin/main';
  const out: Outcome[] = [];
  out.push(pr(cell, 'a clean change', clean, (steps, _o, problems) => passes(steps, `lawcheck: PASS  1 changed file (${against})\n`.repeat(2), problems)));
  out.push(
    pr(cell, 'a breach fails the job', breach, (steps, o, problems) => {
      const result = last(steps);
      same(result.code, 1, 'the exit code', problems);
      const first = result.stdout.split('\n');
      same(first[0], `lawcheck: FAIL  1 error in 1 changed file (${against})`, 'the first line', problems);
      if (!first.includes(`${BREACH_FILE}:1  error[no-console]  ${NO_CONSOLE}`)) problems.push(`no finding line for ${BREACH_FILE} in ${result.stdout}`);
      same(result.stderr, '', 'the standard error', problems);
    }),
  );
  out.push(
    pr(cell, 'a breach and the rule taken off its type fails the second check, and the first one says so', loosen, (steps, _o, problems) => {
      const result = last(steps);
      same(result.code, 1, 'the exit code', problems);
      const found = result.stdout.split('\n');
      same(found[0], `lawcheck: PASS  2 changed files (${against})`, 'the first check passes', problems);
      if (!found.includes('note: this change edits the law that judges it: takes the rule no-console off the type library')) problems.push(`the law-change line is missing: ${result.stdout}`);
      if (!found.includes(`lawcheck: FAIL  1 error in 1 changed file (${against})`)) problems.push(`the check with the base's law did not fail: ${result.stdout}`);
    }),
  );
  out.push(
    pr(cell, 'a note in the law passes both checks', comment, (steps, _o, problems) => {
      const result = last(steps);
      same(result.code, 0, 'the exit code', problems);
      const found = result.stdout.split('\n');
      same(found.filter((line) => line.startsWith('lawcheck: PASS')).length, 2, 'the checks that passed', problems);
      if (!found.includes('note: this change edits the law that judges it: edits .lawcheck/law.yaml without changing a rule or a type')) problems.push(`the law-change line is missing: ${result.stdout}`);
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
        if (!result.stdout.includes('error[base-unreachable]')) problems.push(`no base-unreachable in ${result.stdout}`);
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
    commit(o, CLEAN, '// a comment\n', 'a comment');
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
      (steps, _o, problems) => passes(steps, `lawcheck: PASS  1 changed file (against ${before})\n`, problems),
    ),
  );
  out.push(
    pushed(
      cell,
      'a force-push that removed the commit before falls back to the parent',
      advance,
      () => 'b'.repeat(40),
      (steps, _o, problems) => passes(steps, `lawcheck: PASS  1 changed file (against ${parent})\n`, problems),
    ),
  );
  out.push(
    pushed(
      cell,
      'an all-zero before falls back to the parent',
      advance,
      () => zeros(),
      (steps, _o, problems) => passes(steps, `lawcheck: PASS  1 changed file (against ${parent})\n`, problems),
    ),
  );
  let files = 0;
  const root = (breach: boolean) => (o: Origin) => {
    branch(o, 'checkout', '-q', '--orphan', 'root');
    branch(o, 'rm', '-q', '-rf', 'src/core', 'tools');
    if (breach) {
      mkdirSync(join(o.builder, 'src', 'core'), { recursive: true });
      writeFileSync(join(o.builder, BREACH_FILE), BREACH);
    }
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
  const o = pullRequest(cell, (origin) => commit(origin, CLEAN, '// a comment\n', 'a comment'));
  const base = sha(o, 'main');
  const at = checkout(cell, o, 'pr-merge');
  const steps = runWorkflow(cell, at, { name: 'merge_group', mergeBase: base });
  installed(steps, problems);
  passes(steps, `lawcheck: PASS  1 changed file (against ${base})\n`.repeat(2), problems);
  return { name: `${cell.kind}: merge queue`, problems };
}

function hooks(cell: Cell): Outcome[] {
  const out: Outcome[] = [];
  const commitHook = () => {
    const problems: string[] = [];
    const o = newOrigin(cell);
    const at = checkout(cell, o, 'main', 0);
    const done = install(cell, at.dir);
    same(done.code, 0, 'the install', problems);
    writeHook(at.dir, 'pre-commit', example('pre-commit-hook'));
    writeFileSync(join(at.dir, BREACH_FILE), BREACH);
    const refused = run(at.dir, cell.env, 'git checkout -q -b topic && git add -A && git commit -qm breach');
    same(refused.code, 1, 'the commit with a breach', problems);
    if (!`${refused.stdout}${refused.stderr}`.includes(`${BREACH_FILE}:1  error[no-console]  ${NO_CONSOLE}`)) problems.push(`the hook did not report the breach: ${refused.stdout}${refused.stderr}`);
    if (`${refused.stdout}${refused.stderr}`.includes('not found')) problems.push(`the hook could not start Lawcheck: ${refused.stdout}${refused.stderr}`);
    const clean = run(at.dir, cell.env, `rm ${BREACH_FILE} && printf '// a comment\\n' >> ${CLEAN} && git commit -qam clean`);
    same(clean.code, 0, 'the clean commit', problems);
    same(`${clean.stdout}${clean.stderr}`, 'lawcheck: PASS  1 changed file (against origin/main)\n', 'the clean commit, what it printed', problems);
    return { name: `${cell.kind}: the pre-commit hook refuses a breach and lets a clean commit through`, problems };
  };
  const pushHook = () => {
    const problems: string[] = [];
    const o = newOrigin(cell);
    push(o, 'main');
    branch(o, 'push', '-q', 'origin', 'main:refs/heads/old');
    const at = checkout(cell, o, 'main', 0);
    const done = install(cell, at.dir);
    same(done.code, 0, 'the install', problems);
    writeHook(at.dir, 'pre-push', example('pre-push-hook'));
    const ok = run(at.dir, cell.env, `git checkout -q -b clean && printf '// a comment\\n' >> ${CLEAN} && git commit -qam clean && git push -q origin clean`);
    same(ok.code, 0, 'a clean push', problems);
    const breach = run(at.dir, cell.env, `git checkout -q -b breach && printf "${BREACH.trim()}\\n" >> ${BREACH_FILE} && git add -A && git commit -qm breach && git push -q origin breach`);
    same(breach.code, 1, 'a push with a breach', problems);
    if (!`${breach.stdout}${breach.stderr}`.includes('error[no-console]')) problems.push(`the pre-push hook did not report the breach: ${breach.stdout}${breach.stderr}`);
    const deleted = run(at.dir, cell.env, 'git push -q origin :refs/heads/old');
    same(deleted.code, 0, 'a push that deletes a branch, with the breach in the tree', problems);
    const tagged = run(at.dir, cell.env, 'git tag v1 && git push -q origin v1');
    same(tagged.code, 0, 'a push of a tag, with the breach in the tree', problems);
    return { name: `${cell.kind}: the pre-push hook refuses a breach, and a delete or a tag passes`, problems };
  };
  out.push(commitHook(), pushHook());
  return out;
}

export function scenarios(kind: Kind, tarball: string): Outcome[] {
  const cell = makeCell(kind, tarball);
  try {
    const out = [...prScenarios(cell), ...pushScenarios(cell)];
    if (kind === 'npm-lock') out.push(queue(cell), ...hooks(cell));
    return out;
  } finally {
    removeCell(cell);
  }
}
