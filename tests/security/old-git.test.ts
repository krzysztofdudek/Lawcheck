import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, inTemp, lawcheck, makeSample } from '../acceptance/helpers.ts';
import { platformSkip } from '../harness/tool.ts';

// git 2.34, the oldest Lawcheck supports (docs/support.md), dies in ls-files when --recurse-submodules comes with any of these; a stand-in refuses the same and hands every other call to the real git.
const REFUSED_WITH_RECURSE = ['-s', '--stage', '-o', '--others', '-d', '--deleted', '-u', '--unmerged', '-k', '--killed', '-m', '--modified', '--resolve-undo', '--with-tree'];

function oldGit(dir: string): string {
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = join(dir, 'old-git');
  mkdirSync(bin);
  const refused = REFUSED_WITH_RECURSE.map((flag) => `${flag}|${flag}=*`).join('|');
  writeFileSync(
    join(bin, 'git'),
    [
      '#!/bin/sh',
      'ls=0; recurse=0; mode=0',
      'for a in "$@"; do case "$a" in ls-files) ls=1 ;; --recurse-submodules) recurse=1 ;; ' + refused + ') mode=1 ;; esac; done',
      'if [ $ls = 1 ] && [ $recurse = 1 ] && [ $mode = 1 ]; then echo "fatal: ls-files --recurse-submodules unsupported mode" >&2; exit 128; fi',
      `exec '${real}' "$@"`,
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'git'), 0o755);
  return bin;
}

test('I-git-2: a check of a repository with a submodule sends no git command that git 2.34 refuses, and its link guard still reads the submodule', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await inTemp(async (dir) => {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    mkdirSync(join(dir, 'beside'));
    git(sub, 'init', '-q', '-b', 'main');
    symlinkSync(join(dir, 'beside'), join(sub, 'out'), 'dir');
    git(sub, 'add', '-A');
    git(sub, 'commit', '-q', '-m', 'sub');
    const s = makeSample(dir);
    git(s, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'libs/sub');
    git(s, 'commit', '-q', '-m', 'a submodule');
    writeFileSync(join(s, 'src/core/discount.ts'), "console.log('d');\n");
    const env = { PATH: `${oldGit(dir)}:${process.env.PATH}` };
    const guarded = await lawcheck(s, ['check', '--base', 'main'], env);
    assert.equal(guarded.code, 2, guarded.stdout);
    assert.match(guarded.stdout, /^libs\/sub\/out {2}error\[link-outside-root\]/m, guarded.stdout);
    git(join(s, 'libs', 'sub'), 'rm', '-q', 'out');
    git(join(s, 'libs', 'sub'), 'commit', '-q', '-m', 'no link');
    const plain = await lawcheck(s, ['check', '--base', 'main'], env);
    assert.equal(plain.code, 1, plain.stdout);
    assert.ok(plain.stdout.includes('src/core/discount.ts:1  error[no-console]'), plain.stdout);
  });
});
