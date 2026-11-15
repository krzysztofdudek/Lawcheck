import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultAnswer, openai, withFake } from '../acceptance/fake-reviewer.ts';
import { D, D_PATH, F, F_PATH, F_PRIME, REVIEWER_LAW, withR, withSample, write } from '../acceptance/helpers.ts';
import { errorLines, MiB, run, sparse, textHead } from './support.ts';

const REVIEW = ['check', '--review', '--base', 'main'];

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

test('S3-8: test 242: a review whose .lawcheck/.local cannot be written fails before the first call', async () => {
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

test('S3-8: test 242: a write that fails after the calls is file-unwritable, not internal', async () => {
  await withR(async (r) => {
    await withFake(
      async (fake) => {
        write(r, F_PATH, F);
        const result = await run(r, REVIEW, { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url } });
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

test('S3-6: test 243: a plain check right after a passing review passes, with a type whose paths cover .lawcheck/', async () => {
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        write(r, F_PATH, F_PRIME);
        const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.url };
        const reviewed = await run(r, REVIEW, { env });
        assert.equal(reviewed.stdout, 'lawcheck: PASS  1 changed file (against main), 1 waiver, 1 reviewer call\n');
        assert.equal(reviewed.code, 0);
        const plain = 'lawcheck: PASS  3 changed files (against main), 1 waiver\n';
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

test('S3-6: test 243: a second run right after any run prints the same', async () => {
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
      const result = await run(r, REVIEW, { env: { LAWCHECK_REVIEWER_ENDPOINT: fake.url }, budgetMs: 30_000 });
      assert.equal(result.stdout, 'lawcheck: PASS  1 changed file (against main), 1 waiver, 1 reviewer call\n');
      assert.equal(result.code, 0);
      assert.ok(result.ms < 5_000, String(result.ms));
      assert.equal(existsSync(lock), false);
    });
  });
});

test('test 266: a verdicts file over 16 MiB is file-unreadable, not read whole', async () => {
  await withR(async (r) => {
    write(r, F_PATH, F);
    sparse(r, '.lawcheck/verdicts', textHead(''), 16 * MiB + 1);
    const result = await run(r, ['check', '--base', 'main']);
    assert.equal(
      result.stdout,
      ['lawcheck: ERROR  1 error', '', '.lawcheck/verdicts  error[file-unreadable]  the file cannot be read (it holds more than 16 MiB)', '  why:  a file that cannot be read cannot be typed or judged', '', 'next: remove the lines of .lawcheck/verdicts that no review of this law needs, then run lawcheck check', ''].join('\n'),
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
              '.lawcheck/verdicts  error[file-unwritable]  cannot be written (with the passes of this run it would hold more than 16 MiB, the most a run reads of it)',
              '  why:  what Lawcheck cannot write is lost, so the run cannot say it is done',
              '',
              'next: remove the lines of .lawcheck/verdicts that no review of this law needs, then run lawcheck check again',
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
