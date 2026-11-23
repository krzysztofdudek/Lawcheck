import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRule } from '../../dist/rules.js';

function file(path: string, lines: string[]) {
  return { path, type: { id: 'source' }, rules: [], text: lines.join('\n') + '\n', lines } as never;
}

async function withRule(source: string, body: (root: string, ruleFile: string) => Promise<void>): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-runner-')));
  try {
    mkdirSync(join(root, '.lawcheck/rules'), { recursive: true });
    const ruleFile = join(root, '.lawcheck/rules/r.mjs');
    writeFileSync(ruleFile, source);
    await body(root, ruleFile);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const filesOf = new Map([['source', ['a.ts', 'b.ts']]]);

test('check-slice §3: the runner makes one call per file, in order, and passes repo.filesOf', async () => {
  await withRule(
    "export function check({ files, repo }) { return [{ message: files.length + ' ' + files[0].path + ' ' + files[0].type + ' ' + repo.filesOf('source').join(',') }]; }\n",
    async (root, ruleFile) => {
      const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x']), file('b.ts', ['y'])], filesOf });
      assert.deepEqual(outcome, {
        findings: [
          { rule: 'r', file: 'a.ts', message: '1 a.ts source a.ts,b.ts' },
          { rule: 'r', file: 'b.ts', message: '1 b.ts source a.ts,b.ts' },
        ],
      });
    },
  );
});

test('check-slice §3: a call past the time limit crashes the rule', async () => {
  await withRule('export function check() { while (true) {} }\n', async (root, ruleFile) => {
    const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf, timeoutMs: 1000 });
    assert.deepEqual(outcome, { crash: 'passes 1 seconds on a.ts' });
  });
});

test('check-slice §3: a load past the time limit crashes the rule', async () => {
  await withRule('await new Promise(() => {});\nexport function check() { return []; }\n', async (root, ruleFile) => {
    const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf, timeoutMs: 1000 });
    assert.deepEqual(outcome, { crash: 'passes 1 seconds in its load' });
  });
});

test('check-slice §3: a module that does not load', async () => {
  await withRule("import './missing.mjs';\nexport function check() { return []; }\n", async (root, ruleFile) => {
    const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf });
    assert.ok('crash' in outcome && outcome.crash.startsWith('fails to load: '), JSON.stringify(outcome));
  });
});

test('check-slice §3: process.env is empty in a rule, and an unknown type throws', async () => {
  await withRule(
    "export function check() { return [{ message: Object.keys(process.env).length + '' }]; }\n",
    async (root, ruleFile) => {
      const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf });
      assert.deepEqual(outcome, { findings: [{ rule: 'r', file: 'a.ts', message: '0' }] });
    },
  );
  await withRule("export function check({ repo }) { return repo.filesOf('nope'); }\n", async (root, ruleFile) => {
    const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf });
    assert.deepEqual(outcome, { crash: "throws on a.ts: unknown type 'nope'" });
  });
});

test('check-slice §3: the time limit holds for the load and for each call, not for the rule as a whole', async () => {
  await withRule(
    'const wait = () => new Promise((done) => setTimeout(done, 700));\nawait wait();\nexport async function check({ files }) { await wait(); return [{ message: files[0].path }]; }\n',
    async (root, ruleFile) => {
      const files = [file('a.ts', ['x']), file('b.ts', ['y']), file('c.ts', ['z'])];
      const outcome = await runRule({ root, rule: 'r', ruleFile, files, filesOf, timeoutMs: 1000 });
      assert.deepEqual(outcome, {
        findings: [
          { rule: 'r', file: 'a.ts', message: 'a.ts' },
          { rule: 'r', file: 'b.ts', message: 'b.ts' },
          { rule: 'r', file: 'c.ts', message: 'c.ts' },
        ],
      });
    },
  );
});

function serving(answer: (what: string, path: string) => unknown, waitMs = 0) {
  const asked: string[] = [];
  const serve = async (what: 'tree' | 'uses', asking: { path: string }) => {
    asked.push(`${what} ${asking.path}`);
    if (waitMs > 0) await new Promise((done) => setTimeout(done, waitMs));
    return answer(what, asking.path) as never;
  };
  return { asked, serve };
}

const FLAT = { language: 'typescript', tree: { types: ['program', 'identifier'], fields: ['name'], nodes: Int32Array.of(-1, 0, -1, 1, 0, 2, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0) }, absent: null };

test('test 773: a rule that does not ask for the tree or the uses makes the tool read neither', async () => {
  await withRule("export function check({ files }) { return [{ message: typeof files[0].tree + ' ' + typeof files[0].uses }]; }\n", async (root, ruleFile) => {
    const { asked, serve } = serving(() => FLAT);
    const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x']), file('b.ts', ['y'])], filesOf, serve });
    assert.deepEqual(outcome, { findings: [{ rule: 'r', file: 'a.ts', message: 'function function' }, { rule: 'r', file: 'b.ts', message: 'function function' }] });
    assert.deepEqual(asked, []);
  });
});

test('test 773: tree() and uses() ask the tool once per call, for the file of that call, and a tree arrives as nested nodes', async () => {
  await withRule(
    'export async function check({ files: [file] }) {\n  const [one, two, uses] = await Promise.all([file.tree(), file.tree(), file.uses()]);\n  return [{ message: (one === two) + " " + JSON.stringify(one) + " " + JSON.stringify(uses) }];\n}\n',
    async (root, ruleFile) => {
      const { asked, serve } = serving((what) => (what === 'tree' ? FLAT : { uses: [], absent: null }));
      const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x']), file('b.ts', ['y'])], filesOf, serve });
      const tree = { language: 'typescript', root: { type: 'program', named: true, field: null, start: 0, end: 2, line: 1, column: 0, children: [{ type: 'identifier', named: true, field: 'name', start: 0, end: 1, line: 1, column: 0, children: [] }] }, absent: null };
      const message = `true ${JSON.stringify(tree)} {"uses":[],"absent":null}`;
      assert.deepEqual(outcome, { findings: [{ rule: 'r', file: 'a.ts', message }, { rule: 'r', file: 'b.ts', message }] });
      assert.deepEqual(asked, ['tree a.ts', 'uses a.ts', 'tree b.ts', 'uses b.ts']);
    },
  );
});

test('test 773: the time the tool takes to read what a rule asks for does not count toward the time of the call', async () => {
  await withRule('export async function check({ files: [file] }) { const tree = await file.tree(); return [{ message: tree.absent }]; }\n', async (root, ruleFile) => {
    const { serve } = serving(() => ({ language: null, tree: null, absent: 'no-reader' }), 1500);
    const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf, timeoutMs: 1000, serve });
    assert.deepEqual(outcome, { findings: [{ rule: 'r', file: 'a.ts', message: 'no-reader' }] });
  });
});

test('test 773: a file kept from an earlier call answers tree() with an error, and the tool is not asked', async () => {
  await withRule(
    'let last = null;\nexport async function check({ files: [file] }) {\n  const before = last;\n  last = file;\n  if (before === null) return [];\n  try { await before.tree(); return []; } catch (error) { return [{ message: error.message }]; }\n}\n',
    async (root, ruleFile) => {
      const { asked, serve } = serving(() => FLAT);
      const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x']), file('b.ts', ['y'])], filesOf, serve });
      assert.deepEqual(outcome, { findings: [{ rule: 'r', file: 'b.ts', message: 'tree() was called after its call of check ended' }] });
      assert.deepEqual(asked, []);
    },
  );
});

test("R-119: a rule that asks the tool again through the channel for what its call already asked crashes as that rule, and the tool reads once", async () => {
  await withRule(
    "export async function check({ files: [file] }) {\n  await file.tree();\n  process._send({ kind: 'ask', id: -1, what: 'tree' }, undefined, {}, () => {});\n  return new Promise(() => {});\n}\n",
    async (root, ruleFile) => {
      const { asked, serve } = serving(() => FLAT);
      const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf, timeoutMs: 5000, serve });
      assert.deepEqual(outcome, { crash: "writes to the runner's channel on a.ts" });
      assert.deepEqual(asked, ['tree a.ts']);
    },
  );
});
