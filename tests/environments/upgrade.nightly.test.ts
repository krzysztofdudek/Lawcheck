import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withFake } from '../acceptance/fake-reviewer.ts';
import { CLI, F, F_PATH, F_PRIME, git, GIT_ENV, inTemp, LANGUAGES_SAMPLE, lawcheckAt, makeR, read, write } from '../acceptance/helpers.ts';

const FAILING_PATH = 'src/core/charge.ts';
const NAMED = ['cs/domain/Order.cs', 'java/src/main/java/com/acme/domain/Order.java', 'kotlin/src/main/kotlin/com/acme/k/domain/Order.kt', 'ruby/domain/order.rb', 'rust/src/domain/mod.rs'];

// The release before the candidate is the version npm calls latest: every alpha and every stable release moves that tag (the job publish of release.yml), and the release gate runs before the candidate is published.
function installPrevious(dir: string): { cli: string; version: string } {
  const prefix = join(dir, 'previous');
  execFileSync('npm', ['install', '--prefix', prefix, '--no-audit', '--no-fund', 'lawcheck@latest'], {
    env: { ...GIT_ENV, npm_config_cache: join(dir, 'npm-cache'), npm_config_update_notifier: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const home = join(prefix, 'node_modules', 'lawcheck');
  return { cli: join(home, 'dist', 'cli.js'), version: (JSON.parse(readFileSync(join(home, 'package.json'), 'utf8')) as { version: string }).version };
}

// A repository with a reviewer rule: one file that passes it and one that fails it.
function reviewed(dir: string): string {
  const r = makeR(dir);
  write(r, F_PATH, F_PRIME);
  write(r, FAILING_PATH, F);
  return r;
}

// A repository with files of the five languages whose declarations the reader cache keeps.
function languages(dir: string): string {
  const repo = join(dir, 'l');
  cpSync(LANGUAGES_SAMPLE, repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'l');
  git(repo, 'checkout', '-q', '-b', 'work');
  return repo;
}

const list = (folder: string): string[] => (existsSync(folder) ? readdirSync(folder).sort() : []);

test('test 1395: the candidate reads what the release before it left in a repository: its passes and its kept failure cost no reviewer call, and its reader cache changes no output (network)', async (t) => {
  await inTemp(async (dir) => {
    const previous = installPrevious(dir);
    t.diagnostic(`the release before the candidate: lawcheck ${previous.version}`);

    await withFake(async (fake) => {
      const review = (cli: string, repo: string) => lawcheckAt(cli, repo, ['check', '--review', '--base', 'main'], { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
      const worked = reviewed(join(dir, 'worked'));
      const before = await review(previous.cli, worked);
      assert.equal(before.code, 1, before.stdout);
      assert.equal(fake.requests.length, 2, 'the release before asks about both files');
      const passes = read(worked, '.lawcheck/verdicts');
      assert.equal(passes.split('\n').filter((line) => line !== '').length, 1, passes);
      const failures = list(join(worked, '.lawcheck/.local/failures'));
      assert.equal(failures.length, 1, 'the release before keeps the failure');

      const after = await review(CLI, worked);
      assert.equal(fake.requests.length, 2, `the candidate asked the reviewer again:\n${after.stdout}`);
      assert.equal(read(worked, '.lawcheck/verdicts'), passes);
      assert.deepEqual(list(join(worked, '.lawcheck/.local/failures')), failures);

      // The same repository with nothing of the release before in it: the candidate asks for itself, and its second run is the one to compare with.
      const fresh = reviewed(join(dir, 'fresh'));
      await review(CLI, fresh);
      assert.equal(fake.requests.length, 4);
      const alone = await review(CLI, fresh);
      assert.deepEqual([after.code, after.stdout], [alone.code, alone.stdout]);
      assert.equal(read(fresh, '.lawcheck/verdicts'), passes, 'the candidate writes a pass as the release before wrote it');
    });

    const uses = ['check', ...NAMED, '--json'];
    const worked = languages(join(dir, 'worked-uses'));
    const before = await lawcheckAt(previous.cli, worked, uses);
    assert.equal(before.code, 1, before.stdout);
    assert.deepEqual(list(join(worked, '.lawcheck/.local/readers')), ['csharp', 'jvm', 'ruby', 'rust'], 'the release before leaves its reader cache');
    const after = await lawcheckAt(CLI, worked, uses);
    const alone = await lawcheckAt(CLI, languages(join(dir, 'fresh-uses')), uses);
    assert.deepEqual([after.code, after.stdout], [alone.code, alone.stdout]);
  });
});
