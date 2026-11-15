import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lawcheck, withSample } from '../acceptance/helpers.ts';

const SECRET = 'CANARY-7f3a9c';
// One-line files a link may point at: a token, a token after a key, a list item, and text that does not parse.
const SECRETS = [SECRET, `token: ${SECRET}`, `${SECRET}: x`, `reviewer: ${SECRET}`, `- ${SECRET}`, `"${SECRET}`, `reviewer:\n  provider: ${SECRET}`];
const COMMANDS = [['check', '--base', 'main'], ['check', '--base', 'main', '--json'], ['doctor'], ['doctor', '--json'], ['prime'], ['explain', 'src/core/price.ts'], ['try', 'no-todo', 'src/core/price.ts']];

async function shows(s: string): Promise<string[]> {
  const shown: string[] = [];
  for (const args of COMMANDS) {
    const run = await lawcheck(s, args);
    if ((run.stdout + run.stderr).includes(SECRET.slice(0, 6))) shown.push(`${args.join(' ')}: ${run.stdout}${run.stderr}`);
  }
  return shown;
}

for (const file of ['config.yaml', 'law.yaml']) {
  test(`S5-15: a .lawcheck/${file} linked to a one-line secret shows none of it`, async () => {
    await withSample(async (s, dir) => {
      for (const secret of SECRETS) {
        writeFileSync(join(dir, 'secret.txt'), secret + '\n');
        rmSync(join(s, '.lawcheck', file), { force: true });
        symlinkSync(join(dir, 'secret.txt'), join(s, '.lawcheck', file));
        assert.deepEqual(await shows(s), [], secret);
      }
    });
  });
}

test('S5-15: a .lawcheck folder linked to a folder whose law holds a secret shows none of it', async () => {
  await withSample(async (s, dir) => {
    renameSync(join(s, '.lawcheck'), join(dir, 'outside'));
    symlinkSync(join(dir, 'outside'), join(s, '.lawcheck'));
    for (const secret of SECRETS) {
      writeFileSync(join(dir, 'outside', 'config.yaml'), secret + '\n');
      assert.deepEqual(await shows(s), [], secret);
    }
  });
});

test('S5-15: a law and a config that are plain files still show the text of their errors', async () => {
  await withSample(async (s) => {
    mkdirSync(join(s, '.lawcheck'), { recursive: true });
    writeFileSync(join(s, '.lawcheck', 'config.yaml'), `reviewer: ${SECRET}\n`);
    const run = await lawcheck(s, ['check', '--base', 'main']);
    assert.equal(run.code, 2);
    assert.ok(run.stdout.includes(SECRET), run.stdout);
  });
});
