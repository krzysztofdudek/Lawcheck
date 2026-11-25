import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseConfig } from '../../dist/config.js';
import { withFake } from '../acceptance/fake-reviewer.ts';
import { git, inTemp, lawcheck, newRepository, write } from '../acceptance/helpers.ts';
import { blocksOf, SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';
import { commands, walk } from './write-a-reviewer-rule.ts';

export const claims: Claims = {
  'block 1 under "A slow check"': SCENARIO,
  'block 1 under "1. See what the run judges"': SCENARIO,
  'block 2 under "1. See what the run judges"': SCENARIO,
  'block 1 under "2. Check one file"': SCENARIO,
  'block 2 under "2. Check one file"': SCENARIO,
  'block 1 under "3. Run each script rule alone"': SCENARIO,
  'block 2 under "3. Run each script rule alone"': SCENARIO,
  'block 1 under "4. See which files are read for uses"': SCENARIO,
  'block 2 under "4. See which files are read for uses"': SCENARIO,
  'block 1 under "5. Bound the reviewer"': SCENARIO,
  'block 2 under "5. Bound the reviewer"': SCENARIO,
  'block 3 under "5. Bound the reviewer"': SCENARIO,
  'block 1 under "6. Give the check its base"': SCENARIO,
  'block 2 under "6. Give the check its base"': SCENARIO,
  'block 3 under "6. Give the check its base"': SCENARIO,
  'block 4 under "6. Give the check its base"': SCENARIO,
};

const reviewerPage = readFileSync(new URL('../../docs/write-a-reviewer-rule.md', import.meta.url), 'utf8');
const blockOf = (markdown: string, key: string) => blocksOf(markdown).find((block) => block.key === key)!.text;

export async function scenario(page: Page): Promise<void> {
  const config = page.text('block 1 under "5. Bound the reviewer"') + '\n';
  const read = parseConfig(config);
  assert.ok('config' in read, config);
  assert.deepEqual([read.config.provider, read.config.maxCalls, read.config.parallel, read.config.timeout], ['ollama', 20, 2, 120]);
  await withFake(async (fake) => {
    await inTemp(async (dir) => {
      const repo = newRepository(dir, {
        '.lawcheck/law.yaml': page.text('block 1 under "A slow check"') + '\n',
        '.lawcheck/.gitignore': '.local/\nconfig.local.yaml\n',
        '.lawcheck/config.yaml': blockOf(reviewerPage, 'block 1 under "3. Choose a reviewer"') + '\n',
        '.lawcheck/rules/no-console.mjs': blockOf(readFileSync(new URL('../../docs/adopt-in-an-existing-repository.md', import.meta.url), 'utf8'), 'block 1 under "3. Write the rule"') + '\n',
        '.lawcheck/rules/clear-errors.md': blockOf(reviewerPage, 'block 1 under "1. Write the rule file"') + '\n',
        'src/core/price.ts': 'export function price(cents: number): number {\n  return cents;\n}\n',
        'src/core/tax.ts': "import { price } from './price.js';\n\nexport function tax(cents: number): number {\n  return Math.round(price(cents) * 0.2);\n}\n",
        'src/cli/main.ts': "import { tax } from '../core/tax.js';\n\nconsole.log(tax(100));\n",
      });
      git(repo, 'checkout', '-q', '-b', 'work');
      write(repo, 'src/core/price.ts', 'export function price(cents: number): number {\n  return Math.max(cents, 0);\n}\n');
      write(repo, 'src/core/tax.ts', "import { price } from './price.js';\n\nexport function tax(cents: number): number {\n  return Math.round(price(cents) * 0.21);\n}\n");
      const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.base };
      // The steps before the config changes only read the repository, and so do the steps after it, so each group runs at once.
      const usesRead = async () => {
        const [doctorArgv, ...rest] = commands(page.text('block 1 under "4. See which files are read for uses"'));
        assert.equal(rest.length, 0);
        const doctor = await lawcheck(repo, doctorArgv!.slice(1), env);
        assert.equal(doctor.code, 0, doctor.stdout);
        assert.deepEqual(doctor.stdout.split('\n').filter((line) => line.startsWith('ok  readers  ')), [page.text('block 2 under "4. See which files are read for uses"')]);
      };
      await Promise.all([walk(page, repo, '1. See what the run judges', 1, env), walk(page, repo, '2. Check one file', 0, env), walk(page, repo, '3. Run each script rule alone', 0, env), usesRead()]);
      write(repo, '.lawcheck/config.yaml', config);
      const withoutBase = async () => {
        const [noBase, ...more] = commands(page.text('block 3 under "6. Give the check its base"'));
        assert.equal(more.length, 0);
        const doctorWithout = await lawcheck(repo, noBase!.slice(1), env);
        const lines = doctorWithout.stdout.split('\n');
        const at = lines.findIndex((line) => /^\w+  base  /.test(line));
        assert.ok(at >= 0, doctorWithout.stdout);
        assert.equal(lines.slice(at, /^\s+next: /.test(lines[at + 1] ?? '') ? at + 2 : at + 1).join('\n'), page.text('block 4 under "6. Give the check its base"'), doctorWithout.stdout);
      };
      await Promise.all([walk(page, repo, '5. Bound the reviewer', 2, env, 2), walk(page, repo, '6. Give the check its base', 1, env), withoutBase()]);
      assert.equal(fake.requests.filter((request) => request.path === '/api/chat').length, 0, 'a run past its cap sends nothing');
    });
  }, (request) => (request.path === '/api/version' ? { body: '{"version":"0.12.6"}' } : { status: 500, body: '{}' }));
}
