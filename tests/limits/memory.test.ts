import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { availableNow, memoryCase, runBound, withCache } from '../../dist/limits.js';
import { setRule, withSample, write } from '../acceptance/helpers.ts';
import { errorLines, MiB, run } from './support.ts';

const GiB = 1024 * MiB;

test('test 276: R-83, the memory guard ends a run whose file grows by 384 MiB, a run past its bound, and one the system has no room left for, counting a cgroup\'s page cache and reclaimable slab as left', () => {
  const quiet = { rss: 200 * MiB, stepGrowth: 10 * MiB, available: 4 * GiB, total: 16 * GiB };
  assert.equal(memoryCase(quiet), null);
  assert.equal(memoryCase({ ...quiet, stepGrowth: 384 * MiB + 1 }), 'file');
  assert.equal(memoryCase({ ...quiet, stepGrowth: null, rss: 1536 * MiB + 1 }), 'run');
  assert.equal(memoryCase({ ...quiet, rss: 1536 * MiB }), null);
  assert.equal(runBound(GiB), 870 * MiB);
  assert.equal(memoryCase({ ...quiet, total: GiB, rss: 871 * MiB }), 'run');
  assert.equal(memoryCase({ ...quiet, available: 128 * MiB - 1 }), 'system');
  assert.equal(memoryCase({ ...quiet, available: 128 * MiB }), null);
  assert.equal(memoryCase({ ...quiet, available: null }), null);
  const stat = ['anon 10485760', 'file 1021313024', 'shmem 0', 'file_dirty 574619648', 'inactive_file 1021313024', 'active_file 0', 'slab_reclaimable 0', ''].join('\n');
  assert.equal(withCache(40 * MiB, stat, 16 * GiB), 1014 * MiB);
  assert.equal(memoryCase({ ...quiet, available: withCache(40 * MiB, stat, 16 * GiB) }), null);
  assert.equal(withCache(40 * MiB, stat, 100 * MiB), 100 * MiB);
  assert.equal(memoryCase({ ...quiet, available: withCache(40 * MiB, stat, 100 * MiB) }), 'system');
  assert.equal(withCache(40 * MiB, null, 16 * GiB), 40 * MiB);
  assert.equal(withCache(40 * MiB, 'file 1021313024\nshmem 1021313024\n', 16 * GiB), 40 * MiB);
  const runner = ['anon 583008256', 'file 133169152', 'kernel 357564416', 'shmem 0', 'inactive_file 133169152', 'active_file 0', 'slab_reclaimable 338690048', 'slab_unreclaimable 2097152', 'slab 339738624', ''].join('\n');
  assert.equal(withCache(0, runner, 14 * GiB), 450 * MiB);
  assert.equal(memoryCase({ ...quiet, available: withCache(0, runner, 14 * GiB) }), null);
  assert.equal(availableNow('darwin'), null);
  assert.equal(typeof availableNow('linux'), 'number');
});

test('R-79: the readings of a cgroup that charges slab, as the CI runner gives them, leave 450 MiB where only its page cache counted 127, and a kernel that charges no slab gives what the page cache alone gave', () => {
  const lines = ['anon 583008256', 'file 133169152', 'kernel 357564416', 'shmem 0', 'inactive_file 133169152', 'active_file 0', 'slab_reclaimable 338690048', 'slab_unreclaimable 2097152', 'slab 339738624', ''];
  const quiet = { rss: 200 * MiB, stepGrowth: 10 * MiB, available: 0, total: 16 * GiB };
  const withoutSlab = lines.filter((line) => !line.startsWith('slab_reclaimable')).join('\n');
  assert.equal(withCache(0, withoutSlab, 14 * GiB), 127 * MiB);
  assert.equal(memoryCase({ ...quiet, available: withCache(0, withoutSlab, 14 * GiB) }), 'system');
  assert.equal(withCache(0, lines.join('\n'), 14 * GiB), 450 * MiB);
  assert.equal(memoryCase({ ...quiet, available: withCache(0, lines.join('\n'), 14 * GiB) }), null);
  const nokmem = ['anon 583008256', 'file 133169152', 'kernel 0', 'shmem 0', 'inactive_file 133169152', 'active_file 0', 'slab_reclaimable 0', 'slab_unreclaimable 0', 'slab 0', ''].join('\n');
  assert.equal(withCache(0, nokmem, 14 * GiB), 127 * MiB);
  assert.equal(withCache(0, nokmem, 100 * MiB), 100 * MiB);
});

const csLaw = (s: string) => writeFileSync(join(s, '.lawcheck/law.yaml'), `${readFileSync(join(s, '.lawcheck/law.yaml'), 'utf8')}  cs:\n    paths: ["cs/app/**"]\n    may_use: [cs]\n`);

test('test 277: a file read only for what it declares that takes too much memory names the step the user can take', async () => {
  await withSample(
    async (s) => {
      let body = 'class C { void m() { int x = f(';
      while (body.length < 64 * 1024) body += 'a < b, ';
      write(s, 'cs/gen/Big.cs', body);
      write(s, 'cs/app/App.cs', 'class App { }\n');
      const result = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
      assert.equal(
        result.stdout,
        [
          'lawcheck: ERROR  1 error',
          '',
          'cs/gen/Big.cs  error[memory-too-large]  the run grew by more than the 384 MiB of memory one file may add while reading what cs/gen/Big.cs declares',
          '  why:  a run past its memory would be ended by the system',
          '',
          'next: keep cs/gen/Big.cs out of the files git lists here (git rm --cached, and a line in .gitignore), since Lawcheck reads it for what it declares, then run lawcheck check again',
          '',
        ].join('\n'),
      );
      assert.equal(result.code, 2);
    },
    { onMain: csLaw },
  );
});

test('R-108: a field of a finding that a rule piles up is never read, so the run holds none of it and ends with the rule\'s finding, not as memory-too-large', async () => {
  await withSample(async (s) => {
    setRule(s, 'no-console', "export function check() { return [{ message: 'm', pad: 'x'.repeat(530e6) }]; }\n");
    write(s, 'src/core/pad.ts', 'export const pad = 1;\n');
    const result = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
    assert.deepEqual(errorLines(result.stdout), ['src/core/pad.ts  error[no-console]  m']);
    assert.equal(result.code, 1);
  });
});
