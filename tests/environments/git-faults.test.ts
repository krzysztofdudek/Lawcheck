import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { copySample, D, D_PATH, git, GIT_ENV, inTemp, lawcheck, makeSample, TEST4, write } from '../acceptance/helpers.ts';

function nextLine(stdout: string): string {
  return stdout.split('\n').find((line) => line.startsWith('next: ') || line.startsWith('  next: '))?.trim().slice('next: '.length) ?? '';
}

// git's own switch makes it treat every repository as owned by another user, the case a CI container meets; the nightly ownership test meets it with a real other user.
const OTHER_OWNER = { GIT_TEST_ASSUME_DIFFERENT_OWNER: '1' };

// The quoting of quoted() in src/files.ts, written again apart from it: a path in single quotes for a POSIX shell when it holds a character outside letters, digits, the underscore and @%+=:,./\\-.
function shellQuoted(path: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(path) ? path : `'${path.replace(/'/g, `'\\''`)}'`;
}

const SHELL: [string, string[]] = process.platform === 'win32' ? [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'), ['-c']] : ['sh', ['-c']];

test('S7-15: a repository owned by another user gives no-git with the safe.directory command of git, quoted for a POSIX shell, and that command run there lets check through', async () => {
  for (const folder of ['plain', 'my repo żółw', "it's here"]) {
    await inTemp(async (dir) => {
      mkdirSync(join(dir, folder));
      const s = makeSample(join(dir, folder));
      write(s, D_PATH, D);
      const config = join(dir, 'gitconfig');
      writeFileSync(config, '');
      const env = { ...OTHER_OWNER, GIT_CONFIG_GLOBAL: config };
      const run = await lawcheck(s, ['check', '--base', 'main'], env);
      const said = /^error\[no-git\]  git does not see a work tree here: fatal: detected dubious ownership in repository at '(.*)'$/m.exec(run.stdout);
      assert.ok(said !== null, run.stdout);
      const command = `git config --global --add safe.directory ${shellQuoted(said[1]!)}`;
      assert.equal(nextLine(run.stdout), `let git trust the repository: ${command}, then run lawcheck check`, folder);
      assert.equal(run.code, 2);
      const json = JSON.parse((await lawcheck(s, ['check', '--base', 'main', '--json'], env)).stdout);
      assert.equal(json.next.command, command);
      execFileSync(SHELL[0], [...SHELL[1], command], { cwd: dir, env: { ...GIT_ENV, ...env } });
      const again = await lawcheck(s, ['check', '--base', 'main'], env);
      assert.equal(again.stdout, TEST4, folder);
      assert.equal(again.code, 1);
    });
  }
});

test('S8-7: doctor and init in a repository owned by another user name the same command, worded for themselves', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    const doctor = await lawcheck(s, ['doctor'], OTHER_OWNER);
    assert.match(doctor.stdout, /\nfail  git  git does not see a work tree here: fatal: detected dubious ownership in repository at '/);
    assert.match(nextLine(doctor.stdout), /^let git trust the repository: git config --global --add safe\.directory .+, then run lawcheck doctor again$/);
    assert.equal(doctor.code, 2);
    const plain = join(dir, 'plain');
    git(dir, 'init', '-q', plain);
    const init = await lawcheck(plain, ['init'], OTHER_OWNER);
    assert.match(nextLine(init.stdout), /^let git trust the repository: git config --global --add safe\.directory .+, then run lawcheck init again$/);
    assert.equal(init.code, 2);
  });
});

test('R-1: a repository whose HEAD git cannot read gives no-git that sends the user to repair it, and the repair lets check through', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    write(s, D_PATH, D);
    writeFileSync(join(s, '.git', 'HEAD'), 'not a ref\n');
    const run = await lawcheck(s, ['check', '--base', 'main']);
    assert.match(run.stdout.split('\n')[2]!, /^error\[no-git\]  git does not see a work tree here: fatal: not a git repository/);
    assert.equal(nextLine(run.stdout), `repair the repository at ${s}, so that git status works there, then run lawcheck check`);
    assert.equal(run.code, 2);
    writeFileSync(join(s, '.git', 'HEAD'), 'ref: refs/heads/work\n');
    assert.equal((await lawcheck(s, ['check', '--base', 'main'])).stdout, TEST4);
  });
});

test('R-1: control, a folder outside any repository keeps the next line that sends the user to a work tree', async () => {
  await inTemp(async (dir) => {
    const copy = join(dir, 'copy');
    copySample(copy);
    const run = await lawcheck(copy, ['check']);
    assert.equal(nextLine(run.stdout), 'run lawcheck check inside a git work tree, with git on the PATH');
    assert.equal(run.code, 2);
  });
});

test('S1-10: a base taken from a dangling origin/HEAD says where it came from, and how to point origin/HEAD again', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    git(s, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/upstream/main');
    const run = await lawcheck(s, ['check']);
    assert.equal(run.stdout.split('\n')[2], "error[base-unreachable]  the base 'upstream/main', which origin/HEAD names, names no commit here");
    assert.equal(nextLine(run.stdout), 'pass --base with a branch or a commit that exists here, or point origin/HEAD at one with git remote set-head origin --auto');
    assert.equal(run.code, 2);
  });
});
