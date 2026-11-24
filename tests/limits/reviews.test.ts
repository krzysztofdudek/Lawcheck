import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { closeSync, constants, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultAnswer, openai, withFake } from '../acceptance/fake-reviewer.ts';
import { D, D_PATH, F, F_PATH, F_PRIME, KEY_F, KEY_F_PRIME, REVIEWER_LAW, withR, withSample, write } from '../acceptance/helpers.ts';
import { errorLines, MiB, run, sparse, textHead } from './support.ts';
import { LOCK_HELD_LOOK_MS } from '../numbers.ts';
import { platformSkip } from '../harness/tool.ts';

const REVIEW = ['check', '--review', '--base', 'main'];

const LOCK_TOUCH_MS = 250;

// The review calls a verdicts lock stale ten seconds after its folder's time (LOCK_WAIT_MS in src/verdicts.ts), however long its holder lives, so a test that holds the lock while a slow review gets to it touches the folder as it waits.
function keepLock(lock: string): () => void {
  const timer = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(lock, now, now);
    } catch {
      // The test has let go of the lock.
    }
  }, LOCK_TOUCH_MS);
  timer.unref();
  return () => clearInterval(timer);
}

function unwritable(path: string, message: string): string {
  return [
    'lawcheck: ERROR  1 error',
    '',
    `${path}  error[file-unwritable]  ${message}`,
    '  why:  what Lawcheck cannot write is lost, so the run cannot say it is done',
    '',
    `next: make ${path} writable, then run lawcheck check again`,
    '',
  ].join('\n');
}

test('test 242: S3-8, a review whose .lawcheck/.local cannot be written fails before the first call', async () => {
  const cases: [string, (r: string) => void][] = [
    ['.lawcheck/.local', (r) => writeFileSync(join(r, '.lawcheck/.local'), '')],
    ['.lawcheck/.local/failures', (r) => {
      mkdirSync(join(r, '.lawcheck/.local'), { recursive: true });
      writeFileSync(join(r, '.lawcheck/.local/failures'), '');
    }],
  ];
  for (const [path, block] of cases) {
    await withFake(async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        block(r);
        const result = await run(r, REVIEW, { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url } });
        assert.equal(result.stdout, unwritable(path, 'cannot be written (EEXIST)'), path);
        assert.equal(result.stderr, '', path);
        assert.equal(result.code, 2, path);
        assert.equal(fake.requests.length, 0, path);
      });
    });
  }
});

test('test 242: S3-8, a write that fails after the calls is file-unwritable, not internal', async () => {
  await withR(async (r) => {
    await withFake(
      async (fake) => {
        write(r, F_PATH, F);
        const result = await run(r, REVIEW, { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, writes: [/^\.lawcheck\/\.local(\/|$)/] });
        assert.equal(result.stdout, unwritable('.lawcheck/.local', 'cannot be written (EEXIST), so the answers of the reviewer calls this run made are lost'));
        assert.equal(result.stderr, 'lawcheck: 1 reviewer call to openai-compatible\n');
        assert.equal(result.code, 2);
        assert.equal(fake.requests.length, 1);
      },
      (request) => {
        rmSync(join(r, '.lawcheck/.local'), { recursive: true, force: true });
        writeFileSync(join(r, '.lawcheck/.local'), '');
        return openai(defaultAnswer(request.prompt));
      },
    );
  });
});

test('test 242: a folder named .lawcheck/verdicts is file-unreadable, not internal', async () => {
  await withR(async (r) => {
    mkdirSync(join(r, '.lawcheck/verdicts/x'), { recursive: true });
    write(r, F_PATH, F);
    const result = await run(r, ['check', '--base', 'main']);
    assert.equal(
      result.stdout,
      ['lawcheck: ERROR  1 error', '', '.lawcheck/verdicts  error[file-unreadable]  the file cannot be read (EISDIR)', '  why:  a file that cannot be read cannot be typed or judged', '', 'next: make .lawcheck/verdicts readable, then run lawcheck check', ''].join('\n'),
    );
    assert.equal(result.code, 2);
  });
});

const LAW_DIR = `${REVIEWER_LAW}  law-files:\n    paths: [".lawcheck/**"]\n    rules: [clear-errors]\n`;

test('test 243: S3-6, a plain check right after a passing review passes, with a type whose paths cover .lawcheck/', async () => {
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        write(r, F_PATH, F_PRIME);
        const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.url };
        const reviewed = await run(r, REVIEW, { env });
        assert.equal(reviewed.stdout, 'lawcheck: PASS  1 changed file (against main), 1 waiver, 1 reviewer call\nnote: this change adds 1 waiver: clear-errors at src/core/refund.ts:3\n');
        assert.equal(reviewed.code, 0);
        const plain = 'lawcheck: PASS  3 changed files (against main), 1 waiver\nnote: this change adds 1 waiver: clear-errors at src/core/refund.ts:3\n';
        for (const args of [['check', '--base', 'main'], ['check', '--base', 'main'], REVIEW]) {
          const again = await run(r, args, { env });
          assert.equal(again.stdout, plain, args.join(' '));
          assert.equal(again.stderr, '', args.join(' '));
          assert.equal(again.code, 0, args.join(' '));
        }
        assert.equal(fake.requests.length, 1);
      },
      { onMain: (r) => writeFileSync(join(r, '.lawcheck/law.yaml'), LAW_DIR) },
    );
  });
});

test('test 243: S3-6, a second run right after any run prints the same', async () => {
  const commands = [
    ['check', '--base', 'main'],
    ['check', '--base', 'main', '--full'],
    ['check', '--base', 'main', '--json'],
    ['check', 'src/core'],
    ['explain', 'src'],
    ['explain', D_PATH],
    ['try', 'no-todo', 'src/core/tax.ts'],
    ['doctor', '--base', 'main'],
    ['prime'],
    ['docs', 'law'],
  ];
  await withSample(async (s) => {
    write(s, D_PATH, D);
    for (const args of commands) {
      const first = await run(s, args);
      const second = await run(s, args);
      assert.deepEqual({ stdout: second.stdout, stderr: second.stderr, code: second.code }, { stdout: first.stdout, stderr: first.stderr, code: first.code }, args.join(' '));
      assert.notEqual(first.code, null, args.join(' '));
    }
  });
});

test('test 261: a lock left by a run that ended, whose pid now names a live process, is taken over before the first call', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F_PRIME);
      const lock = join(r, '.lawcheck/.local/verdicts.lock');
      mkdirSync(lock, { recursive: true });
      writeFileSync(join(r, '.lawcheck/.local/.gitignore'), '*\n');
      writeFileSync(join(lock, 'pid'), String(process.pid));
      const old = new Date(Date.now() - 60_000);
      utimesSync(lock, old, old);
      const result = await run(r, REVIEW, { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, budget: 'LIMITS_RUN_MS', writes: [/^\.lawcheck\/\.local(\/|$)/] });
      assert.equal(result.stdout, 'lawcheck: PASS  1 changed file (against main), 1 waiver, 1 reviewer call\nnote: this change adds 1 waiver: clear-errors at src/core/refund.ts:3\n');
      assert.equal(result.code, 0);
      assert.ok(result.ms < 5_000, String(result.ms));
      assert.equal(existsSync(lock), false);
    });
  });
});

test('test 266: a verdicts file over 16 MiB is file-unreadable, not read whole', async () => {
  await withR(async (r) => {
    write(r, F_PATH, F);
    sparse(r, '.lawcheck/verdicts', textHead(`${KEY_F} clear-errors\n`), 16 * MiB + 1);
    const result = await run(r, ['check', '--base', 'main']);
    assert.equal(
      result.stdout,
      ['lawcheck: ERROR  1 error', '', '.lawcheck/verdicts  error[file-unreadable]  the file cannot be read (it holds more than 16 MiB); of its 1 pass the files of this tree need 1, and a review of every file of this law would take 3 reviewer calls', '  why:  a file that cannot be read cannot be typed or judged', '', "next: ask the user how to make room in .lawcheck/verdicts: its passes are hashes, so none can be told apart by hand", ''].join('\n'),
    );
    assert.equal(result.code, 2);
  });
});

test('test 267: a reviewer rule whose file is binary is law-invalid, as a binary context file is', async () => {
  await withR(async (r) => {
    write(r, '.lawcheck/rules/clear-errors.md', 'Errors say what to do.\n\0\n');
    const result = await run(r, ['check', '--base', 'main']);
    assert.deepEqual(errorLines(result.stdout), [".lawcheck/law.yaml:9  error[law-invalid]  the file .lawcheck/rules/clear-errors.md of the rule 'clear-errors' is binary"]);
    assert.equal(result.code, 2);
  });
});

test('test 271: a review whose passes would push .lawcheck/verdicts past 16 MiB is refused before its first call', async () => {
  const filler = (bytes: number) => {
    const line = 'x'.repeat(63) + '\n';
    return line.repeat(Math.floor(bytes / line.length)) + 'y'.repeat((bytes % line.length) - 1) + '\n';
  };
  for (const [room, refused] of [[60, true], [200, false]] as const) {
    await withFake(async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F_PRIME);
        write(r, 'src/core/refund2.ts', F_PRIME.replace('function refund', 'function refund2'));
        write(r, '.lawcheck/verdicts', filler(16 * MiB - room));
        const result = await run(r, REVIEW, { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url } });
        if (refused) {
          assert.equal(
            result.stdout,
            [
              'lawcheck: ERROR  1 error',
              '',
              '.lawcheck/verdicts  error[file-unwritable]  cannot be written (with the passes of this run it would hold more than 16 MiB, the most a run reads of it); of its 0 passes the files of this tree need 0, and a review of every file of this law would take 4 reviewer calls',
              '  why:  what Lawcheck cannot write is lost, so the run cannot say it is done',
              '',
              "next: ask the user how to make room in .lawcheck/verdicts: its passes are hashes, so none can be told apart by hand",
              '',
            ].join('\n'),
          );
          assert.equal(result.code, 2);
          assert.equal(fake.requests.length, 0);
        } else {
          assert.equal(result.code, 0, result.stdout);
          assert.equal(fake.requests.length, 2);
          assert.ok(statSync(join(r, '.lawcheck/verdicts')).size <= 16 * MiB);
        }
      });
    });
  }
});

// The test is the other run: it holds the lock while it reads the verdicts file and writes it back with a line of its own, as a run does. It writes once the review has reached the lock, however long the review takes to get there; held there, the review calls no reviewer until the test lets go, while a review the lock does not hold calls the fake within moments and writes in between, and the test's write loses that line.
test('R-76: test 253, two runs that write the verdicts file at once keep the lines of both, the second writing only once the first waits at the lock', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F_PRIME);
      const local = join(r, '.lawcheck/.local');
      const lock = join(local, 'verdicts.lock');
      const verdicts = join(r, '.lawcheck/verdicts');
      mkdirSync(lock, { recursive: true });
      writeFileSync(join(local, '.gitignore'), '*\n');
      writeFileSync(join(lock, 'pid'), String(process.pid));
      const madeAt = statSync(lock).mtimeMs;
      const letGo = keepLock(lock);
      const before = existsSync(verdicts) ? readFileSync(verdicts, 'utf8') : '';
      const review = run(r, REVIEW, { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, budget: 'LIMITS_RUN_MS', writes: [/^\.lawcheck\/\.local(\/|$)/] });
      await heldAtLock(local, review);
      const until = Date.now() + LOCK_HELD_LOOK_MS;
      while (fake.requests.length === 0 && Date.now() < until) await new Promise((done) => setTimeout(done, 20));
      assert.equal(fake.requests.length, 0, 'the review called the reviewer while the test held the lock');
      const touched = statSync(lock).mtimeMs > madeAt;
      letGo();
      assert.ok(touched, 'the lock kept the time it was made at, so a review that came ten seconds late would have taken it');
      const other = `${'0'.repeat(32)} clear-errors\n`;
      writeFileSync(verdicts, before + other);
      rmSync(lock, { recursive: true, force: true });
      const result = await review;
      assert.equal(result.code, 0, result.stdout);
      assert.equal(fake.requests.length, 1);
      assert.deepEqual(readFileSync(verdicts, 'utf8').split('\n').filter(Boolean).sort(), [other.trim(), `${KEY_F_PRIME} clear-errors`].sort());
    });
  });
});


// _O_TEMPORARY of the C runtime of Windows: libuv opens a path with it for DELETE and deletes it when the handle closes, which Node gives no other way to do.
const O_TEMPORARY = 0x40;

// On Windows a folder whose delete is pending keeps its name until the last handle on it closes, and making a folder of that name is refused with EPERM. A run that lets go of the lock while a waiting run has the folder or its pid open leaves it so for a moment; the test holds that moment: it empties the lock, keeps one handle on it and deletes it through a second, so the name stays until the test closes the first.
test('test 1230: a review waiting at the lock while Windows still holds the delete of the lock another run let go waits for the delete to end, and writes its pass', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F_PRIME);
      const local = join(r, '.lawcheck/.local');
      const lock = join(local, 'verdicts.lock');
      mkdirSync(lock, { recursive: true });
      writeFileSync(join(local, '.gitignore'), '*\n');
      writeFileSync(join(lock, 'pid'), String(process.pid));
      const letGo = keepLock(lock);
      const review = run(r, REVIEW, { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, budget: 'LIMITS_RUN_MS', writes: [/^\.lawcheck\/\.local(\/|$)/] });
      await heldAtLock(local, review);
      letGo();
      rmSync(join(lock, 'pid'));
      const held = openSync(lock, 'r');
      try {
        closeSync(openSync(lock, constants.O_RDONLY | O_TEMPORARY));
        assert.ok(readdirSync(local).includes('verdicts.lock'), 'the lock was deleted at once, so its delete is not pending');
        assert.throws(() => mkdirSync(lock), { code: 'EPERM' }, 'Windows made a folder whose delete is pending');
        const until = Date.now() + LOCK_HELD_LOOK_MS;
        while (Date.now() < until) await new Promise((done) => setTimeout(done, 20));
        assert.equal(fake.requests.length, 0, 'the review called the reviewer while the delete of the lock was pending');
      } finally {
        closeSync(held);
      }
      const result = await review;
      assert.equal(result.code, 0, result.stdout);
      assert.equal(fake.requests.length, 1);
      assert.ok(readFileSync(join(r, '.lawcheck/verdicts'), 'utf8').split('\n').includes(`${KEY_F_PRIME} clear-errors`));
    });
  });
});

function stop(path: string, message: string, next: string): string {
  return ['lawcheck: ERROR  1 error', '', `${path}  error[file-unwritable]  ${message}`, '  why:  what Lawcheck cannot write is lost, so the run cannot say it is done', '', `next: ${next}`, ''].join('\n');
}

// As in test 1230 the test holds the delete of the lock pending, here until the review has given up waiting, as a program that keeps the old lock open would.
test('test 1261: on Windows a review whose lock stays in a pending delete through the 10 seconds it waits stops with EPERM and says a program still holds the lock open', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F_PRIME);
      const local = join(r, '.lawcheck/.local');
      const lock = join(local, 'verdicts.lock');
      mkdirSync(lock, { recursive: true });
      writeFileSync(join(local, '.gitignore'), '*\n');
      const held = openSync(lock, 'r');
      let result: Awaited<ReturnType<typeof run>>;
      try {
        closeSync(openSync(lock, constants.O_RDONLY | O_TEMPORARY));
        assert.ok(readdirSync(local).includes('verdicts.lock'), 'the lock was deleted at once, so its delete is not pending');
        result = await run(r, REVIEW, { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, budget: 'LIMITS_RUN_MS', writes: [/^\.lawcheck\/\.local(\/|$)/] });
      } finally {
        closeSync(held);
      }
      assert.equal(result.stdout, stop('.lawcheck/.local/verdicts.lock', 'cannot be written (EPERM)', 'a program still holds .lawcheck/.local/verdicts.lock open, such as another Lawcheck run or a virus scanner: run lawcheck check again once it is closed'));
      assert.equal(result.code, 2);
      assert.equal(fake.requests.length, 0);
    });
  });
});

// (AD) is the right to add a subfolder: denied to everyone on .lawcheck/.local alone, it lets the review make files there, so the probe of the folder passes, and refuses the folder of the lock, whose name then is not listed, as a pending delete's is.
test('test 1260: on Windows a review whose .lawcheck/.local lets it make files but not folders stops at the lock with EPERM at once, with no call', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F_PRIME);
      const local = join(r, '.lawcheck/.local');
      mkdirSync(join(local, 'failures'), { recursive: true });
      writeFileSync(join(local, '.gitignore'), '*\n');
      execFileSync('icacls', [local, '/deny', '*S-1-1-0:(AD)']);
      let result: Awaited<ReturnType<typeof run>>;
      try {
        assert.throws(() => mkdirSync(join(local, 'verdicts.lock')), { code: 'EPERM' }, 'Windows let a folder be made where adding one is denied');
        result = await run(r, REVIEW, { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, budget: 'LIMITS_RUN_MS', writes: [/^\.lawcheck\/\.local(\/|$)/] });
      } finally {
        execFileSync('icacls', [local, '/remove:d', '*S-1-1-0']);
      }
      assert.equal(result.stdout, stop('.lawcheck/.local/verdicts.lock', 'cannot be written (EPERM)', 'let Lawcheck make folders in .lawcheck/.local, then run lawcheck check again'));
      assert.equal(result.code, 2);
      assert.equal(fake.requests.length, 0);
      assert.ok(result.ms < 5_000, `the review waited ${result.ms} ms for a folder it may not make`);
    });
  });
});

// The review makes `.lawcheck/.local/failures` after its check of the file's size and its probe of the folder, and just before it takes the lock; with the lock held by the test it waits there, so the folder's appearing is the event that shows the review is held.
async function heldAtLock(local: string, review: Promise<unknown>): Promise<void> {
  const failures = join(local, 'failures');
  let stop = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    const watcher = watch(local, () => {
      if (existsSync(failures)) resolve();
    });
    stop = () => watcher.close();
    if (existsSync(failures)) resolve();
  });
  const ended = review.then(() => {
    throw new Error('the review ended before it was held at the lock');
  });
  try {
    await Promise.race([held, ended]);
  } finally {
    stop();
  }
}

// As in R-76 the test is a second run holding the lock; it adds three passes, so the review's own pass would take the file past 16 MiB at the moment it writes.
test('test 272: R-84, a pass that would take the verdicts file past 16 MiB when it is written is refused, even after the check before the calls', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F_PRIME);
      const local = join(r, '.lawcheck/.local');
      const lock = join(local, 'verdicts.lock');
      const verdicts = join(r, '.lawcheck/verdicts');
      // Passes the tool keeps, each a line of 46 bytes, and a last one whose rule id brings the file to 16 MiB less 150 bytes.
      const size = 16 * MiB - 150;
      const count = Math.floor(size / 46) - 1;
      const lines: string[] = [];
      for (let i = 0; i < count; i++) lines.push(`${i.toString(16).padStart(32, '0')} clear-errors\n`);
      const rest = size - count * 46;
      lines.push(`${'f'.repeat(32)} ${'r'.repeat(rest - 34)}\n`);
      const filler = lines.join('');
      assert.equal(Buffer.byteLength(filler), size);
      writeFileSync(verdicts, filler);
      mkdirSync(lock, { recursive: true });
      writeFileSync(join(local, '.gitignore'), '*\n');
      writeFileSync(join(lock, 'pid'), String(process.pid));
      const review = run(r, REVIEW, { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, budget: 'LIMITS_RUN_MS', writes: [/^\.lawcheck\/\.local(\/|$)/, '.lawcheck/verdicts'] });
      await heldAtLock(local, review);
      writeFileSync(verdicts, filler + ['1', '2', '3'].map((d) => `${d.repeat(32)} clear-errors\n`).join(''));
      rmSync(lock, { recursive: true, force: true });
      const result = await review;
      assert.equal(
        result.stdout,
        [
          'lawcheck: ERROR  1 error',
          '',
          '.lawcheck/verdicts  error[file-unwritable]  cannot be written (with the passes of this run it would hold more than 16 MiB, the most a run reads of it), so the answers of the reviewer calls this run made are lost; of its 364,721 passes the files of this tree need 0, and a review of every file of this law would take 3 reviewer calls',
          '  why:  what Lawcheck cannot write is lost, so the run cannot say it is done',
          '',
          "next: ask the user how to make room in .lawcheck/verdicts: its passes are hashes, so none can be told apart by hand",
          '',
        ].join('\n'),
      );
      assert.equal(result.code, 2);
      assert.equal(fake.requests.length, 1);
      assert.ok(statSync(verdicts).size <= 16 * MiB);
    });
  });
});
