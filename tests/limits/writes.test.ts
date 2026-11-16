import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { append, D, D_PATH, GIT_ENV, inTemp, newRepository, setRule, withSample, write } from '../acceptance/helpers.ts';
import { platformSkip, startByHand } from '../harness/tool.ts';

const LOST = /^error\[file-unwritable\]  standard output cannot be written \(([A-Z]+)\), so the result is lost\n$/;

// Every command, in the sample on work with D added: a failing check, a passing one, an error, JSON, and each other command.
const COMMANDS: string[][] = [
  ['--version'],
  ['--help'],
  ['check', '--help'],
  ['check', '--base', 'main'],
  ['check', '--base', 'main', '--json'],
  ['check', '--base', 'main', '--full'],
  ['check', 'src/cli/main.ts'],
  ['check', '--base', 'nope'],
  ['prime'],
  ['docs'],
  ['docs', 'law'],
  ['explain', 'src/core/price.ts'],
  ['try', 'no-todo', 'src/core/tax.ts'],
  ['doctor'],
];

async function everyCommand(stdout: () => number, expectCode: (code: string) => void): Promise<void> {
  await withSample(async (s) => {
    write(s, D_PATH, D);
    for (const args of COMMANDS) {
      const fd = stdout();
      try {
        const result = await startByHand(s, args, GIT_ENV, { stdout: fd });
        const lost = LOST.exec(result.stderr);
        assert.ok(lost, `${args.join(' ')}: ${JSON.stringify(result.stderr)}`);
        expectCode(lost![1]!);
        assert.equal(result.code, 2, args.join(' '));
      } finally {
        closeSync(fd);
      }
    }
  });
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    const fd = stdout();
    try {
      const result = await startByHand(repo, ['init'], GIT_ENV, { stdout: fd });
      assert.ok(LOST.test(result.stderr), result.stderr);
      assert.equal(result.code, 2);
    } finally {
      closeSync(fd);
    }
  });
}

test('test 240: S1-6, S5-13, S8-8, every command writing to /dev/full ends with exit 2 and says the result is lost', async (t) => {
  const skipped = platformSkip('the whole test');
  if (skipped !== null) return t.skip(skipped);
  await everyCommand(() => openSync('/dev/full', 'w'), (code) => assert.equal(code, 'ENOSPC'));
});

test('test 240: S1-6, S5-13, S8-8, every command writing to an output opened only for reading ends with exit 2', async () => {
  await inTemp(async (dir) => {
    const file = join(dir, 'read-only');
    writeFileSync(file, '');
    await everyCommand(() => openSync(file, 'r'), (code) => assert.ok(['EBADF', 'EPERM', 'EACCES'].includes(code), code));
  });
});

test('test 240: S1-6, a closed standard output is the same as one sent to /dev/null', async (t) => {
  const skipped = platformSkip('the whole test');
  if (skipped !== null) return t.skip(skipped);
  await withSample(async (s) => {
    append(s, 'src/cli/main.ts', "console.log('done');\n");
    for (const args of [['check', '--base', 'main'], ['prime'], ['--version']]) {
      const closed = await startByHand(s, args, GIT_ENV, { redirect: '>&-' });
      const devNull = await startByHand(s, args, GIT_ENV, { redirect: '>/dev/null' });
      assert.equal(closed.code, devNull.code, args.join(' '));
      assert.equal(closed.stderr, devNull.stderr, args.join(' '));
      assert.equal(closed.code, 0, args.join(' '));
    }
    write(s, D_PATH, D);
    assert.equal((await startByHand(s, ['check', '--base', 'main'], GIT_ENV, { redirect: '>&-' })).code, 1);
    assert.equal((await startByHand(s, ['check', '--base', 'main'], GIT_ENV, { redirect: '>/dev/null' })).code, 1);
  });
});

test('test 240: S8-8, a reader that stops early ends the run with its own code and nothing on standard error', async () => {
  const many = "export function check() { return Array.from({ length: 60000 }, () => ({ message: 'm' })); }\n";
  await withSample(
    async (s) => {
      write(s, D_PATH, D);
      const { code, stderr } = await startByHand(s, ['check', '--base', 'main', '--json'], GIT_ENV, { closeAfterFirst: true });
      assert.equal(stderr, '');
      assert.equal(code, 1);
    },
    { onMain: (s) => setRule(s, 'no-console', many) },
  );
});
