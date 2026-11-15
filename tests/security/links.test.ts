import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, findingLines, git, inTemp, makeSample, setRule } from '../acceptance/helpers.ts';

const MARKER = 'MARKER-beside-the-root';

// A rule that reads one file through the link and says what it got, then reads a file of its own root.
const READER = [
  "import { readFileSync } from 'node:fs';",
  'export function check() {',
  "  const out = [];",
  "  try { out.push({ message: 'read ' + readFileSync('outside/marker.txt', 'utf8').trim() }); } catch (error) { out.push({ message: 'denied ' + error.code }); }",
  "  out.push({ message: 'own ' + readFileSync('README.md', 'utf8').split('\\n')[0] });",
  '  return out;',
  '}',
  '',
].join('\n');

function linked(dir: string, tracked: boolean): string {
  const s = makeSample(dir);
  const outside = join(dir, 'beside');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'marker.txt'), `${MARKER}\n`);
  symlinkSync(outside, join(s, 'outside'), 'dir');
  setRule(s, 'no-console', READER);
  if (tracked) {
    git(s, 'add', 'outside');
    git(s, 'commit', '-q', '-m', 'a link');
  }
  writeFileSync(join(s, 'src/core/discount.ts'), 'export const d = 1;\n');
  return s;
}

test('I-runner-1: a tracked link that leads outside the root stops the run before any rule runs, naming the link', async () => {
  await inTemp(async (dir) => {
    const s = linked(dir, true);
    const run = await check(s);
    assert.ok(!run.stdout.includes(MARKER), run.stdout);
    assert.equal(run.code, 2, run.stdout);
    assert.match(run.stdout, /^outside {2}error\[link-outside-root\] {2}the link leads to .+, outside the git work tree/m);
  });
});

test('I-runner-1: an untracked link is the local user\'s own and does not stop the run', async () => {
  await inTemp(async (dir) => {
    const s = linked(dir, false);
    const run = await check(s);
    assert.equal(run.code, 1, run.stdout);
    assert.ok(findingLines(run.stdout).some((line) => line.endsWith('own # Sample')), run.stdout);
  });
});

test('I-runner-1: a tracked link that stays inside the root does not stop the run', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    symlinkSync(join(s, 'src'), join(s, 'source'), 'dir');
    git(s, 'add', 'source');
    git(s, 'commit', '-q', '-m', 'a link inside');
    writeFileSync(join(s, 'src/core/discount.ts'), "console.log('d');\n");
    const run = await check(s);
    assert.equal(run.code, 1, run.stdout);
    assert.ok(run.stdout.includes('src/core/discount.ts:1  error[no-console]'), run.stdout);
  });
});

// The threat is content that comes from git, which a pull request can carry: a tracked link under any name, in the root or in a submodule.
async function refusedWith(s: string, name: string | Buffer, target: string): Promise<void> {
  const linkPath = typeof name === 'string' ? join(s, name) : Buffer.concat([Buffer.from(s + '/'), name]);
  symlinkSync(target, linkPath, 'dir');
  git(s, 'add', '-A');
  git(s, 'commit', '-q', '-m', 'a link');
  writeFileSync(join(s, 'src/core/discount.ts'), 'export const d = 1;\n');
  const run = await check(s);
  assert.equal(run.code, 2, run.stdout);
  assert.match(run.stdout, /error\[link-outside-root\] {2}the link leads to /, run.stdout);
}

test('I-runner-1: a tracked link whose name holds a line break is not dropped from the guard', { skip: process.platform === 'win32' ? 'Windows refuses a line break in a name' : false }, async () => {
  await inTemp(async (dir) => {
    mkdirSync(join(dir, 'beside'));
    await refusedWith(makeSample(dir), 'out\nlink', join(dir, 'beside'));
  });
});

test('I-runner-1: a tracked link whose name is not valid UTF-8 is not dropped from the guard', { skip: process.platform === 'linux' ? false : 'only Linux takes a name that is not valid UTF-8' }, async () => {
  await inTemp(async (dir) => {
    mkdirSync(join(dir, 'beside'));
    await refusedWith(makeSample(dir), Buffer.from([0x6f, 0x75, 0x74, 0xff]), join(dir, 'beside'));
  });
});

test('I-runner-1: a link whose target only shares the beginning of the root path is outside it', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    mkdirSync(`${s}2`);
    await refusedWith(s, 'sibling', `${s}2`);
  });
});

test('I-runner-1: a tracked link inside a submodule that leads outside the root is refused', async () => {
  await inTemp(async (dir) => {
    const sub = join(dir, 'sub');
    mkdirSync(join(dir, 'beside'));
    mkdirSync(sub);
    git(sub, 'init', '-q', '-b', 'main');
    symlinkSync(join(dir, 'beside'), join(sub, 'out'), 'dir');
    git(sub, 'add', '-A');
    git(sub, 'commit', '-q', '-m', 'sub');
    const s = makeSample(dir);
    git(s, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub.split('\\').join('/'), 'libs/sub');
    git(s, 'commit', '-q', '-m', 'a submodule');
    writeFileSync(join(s, 'src/core/discount.ts'), 'export const d = 1;\n');
    const run = await check(s);
    assert.equal(run.code, 2, run.stdout);
    assert.match(run.stdout, /^libs\/sub\/out {2}error\[link-outside-root\]/m, run.stdout);
  });
});

test('I-runner-1: a tracked link that leads elsewhere inside the git work tree passes, with the law in a package below the top', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir, {
      under: 'pkg',
      top: (repo) => {
        writeFileSync(join(repo, 'LICENSE'), 'MIT\n');
        symlinkSync('../LICENSE', join(repo, 'pkg', 'LICENSE'));
      },
    });
    writeFileSync(join(s, 'pkg/src/core/discount.ts'), "console.log('d');\n");
    const run = await check(join(s, 'pkg'));
    assert.equal(run.code, 1, run.stdout);
    assert.ok(run.stdout.includes('src/core/discount.ts:1  error[no-console]'), run.stdout);
  });
});
