import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { withFake } from '../acceptance/fake-reviewer.ts';
import { F, F_PATH, inTemp, newRepository, withR, withSample, write } from '../acceptance/helpers.ts';
import { platformSkip } from '../harness/tool.ts';
import { errorLines, run } from './support.ts';


test('S1-7: test 244: a folder that cannot be read is file-unreadable for the typed files below it, and a law that cannot be read is law-invalid', async (t) => {
  const skipped = platformSkip('the whole test');
  if (skipped !== null) return t.skip(skipped);
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

test('S5-4: test 241: init where .lawcheck is a symbolic link to nothing names it', async (t) => {
  const skipped = platformSkip('the whole test');
  if (skipped !== null) return t.skip(skipped);
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


test('test 260: a named pipe is no regular file: explain names it, and as .lawcheck/verdicts it is file-unreadable, with no call', async (t) => {
  const skipped = platformSkip('the whole test');
  if (skipped !== null) return t.skip(skipped);
  await withSample(async (s) => {
    execFileSync('mkfifo', [join(s, 'src/core/pipe.ts')]);
    const explained = await run(s, ['explain', 'src/core/pipe.ts'], { budget: 'LIMITS_RUN_MS' });
    assert.equal(explained.stdout, 'src/core/pipe.ts\n  type:  none: it is no regular file, which has no type\n');
    assert.equal(explained.code, 0);
    const checked = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
    assert.equal(checked.stdout, 'lawcheck: PASS  nothing changed against main\n');
    assert.equal(checked.code, 0);
  });
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      execFileSync('mkfifo', [join(r, '.lawcheck/verdicts')]);
      for (const args of [['check', '--base', 'main'], ['check', '--review', '--base', 'main']]) {
        const result = await run(r, args, { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, budget: 'LIMITS_RUN_MS' });
        assert.deepEqual(errorLines(result.stdout), ['.lawcheck/verdicts  error[file-unreadable]  the file cannot be read (it is no regular file)'], args.join(' '));
        assert.equal(result.code, 2, args.join(' '));
      }
      assert.equal(fake.requests.length, 0);
    });
  });
});
