import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { example } from '../harness/examples.ts';
import { git, inTemp, lawcheck, newRepository, write } from './helpers.ts';

const page = readFileSync(new URL('../../docs/first-law.md', import.meta.url), 'utf8');

test('docs-5: the first-law page walked in a new repository: init makes no rules folder, the page says to make it, and its rule and law work', async () => {
  assert.ok(page.includes('`init` makes no `rules/` folder'), 'the page says init makes no rules folder');
  assert.ok(page.includes('$ mkdir -p .lawcheck/rules'), 'the page gives the command that makes it');
  await inTemp(async (dir) => {
    const repo = newRepository(dir, {
      '.gitignore': 'node_modules/\n',
      'src/price.ts': 'export const price = 1;\n',
      'src/cli/main.ts': "console.log('done');\n",
      'node_modules/dep/index.ts': "console.log('a dependency');\n",
    });
    const init = await lawcheck(repo, ['init']);
    assert.equal(init.code, 0);
    assert.ok(!existsSync(join(repo, '.lawcheck', 'rules')), 'init made a rules folder, so the page is wrong');
    mkdirSync(join(repo, '.lawcheck', 'rules'), { recursive: true });
    write(repo, '.lawcheck/rules/no-console.mjs', example('first-law-rule') + '\n');
    write(repo, '.lawcheck/law.yaml', example('first-law-law') + '\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'the law');
    const clean = await lawcheck(repo, ['try', 'no-console', 'src/price.ts']);
    assert.ok(clean.stdout.endsWith('  nothing found in 1 file\n'), clean.stdout);
    assert.equal(clean.code, 0);
    const dirty = await lawcheck(repo, ['try', 'no-console', 'src/cli/main.ts']);
    assert.match(dirty.stdout, /^src\/cli\/main\.ts:1 {2}error\[no-console\] {2}writes to the terminal with console\.log$/m);
    assert.equal(dirty.code, 1);
    const full = await lawcheck(repo, ['check', '--full', '--base', 'main']);
    assert.ok(!full.stdout.includes('node_modules'), 'a folder git ignores is never judged');
  });
});

test('docs-5, S7-12: the rule of the first-law page reads lines as text, so it finds console.log in a comment, as the page says', async () => {
  assert.ok(page.includes('parses no comments, so it also finds `console.log` inside a comment'));
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { 'src/price.ts': "// console.log('an example in a comment');\nexport const price = 1;\n" });
    mkdirSync(join(repo, '.lawcheck', 'rules'), { recursive: true });
    write(repo, '.lawcheck/rules/no-console.mjs', example('first-law-rule') + '\n');
    write(repo, '.lawcheck/law.yaml', example('first-law-law') + '\n');
    const found = await lawcheck(repo, ['try', 'no-console', 'src/price.ts']);
    assert.match(found.stdout, /^src\/price\.ts:1 {2}error\[no-console\]/m);
    assert.equal(found.code, 1);
  });
});
