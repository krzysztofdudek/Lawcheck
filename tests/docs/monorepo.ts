import assert from 'node:assert/strict';
import { join } from 'node:path';
import { git, inTemp, lawcheck, newRepository, write } from '../acceptance/helpers.ts';
import { exampleText } from '../harness/examples.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "1. Start a law in one package"': SCENARIO,
  'block 2 under "1. Start a law in one package"': SCENARIO,
  'block 1 under "2. Describe the package"': SCENARIO,
  'block 1 under "3. Check from a folder inside the package"': SCENARIO,
  'block 2 under "3. Check from a folder inside the package"': SCENARIO,
  'block 1 under "4. Run it from the top"': SCENARIO,
  'block 2 under "4. Run it from the top"': SCENARIO,
  'block 1 under "5. Give a package its own runner"': SCENARIO,
  'block 2 under "5. Give a package its own runner"': SCENARIO,
  'block 1 under "6. Leave a nested repository to its own law"': SCENARIO,
  'block 2 under "6. Leave a nested repository to its own law"': SCENARIO,
};

const args = (block: string): string[] => {
  assert.ok(block.startsWith('$ lawcheck '), block);
  return block.slice('$ lawcheck '.length).split(' ');
};
const TOTAL = 'export function total(price: number): number {\n  console.log(price);\n  return price;\n}\n';

async function shown(cwd: string, page: Page, step: string, code: number): Promise<void> {
  const run = await lawcheck(cwd, args(page.text(`block 1 under "${step}"`)));
  assert.deepEqual([run.code, run.stdout], [code, page.text(`block 2 under "${step}"`) + '\n'], step);
}

export async function scenario(page: Page): Promise<void> {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { 'packages/api/src/price.ts': 'export const price = 1;\n', 'packages/web/src/page.ts': 'export const page = 1;\n' });
    git(repo, 'checkout', '-q', '-b', 'work');
    const api = join(repo, 'packages/api');
    const web = join(repo, 'packages/web');
    await shown(api, page, '1. Start a law in one package', 0);
    write(api, '.lawcheck/law.yaml', page.text('block 1 under "2. Describe the package"') + '\n');
    write(api, '.lawcheck/rules/no-console.mjs', exampleText('first-law-rule'));
    write(api, 'src/total.ts', TOTAL);
    await shown(join(api, 'src'), page, '3. Check from a folder inside the package', 1);
    const package_ = await lawcheck(join(api, 'src'), ['check', '--base', 'main']);
    assert.equal(package_.code, 1);
    assert.match(package_.stdout, /^lawcheck: FAIL  1 error in 4 changed files \(against main\)\n/, 'the base given in a folder of the package judges every changed file of the package');

    assert.equal((await lawcheck(web, ['init'])).code, 0);
    await shown(repo, page, '4. Run it from the top', 2);

    write(web, '.lawcheck/config.yaml', page.text('block 1 under "5. Give a package its own runner"') + '\n');
    const primed = await lawcheck(web, ['prime']);
    assert.equal(primed.code, 0);
    assert.equal(primed.stdout.split('\n')[0], page.text('block 2 under "5. Give a package its own runner"'));

    write(api, 'src/total.ts', TOTAL.replace('  console.log(price);\n', ''));
    const vendor = join(api, 'src/vendor');
    write(vendor, 'lib.ts', 'export const lib = 1;\n');
    git(vendor, 'init', '-q', '-b', 'main');
    git(vendor, 'add', '-A');
    git(vendor, 'commit', '-q', '-m', 'first');
    await shown(api, page, '6. Leave a nested repository to its own law', 0);
  });
}
