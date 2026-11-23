import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT } from '../harness/sets.ts';
import { apiImports, fingerprint, pilotOf, rowOf, summaryOf } from '../../film/pilot.mjs';

interface Row {
  id: string;
  arm: 'a' | 'b';
  complete: boolean;
  apiImports: string[];
  tests: { exit: number; fail: number };
  check: { exit: number; first: string } | null;
  versions: { lawcheck: string; plugin: unknown[] };
  record: string;
}

const pilot = JSON.parse(readFileSync(join(ROOT, 'film/pilot.json'), 'utf8')) as { summary: Record<string, { sessions: number; imported: number }>; sessions: Row[] };

function record(folder: string, files: Record<string, string>, take: object = {}): void {
  const all: Record<string, string> = { 'take.json': JSON.stringify({ id: 'x', arm: 'a', complete: true, changed: [], tests: {}, check: null, versions: {}, prompt: 'p', recorded: 'now', ...take }), ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
}

test('test 742: film/pilot.json gives 8 of 20 sessions without Lawcheck that imported src/api into src/core and 0 of 60 with the plugin, as the count of its own rows', () => {
  assert.deepEqual(pilot.summary, { a: { sessions: 20, imported: 8 }, b: { sessions: 60, imported: 0 } });
  assert.deepEqual(summaryOf(pilot.sessions), pilot.summary);
  assert.equal(pilot.sessions.filter((row) => row.arm === 'a' && row.apiImports.length > 0).length, 8);
  assert.equal(pilot.sessions.filter((row) => row.arm === 'b' && row.apiImports.length > 0).length, 0);
});

test('test 742: every row of film/pilot.json names a record by a hash of its own, ends its turn, passes its tests, and in the arm with the plugin ends in a passing check', () => {
  assert.equal(new Set(pilot.sessions.map((row) => row.id)).size, 80);
  assert.equal(new Set(pilot.sessions.map((row) => row.record)).size, 80);
  for (const row of pilot.sessions) {
    assert.match(row.record, /^[0-9a-f]{64}$/, row.id);
    assert.match(row.id, row.arm === 'a' ? /^a\d\d$/ : /^b\d\d$/);
    assert.ok(row.complete && row.tests.exit === 0 && row.tests.fail === 0, row.id);
    assert.equal(row.versions.lawcheck, '0.1.0-alpha.4', row.id);
    assert.equal(row.versions.plugin.length, row.arm === 'a' ? 0 : 1, row.id);
    if (row.arm === 'b') assert.ok(row.check !== null && row.check.exit === 0 && row.check.first.startsWith('lawcheck: PASS'), row.id);
    else assert.equal(row.check, null, row.id);
  }
});

test('test 742: a record is hashed by every file in it, and an import of src/api into src/core is found in each form and in no other place (control)', () => {
  const root = mkdtempSync(join(tmpdir(), 'lawcheck-pilot-'));
  try {
    const one = join(root, 'one');
    record(one, {
      'files/src/core/a.ts': 'import { x } from "../api/format.ts";\n',
      'files/src/core/b.ts': 'import {\n  y,\n} from "../../api";\nexport { z } from \'../api/z.ts\';\n',
      'files/src/core/c.ts': 'const m = await import("../api/m.ts");\nconst r = require("../api/r.js");\nimport "../api/side.ts";\n',
      'files/src/core/d.ts': 'import { fine } from "./money.ts";\nconst apiary = "../api/not-an-import.ts";\n',
      'files/src/api/e.ts': 'import { x } from "../core/a.ts";\n',
      'files/tests/f.test.ts': 'import { x } from "../src/api/format.ts";\n',
    });
    assert.deepEqual(apiImports(one), ['src/core/a.ts:1', 'src/core/b.ts:1', 'src/core/b.ts:4', 'src/core/c.ts:1', 'src/core/c.ts:2', 'src/core/c.ts:3']);
    const first = fingerprint(one);
    assert.match(first, /^[0-9a-f]{64}$/);
    writeFileSync(join(one, 'files/src/api/e.ts'), 'changed\n');
    assert.notEqual(fingerprint(one), first);
    writeFileSync(join(one, 'files/src/api/e.ts'), 'import { x } from "../core/a.ts";\n');
    assert.equal(fingerprint(one), first);
    writeFileSync(join(one, 'extra.txt'), '');
    assert.notEqual(fingerprint(one), first);
    assert.equal(rowOf(one).record, fingerprint(one));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('test 742: node film/pilot.mjs recounts a folder of records, says that film/pilot.json differs from the recount with exit 1, and refuses a missing folder with exit 2 (control)', () => {
  const root = mkdtempSync(join(tmpdir(), 'lawcheck-pilot-'));
  try {
    record(join(root, 'a01'), { 'files/src/core/a.ts': 'import { x } from "../api/format.ts";\n' }, { id: 'a01', arm: 'a' });
    record(join(root, 'b01'), { 'files/src/core/a.ts': 'export const x = 1;\n' }, { id: 'b01', arm: 'b' });
    assert.deepEqual(pilotOf(root).summary, { a: { sessions: 1, imported: 1 }, b: { sessions: 1, imported: 0 } });
    const run = spawnSync(process.execPath, [join(ROOT, 'film/pilot.mjs'), 'check', root], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stderr);
    assert.ok(run.stdout.includes('recount: arm a 1 of 1 imported src/api into src/core, arm b 0 of 1\nfilm/pilot.json differs from a recount of the records\n'), run.stdout);
    const usage = spawnSync(process.execPath, [join(ROOT, 'film/pilot.mjs'), 'check'], { encoding: 'utf8' });
    assert.equal(usage.status, 2);
    assert.ok(usage.stderr.startsWith('usage: node film/pilot.mjs'), usage.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
