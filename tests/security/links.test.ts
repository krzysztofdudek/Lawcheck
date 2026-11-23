import { test } from 'node:test';
import { platformSkip } from '../harness/tool.ts';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, findingLines, git, inTemp, lawcheck, makeR, makeSample, setRule, write } from '../acceptance/helpers.ts';
import { MiB, sparse, textHead } from '../limits/support.ts';

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

test('I-runner-1: a tracked link whose name holds a line break is not dropped from the guard', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await inTemp(async (dir) => {
    mkdirSync(join(dir, 'beside'));
    await refusedWith(makeSample(dir), 'out\nlink', join(dir, 'beside'));
  });
});

test('I-runner-1: a tracked link whose name is not valid UTF-8 is not dropped from the guard', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
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
    // git for Windows checks a link out as a plain file unless links are switched on; a clone that has them gets a real link.
    const checkedOut = join(s, 'libs', 'sub', 'out');
    if (!lstatSync(checkedOut).isSymbolicLink()) {
      rmSync(checkedOut, { recursive: true, force: true });
      symlinkSync(join(dir, 'beside'), checkedOut, 'dir');
    }
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

const COMPANION_LAW = [
  'lawcheck: 0.1.0',
  '',
  'rules:',
  '  no-console:',
  '    why: Only the command layer writes to the terminal.',
  '  no-todo:',
  '    why: A TODO without an issue number gets forgotten.',
  '  clear-errors:',
  '    why: An error a caller sees says what happened and what to do next.',
  '    companion: .lawcheck/rules/lib/spec-of.mjs',
  '',
  'types:',
  '  library:',
  '    about: Code the commands call.',
  '    paths: ["src/core/**"]',
  '    rules: [clear-errors]',
  '',
].join('\n');

// A companion that ran would return what it read through the link as a path, and the error about that path would print it.
const LEAKING_COMPANION = "import { readFileSync } from 'node:fs';\nexport function companion() { return [readFileSync('outside/marker.txt', 'utf8').trim()]; }\n";

test("I-runner-1: a reviewer rule's companion meets the link guard where no script rule runs: in the count of a full verdicts file, in explain and in a check of a file of the rule", async () => {
  await inTemp(async (dir) => {
    const outside = join(dir, 'beside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'marker.txt'), `${MARKER}\n`);
    const s = makeR(dir, {
      onMain: (repo) => {
        write(repo, '.lawcheck/law.yaml', COMPANION_LAW);
        write(repo, '.lawcheck/rules/lib/spec-of.mjs', LEAKING_COMPANION);
        symlinkSync(outside, join(repo, 'outside'), 'dir');
        sparse(repo, '.lawcheck/verdicts', textHead(''), 16 * MiB + 1);
      },
    });
    const refused = (name: string, result: { code: number | null; stdout: string }) => {
      assert.ok(!result.stdout.includes(MARKER), `${name}: ${result.stdout}`);
      assert.equal(result.code, 2, `${name}: ${result.stdout}`);
      assert.match(result.stdout, /^outside {2}error\[link-outside-root\] {2}the link leads to /m, `${name}: ${result.stdout}`);
    };
    refused('the count of a full verdicts file', await check(s));
    refused('explain', await lawcheck(s, ['explain', 'src/core/price.ts']));
    writeFileSync(join(s, 'src/core/price.ts'), 'export const p = 1;\n');
    refused('a check of a file of the rule', await check(s));
  });
});
