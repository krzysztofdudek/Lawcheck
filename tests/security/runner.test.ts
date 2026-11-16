import { test } from 'node:test';
import { platformSkip } from '../harness/tool.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, sep } from 'node:path';
import fc from 'fast-check';
import { check, findingLines, inTemp, makeSample, setRule } from '../acceptance/helpers.ts';
import { cases, REACH_SHARE, seed } from '../numbers.ts';

const RUNS = cases('tool');

const SECRET = 'SECRET-beside-the-root';

// A rule that tries each path outside the root, as a file and as a SQLite database, and says what it got, then reads a file of its own root.
function reader(planted: Planted): string {
  return [
    "import { readFileSync } from 'node:fs';",
    `const PATHS = ${JSON.stringify(planted.paths)};`,
    `const DATABASES = ${JSON.stringify(planted.databases)};`,
    'export function check() {',
    "  const out = PATHS.map((path) => { try { return { message: 'read ' + readFileSync(path, 'utf8').trim() }; } catch (error) { return { message: 'denied ' + error.code }; } });",
    "  const sqlite = process.getBuiltinModule('node:sqlite');",
    "  for (const path of DATABASES) { if (sqlite === undefined) { out.push({ message: 'denied without node:sqlite' }); continue; } try { out.push({ message: 'read ' + new sqlite.DatabaseSync(path, { readOnly: true }).prepare('select v from c').get().v }); } catch (error) { out.push({ message: 'denied ' + error.code }); } }",
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

function database(path: string): string {
  const db = new DatabaseSync(path);
  db.exec('create table c(v text)');
  db.prepare('insert into c values (?)').run(SECRET);
  db.close();
  return path;
}

interface Planted {
  paths: string[];
  databases: string[];
}

function plant(root: string): Planted {
  const outside = join(dirname(root), 'outside.txt');
  writeFileSync(outside, `${SECRET}\n`);
  const paths = [outside];
  const databases = [database(join(dirname(root), 'outside.sqlite'))];
  const star = root.indexOf('*');
  if (star >= 0) {
    const sibling = `${root.slice(0, star)}zz-secret`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 's.txt'), `${SECRET}\n`);
    paths.push(join(sibling, 's.txt'));
  }
  return { paths, databases };
}

async function judged(parent: string): Promise<Judged> {
  mkdirSync(parent, { recursive: true });
  const root = makeSample(parent);
  const planted = plant(root);
  setRule(root, 'no-console', reader(planted));
  writeFileSync(join(root, 'src/core/discount.ts'), 'export const d = 1;\n');
  const run = await check(root);
  return { root, planted, code: run.code, stdout: run.stdout };
}

interface Judged {
  root: string;
  planted: Planted;
  code: number | null;
  stdout: string;
}

function assertConfined(result: Judged): void {
  assert.ok(!result.stdout.includes(SECRET), result.stdout);
  if (unconfinable(result.root)) {
    assert.equal(result.code, 2, result.stdout);
    assert.match(result.stdout, /^error\[path-unsupported\]  the root .* holds /m);
    return;
  }
  assert.equal(result.code, 1, result.stdout);
  const found = findingLines(result.stdout).map((line) => line.slice(line.indexOf('  error[no-console]  ') + '  error[no-console]  '.length));
  assert.deepEqual(found.filter((m) => !m.startsWith('own')), [...result.planted.paths.map(() => 'denied ERR_ACCESS_DENIED'), ...result.planted.databases.map(() => 'denied without node:sqlite')]);
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

const REFUSED_SQLITE = 'imports node:sqlite, and a rule may not';

// Each route by which a rule can reach node:sqlite, with the place of the refusal: the load, or the call on the judged file.
function sqliteRoutes(db: string, created: string): { route: string; rule: string; lib?: string; refused: string }[] {
  const read = `'read ' + new DatabaseSync(${JSON.stringify(db)}, { readOnly: true }).prepare('select v from c').get().v`;
  return [
    { route: 'a static import', rule: `import { DatabaseSync } from 'node:sqlite';\nexport function check() { return [{ message: ${read} }]; }\n`, refused: 'fails to load' },
    { route: 'a dynamic import', rule: `export async function check() { const { DatabaseSync } = await import('node:sqlite'); return [{ message: ${read} }]; }\n`, refused: 'throws on src/core/discount.ts' },
    { route: 'createRequire', rule: `import { createRequire } from 'node:module';\nexport function check() { const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite'); return [{ message: ${read} }]; }\n`, refused: 'throws on src/core/discount.ts' },
    {
      route: 'a helper under .lawcheck/rules/lib/',
      lib: `import { DatabaseSync } from 'node:sqlite';\nexport function value() { return ${read}; }\n`,
      rule: `import { value } from './lib/db.mjs';\nexport function check() { return [{ message: value() }]; }\n`,
      refused: 'fails to load',
    },
    {
      route: 'ATTACH from a database in memory',
      rule: `export async function check() { const { DatabaseSync } = await import('node:sqlite'); const d = new DatabaseSync(':memory:'); d.exec(${JSON.stringify(`ATTACH '${db.replace(/'/g, "''")}' AS x`)}); return [{ message: 'read ' + d.prepare('select v from x.c').get().v }]; }\n`,
      refused: 'throws on src/core/discount.ts',
    },
    {
      route: 'a write',
      rule: `export async function check() { const { DatabaseSync } = await import('node:sqlite'); new DatabaseSync(${JSON.stringify(created)}).exec('create table t(a)'); return [{ message: 'wrote' }]; }\n`,
      refused: 'throws on src/core/discount.ts',
    },
  ];
}

test('R-98: a rule reads no SQLite database outside the root and writes none through node:sqlite, by any route to the module', async () => {
  await inTemp(async (dir) => {
    const db = database(join(dir, 'cookies.sqlite'));
    const created = join(dir, 'created.sqlite');
    const s = makeSample(join(dir, 'repo'));
    writeFileSync(join(s, 'src/core/discount.ts'), 'export const d = 1;\n');
    for (const { route, rule, lib, refused } of sqliteRoutes(db, created)) {
      if (lib !== undefined) {
        mkdirSync(join(s, '.lawcheck/rules/lib'), { recursive: true });
        writeFileSync(join(s, '.lawcheck/rules/lib/db.mjs'), lib);
      }
      setRule(s, 'no-console', rule);
      const run = await check(s);
      assert.ok(!run.stdout.includes(SECRET) && !run.stderr.includes(SECRET), `${route}: ${run.stdout}`);
      assert.equal(run.code, 2, `${route}: ${run.stdout}`);
      assert.deepEqual(
        run.stdout.split('\n').filter((line) => line.includes('error[rule-crashed]')),
        [`.lawcheck/rules/no-console.mjs  error[rule-crashed]  ${refused}: ${REFUSED_SQLITE}`],
        route,
      );
      assert.ok(!existsSync(created), `${route}: ${created} was written`);
    }
    setRule(s, 'no-console', `export function check() { const sqlite = process.getBuiltinModule('node:sqlite'); return [{ message: sqlite === undefined ? 'no node:sqlite' : 'read ' + new sqlite.DatabaseSync(${JSON.stringify(db)}, { readOnly: true }).prepare('select v from c').get().v }]; }\n`);
    const run = await check(s);
    assert.equal(run.code, 1, run.stdout);
    assert.deepEqual(findingLines(run.stdout), ['src/core/discount.ts  error[no-console]  no node:sqlite']);
  });
});
