import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIT_ENV } from '../guard/fixture.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const ENTRY_POINTS: Array<{ file: string; args: string[]; usage: string }> = [
  { file: 'tests/guard/cli.ts', args: ['--bogus'], usage: 'usage: node tests/guard/cli.ts' },
  { file: 'tests/guard/from-base.ts', args: ['--bogus'], usage: 'usage: node tests/guard/from-base.ts' },
  { file: 'tests/guard/count.ts', args: ['--bogus'], usage: 'usage: node tests/guard/count.ts' },
  { file: 'tests/gate/run.ts', args: ['--bogus', 'x'], usage: 'usage: npm run gate' },
  { file: 'tests/gate/red-on-base.ts', args: ['--bogus', 'x'], usage: 'usage: node tests/gate/red-on-base.ts' },
  { file: 'tests/sabotage/run.ts', args: ['--bogus'], usage: 'usage: node tests/sabotage/run.ts' },
  { file: 'tests/harness/merge.ts', args: [], usage: 'usage: node tests/harness/merge.ts' },
  { file: 'tests/harness/shards.ts', args: [], usage: 'usage: node tests/harness/shards.ts' },
];

test('question 95: the suite guard, the gate, the sabotage run and the harness started through a linked folder refuse an argument they do not know with exit 2 and their usage line', () => {
  const outer = mkdtempSync(join(tmpdir(), 'lawcheck-entry-link-'));
  try {
    const link = join(outer, 'link');
    symlinkSync(join(ROOT, 'tests'), link, process.platform === 'win32' ? 'junction' : 'dir');
    for (const entry of ENTRY_POINTS) {
      const run = spawnSync(process.execPath, [join(link, entry.file.slice('tests/'.length)), ...entry.args], { cwd: ROOT, env: GIT_ENV, encoding: 'utf8' });
      assert.equal(run.status, 2, `${entry.file}: ${run.stdout}${run.stderr}`);
      assert.ok(run.stderr.includes(entry.usage), `${entry.file}: ${run.stderr}`);
    }
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

