import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRule } from '../../dist/rules.js';

test('test 247: S2-5, a rule still running when the time of the run is over is stopped and named rules-too-slow', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-test-')));
  try {
    const ruleFile = join(root, 'slow.mjs');
    writeFileSync(ruleFile, 'export function check() { return new Promise(() => {}); }\n');
    const controller = new AbortController();
    const started = Date.now();
    const timer = setTimeout(() => controller.abort(), 500);
    const outcome = await runRule({ root, rule: 'slow', ruleFile, files: [{ path: 'a.ts', type: null, text: '', lines: [] }], filesOf: new Map(), signal: controller.signal });
    clearTimeout(timer);
    assert.deepEqual(outcome, { slow: 'had not finished on a.ts when the script rules of this run passed the 600 seconds they may take together' });
    assert.ok(Date.now() - started < 10_000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
