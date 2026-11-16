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
