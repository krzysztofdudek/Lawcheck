import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { example } from '../harness/examples.ts';
import { git, inTemp, lawcheck, newRepository, write } from './helpers.ts';

const page = readFileSync(new URL('../../docs/first-law.md', import.meta.url), 'utf8');

const FILES = (ignore: boolean) => ({
  '.gitignore': ignore ? 'node_modules/\n' : '\n',
  'src/price.ts': 'export const price = 1;\n',
  'src/report.ts': "console.log('a report');\n",
  'node_modules/dep/index.ts': "console.log('a dependency');\n",
});

interface Block {
  marker: string | null;
  info: string;
  lines: string[];
}

function blocks(): Block[] {
  const out: Block[] = [];
  const lines = page.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.startsWith('```')) continue;
    const marker = /^<!-- example: ([a-z-]+) -->$/.exec(lines[i - 1] ?? '')?.[1] ?? null;
    const info = lines[i]!.slice(3);
    const body: string[] = [];
    for (i++; !lines[i]!.startsWith('```'); i++) body.push(lines[i]!);
    out.push({ marker, info, lines: body });
  }
  return out;
}

function words(line: string): string[] {
  return [...line.matchAll(/'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2]!);
}

const EXIT: Record<string, number> = { init: 0, 'explain src/price.ts': 0, 'try no-console src/price.ts': 0, 'try no-console src/report.ts': 1, "try no-console src/**/*.ts": 1, 'check --full --base main': 0 };

test('test 309: R-7, the first-law page walked top to bottom in a new repository: every command it gives prints, byte for byte, the output the page shows after it', async () => {
  assert.ok(page.includes('`init` makes no `rules/` folder'), 'the page says init makes no rules folder');
  await inTemp(async (dir) => {
    const repo = newRepository(dir, FILES(true));
    git(repo, 'checkout', '-q', '-b', 'work');
    let compared = 0;
    const all = blocks();
    for (let b = 0; b < all.length; b++) {
      const block = all[b]!;
      if (block.marker === 'first-law-rule') write(repo, '.lawcheck/rules/no-console.mjs', block.lines.join('\n') + '\n');
      if (block.marker === 'first-law-type' || block.marker === 'first-law-entry' || block.marker === 'first-law-law') write(repo, '.lawcheck/law.yaml', block.lines.join('\n') + '\n');
      for (const line of block.lines.filter((l) => l.startsWith('$ '))) {
        const command = line.slice(2);
        if (command.startsWith('mkdir ')) {
          assert.ok(!existsSync(join(repo, '.lawcheck', 'rules')), 'init made a rules folder, so the page is wrong');
          mkdirSync(join(repo, '.lawcheck', 'rules'), { recursive: true });
          continue;
        }
        const argv = words(command.slice('lawcheck '.length));
        const run = await lawcheck(repo, argv);
        assert.equal(run.code, EXIT[argv.join(' ')], `${command}: exit code`);
        assert.equal(run.stderr, '', command);
        const shown = all[b + 1];
        assert.equal(shown?.info, 'output', `${command} is followed by its output`);
        assert.equal(run.stdout, shown!.lines.join('\n') + '\n', command);
        compared++;
      }
    }
    assert.equal(compared, 6, 'the commands the page runs');
  });
});

test('test 309: S7-7, a folder git ignores is never judged, and the same folder not ignored is', async () => {
  assert.ok(page.includes('so a folder that `.gitignore` names, `node_modules/` or a build folder, is never judged; one that git does not ignore would be'));
  const law = (repo: string) => {
    write(repo, '.lawcheck/rules/no-console.mjs', example('first-law-rule') + '\n');
    write(repo, '.lawcheck/law.yaml', example('first-law-law').replace('src/**/*.ts', '**/*.ts') + '\n');
  };
  await inTemp(async (dir) => {
    const repo = newRepository(dir, FILES(true));
    git(repo, 'checkout', '-q', '-b', 'work');
    law(repo);
    const ignored = await lawcheck(repo, ['check']);
    assert.ok(!ignored.stdout.includes('node_modules'), ignored.stdout);
    assert.equal(ignored.code, 1, 'the control: src/report.ts is judged');
    assert.ok(ignored.stdout.includes('src/report.ts:1  error[no-console]'), ignored.stdout);
  });
  await inTemp(async (dir) => {
    const repo = newRepository(dir, FILES(false));
    git(repo, 'checkout', '-q', '-b', 'work');
    law(repo);
    const listed = await lawcheck(repo, ['check']);
    assert.ok(listed.stdout.includes('node_modules/dep/index.ts:1  error[no-console]  writes to the terminal with console.log'), listed.stdout);
    assert.equal(listed.code, 1);
  });
});

test('test 309: S7-12, the rule of the first-law page reads lines as text, so it finds console.log in a comment, as the page says', async () => {
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
