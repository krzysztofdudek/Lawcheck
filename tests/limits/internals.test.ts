import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withFake } from '../acceptance/fake-reviewer.ts';
import { F, F_PATH, inTemp, newRepository, withR, withSample, write } from '../acceptance/helpers.ts';
import { platformSkip } from '../harness/tool.ts';
import { errorLines, run } from './support.ts';


test('test 244: S1-7, a folder that cannot be read is file-unreadable for the typed files below it, and a law that cannot be read is law-invalid', async (t) => {
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

test('S1-7: a corrupt .git/index is no-git with git\'s sentence and a step that repairs the repository, for check, doctor, explain and try', async () => {
  await withSample(async (s) => {
    writeFileSync(join(s, '.git/index'), 'garbage\n');
    const sentence = 'git cannot read this repository: fatal: .git/index: index file smaller than expected';
    for (const [args, command] of [
      [['check', '--base', 'main'], 'check'],
      [['explain', 'src/core/price.ts'], 'explain'],
      [['try', 'no-console', 'src/core/price.ts'], 'try'],
    ] as const) {
      const result = await run(s, [...args]);
      assert.equal(result.code, 2, args.join(' '));
      assert.equal(
        result.stdout,
        ['lawcheck: ERROR  1 error', '', `error[no-git]  ${sentence}`, '  why:  the files and the change come from git', '', `next: repair the repository, so that git status works here, then run lawcheck ${command}${command === 'check' ? '' : ' again'}`, ''].join('\n'),
        args.join(' '),
      );
    }
    const doctor = await run(s, ['doctor']);
    assert.equal(doctor.code, 2);
    assert.ok(doctor.stdout.includes(`fail  law  ${sentence}\n  next: repair the repository, so that git status works here, then run lawcheck doctor again\n`), doctor.stdout);
  });
});

test('test 245: S5-6, explain on a path that cannot exist is usage, not internal', async () => {
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

test('test 241: S5-4, init where .lawcheck is a symbolic link to nothing names it', async (t) => {
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


for (const [what, make, cause] of [
  ['a folder', (path: string) => mkdirSync(path), 'EISDIR'],
  ['a symbolic link to nothing', (path: string) => symlinkSync(join(path, '../nowhere.yaml'), path), 'ENOENT'],
] as const) {
  test(`S5-5: .lawcheck/law.yaml is ${what}, so init sends the user to doctor, and doctor and check say the law cannot be read`, async (t) => {
    if (cause === 'ENOENT') {
      const skipped = platformSkip('the whole test');
      if (skipped !== null) return t.skip(skipped);
    }
    await inTemp(async (dir) => {
      const repo = newRepository(dir);
      mkdirSync(join(repo, '.lawcheck'));
      make(join(repo, '.lawcheck/law.yaml'));
      const init = await run(repo, ['init']);
      assert.equal(init.code, 2);
      assert.deepEqual(errorLines(init.stdout), ['.lawcheck/law.yaml  error[already-initialized]  a law already governs this directory']);
      assert.match(init.stdout, /\nnext: lawcheck doctor /);
      const doctor = await run(repo, ['doctor']);
      assert.equal(doctor.code, 2);
      assert.ok(doctor.stdout.includes(`fail  law  .lawcheck/law.yaml:1  the law cannot be read (${cause})\n  next: fix .lawcheck/law.yaml, then run lawcheck doctor again\n`), doctor.stdout);
      const checked = await run(repo, ['check']);
      assert.equal(checked.code, 2);
      assert.deepEqual(errorLines(checked.stdout), [`.lawcheck/law.yaml:1  error[law-invalid]  the law cannot be read (${cause})`]);
    });
  });
}

test('S5-5: init where .lawcheck/.gitignore is a folder writes nothing and names it, and does not call it kept', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    mkdirSync(join(repo, '.lawcheck/.gitignore'), { recursive: true });
    const result = await run(repo, ['init']);
    assert.equal(
      result.stdout,
      [
        'lawcheck: ERROR  1 error',
        '',
        '.lawcheck/.gitignore  error[file-unwritable]  it is a folder, so the file .lawcheck/.gitignore cannot be written',
        '  why:  what Lawcheck cannot write is lost, so the run cannot say it is done',
        '',
        'next: move .lawcheck/.gitignore out of the way, then run lawcheck init again',
        '',
      ].join('\n'),
    );
    assert.equal(result.code, 2);
    assert.equal(existsSync(join(repo, '.lawcheck/law.yaml')), false);
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
