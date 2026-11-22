import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../harness/sets.ts';
import { railProblems, runScenario, SCENARIO } from './docs-blocks.ts';
import type { PageFile } from './docs-blocks.ts';
import * as change from '../docs/change.ts';

const ids = (dir: string, end: string): string[] => readdirSync(join(ROOT, dir)).filter((name) => name.endsWith(end)).map((name) => name.slice(0, -end.length)).sort();

const PAGES: Record<string, string> = Object.fromEntries(ids('docs', '.md').map((id) => [id, readFileSync(join(ROOT, 'docs', `${id}.md`), 'utf8')]));
const load = async (id: string): Promise<PageFile> => (await import(pathToFileURL(join(ROOT, 'tests', 'docs', `${id}.ts`)).href)) as PageFile;
const FILES: Record<string, PageFile> = Object.fromEntries(await Promise.all(ids('tests/docs', '.ts').filter((id) => id !== 'README').map(async (id) => [id, await load(id)])));
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const source = (file: string): string | null => (file.startsWith('tests/') && existsSync(join(ROOT, file)) ? readFileSync(join(ROOT, file), 'utf8') : null);

test('test 430: every fenced block of every page of docs/ is claimed once, by the scenario of tests/docs/<page>.ts or by a test that exists, and every page has its file', () => {
  assert.deepEqual(railProblems(PAGES, FILES, source), []);
});

test('test 431: control, an unclaimed block, a claim of a block the page lacks, two blocks of one key, a claim by a test that does not exist, and a page or a file alone are each named', () => {
  const page = '# A\n\n## One\n\n```text\n$ lawcheck doctor\n```\n';
  const by = 'tests/contract/docs-examples.test.ts > test 430: every fenced block of every page of docs/ is claimed once, by the scenario of tests/docs/<page>.ts or by a test that exists, and every page has its file';
  const held = { claims: { 'block 1 under "One"': by } };
  assert.deepEqual(railProblems({ a: page }, { a: held }, source), []);
  assert.deepEqual(railProblems({ a: `${page}\n\`\`\`text\n$ lawcheck check\n\`\`\`\n` }, { a: held }, source), ['docs/a.md:9: block 2 under "One" is claimed by no scenario and no test']);
  assert.deepEqual(railProblems({ a: `${page}\n## One\n\n\`\`\`text\nx\n\`\`\`\n` }, { a: held }, source), ['docs/a.md:11: a second block is block 1 under "One", so no claim can tell the two apart']);
  assert.deepEqual(railProblems({ a: page }, { a: { claims: { ...held.claims, 'block 1 under "Two"': by } } }, source), ['tests/docs/a.ts claims block 1 under "Two", which docs/a.md does not have']);
  assert.deepEqual(railProblems({ a: page }, { a: { claims: { 'block 1 under "One"': by.replace('test 430', 'test 999') } } }, source), [`tests/docs/a.ts claims block 1 under "One" by a test tests/contract/docs-examples.test.ts does not hold: ${by.split(' > ')[1]!.replace('test 430', 'test 999')}`]);
  assert.deepEqual(railProblems({ a: page }, { a: { claims: { 'block 1 under "One"': 'tests/contract/nothing.test.ts > test 430: x' } } }, source), ['tests/docs/a.ts claims block 1 under "One" by "tests/contract/nothing.test.ts > test 430: x", which names no test file']);
  assert.deepEqual(railProblems({ a: page }, { a: { claims: { 'block 1 under "One"': SCENARIO } } }, source), ['tests/docs/a.ts claims block 1 under "One" for a scenario it does not export']);
  assert.deepEqual(railProblems({ a: page, b: page }, { a: held, c: held }, source), ['docs/b.md has no tests/docs/b.ts', 'tests/docs/c.ts names no page of docs/']);
});

test('test 740: every fenced block of README.md is claimed once, by the scenario of tests/docs/README.ts or by a test that exists, and the scenario runs the blocks it claims and shows each output as the tool prints it, byte for byte', async () => {
  const file = await load('README');
  assert.deepEqual(railProblems({ README }, { README: file }, source), []);
  assert.deepEqual(await runScenario('README', README, file), []);
});

// One test per page, so that each scenario has the budget of one test and a page added to docs/ takes nothing from the others.
for (const [id, file] of Object.entries(FILES)) {
  if (PAGES[id] === undefined || file.scenario === undefined) continue;
  test(`test 432: the scenario of docs/${id}.md runs the blocks it claims, and each output the page shows is the one the tool prints, byte for byte`, async () => {
    assert.deepEqual(await runScenario(id, PAGES[id]!, file), []);
  });
}

test('test 433: control, a planted wrong output fails the scenario of its page, and a scenario that never reads a block it claims, or reads one it does not, is named', async () => {
  const shown = 'takes the rule no-console off the type library';
  assert.ok(PAGES.change!.includes(shown));
  await assert.rejects(runScenario('change', PAGES.change!.replace(shown, 'takes the rule no-console off the type command'), change), { name: 'AssertionError', message: /the output does not hold the block/ });
  const page = '# A\n\n## One\n\n```text\nx\n```\n';
  assert.deepEqual(await runScenario('a', page, { claims: { 'block 1 under "One"': SCENARIO }, scenario: async () => {} }), ['the scenario of docs/a.md never reads block 1 under "One", which it claims']);
  await assert.rejects(runScenario('a', page, { claims: { 'block 1 under "One"': 'x > y' }, scenario: async (p) => void p.text('block 1 under "One"') }), /^Error: the scenario of docs\/a\.md reads block 1 under "One", which tests\/docs\/a\.ts does not claim for it$/);
});
