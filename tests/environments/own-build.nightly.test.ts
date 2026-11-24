import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { D, D_PATH, makeSample, write } from '../acceptance/helpers.ts';
import { installedLawcheck } from '../harness/fakes.ts';
import { fakeWrites } from '../harness/tool.ts';
import { json, nothing, Session, withBench } from '../acceptance/plugin-bench.ts';
import type { Bench } from '../acceptance/plugin-bench.ts';

const D_OUTPUT = [
  'lawcheck: FAIL  1 error, 1 warning in 1 named file, 1 waiver',
  '',
  'src/core/discount.ts:2  error[no-console]  writes to the terminal with console.log',
  '  why:  Only the command layer writes to the terminal.',
  'src/core/discount.ts:3  warning[no-todo]  TODO without an issue number',
  '  why:  A TODO without an issue number gets forgotten.',
  '',
  'next: fix src/core/discount.ts:2',
].join('\n');

// A repository that develops Lawcheck: its package.json names the build the repository makes as its lawcheck program, and no installed lawcheck is on the PATH.
function developing(bench: Bench, dir: string, runner: string): string {
  const s = makeSample(dir);
  bench.remove('lawcheck');
  write(s, '.lawcheck/config.yaml', `runner: ${runner}\n`);
  write(s, 'package.json', JSON.stringify({ name: 'lawcheck', version: '0.0.0', bin: { lawcheck: 'own-build.mjs' } }));
  const build = join(s, 'own-build.mjs');
  writeFileSync(build, [`#!${process.execPath}`, "import { appendFileSync } from 'node:fs';", "import { spawnSync } from 'node:child_process';", ...installedLawcheck(bench.logFile), '']. join('\n'));
  chmodSync(build, 0o755);
  write(s, D_PATH, D);
  return s;
}

// npx starts its program through sh, so the PATH of the run gains /usr/bin; npm keeps its cache and its log in the test's own folder, and Node writes no compile cache, so the run changes nothing else.
const quiet = (bench: Bench, dir: string): NodeJS.ProcessEnv => ({ PATH: `${bench.env().PATH}${delimiter}/usr/bin`, npm_config_cache: join(dir, 'npm-cache'), npm_config_update_notifier: 'false', NODE_DISABLE_COMPILE_CACHE: '1' });

test('R-36: with runner npx the plugin starts the build that the repository makes as its own lawcheck program, and with the default runner it finds no lawcheck', async () => {
  await withBench(async (bench, dir) => {
    fakeWrites(dir, ['npm-cache/']);
    const own = developing(bench, join(dir, 'own'), 'npx');
    json(
      await new Session(bench, own, 's1', quiet(bench, dir)).edit(D_PATH),
      { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `Lawcheck: after this edit, ${D_PATH} breaks the law of this repository. npx --no-install lawcheck check ./${D_PATH} printed:\n\n${D_OUTPUT}` } },
      'npx',
    );
    assert.deepEqual(bench.log(), [{ args: ['check', `./${D_PATH}`], cwd: own }]);
    bench.clearLog();
    const global = developing(bench, join(dir, 'global'), 'global');
    nothing(await new Session(bench, global, 's1', quiet(bench, dir)).edit(D_PATH), 'global');
    assert.deepEqual(bench.log(), []);
  });
});
