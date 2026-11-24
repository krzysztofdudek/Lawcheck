import { test } from 'node:test';
import { exampleText } from '../harness/examples.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GITIGNORE, lawText, writeNew } from '../../dist/init.js';
import { parseLaw } from '../../dist/law.js';
import { inTemp, lawcheck, makeSample, newRepository } from '../acceptance/helpers.ts';

test('commands-slice §3: the law init writes reads as a law with no types and no rules', () => {
  const { law, problems } = parseLaw(lawText('0.1.0'));
  assert.deepEqual(problems, []);
  assert.equal(law!.types.length, 0);
  assert.equal(law!.rules.size, 0);
});

test('commands-slice §3: the version line takes MAJOR.MINOR.PATCH of the package version', () => {
  assert.equal(lawText('1.2.3-beta.4').split('\n')[0], 'lawcheck: 1.2.3');
  assert.equal(lawText('0.1.0').split('\n')[0], 'lawcheck: 0.1.0');
});

test('commands-slice §3: the .gitignore keeps the local folder and the local settings out of git', () => {
  assert.equal(GITIGNORE, exampleText('init-gitignore'));
});

test('commands-slice §3: a file that exists is never written over', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-init-'));
  try {
    const path = join(dir, 'law.yaml');
    writeFileSync(path, 'kept\n');
    assert.equal(writeNew(path, 'new\n'), false);
    assert.equal(readFileSync(path, 'utf8'), 'kept\n');
    assert.equal(writeNew(join(dir, 'fresh.yaml'), 'new\n'), true);
    assert.equal(readFileSync(join(dir, 'fresh.yaml'), 'utf8'), 'new\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const WHY = "  why:  a second law would split one repository's rules between two files\n";
const NEXT_DOCTOR = 'next: lawcheck doctor  (shows how the law here stands)\n';

test('R-41: init where a law already governs names the law in the words of its own, in text and in JSON, from the top and from a folder below it', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    await lawcheck(repo, ['init']);
    const again = await lawcheck(repo, ['init']);
    assert.equal(again.stdout, `lawcheck: ERROR  1 error\n\n.lawcheck/law.yaml  error[already-initialized]  a law already governs this directory\n${WHY}\n${NEXT_DOCTOR}`);
    assert.equal(again.code, 2);
    const json = await lawcheck(repo, ['init', '--json']);
    assert.deepEqual(JSON.parse(json.stdout), {
      schema: 'lawcheck-error/1',
      errors: [{ code: 'already-initialized', file: '.lawcheck/law.yaml', line: null, message: 'a law already governs this directory', why: "a second law would split one repository's rules between two files" }],
      next: { command: 'lawcheck doctor', text: 'lawcheck doctor  (shows how the law here stands)' },
    });
    const extra = await lawcheck(repo, ['init', 'x']);
    assert.equal(extra.stdout, "lawcheck: ERROR  1 error\n\nerror[usage]  unexpected argument 'x'; init takes no arguments\n  why:  the tool does only what its usage line says\n\nnext: run lawcheck init as its usage line says: lawcheck init --help\n");
    assert.equal(extra.code, 2);
  });
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    const below = await lawcheck(join(s, 'src/core'), ['init']);
    assert.equal(below.stdout, `lawcheck: ERROR  1 error\n\n../../.lawcheck/law.yaml  error[already-initialized]  a law already governs this directory\n${WHY}\n${NEXT_DOCTOR}`);
  });
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { 'packages/api/.lawcheck/law.yaml': 'lawcheck: 0.1.0\n' });
    const run = await lawcheck(repo, ['init']);
    assert.equal(run.stdout, `lawcheck: ERROR  1 error\n\npackages/api/.lawcheck/law.yaml  error[already-initialized]  a law already governs a directory below this one\n${WHY}\n${NEXT_DOCTOR}`);
    assert.equal(run.code, 2);
  });
});

test('R-41: init where .lawcheck is a file, or a link to a file or to nothing, says which and what to do', async () => {
  const said = (what: string) => `lawcheck: ERROR  1 error\n\n.lawcheck  error[file-unwritable]  ${what}, so the folder .lawcheck cannot be made\n  why:  what Lawcheck cannot write is lost, so the run cannot say it is done\n\nnext: move .lawcheck out of the way, then run lawcheck init again\n`;
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { 'target.txt': 'x\n' });
    writeFileSync(join(repo, '.lawcheck'), 'x');
    const run = await lawcheck(repo, ['init']);
    assert.equal(run.stdout, said('it is a file'));
    assert.equal(run.code, 2);
  });
  for (const [name, target, what] of [['a link to a file', 'target.txt', 'it is a symbolic link to a file'], ['a link to nothing', 'missing', 'it is a symbolic link to a place that does not exist']] as const) {
    await inTemp(async (dir) => {
      const repo = newRepository(dir, { 'target.txt': 'x\n' });
      try {
        symlinkSync(join(repo, target), join(repo, '.lawcheck'));
      } catch (error) {
        assert.equal(process.platform, 'win32', `${name}: ${String(error)}`);
        return;
      }
      const run = await lawcheck(repo, ['init']);
      assert.equal(run.stdout, said(what), name);
      assert.equal(run.code, 2, name);
    });
  }
});

test('R-41: a file that cannot be made is file-unwritable, with the code of the failure and the place', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-init-'));
  try {
    assert.throws(
      () => writeNew(join(dir, 'missing', 'law.yaml'), 'x\n', '.lawcheck/law.yaml'),
      (error: unknown) => {
        const { errors } = error as { errors: { code: string; file: string; line: null; message: string; next: string }[] };
        assert.deepEqual(errors, [{ code: 'file-unwritable', file: '.lawcheck/law.yaml', line: null, message: 'cannot be written (ENOENT)', next: 'make .lawcheck/law.yaml writable, then run lawcheck init again' }]);
        return true;
      },
    );
    assert.equal(writeNew(join(dir, 'made.yaml'), 'x\n'), true);
    assert.equal(writeNew(join(dir, 'made.yaml'), 'y\n'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
