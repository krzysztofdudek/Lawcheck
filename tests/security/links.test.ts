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
    assert.match(run.stdout, /^outside {2}error\[link-outside-root\] {2}the link leads to .+ outside the root/m);
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
