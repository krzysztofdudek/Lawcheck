import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { append, git, inTemp, lawcheck, makeSample } from '../acceptance/helpers.ts';

const CHANGE_PAGE = readFileSync(new URL('../../docs/change.md', import.meta.url), 'utf8');

const HOOKS = ['pre-commit', 'post-index-change', 'reference-transaction', 'post-checkout', 'fsmonitor-watchman', 'pre-auto-gc', 'post-rewrite'];

// git for Windows runs these programs through its sh, which reads a backslash as an escape, so each path is given with forward slashes.
const slashed = (path: string) => path.split('\\').join('/');

function marker(dir: string, markers: string, name: string, body = 'cat'): string {
  const path = join(dir, `${name}.sh`);
  writeFileSync(path, `#!/bin/sh\n: > "${slashed(markers)}/${name}"\n${body}\n`);
  chmodSync(path, 0o755);
  return slashed(path);
}

// Every way a repository's own git config and attributes name a program that git starts while it reads.
function arm(repo: string, dir: string): string {
  const markers = join(dir, 'markers');
  const scripts = join(dir, 'scripts');
  const hooks = join(dir, 'hooks');
  mkdirSync(markers, { recursive: true });
  mkdirSync(scripts, { recursive: true });
  mkdirSync(hooks, { recursive: true });
  for (const hook of HOOKS) marker(hooks, markers, hook, 'exit 0');
  git(repo, 'config', 'core.fsmonitor', marker(scripts, markers, 'fsmonitor', 'exit 1'));
  git(repo, 'config', 'core.hooksPath', slashed(hooks));
  git(repo, 'config', 'diff.external', marker(scripts, markers, 'external'));
  git(repo, 'config', 'diff.conv.textconv', marker(scripts, markers, 'textconv'));
  git(repo, 'config', 'filter.clean-it.clean', marker(scripts, markers, 'clean'));
  git(repo, 'config', 'filter.clean-it.smudge', marker(scripts, markers, 'smudge'));
  git(repo, 'config', 'filter.clean-it.required', 'true');
  git(repo, 'config', 'filter.by.process.process', marker(scripts, markers, 'process', 'exit 1'));
  git(repo, 'config', 'filter.by.process.required', 'false');
  writeFileSync(join(repo, '.git', 'info', 'attributes'), '*.ts diff=conv filter=clean-it\n*.mjs diff=conv filter=by.process\n*.md diff=conv filter=clean-it\n');
  return markers;
}

// git hashes a file again, and so runs its clean filter, when the file's time no longer matches the index.
function stale(repo: string, markers: string): void {
  const past = new Date(Date.now() - 3600_000);
  for (const path of git(repo, 'ls-files').split('\n').filter(Boolean)) utimesSync(join(repo, path), past, past);
  clear(markers);
}

function clear(markers: string): void {
  rmSync(markers, { recursive: true, force: true });
  mkdirSync(markers);
}

const COMMANDS = [['prime'], ['explain', 'src/core/price.ts'], ['explain', 'src'], ['doctor'], ['doctor', '--json'], ['docs', 'law'], ['docs']];

test('S5-14: prime, explain, doctor and docs start no program that the repository names for git (I-git-1)', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    append(s, 'src/core/price.ts', '// edited\n');
    writeFileSync(join(s, 'src/core/new.ts'), 'export const n = 1;\n');
    const markers = arm(s, dir);
    stale(s, markers);
    for (const args of COMMANDS) {
      const run = await lawcheck(s, args);
      assert.deepEqual(readdirSync(markers), [], `${args.join(' ')} started: ${readdirSync(markers).join(', ')}\n${run.stdout}${run.stderr}`);
      assert.ok(!run.stdout.includes('error[internal]'), run.stdout);
    }
  });
});

test('S5-14: init starts no program that the repository names for git (I-git-1)', async () => {
  await inTemp(async (dir) => {
    const repo = join(dir, 'fresh');
    mkdirSync(join(repo, 'src'), { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'one');
    const markers = arm(repo, dir);
    stale(repo, markers);
    const run = await lawcheck(repo, ['init']);
    assert.equal(run.code, 0, run.stdout);
    assert.deepEqual(readdirSync(markers), []);
  });
});

test('R-22: S5-14, check and try start no program that the repository names for git, and still see the change (I-git-1)', async () => {
  assert.ok(CHANGE_PAGE.includes('Git reads some files through a filter, such as the files of Git LFS. Lawcheck compares such a file as its bytes on disk.'));
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    writeFileSync(join(s, 'src/core/discount.ts'), "export const d = 1;\nconsole.log('d');\n");
    const markers = arm(s, dir);
    stale(s, markers);
    const run = await lawcheck(s, ['check', '--base', 'main']);
    assert.deepEqual(readdirSync(markers), []);
    assert.equal(run.code, 1, run.stdout);
    assert.ok(run.stdout.includes('src/core/discount.ts:2  error[no-console]'), run.stdout);
    const tried = await lawcheck(s, ['try', 'no-console', 'src/core/discount.ts']);
    assert.equal(tried.code, 1, tried.stdout);
    assert.deepEqual(readdirSync(markers), []);
  });
});

test('R-21: S5-14, the fixture arms git: the same reads through git itself start the programs', async () => {
  assert.ok(CHANGE_PAGE.includes('Settings you pass to git yourself, through `GIT_CONFIG_PARAMETERS` or `git -c` in an alias, take effect. If one of your own settings names a program, git starts that program.'));
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    append(s, 'src/core/price.ts', '// edited\n');
    const markers = arm(s, dir);
    stale(s, markers);
    try {
      git(s, 'diff', '--name-only', 'main', '--');
    } catch {
      // A required filter that fails makes git fail; the marker is what counts.
    }
    try {
      git(s, 'status', '--porcelain');
    } catch {
      // As above.
    }
    // Whether diff hashes a file again, and so runs its clean filter, depends on git's version and on time; hash-object always does.
    try {
      git(s, 'hash-object', 'src/core/price.ts');
    } catch {
      // As above.
    }
    const started = readdirSync(markers);
    for (const name of ['fsmonitor', 'clean', 'process']) assert.ok(started.includes(name), started.join(', '));
  });
});

test('S5-14: a submodule whose own config names a filter starts nothing during check, explain and doctor (I-git-1)', async () => {
  await inTemp(async (dir) => {
    const markers = join(dir, 'markers');
    mkdirSync(markers, { recursive: true });
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    git(sub, 'init', '-q', '-b', 'main');
    writeFileSync(join(sub, 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(sub, '.gitattributes'), '*.ts filter=mark\n');
    git(sub, 'add', '-A');
    git(sub, 'commit', '-q', '-m', 'sub');
    const s = makeSample(dir);
    git(s, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', slashed(sub), 'libs/sub');
    git(s, 'commit', '-q', '-m', 'a submodule');
    const inner = join(s, 'libs', 'sub');
    mkdirSync(join(dir, 'scripts-sub'));
    git(inner, 'config', 'filter.mark.clean', marker(join(dir, 'scripts-sub'), markers, 'submodule-clean'));
    writeFileSync(join(inner, 'a.ts'), 'export const a = 2;\n');
    stale(inner, markers);
    writeFileSync(join(s, 'src/core/discount.ts'), "console.log('d');\n");
    for (const args of [['check', '--base', 'main'], ['explain', 'libs/sub/a.ts'], ['doctor']]) {
      const run = await lawcheck(s, args);
      assert.ok(!run.stdout.includes('error[internal]'), `${args.join(' ')}: ${run.stdout}`);
      assert.deepEqual(readdirSync(markers), [], args.join(' '));
    }
    git(inner, 'status', '--porcelain');
    assert.deepEqual(readdirSync(markers), ['submodule-clean'], 'the control: git itself runs the filter of the submodule');
  });
});

test('R-46: harness-7, check leaves the index as it was when the times of its files no longer match it', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    writeFileSync(join(s, 'src/core/discount.ts'), "console.log('d');\n");
    const past = new Date(Date.now() - 3600_000);
    for (const path of git(s, 'ls-files').split('\n').filter(Boolean)) utimesSync(join(s, path), past, past);
    const run = await lawcheck(s, ['check', '--base', 'main']);
    assert.equal(run.code, 1, run.stdout);
    assert.ok(run.stdout.includes('src/core/discount.ts:1  error[no-console]'), run.stdout);
  });
});
