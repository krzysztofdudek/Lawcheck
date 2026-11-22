import assert from 'node:assert/strict';
import { join } from 'node:path';
import { git, inTemp, lawcheck, newRepository, NO_CONSOLE, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const LAW = 'block 1 under "The commands"';

const USAGE = ['init', 'prime', 'check', 'explain', 'try', 'docs', 'doctor'];
const RUNS: [heading: string, at: number, code: number][] = [
  ['init', 2, 0],
  ['prime', 2, 0],
  ['check', 2, 1],
  ['explain', 2, 0],
  ['try', 2, 1],
  ['`<topic>`', 1, 2],
  ['doctor', 2, 0],
];
const ALONE = ['--version', '--help'];

const key = (heading: string, at: number) => `block ${at} under "${heading}"`;

export const claims: Claims = Object.fromEntries([
  [LAW, SCENARIO],
  ...USAGE.map((command) => [key(command, 1), SCENARIO]),
  ...RUNS.flatMap(([heading, at]) => [[key(heading, at), SCENARIO], [key(heading, at + 1), SCENARIO]]),
  ...ALONE.map((flag) => [key(flag, 1), SCENARIO]),
]);

function argvOf(block: string): string[] {
  assert.match(block, /^\$ lawcheck [^\n]+$/, block);
  return block.slice('$ lawcheck '.length).split(' ');
}

export async function scenario(page: Page): Promise<void> {
  await inTemp(async (dir) => {
    for (const command of USAGE) {
      const help = await lawcheck(dir, [command, '--help']);
      assert.equal(help.code, 0, command);
      assert.ok(help.stdout.startsWith(`${page.text(key(command, 1))}\n\n`), `the usage of ${command} is the start of its --help\n${help.stdout}`);
    }
    const fresh = newRepository(join(dir, 'fresh'));
    const repo = newRepository(join(dir, 'example'), {
      '.lawcheck/law.yaml': page.text(LAW) + '\n',
      '.lawcheck/rules/no-console.mjs': NO_CONSOLE,
      'src/core/price.ts': 'export const price = 1;\n',
      'src/cli/main.ts': "console.log('hello');\n",
    });
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, 'src/core/report.ts', "export function report() {\n  console.log('total');\n}\n");
    for (const [heading, at, code] of RUNS) {
      const argv = argvOf(page.text(key(heading, at)));
      const shown = page.text(key(heading, at + 1)) + '\n';
      const run = await lawcheck(heading === 'init' ? fresh : repo, argv);
      assert.equal(run.code, code, `${argv.join(' ')}\n${run.stdout}`);
      if (heading === 'prime') assert.ok(run.stdout.endsWith(shown), `the text of prime ends with the block\n${run.stdout}`);
      else if (heading === 'doctor') assert.equal(run.stdout.replace(`Node ${process.versions.node};`, 'Node 24.11.0;'), shown);
      else assert.equal(run.stdout, shown, argv.join(' '));
    }
    for (const flag of ALONE) {
      const run = await lawcheck(repo, [flag]);
      assert.deepEqual([run.code, run.stdout], [0, page.text(key(flag, 1)) + '\n'], flag);
    }
  });
}
