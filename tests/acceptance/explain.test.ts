import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { withFake } from './fake-reviewer.ts';
import { F, F_PATH, F_PRIME, lawcheck, PRICING, read, REVIEWER_CONFIG, run, setRule, withR, withSample, withU, write } from './helpers.ts';

const spec = readFileSync(new URL('../../spec/commands-slice.md', import.meta.url), 'utf8').split('\n');
const block = (start: string): string => {
  const at = spec.indexOf(start);
  const lines: string[] = [];
  for (let i = at; spec[i] !== '```'; i++) lines.push(spec[i]!);
  return lines.join('\n') + '\n';
};

const PRICE = block('src/core/price.ts');
const RELEASE = block('tools/release.mjs');
const BUILD = block('tools/build.mjs  (does not exist yet)');
const REFUND = block('src/core/refund.ts');
const SRC = block('src/  3 files');
const TYPE_SOURCE = block('type source  (source)  Everything that ships.');
const RULE_NO_TODO = block('rule no-todo  script  advisory');

async function explain(cwd: string, ...args: string[]) {
  return lawcheck(cwd, ['explain', ...args]);
}

async function same(cwd: string, args: string[], expected: string): Promise<void> {
  const result = await explain(cwd, ...args);
  assert.equal(result.stdout, expected, args.join(' '));
  assert.equal(result.code, 0, args.join(' '));
}

test('test 105: explain a file, from a subdirectory, with content, and one that does not exist', async () => {
  await withSample(async (s) => {
    await same(s, ['src/core/price.ts'], PRICE);
    await same(join(s, 'src/core'), ['price.ts'], PRICE);
    await same(s, ['tools/release.mjs'], RELEASE);
    await same(s, ['tools/build.mjs'], BUILD);
  });
});

test('test 106: files with no type, and a new file of a type', async () => {
  await withSample(async (s) => {
    await same(s, ['README.md'], "README.md\n  type:  none: no type's paths match it, so no rule judges it\n");
    await same(s, ['src/core/api.d.ts'], "src/core/api.d.ts  (does not exist yet)\n  type:  none: no type's paths match it, so no rule judges it\n");
    const known = PRICE.split('\n').slice(1, 7).join('\n');
    await same(s, ['src/core/new.ts'], `src/core/new.ts  (does not exist yet)\n${known}\n`);
    write(s, 'tools/plain.mjs', 'console.log(1);\n');
    await same(s, ['tools/plain.mjs'], 'tools/plain.mjs\n  type:  none: it matches the paths of script but not their content, so no rule judges it\n');
  });
});

test('test 107: ignored, symbolic links and binary files', async () => {
  await withSample(async (s) => {
    write(s, '.gitignore', 'src/core/gen*.ts\n');
    write(s, 'src/core/gen.ts', 'export const x = 1;\n');
    await same(s, ['src/core/gen.ts'], 'src/core/gen.ts\n  type:  none: git ignores it, so Lawcheck never sees it\n');
    await same(s, ['src/core/gen2.ts'], 'src/core/gen2.ts  (does not exist yet)\n  type:  none: git ignores this path, so Lawcheck would never see it\n');
    symlinkSync('price.ts', join(s, 'src/core/link.ts'));
    await same(s, ['src/core/link.ts'], 'src/core/link.ts\n  type:  none: it is a symbolic link, which has no type\n');
    write(s, 'src/core/blob.ts', Buffer.from([0x78, 0x00]));
    await same(s, ['src/core/blob.ts'], 'src/core/blob.ts\n  type:  none: it is binary, which has no type\n');
  });
});

test('test 108: an overlap is the answer for its file, and stops a directory', async () => {
  await withSample(
    async (s) => {
      const price = await explain(s, 'src/core/price.ts');
      assert.equal(price.stdout.split('\n')[1], '  type:  none: it matches library and pricing at one level (type-overlap); check stops with exit 2 until a ! pattern in one of them leaves it out');
      assert.equal(price.code, 0);
      const tax = await explain(s, 'src/core/tax.ts');
      assert.equal(tax.stdout.split('\n')[1], '  type:  library  (source > library)  Code the commands call.');
      assert.equal(tax.code, 0);
      const src = await explain(s, 'src');
      assert.match(src.stdout, /^src\/core\/price\.ts {2}error\[type-overlap\]/m);
      assert.equal(src.code, 2);
    },
    { onMain: (s) => write(s, '.lawcheck/law.yaml', PRICING(read(s, '.lawcheck/law.yaml'))) },
  );
});

test('test 109: a subtype whose content does not match, and the alternatives of a new file', async () => {
  const entry = (law: string) =>
    law.replace('        paths: ["src/cli/**"]\n', '        paths: ["src/cli/**"]\n        types:\n          entry:\n            about: Entry points.\n            paths: ["src/cli/**"]\n            content: "^#!"\n');
  await withSample(
    async (s) => {
      const main = await explain(s, 'src/cli/main.ts');
      assert.equal(main.stdout.split('\n')[2], '  matched:  source by "src/**/*.ts", command by "src/cli/**", not entry: content "^#!" does not match');
      assert.equal(main.code, 0);
      const json = await explain(s, 'src/cli/main.ts', '--json');
      assert.deepEqual(JSON.parse(json.stdout).not_matched, [{ type: 'entry', content: '^#!' }]);
      const fresh = await explain(s, 'src/cli/run.ts');
      assert.equal(
        fresh.stdout,
        [
          'src/cli/run.ts  (does not exist yet)',
          '  type:  command  (source > command)  The command layer.',
          '  matched:  source by "src/**/*.ts", command by "src/cli/**"',
          '  then:  entry if its text matches "^#!"; otherwise command',
          '  may use:  any file; no type on the way up has may_use',
          '  rules:',
          '    no-todo  script  advisory  from source  A TODO without an issue number gets forgotten.',
          '',
        ].join('\n'),
      );
      assert.equal(fresh.code, 0);
    },
    { onMain: (s) => write(s, '.lawcheck/law.yaml', entry(read(s, '.lawcheck/law.yaml'))) },
  );
});

test('test 110: the list in force and the reader', async () => {
  await withU(async (u) => {
    const price = (await explain(u, 'src/core/price.ts')).stdout.split('\n');
    assert.deepEqual(price.slice(3, 5), ['  may use:  library  (from source)', '  uses:  read as typescript']);
    const main = await explain(u, 'src/cli/main.ts');
    assert.deepEqual(main.stdout.split('\n').slice(3, 5), ['  may use:  command, library', '  uses:  read as typescript']);
    assert.equal(main.code, 0);
  });
  await withU(
    async (u) => {
      const price = await explain(u, 'src/core/price.ts');
      assert.equal(price.stdout.split('\n')[3], '  may use:  nothing  (from source)');
      assert.equal(price.code, 0);
    },
    { onMain: (u) => write(u, '.lawcheck/law.yaml', read(u, '.lawcheck/law.yaml').replace('    may_use: [library]\n', '    may_use: []\n')) },
  );
});

test('explain: the pattern that matched, a rule listed twice, and a file with no reader under a list', async () => {
  const law = (text: string) =>
    text
      .replace('    paths: ["src/**/*.ts", "!src/**/*.d.ts"]\n    rules: [no-todo]\n', '    paths: ["src/**/*.ts", "src/**/*.md", "!src/**/*.d.ts"]\n    rules: [no-todo]\n    may_use: [source]\n')
      .replace('        rules: [no-console]\n', '        rules: [no-console, no-todo]\n');
  await withSample(
    async (s) => {
      write(s, 'src/core/notes.md', '# Notes\n');
      await same(
        s,
        ['src/core/notes.md'],
        [
          'src/core/notes.md',
          '  type:  library  (source > library)  Code the commands call.',
          '  matched:  source by "src/**/*.md", library by "src/core/**"',
          '  may use:  source  (from source)',
          '  uses:  not read: Lawcheck has no reader for this file',
          '  rules:',
          '    no-todo  script  advisory  from source  A TODO without an issue number gets forgotten.',
          '    no-console  script  enforced  from library  Only the command layer writes to the terminal.',
          '  waivers:  none',
          '',
        ].join('\n'),
      );
    },
    { onMain: (s) => write(s, '.lawcheck/law.yaml', law(read(s, '.lawcheck/law.yaml'))) },
  );
});

test('test 111: the state of each review, and no request', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      await same(r, [F_PATH], REFUND);
      await run(r, fake, ['--review', '--base', 'main']);
      await same(r, [F_PATH], REFUND.replace('not reviewed', 'failed earlier'));
      assert.equal(fake.requests.length, 1);
    });
    await withR(async (r) => {
      write(r, F_PATH, F_PRIME);
      await run(r, fake, ['--review', '--base', 'main']);
      const result = await explain(r, F_PATH);
      assert.match(result.stdout, /^ {4}clear-errors {2}reviewer {2}enforced {2}from library {2}reviewed {2}/m);
      assert.equal(result.code, 0);
      assert.equal(fake.requests.length, 2);
    });
    await withR(
      async (r) => {
        write(r, F_PATH, F);
        const result = await explain(r, F_PATH);
        assert.match(result.stdout, /^ {4}clear-errors {2}reviewer {2}enforced {2}from library {2}too large to review {2}/m);
        assert.equal(result.code, 0);
      },
      { onMain: (r) => write(r, '.lawcheck/config.yaml', REVIEWER_CONFIG + '  max_chars: 100\n') },
    );
    assert.equal(fake.requests.length, 2);
  });
});

test('test 112: a directory, the root, a type and a rule', async () => {
  await withSample(async (s) => {
    await same(s, ['src'], SRC);
    await same(s, ['.'], './  8 files\n  library  2 files\n  command  1 file\n  script  1 file\n  no type  4 files\n');
    await same(s, ['--type', 'source'], TYPE_SOURCE);
    await same(s, ['--rule', 'no-todo'], RULE_NO_TODO);
  });
  await withR(async (r) => {
    const result = await explain(r, '--rule', 'clear-errors');
    const lines = result.stdout.split('\n');
    assert.equal(lines[3], '  context:  docs/errors.md');
    assert.equal(lines[2], '  file:  .lawcheck/rules/clear-errors.md');
    assert.ok(lines.includes('  binds:  2 files; 0 have a verdict for their content'));
    assert.equal(result.code, 0);
  });
});

test('test 113: usage', async () => {
  await withSample(async (s) => {
    for (const args of [[], ['a', 'b'], ['--type', 'nope'], ['--rule', 'no-tod'], ['--type', 'source', '--rule', 'no-todo'], ['../outside'], ['--type']]) {
      const result = await explain(s, ...args);
      assert.match(result.stdout, /^error\[usage\]/m, args.join(' '));
      assert.equal(result.code, 2, args.join(' '));
      if (args[1] === 'no-tod') assert.match(result.stdout, /'no-todo'/);
    }
  });
});

test('test 114: JSON', async () => {
  await withSample(async (s) => {
    const price = await explain(s, 'src/core/price.ts', '--json');
    assert.deepEqual(JSON.parse(price.stdout), {
      schema: 'lawcheck-explain/0',
      subject: 'file',
      path: 'src/core/price.ts',
      exists: true,
      type: 'library',
      chain: ['source', 'library'],
      about: 'Code the commands call.',
      none: null,
      matched: [
        { type: 'source', pattern: 'src/**/*.ts', content: null },
        { type: 'library', pattern: 'src/core/**', content: null },
      ],
      not_matched: [],
      then: null,
      may_use: null,
      uses: null,
      rules: [
        { id: 'no-todo', kind: 'script', status: 'advisory', why: 'A TODO without an issue number gets forgotten.', from: 'source', review: null },
        { id: 'no-console', kind: 'script', status: 'enforced', why: 'Only the command layer writes to the terminal.', from: 'library', review: null },
      ],
      waivers: [],
    });
    const readme = await explain(s, 'README.md', '--json');
    assert.deepEqual(JSON.parse(readme.stdout), {
      schema: 'lawcheck-explain/0',
      subject: 'file',
      path: 'README.md',
      exists: true,
      type: null,
      chain: [],
      about: null,
      none: "no type's paths match it, so no rule judges it",
      matched: [],
      not_matched: [],
      then: null,
      may_use: null,
      uses: null,
      rules: [],
      waivers: [],
    });
    const src = await explain(s, 'src', '--json');
    assert.deepEqual(JSON.parse(src.stdout), {
      schema: 'lawcheck-explain/0',
      subject: 'directory',
      path: 'src/',
      files: 3,
      types: [
        { type: 'library', files: 2 },
        { type: 'command', files: 1 },
      ],
    });
    for (const result of [price, readme, src]) assert.equal(result.code, 0);
  });
});

test('test 115: explain and prime run no rule and send no request', async () => {
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        write(r, F_PATH, F);
        for (const args of [['explain', F_PATH], ['explain', '--rule', 'clear-errors'], ['prime']]) {
          const result = await lawcheck(r, args, { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
          assert.equal(result.code, 0, args.join(' '));
        }
        assert.equal(fake.requests.length, 0);
      },
      { onMain: (r) => setRule(r, 'no-console', "throw new Error('broken at load');\n") },
    );
  });
});
