import { test } from 'node:test';
import { exampleText } from '../harness/examples.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, inTemp, lawcheck, makeSample, newRepository, write } from './helpers.ts';

const VERSION = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version.match(/^\d+\.\d+\.\d+/)![0];

// The block writes 0.1.0 for the MAJOR.MINOR.PATCH part of the package version.
const LAW_TEXT = exampleText('init-law').replace(/^lawcheck: 0\.1\.0\n/, `lawcheck: ${VERSION}\n`);

const CREATED = exampleText('init-output');

test('test 96: init in a new repository writes the two files and nothing else', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    const before = git(repo, 'config', '--list', '--local');
    const run = await lawcheck(repo, ['init']);
    assert.equal(run.stdout, CREATED);
    assert.equal(run.code, 0);
    assert.deepEqual(readdirSync(join(repo, '.lawcheck')).sort(), ['.gitignore', 'law.yaml']);
    assert.equal(readFileSync(join(repo, '.lawcheck/law.yaml'), 'utf8'), LAW_TEXT);
    assert.equal(readFileSync(join(repo, '.lawcheck/.gitignore'), 'utf8'), exampleText('init-gitignore'));
    assert.equal(git(repo, 'status', '--porcelain'), '?? .lawcheck/\n');
    assert.equal(git(repo, 'config', '--list', '--local'), before);
    const checked = await lawcheck(repo, ['check']);
    assert.equal(checked.stdout, 'lawcheck: PASS  3 files (no base: every file counts as changed)\n');
    assert.equal(checked.code, 0);
  });
});

test('test 97: init refuses where a law already governs, and writes nothing', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    await lawcheck(repo, ['init']);
    const law = readFileSync(join(repo, '.lawcheck/law.yaml'));
    const ignore = readFileSync(join(repo, '.lawcheck/.gitignore'));
    const again = await lawcheck(repo, ['init']);
    assert.match(again.stdout, /^\.lawcheck\/law\.yaml {2}error\[already-initialized\]/m);
    assert.match(again.stdout, /^next: lawcheck doctor {2}\(shows how the law here stands\)$/m);
    assert.equal(again.code, 2);
    assert.deepEqual(readFileSync(join(repo, '.lawcheck/law.yaml')), law);
    assert.deepEqual(readFileSync(join(repo, '.lawcheck/.gitignore')), ignore);
  });
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    const top = await lawcheck(s, ['init']);
    assert.match(top.stdout, /^\.lawcheck\/law\.yaml {2}error\[already-initialized\]/m);
    assert.equal(top.code, 2);
    assert.equal(existsSync(join(s, '.lawcheck/.gitignore')), false);
    const below = await lawcheck(join(s, 'src/core'), ['init']);
    assert.match(below.stdout, /^\.\.\/\.\.\/\.lawcheck\/law\.yaml {2}error\[already-initialized\]/m);
    assert.equal(below.code, 2);
    assert.equal(existsSync(join(s, 'src/core/.lawcheck')), false);
  });
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { 'packages/api/.lawcheck/law.yaml': LAW_TEXT });
    const run = await lawcheck(repo, ['init']);
    assert.match(run.stdout, /^packages\/api\/\.lawcheck\/law\.yaml {2}error\[already-initialized\]/m);
    assert.equal(run.code, 2);
    assert.equal(existsSync(join(repo, '.lawcheck')), false);
  });
});

test('test 98: a kept .gitignore, a law below the top, and no git', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/.gitignore': 'x\n' });
    const run = await lawcheck(repo, ['init']);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: created .lawcheck/law.yaml; kept .lawcheck/.gitignore');
    assert.equal(run.code, 0);
    assert.equal(readFileSync(join(repo, '.lawcheck/.gitignore'), 'utf8'), 'x\n');
  });
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    const api = join(repo, 'packages/api');
    mkdirSync(api, { recursive: true });
    const run = await lawcheck(api, ['init']);
    assert.deepEqual(run.stdout.split('\n').slice(0, 2), ['lawcheck: created .lawcheck/law.yaml and .lawcheck/.gitignore', 'note: the law covers only the files below packages/api/']);
    assert.equal(run.code, 0);
    assert.equal(readFileSync(join(repo, 'packages/api/.lawcheck/law.yaml'), 'utf8'), LAW_TEXT);
  });
  await inTemp(async (dir) => {
    const run = await lawcheck(dir, ['init']);
    assert.match(run.stdout, /^error\[no-git\]/m);
    assert.equal(run.code, 2);
    assert.equal(existsSync(join(dir, '.lawcheck')), false);
  });
});

test('init where .lawcheck is a file: internal, and its next line names init', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck': 'x\n' });
    // Today's behaviour, finding S5-4 of the stress round: internal where a named error belongs.
    const run = await lawcheck(repo, ['init'], {}, [], { internal: true });
    assert.match(run.stdout, /^error\[internal\]/m);
    assert.match(run.stdout, /^next: run lawcheck init again, and report the error if it stays$/m);
    assert.equal(run.code, 2);
    assert.equal(readFileSync(join(repo, '.lawcheck'), 'utf8'), 'x\n');
  });
});

test('test 99: JSON, usage, and already-initialized as a reserved rule id', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    const run = await lawcheck(repo, ['init', '--json']);
    assert.deepEqual(JSON.parse(run.stdout), {
      schema: 'lawcheck-init/0',
      root: '',
      created: ['.lawcheck/law.yaml', '.lawcheck/.gitignore'],
      kept: [],
      next: { command: null, text: 'describe your first file type in .lawcheck/law.yaml  (lawcheck docs first-law shows how)' },
    });
    assert.equal(run.code, 0);
  });
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    for (const args of [['init', 'x'], ['init', '--full']]) {
      const run = await lawcheck(repo, args);
      assert.match(run.stdout, /^error\[usage\]/m, args.join(' '));
      assert.equal(run.code, 2);
    }
    assert.equal(existsSync(join(repo, '.lawcheck')), false);
  });
  await inTemp(async (dir) => {
    const s = makeSample(dir, {
      onMain: (repo) => {
        const law = readFileSync(join(repo, '.lawcheck/law.yaml'), 'utf8');
        write(repo, '.lawcheck/law.yaml', law.replace('rules:\n', 'rules:\n  already-initialized:\n    why: x\n'));
        write(repo, '.lawcheck/rules/already-initialized.mjs', 'export function check() { return []; }\n');
      },
    });
    const run = await lawcheck(s, ['check', '--base', 'main']);
    assert.match(run.stdout, /error\[law-invalid\]/);
    assert.equal(run.code, 2);
  });
});
