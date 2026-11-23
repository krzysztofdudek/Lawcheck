import assert from 'node:assert/strict';
import { git, inTemp, lawcheck, newRepository, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "Waivers"': SCENARIO,
  'block 1 under "The lines a waiver covers"': SCENARIO,
  'block 1 under "forbidden-use"': SCENARIO,
  'block 2 under "forbidden-use"': SCENARIO,
  'block 3 under "forbidden-use"': SCENARIO,
};

const LAW = (root: string, extension: string) => `lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.

types:
  library:
    paths: ["${root}/core/**/*.${extension}"]
    rules: [no-console]
    may_use: [library]
  command:
    paths: ["${root}/cli/**/*.${extension}"]
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
    const python = page.text(key).startsWith('#');
    const [root, extension, marker] = python ? ['app', 'py', /\s*# lawcheck-waive .*$/] : ['src', 'ts', /\s*\/\/ lawcheck-waive .*$/];
    const file = `${root}/core/report.${extension}`;
    await inTemp(async (dir) => {
      const repo = newRepository(dir, {
        '.lawcheck/law.yaml': LAW(root, extension),
        '.lawcheck/rules/no-console.mjs': NO_CONSOLE,
        ...(python ? { 'app/__init__.py': '', 'app/core/__init__.py': '', 'app/cli/__init__.py': '', 'app/cli/main.py': 'banner = 1\n' } : { 'src/cli/main.ts': 'export const main = 1;\n' }),
      });
      git(repo, 'checkout', '-q', '-b', 'work');
      write(repo, file, page.text(key) + '\n');
      const rule = page.text(key).includes('forbidden-use') ? 'forbidden-use' : 'no-console';
      const run = await lawcheck(repo, ['check', '--base', 'main']);
      assert.deepEqual([run.code, run.stdout], [0, `lawcheck: PASS  1 changed file (against main), 1 waiver\nnote: this change adds 1 waiver: ${rule} at ${file}:1\n`], `${key}: the waiver drops the finding of its line`);
      write(repo, file, page.text(key).split('\n').map((line) => line.replace(marker, '')).filter((line) => line !== '').join('\n') + '\n');
      const bare = await lawcheck(repo, ['check', '--base', 'main']);
      assert.equal(bare.code, 1, `${key}: without the waiver the line breaks the law\n${bare.stdout}`);
    });
  }
}
