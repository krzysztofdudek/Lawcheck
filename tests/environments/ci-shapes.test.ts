import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { D, D_PATH, findingLines, git, GIT_ENV, inTemp, lawcheck, LAW, makeSample, TEST4, write } from '../acceptance/helpers.ts';

const AGAINST_ORIGIN = TEST4.replace('(against main)', '(against origin/main)');
const CI = { CI: 'true' };

// The origin: S with D committed on work, and work pushed; a clone sees origin/main and origin/work.
function origin(dir: string): string {
  const s = makeSample(dir);
  write(s, D_PATH, D);
  git(s, 'add', '-A');
  git(s, 'commit', '-q', '-m', 'discount');
  return pathToFileURL(s).href;
}

// A depth-1 clone of work with no base: git 2.47 and newer record origin/HEAD even for a clone of one branch, and older git does not, so the test removes it.
function noBaseClone(dir: string): string {
  git(dir, 'clone', '-q', '--depth', '1', '--branch', 'work', origin(dir), 'clone');
  const clone = join(dir, 'clone');
  git(clone, 'update-ref', '--no-deref', '-d', 'refs/remotes/origin/HEAD');
  return clone;
}

function nextLine(stdout: string): string {
  return stdout.split('\n').find((line) => line.startsWith('next: '))?.slice('next: '.length) ?? '';
}

function errorLine(stdout: string): string {
  return stdout.split('\n').find((line) => line.startsWith('error[')) ?? '';
}

// The git command a next line names, run as it is written, in the clone.
function follow(next: string, cwd: string): void {
  const command = /(git fetch [^,()]+?) \(/.exec(next)?.[1];
  assert.ok(command !== undefined, `no git command in "${next}"`);
  const words = command.split(' ');
  execFileSync(words[0]!, words.slice(1), { cwd, env: GIT_ENV, stdio: 'ignore' });
}

const FETCH_ALL = 'fetch-depth: 0 in actions/checkout, GIT_DEPTH: 0 in GitLab CI, fetchDepth: 0 in Azure Pipelines';
const NO_BASE_IN_CI = [
  'lawcheck: ERROR  1 error',
  '',
  'error[base-unreachable]  no base in this CI job: no --base, no LAWCHECK_BASE and no origin/HEAD, and a plain check without one would count every file as changed',
  '  why:  without its base a change cannot be told from debt',
  '',
  `next: pass --base origin/<the branch the change goes into> or set LAWCHECK_BASE, with the history fetched (${FETCH_ALL}); or judge every file with lawcheck check --full`,
  '',
].join('\n');

test('S7-6: a depth-1 clone of a branch with no base fails every file outside CI, as the spec says, and a plain check refuses in CI with the ways out (question 87)', async () => {
  await inTemp(async (dir) => {
    const clone = noBaseClone(dir);
    const plain = await lawcheck(clone, ['check']);
    assert.equal(plain.stdout.split('\n')[0], 'lawcheck: FAIL  2 errors, 3 warnings in 9 files (no base: every file counts as changed), 1 waiver');
    assert.equal(plain.code, 1);
    const job = await lawcheck(clone, ['check'], CI);
    assert.equal(job.stdout, NO_BASE_IN_CI);
    assert.equal(job.stderr, '');
    assert.equal(job.code, 2);
    const json = JSON.parse((await lawcheck(clone, ['check', '--json'], CI)).stdout);
    assert.equal(json.schema, 'lawcheck-error/1');
    assert.equal(json.errors[0].code, 'base-unreachable');
    assert.deepEqual(json.next, { command: null, text: NO_BASE_IN_CI.split('\n')[5]!.slice('next: '.length) });
    assert.equal((await lawcheck(clone, ['check', './src/core/discount.ts'], CI)).code, 1, 'named files need no base');
  });
});

test('R-48: the clone of the no-base case has no origin/HEAD, whichever git made it, so the job is refused for its missing base', async () => {
  await inTemp(async (dir) => {
    const clone = noBaseClone(dir);
    assert.throws(() => execFileSync('git', ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { cwd: clone, env: GIT_ENV, stdio: 'ignore' }));
    const job = await lawcheck(clone, ['check'], CI);
    assert.equal(job.stdout, NO_BASE_IN_CI);
    assert.equal(job.code, 2);
  });
});

test('S7-6: --full needs no base, so it judges every file in CI as it does elsewhere', async () => {
  await inTemp(async (dir) => {
    const clone = noBaseClone(dir);
    const job = await lawcheck(clone, ['check', '--full'], CI);
    const outside = await lawcheck(clone, ['check', '--full']);
    assert.equal(job.stdout, outside.stdout);
    assert.equal(job.stdout.split('\n')[0], 'lawcheck: FAIL  2 errors, 3 warnings in 9 files (no base: every file counts as changed), 1 waiver');
    assert.equal(job.code, 1);
  });
});

test('S7-6: the variables of CI services count as CI, and CI set to an off word does not', async () => {
  await inTemp(async (dir) => {
    const clone = noBaseClone(dir);
    for (const env of [{ CI: '1' }, { CI: 'yes' }, { GITHUB_ACTIONS: 'true' }, { GITLAB_CI: 'true' }, { TF_BUILD: 'True' }, { JENKINS_URL: 'http://ci.example/' }, { BUILDKITE: 'true' }, { CIRCLECI: 'true' }]) {
      const run = await lawcheck(clone, ['check'], env);
      assert.equal(run.stdout, NO_BASE_IN_CI, JSON.stringify(env));
    }
    for (const env of [{ CI: '' }, { CI: '0' }, { CI: 'false' }, { CI: 'FALSE' }, { CI: 'no' }, { CI: 'off' }, { CI: 'off', GITHUB_ACTIONS: 'true' }, {}]) {
      const run = await lawcheck(clone, ['check'], env);
      assert.equal(run.code, 1, JSON.stringify(env));
      assert.match(run.stdout, /^lawcheck: FAIL  .*\(no base: every file counts as changed\)/, JSON.stringify(env));
    }
  });
});

test('S7-6: doctor agrees with check in a CI job with no base', async () => {
  await inTemp(async (dir) => {
    const run = await lawcheck(noBaseClone(dir), ['doctor'], CI);
    assert.ok(run.stdout.includes('\nfail  base  no base in this CI job: no --base, no LAWCHECK_BASE and no origin/HEAD, and a plain check without one would count every file as changed\n'), run.stdout);
    assert.equal(run.code, 2);
  });
});

test('S7-5: a depth-1 clone given its base names the shallow clone and the fetch that fixes it; that fetch gives the right result', async () => {
  await inTemp(async (dir) => {
    git(dir, 'clone', '-q', '--depth', '1', '--branch', 'work', origin(dir), 'clone');
    const clone = join(dir, 'clone');
    const run = await lawcheck(clone, ['check', '--base', 'origin/main'], CI);
    assert.equal(errorLine(run.stdout), "error[base-unreachable]  the base 'origin/main' names no commit here, and this clone is shallow");
    assert.equal(nextLine(run.stdout), `fetch the history: git fetch --unshallow origin +refs/heads/main:refs/remotes/origin/main (${FETCH_ALL}), then run lawcheck check`);
    assert.equal(run.code, 2);
    assert.equal(JSON.parse((await lawcheck(clone, ['check', '--base', 'origin/main', '--json'], CI)).stdout).next.command, 'git fetch --unshallow origin +refs/heads/main:refs/remotes/origin/main');
    follow(nextLine(run.stdout), clone);
    const again = await lawcheck(clone, ['check', '--base', 'origin/main'], CI);
    assert.equal(again.stdout, AGAINST_ORIGIN);
    assert.equal(again.code, 1);
  });
});

test('S7-5: the same clone with the base fetched at depth 1 names the shallow clone, and the fetch it names gives the right result', async () => {
  await inTemp(async (dir) => {
    git(dir, 'clone', '-q', '--depth', '1', '--branch', 'work', origin(dir), 'clone');
    const clone = join(dir, 'clone');
    git(clone, 'fetch', '-q', '--depth', '1', 'origin', '+refs/heads/main:refs/remotes/origin/main');
    const run = await lawcheck(clone, ['check', '--base', 'origin/main']);
    assert.equal(errorLine(run.stdout), "error[base-unreachable]  the base 'origin/main' shares no history with HEAD in this clone, which is shallow");
    assert.match(nextLine(run.stdout), /^fetch the history: git fetch --unshallow origin \+refs\/heads\/main:refs\/remotes\/origin\/main /);
    follow(nextLine(run.stdout), clone);
    assert.equal((await lawcheck(clone, ['check', '--base', 'origin/main'])).stdout, AGAINST_ORIGIN);
  });
});

test('S7-5: a single-branch clone whose history was fetched whole, with no base branch, names the fetch of that branch, and the fetch gives the right result', async () => {
  await inTemp(async (dir) => {
    git(dir, 'clone', '-q', '--depth', '1', '--branch', 'work', origin(dir), 'clone');
    const clone = join(dir, 'clone');
    git(clone, 'fetch', '-q', '--unshallow');
    const run = await lawcheck(clone, ['check', '--base', 'origin/main']);
    assert.equal(errorLine(run.stdout), "error[base-unreachable]  the base 'origin/main' names no commit here; this clone did not fetch that branch");
    assert.equal(nextLine(run.stdout), `fetch the branch: git fetch origin +refs/heads/main:refs/remotes/origin/main (${FETCH_ALL}), then run lawcheck check`);
    follow(nextLine(run.stdout), clone);
    assert.equal((await lawcheck(clone, ['check', '--base', 'origin/main'])).stdout, AGAINST_ORIGIN);
  });
});

test('S1-10: control, an unreachable base in a full clone keeps the plain sentence and next line', async () => {
  await inTemp(async (dir) => {
    git(dir, 'clone', '-q', '--branch', 'work', origin(dir), 'clone');
    const run = await lawcheck(join(dir, 'clone'), ['check', '--base', 'origin/nope']);
    assert.equal(errorLine(run.stdout), "error[base-unreachable]  the base 'origin/nope' names no commit here");
    assert.equal(nextLine(run.stdout), 'pass --base with a branch or a commit that exists here');
  });
});

test('test 208: a detached merge ref of a pull request, checked against its base, gives the change of the pull request', async () => {
  await inTemp(async (dir) => {
    const url = origin(dir);
    const s = join(dir, 's');
    git(s, 'checkout', '-q', 'main');
    git(s, 'merge', '-q', '--no-ff', '-m', 'merge work', 'work');
    git(s, 'update-ref', 'refs/pull/1/merge', 'HEAD');
    git(s, 'reset', '-q', '--hard', 'HEAD^');
    git(dir, 'clone', '-q', '--no-checkout', url, 'clone');
    const clone = join(dir, 'clone');
    git(clone, 'fetch', '-q', 'origin', '+refs/pull/1/merge:refs/remotes/pull/1/merge');
    git(clone, 'checkout', '-q', '--detach', 'refs/remotes/pull/1/merge');
    const run = await lawcheck(clone, ['check', '--base', 'origin/main']);
    assert.equal(run.stdout, AGAINST_ORIGIN);
    assert.equal(run.code, 1);
  });
});

test('test 209: a push with an empty base ref names the empty branch name, and a push of a new branch names the commit of zeros', async () => {
  await inTemp(async (dir) => {
    git(dir, 'clone', '-q', '--branch', 'work', origin(dir), 'clone');
    const clone = join(dir, 'clone');
    const empty = await lawcheck(clone, ['check', '--base', 'origin/']);
    assert.equal(errorLine(empty.stdout), "error[base-unreachable]  the base 'origin/' names no commit here: the branch name after the last / is empty, as when the variable that should hold it is empty");
    assert.equal(empty.code, 2);
    const zeros = '0'.repeat(40);
    const fresh = await lawcheck(clone, ['check', '--base', zeros]);
    assert.equal(errorLine(fresh.stdout), `error[base-unreachable]  the base '${zeros}' is git's commit of zeros, which a push of a new branch names as the commit before it`);
    assert.equal(nextLine(fresh.stdout), 'pass --base with the branch the new one was made from, such as origin/main, then run lawcheck check');
    assert.equal((await lawcheck(clone, ['check', '--base', 'origin/main'])).stdout, AGAINST_ORIGIN, 'the base the next line names');
  });
});

const BROAD = LAW.replace('paths: ["src/**/*.ts", "!src/**/*.d.ts"]\n    rules: [no-todo]', 'paths: ["**/*.ts", "!**/*.d.ts"]\n    rules: [no-todo, no-console]');

test('S7-7: a CI cache folder inside the project counts as changed code until the job excludes it, as docs/ci.md says', async () => {
  await inTemp(async (dir) => {
    assert.notEqual(BROAD, LAW);
    const s = makeSample(dir, { onMain: (repo) => write(repo, '.lawcheck/law.yaml', BROAD) });
    write(s, '.npm/_cacache/pkg/index.ts', "console.log('cached');\n");
    const counted = await lawcheck(s, ['check', '--base', 'main']);
    assert.deepEqual(findingLines(counted.stdout), ['.npm/_cacache/pkg/index.ts:1  error[no-console]  writes to the terminal with console.log']);
    assert.equal(counted.code, 1);
    mkdirSync(join(s, '.git', 'info'), { recursive: true });
    appendFileSync(join(s, '.git', 'info', 'exclude'), '.npm/\n');
    const excluded = await lawcheck(s, ['check', '--base', 'main']);
    assert.equal(excluded.stdout, 'lawcheck: PASS  nothing changed against main\n');
    assert.equal(excluded.code, 0);
  });
});
