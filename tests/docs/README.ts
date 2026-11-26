import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { inTemp, lawcheck, newRepository, ROOT } from '../acceptance/helpers.ts';
import { blocksOf, SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "Lawcheck"': SCENARIO,
  'block 2 under "Lawcheck"': SCENARIO,
  'block 3 under "Lawcheck"': SCENARIO,
  'block 1 under "Try it"': SCENARIO,
  'block 1 under "Your coding agent"': SCENARIO,
  'block 2 under "Your coding agent"': SCENARIO,
};

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const blockOf = (path: string, key: string): string => {
  const block = blocksOf(read(path)).find((b) => b.key === key);
  assert.ok(block, `${path} has ${key}`);
  return block.text;
};

const DISCOUNT = "import { orderTotal } from '../api/orders.js';\n\nexport function discount(order: { total: number }): number {\n  const friday = new Date().getDay() === 5;\n  return friday ? orderTotal(order) * 0.1 : 0;\n}\n";

type Types = Record<string, { types?: Types }>;
const count = (types: Types = {}): number => Object.values(types).reduce((n, type) => n + 1 + count(type.types), 0);

export async function scenario(page: Page): Promise<void> {
  const readme = read('README.md');

  const install = blockOf('docs/install.md', 'block 1 under "Install globally"');
  assert.equal(page.text('block 1 under "Try it"'), `${install.replace(/^\$ /, '')}\nlawcheck docs quick-start`, 'the install line of docs/install.md, which test 205 runs, then the quick start');
  assert.ok(readme.includes('first finding in five steps'), 'README.md gives the steps of the quick start');
  assert.deepEqual(read('docs/quick-start.md').match(/^## \d+\. /gm), ['## 1. ', '## 2. ', '## 3. ', '## 4. ', '## 5. ']);

  assert.equal(page.text('block 1 under "Your coding agent"'), blockOf('docs/plugin.md', 'block 1 under "The Claude Code plugin"'), 'the commands that docs/plugin.md builds from the marketplace');
  assert.equal(page.text('block 2 under "Your coding agent"'), blockOf('docs/other-agents.md', 'block 1 under "1. Add one line to the instructions file"'), 'the line of docs/other-agents.md, whose scenario follows it');

  const own = parse(read('.lawcheck/law.yaml')) as { rules: Record<string, unknown>; types: Types };
  const counted = `${Object.keys(own.rules).length} rules over ${count(own.types)} types`;
  assert.ok(readme.includes(`: ${counted},`), `README.md gives the count of Lawcheck's own law, which has ${counted}`);

  await inTemp(async (dir) => {
    const repo = newRepository(dir, {
      '.lawcheck/law.yaml': page.text('block 1 under "Lawcheck"') + '\n',
      '.lawcheck/rules/no-clock.mjs': page.text('block 2 under "Lawcheck"') + '\n',
      'src/api/orders.ts': 'export function orderTotal(order: { total: number }): number {\n  return order.total;\n}\n',
      'src/core/discount.ts': DISCOUNT,
    });
    const [command, ...output] = page.text('block 3 under "Lawcheck"').split('\n');
    assert.equal(command, '$ lawcheck check src/core/discount.ts');
    const check = await lawcheck(repo, command!.slice('$ lawcheck '.length).split(' '));
    assert.equal(check.code, 1, check.stdout);
    assert.equal(check.stdout, output.join('\n') + '\n');

    const prime = await lawcheck(repo, ['prime']);
    assert.equal(prime.code, 0, prime.stdout);
    assert.match(prime.stdout, /^Lawcheck checks this repository's code against its law/);

    const docs = await lawcheck(repo, ['docs', 'quick-start']);
    assert.equal(docs.code, 0, docs.stdout);
    assert.match(docs.stdout, /^# Quick start\n/);
  });
}
