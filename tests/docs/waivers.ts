import assert from 'node:assert/strict';
import { git, inTemp, lawcheck, newRepository, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "Waivers"': SCENARIO,
  'block 1 under "What it covers"': SCENARIO,
  'block 1 under "forbidden-use"': SCENARIO,
};

const LAW = `lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.

types:
  library:
    paths: ["src/core/**"]
    rules: [no-console]
    may_use: [library]
  command:
    paths: ["src/cli/**"]
`;

const NO_CONSOLE = `export function check({ files }) {
  const findings = [];
  for (const file of files) {
    file.lines.forEach((text, index) => {
      if (/\\bconsole\\.\\w+/.test(text)) findings.push({ line: index + 1, message: 'writes to the terminal' });
    });
  }
  return findings;
}
`;

export async function scenario(page: Page): Promise<void> {
  for (const key of Object.keys(claims)) {
    await inTemp(async (dir) => {
      const repo = newRepository(dir, { '.lawcheck/law.yaml': LAW, '.lawcheck/rules/no-console.mjs': NO_CONSOLE, 'src/cli/main.ts': 'export const main = 1;\n' });
      git(repo, 'checkout', '-q', '-b', 'work');
      write(repo, 'src/core/report.ts', page.text(key) + '\n');
      const run = await lawcheck(repo, ['check', '--base', 'main']);
      assert.deepEqual([run.code, run.stdout], [0, 'lawcheck: PASS  1 changed file (against main), 1 waiver\n'], `${key}: the waiver drops the finding of its line`);
      write(repo, 'src/core/report.ts', page.text(key).split('\n').map((line) => line.replace(/\s*\/\/ lawcheck-waive .*$/, '')).filter((line) => line !== '').join('\n') + '\n');
      const bare = await lawcheck(repo, ['check', '--base', 'main']);
      assert.equal(bare.code, 1, `${key}: without the waiver the line breaks the law\n${bare.stdout}`);
    });
  }
}
