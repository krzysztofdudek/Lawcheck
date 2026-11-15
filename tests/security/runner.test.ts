import { test } from 'node:test';
import { platformSkip } from '../harness/tool.ts';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import fc from 'fast-check';
import { check, findingLines, inTemp, makeSample, setRule } from '../acceptance/helpers.ts';
import { cases, REACH_SHARE, seed } from '../numbers.ts';

const RUNS = cases('tool');

const SECRET = 'SECRET-beside-the-root';

// A rule that tries each path outside the root and says what it got, then reads a file of its own root.
function reader(paths: string[]): string {
  return [
    "import { readFileSync } from 'node:fs';",
    `const PATHS = ${JSON.stringify(paths)};`,
    'export function check() {',
    "  const out = PATHS.map((path) => { try { return { message: 'read ' + readFileSync(path, 'utf8').trim() }; } catch (error) { return { message: 'denied ' + error.code }; } });",
    "  out.push({ message: 'own ' + readFileSync('README.md', 'utf8').split('\\n')[0] });",
    '  return out;',
    '}',
    '',
  ].join('\n');
}

// Node's permission model reads a * in a granted path as a wildcard over everything after it, and refuses a module path holding a backslash.
function unconfinable(root: string): boolean {
  return root.includes('*') || (sep === '/' && root.includes('\\'));
}

function plant(root: string): string[] {
  const outside = join(dirname(root), 'outside.txt');
  writeFileSync(outside, `${SECRET}\n`);
  const paths = [outside];
  const star = root.indexOf('*');
  if (star >= 0) {
    const sibling = `${root.slice(0, star)}zz-secret`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 's.txt'), `${SECRET}\n`);
    paths.push(join(sibling, 's.txt'));
  }
  return paths;
}

async function judged(parent: string): Promise<{ root: string; code: number | null; stdout: string }> {
  mkdirSync(parent, { recursive: true });
  const root = makeSample(parent);
  setRule(root, 'no-console', reader(plant(root)));
  writeFileSync(join(root, 'src/core/discount.ts'), 'export const d = 1;\n');
  const run = await check(root);
  return { root, code: run.code, stdout: run.stdout };
}

function assertConfined(result: { root: string; code: number | null; stdout: string }): void {
  assert.ok(!result.stdout.includes(SECRET), result.stdout);
  if (unconfinable(result.root)) {
    assert.equal(result.code, 2, result.stdout);
    assert.match(result.stdout, /^error\[path-unsupported\]  the root .* holds /m);
    return;
  }
  assert.equal(result.code, 1, result.stdout);
  const found = findingLines(result.stdout).map((line) => line.slice(line.indexOf('  error[no-console]  ') + '  error[no-console]  '.length));
  assert.deepEqual(found.filter((m) => m.startsWith('denied')), found.filter((m) => !m.startsWith('own')).map(() => 'denied ERR_ACCESS_DENIED'));
  assert.ok(found.includes('own # Sample'), result.stdout);
}

test('S8-4: a root whose path ends in * lets no rule read the folders beside it', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await inTemp(async (dir) => {
    const result = await judged(join(dir, 'zone*'));
    assertConfined(result);
    assert.equal(result.code, 2);
  });
});

test('S2-8: a root whose path holds a backslash is refused by name, not blamed on the rule', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await inTemp(async (dir) => {
    const result = await judged(join(dir, 'back\\slash'));
    assertConfined(result);
    assert.ok(!result.stdout.includes('rule-crashed'), result.stdout);
  });
});

const PIECES = ['a', 'b', '-', '*', ',', '\\', ' ', 'é', 'ż', '日本'];
// Windows refuses * and the backslash in a name, and a name that ends in a space or a dot.
const REFUSED = process.platform === 'win32' ? /[*\\]|[ .]$/ : /$^/;

test('I-runner-1: a rule reads nothing outside the root and the package at a root path holding *, a comma, a backslash, a space or non-ASCII (test 26, S8-4, S2-8)', async () => {
  const reach: Record<string, number> = { '*': 0, ',': 0, '\\': 0, ' ': 0, 'non-ASCII': 0 };
  let filtered = 0;
  await inTemp(async (dir) => {
    let index = 0;
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...PIECES), { minLength: 1, maxLength: 6 }), async (pieces) => {
        const name = pieces.join('');
        if (REFUSED.test(name)) {
          filtered++;
          return;
        }
        for (const mark of [',', ' ', '*', '\\']) if (name.includes(mark)) reach[mark]!++;
        if (/[^\x00-\x7f]/.test(name)) reach['non-ASCII']!++;
        assertConfined(await judged(join(dir, String(index++), name.trim() === '' ? `${name}x` : name)));
      }),
      { seed: seed(), numRuns: RUNS },
    );
  });
  if (filtered > 0) process.stdout.write(`# ${filtered} of ${RUNS} root names left out on ${process.platform}\n`);
  for (const [kind, count] of Object.entries(reach)) {
    if (REFUSED.test(kind)) continue;
    assert.ok(count >= RUNS * REACH_SHARE, `${kind}: ${count} of ${RUNS} cases`);
  }
});
