import { test } from 'node:test';
import { exampleText } from '../harness/examples.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
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

test('test 241: S5-4, init where .lawcheck is a file names it', async () => {
  const obstacle = (what: string) =>
    [
      'lawcheck: ERROR  1 error',
      '',
      `.lawcheck  error[file-unwritable]  it is ${what}, so the folder .lawcheck cannot be made`,
      '  why:  what Lawcheck cannot write is lost, so the run cannot say it is done',
      '',
      'next: move .lawcheck out of the way, then run lawcheck init again',
      '',
    ].join('\n');
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck': 'x\n' });
    const run = await lawcheck(repo, ['init']);
    assert.equal(run.stdout, obstacle('a file'));
    assert.equal(run.stderr, '');
    assert.equal(run.code, 2);
    assert.equal(readFileSync(join(repo, '.lawcheck'), 'utf8'), 'x\n');
  });
});

test('S5-7: init where .gitignore names .lawcheck says that git ignores the law, in text and in JSON, and doctor says it too', async () => {
  const note =
    'note: git ignores .lawcheck/law.yaml, so no commit carries the law and no other checkout has it; remove the line that ignores it, as `git check-ignore -v .lawcheck/law.yaml` shows';
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.gitignore': '.lawcheck\n' });
    const run = await lawcheck(repo, ['init']);
    assert.deepEqual(run.stdout.split('\n'), [
      'lawcheck: created .lawcheck/law.yaml and .lawcheck/.gitignore',
      note,
      '',
      'Nothing is checked yet: the law has no types.',
      'next: describe your first file type in .lawcheck/law.yaml  (lawcheck docs first-law shows how)',
      '',
    ]);
    assert.equal(run.code, 0);
    const doctor = await lawcheck(repo, ['doctor']);
    assert.match(doctor.stdout, /^note {2}law {2}\.lawcheck\/law\.yaml: 0 types, 0 rules \(0 script, 0 reviewer\); git ignores it, so no other checkout has the law$/m);
    assert.match(doctor.stdout, /^ {2}next: remove the line that ignores \.lawcheck\/law\.yaml, as `git check-ignore -v \.lawcheck\/law\.yaml` shows, then run lawcheck doctor again$/m);
    assert.equal(doctor.code, 0);
  });
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.gitignore': '.lawcheck/\n' });
    const run = await lawcheck(repo, ['init', '--json']);
    const document = JSON.parse(run.stdout);
    assert.equal(document.next.text, 'git ignores .lawcheck/law.yaml, so remove the line that ignores it, then describe your first file type in .lawcheck/law.yaml  (lawcheck docs first-law shows how)');
    assert.deepEqual(document.created, ['.lawcheck/law.yaml', '.lawcheck/.gitignore']);
    assert.equal(run.code, 0);
  });
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    const run = await lawcheck(repo, ['init']);
    assert.ok(!run.stdout.includes('git ignores'), run.stdout);
    const doctor = await lawcheck(repo, ['doctor']);
    assert.ok(!doctor.stdout.includes('git ignores'), doctor.stdout);
  });
});

test('S5-7: init and doctor where .lawcheck is a symbolic link to a folder write through it and pass with no note, never internal', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    mkdirSync(join(repo, 'shared'));
    symlinkSync(join(repo, 'shared'), join(repo, '.lawcheck'), process.platform === 'win32' ? 'junction' : 'dir');
    const run = await lawcheck(repo, ['init'], {}, [], { writes: [/^shared\/(law\.yaml|\.gitignore)$/] });
    assert.equal(run.stdout, CREATED, run.stdout);
    assert.equal(run.code, 0);
    assert.equal(existsSync(join(repo, 'shared/law.yaml')), true);
    const doctor = await lawcheck(repo, ['doctor']);
    assert.match(doctor.stdout, /^ok {2}law {2}\.lawcheck\/law\.yaml: 0 types, 0 rules \(0 script, 0 reviewer\)$/m, doctor.stdout);
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

test('R-3: init above a sample repository with a law of its own refuses and writes nothing, doctor sends the user into the sample, and a law written by hand at the top governs the top while the sample keeps its own', async () => {
  const law = (path: string) => `lawcheck: 0.1.0\n\ntypes:\n  files:\n    about: The files of this folder.\n    paths: ["${path}"]\n`;
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { 'src/a.ts': 'export const a = 1;\n', 'tests/sample/src/b.ts': 'export const b = 1;\n', 'tests/sample/.lawcheck/law.yaml': law('src/**/*.ts') });
    const init = await lawcheck(repo, ['init']);
    assert.match(init.stdout, /^tests\/sample\/\.lawcheck\/law\.yaml {2}error\[already-initialized\]  a law already governs a directory below this one$/m);
    assert.match(init.stdout, /^next: to govern this folder instead, write \.lawcheck\/law\.yaml here by hand  \(lawcheck docs first-law shows how\)$/m);
    assert.equal(init.code, 2);
    assert.equal(existsSync(join(repo, '.lawcheck')), false);
    const doctor = await lawcheck(repo, ['doctor']);
    assert.match(doctor.stdout, /^fail {2}law {2}no \.lawcheck\/law\.yaml in this directory or any above it; the laws below it are in tests\/sample$/m);
    assert.match(doctor.stdout, /^ {2}next: cd tests\/sample, where a law is, then run lawcheck doctor again$/m);
    assert.match(doctor.stdout, /^ {2}to govern this folder instead, write \.lawcheck\/law\.yaml here by hand  \(lawcheck docs first-law shows how\)$/m);
    assert.ok(!/lawcheck init/.test(doctor.stdout), doctor.stdout);
    write(repo, '.lawcheck/law.yaml', law('src/**/*.ts'));
    const top = await lawcheck(repo, ['check', '--full']);
    assert.equal(top.code, 0, top.stdout);
    const sample = await lawcheck(join(repo, 'tests/sample'), ['check', '--full']);
    assert.equal(sample.code, 0, sample.stdout);
    assert.match(top.stdout, /^lawcheck: PASS {2}\d+ files/);
  });
});
