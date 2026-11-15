import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { D, D_PATH, inTemp, makeSample, ROOT, TEST4, write } from '../acceptance/helpers.ts';

// A user id no file of the folder belongs to, so git in the container sees the repository as another user's.
const OTHER_USER = '4321:4321';

// The command a container job runs, in node:24 as that user, with the repository and Lawcheck mounted read-only.
const SCRIPT = [
  'export HOME=/tmp/home GIT_CONFIG_NOSYSTEM=1',
  'mkdir -p $HOME',
  'cd /cell/s',
  'node /cell/pkg/dist/cli.js check --base main > /tmp/first.txt; echo "exit $?" >> /tmp/first.txt',
  "fix=$(sed -n 's/^next: let git trust the repository: \\(git config --global --add safe.directory [^,]*\\), then run lawcheck check$/\\1/p' /tmp/first.txt)",
  'echo "=== first"; cat /tmp/first.txt; echo "=== fix $fix"',
  '[ -n "$fix" ] && sh -c "$fix"',
  'echo "=== again"; node /cell/pkg/dist/cli.js check --base main; echo "exit $?"',
].join('\n');

test('S7-15: in a container whose user does not own the checkout, check names the safe.directory command, and that command lets it through (network)', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    write(s, D_PATH, D);
    mkdirSync(join(dir, 'pkg'));
    copyFileSync(join(ROOT, 'package.json'), join(dir, 'pkg', 'package.json'));
    for (const entry of ['dist', 'node_modules']) cpSync(join(ROOT, entry), join(dir, 'pkg', entry), { recursive: true, verbatimSymlinks: true });
    writeFileSync(join(dir, 'job.sh'), SCRIPT + '\n');
    // mkdtemp makes a folder only its owner may enter, and the other user must read it.
    chmodSync(dir, 0o755);
    const run = spawnSync('docker', ['run', '--rm', '--user', OTHER_USER, '-v', `${dir}:/cell:ro`, 'node:24', 'sh', '/cell/job.sh'], { encoding: 'utf8', maxBuffer: 1 << 26 });
    assert.equal(run.error, undefined, 'could not run: docker');
    const [first, again] = run.stdout.split(/^=== again\n/m);
    assert.match(first!, /^error\[no-git\]  git does not see a work tree here: fatal: detected dubious ownership in repository at '\/cell\/s'$/m, run.stdout + run.stderr);
    assert.match(first!, /^next: let git trust the repository: git config --global --add safe\.directory \/cell\/s, then run lawcheck check$/m);
    assert.match(first!, /^exit 2$/m);
    assert.equal(again, `${TEST4}exit 1\n`);
  });
});
