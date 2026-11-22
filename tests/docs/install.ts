import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, inTemp, lawcheck, ROOT } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';
import { parseConfig, RUNNER_COMMANDS, runnerOf } from '../../dist/config.js';

export const claims: Claims = {
  'block 1 under "Install globally"': 'tests/environments/systems.test.ts > test 205: the packed tarball, installed globally without the network, starts from every shell of the system and checks the sample',
  'block 1 under "The runner setting"': SCENARIO,
  'block 1 under "Check the install"': SCENARIO,
  'block 2 under "Check the install"': SCENARIO,
};

const SHOWN_NODE = '24.22.3';

export async function scenario(page: Page): Promise<void> {
  const runner = page.text('block 1 under "The runner setting"');
  assert.equal(runnerOf(runner), 'pnpm');
  assert.ok('config' in parseConfig(runner), runner);

  const text = readFileSync(join(ROOT, 'docs', 'install.md'), 'utf8');
  for (const [name, { words }] of Object.entries(RUNNER_COMMANDS)) {
    if (name === 'global') continue;
    assert.match(text, new RegExp(`\\| \`${words.join(' ')}\` \\| \`${name}\` \\|$`, 'm'), `the row of the runner ${name}`);
  }

  await inTemp(async (dir) => {
    assert.equal(page.text('block 1 under "Check the install"'), '$ lawcheck doctor');
    git(dir, 'init', '-q', 'shop');
    const doctor = await lawcheck(join(dir, 'shop'), ['doctor']);
    assert.equal(doctor.code, 2, doctor.stdout);
    assert.equal(doctor.stdout, page.text('block 2 under "Check the install"').replace(`Node ${SHOWN_NODE};`, `Node ${process.versions.node};`) + '\n');
  });
}
