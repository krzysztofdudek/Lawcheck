import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { append, git, inTemp, lawcheck, makeSample } from '../acceptance/helpers.ts';

const HOOKS = ['pre-commit', 'post-index-change', 'reference-transaction', 'post-checkout', 'fsmonitor-watchman', 'pre-auto-gc', 'post-rewrite'];

function marker(dir: string, markers: string, name: string, body = 'cat'): string {
  const path = join(dir, `${name}.sh`);
  writeFileSync(path, `#!/bin/sh\ntouch "${markers}/${name}"\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
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
  git(repo, 'config', 'core.hooksPath', hooks);
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

test('S5-14: prime, explain, doctor and docs start no program that the repository names for git', async () => {
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

test('S5-14: init starts no program that the repository names for git', async () => {
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

test('S5-14: check and try start no program that the repository names for git, and still see the change', async () => {
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

test('S5-14: the fixture arms git: the same reads through git itself start the programs', async () => {
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
    const started = readdirSync(markers);
    for (const name of ['fsmonitor', 'clean', 'process']) assert.ok(started.includes(name), started.join(', '));
  });
});
