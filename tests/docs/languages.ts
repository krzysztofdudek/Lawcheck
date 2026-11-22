import assert from 'node:assert/strict';
import { git, inTemp, lawcheck, newRepository, write } from '../acceptance/helpers.ts';
import { SCENARIO, shows } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "uses-not-read"': SCENARIO,
};

export async function scenario(page: Page): Promise<void> {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, {
      '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n\ntypes:\n  domain:\n    paths: ["domain/**"]\n    may_use: []\n',
      'domain/price.ts': 'export const price = 1;\n',
    });
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, 'domain/schema.json', '{}\n');
    const run = await lawcheck(repo, ['check', '--base', 'main']);
    assert.equal(run.code, 0, run.stdout);
    shows(run.stdout, page.text('block 1 under "uses-not-read"'));
  });
}
