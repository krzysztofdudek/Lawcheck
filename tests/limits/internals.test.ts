import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { inTemp, newRepository, withSample } from '../acceptance/helpers.ts';
import { run } from './support.ts';

const UNREADABLE = process.platform === 'win32' ? 'chmod on Windows sets only the read-only flag, so a folder cannot be made unreadable' : process.getuid?.() === 0 ? 'chmod cannot make a folder unreadable for root' : false;

test('S1-7: test 244: a folder that cannot be read is file-unreadable for the typed files below it, and a law that cannot be read is law-invalid', { skip: UNREADABLE }, async () => {
  await withSample(async (s) => {
    chmodSync(join(s, 'src/cli'), 0o000);
    try {
      const result = await run(s, ['check', '--base', 'main']);
      assert.equal(
        result.stdout,
        ['lawcheck: ERROR  1 error', '', 'src/cli/main.ts  error[file-unreadable]  the file cannot be read (EACCES)', '  why:  a file that cannot be read cannot be typed or judged', '', 'next: make src/cli/main.ts readable, then run lawcheck check', ''].join('\n'),
      );
      assert.equal(result.code, 2);
    } finally {
      chmodSync(join(s, 'src/cli'), 0o755);
    }
    chmodSync(join(s, '.lawcheck'), 0o000);
    try {
      const result = await run(s, ['check', '--base', 'main']);
      assert.equal(
        result.stdout,
        ['lawcheck: ERROR  1 error', '', '.lawcheck/law.yaml:1  error[law-invalid]  the law cannot be read (EACCES)', '  why:  a misspelled key changes the law without a word', '', 'next: fix .lawcheck/law.yaml, then run lawcheck check', ''].join('\n'),
      );
      assert.equal(result.code, 2);
    } finally {
      chmodSync(join(s, '.lawcheck'), 0o755);
    }
  });
});

test('S5-6: test 245: explain on a path that cannot exist is usage, not internal', async () => {
  await withSample(async (s) => {
    for (const path of [`src/core/${'a'.repeat(300)}.ts`, Array.from({ length: 2500 }, () => 'd').join('/')]) {
      const result = await run(s, ['explain', path]);
      assert.equal(
        result.stdout,
        [
          'lawcheck: ERROR  1 error',
          '',
          `error[usage]  the path '${path}' cannot exist here: it is longer than this system allows for a name or a path`,
          '  why:  the tool does only what its usage line says',
          '',
          'next: run lawcheck explain as its usage line says: lawcheck explain --help',
          '',
        ].join('\n'),
        path.slice(0, 20),
      );
      assert.equal(result.code, 2);
    }
  });
});

test('S5-4: test 241: init where .lawcheck is a symbolic link to nothing names it', { skip: process.platform === 'win32' ? 'a symbolic link on Windows needs a right a test user does not have' : false }, async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    symlinkSync(join(dir, 'nowhere'), join(repo, '.lawcheck'));
    const result = await run(repo, ['init']);
    assert.equal(
      result.stdout,
      [
        'lawcheck: ERROR  1 error',
        '',
        '.lawcheck  error[file-unwritable]  it is a symbolic link to a place that does not exist, so the folder .lawcheck cannot be made',
        '  why:  what Lawcheck cannot write is lost, so the run cannot say it is done',
        '',
        'next: move .lawcheck out of the way, then run lawcheck init again',
        '',
      ].join('\n'),
    );
    assert.equal(result.code, 2);
    assert.equal(existsSync(join(dir, 'nowhere')), false);
  });
});
