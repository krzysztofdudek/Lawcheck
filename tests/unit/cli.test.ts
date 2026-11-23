import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, memoryError, parseArguments, readerGone } from '../../dist/cli.js';

const context = { cwd: '/', env: {} };

test('check-slice §6: a command that throws ends in exit 2 with internal', async () => {
  const result = await main(['check'], context, async () => {
    throw new Error('the handler broke\nsecond line');
  });
  assert.equal(result.code, 2);
  assert.match(result.stdout, /^error\[internal\] {2}the handler broke$/m);
  assert.doesNotMatch(result.stdout, /second line/);
  const json = await main(['check', '--json'], context, async () => {
    throw new TypeError('boom');
  });
  assert.equal(json.code, 2);
  assert.equal(JSON.parse(json.stdout).errors[0].code, 'internal');
});

test('check-slice §4: arguments', () => {
  const plain = { full: false, strict: false, base: null, review: false, again: false, maxCalls: null, paths: [] };
  assert.deepEqual(parseArguments(['check']), { options: plain });
  assert.deepEqual(parseArguments(['check', '--json', '--base', 'main', '--full']), { options: { ...plain, full: true, base: 'main' } });
  assert.deepEqual(parseArguments(['check', '--strict']), { options: { ...plain, full: true, strict: true } });
  assert.deepEqual(parseArguments(['check', '--max-calls', '0', '--again', '--review']), { options: { ...plain, review: true, again: true, maxCalls: 0 } });
  assert.deepEqual(parseArguments(['check', '--review', '--max-calls', '007']), { options: { ...plain, review: true, maxCalls: 7 } });
  for (const argv of [[], ['fix'], ['check', 'src', '--full'], ['check', '--base'], ['check', '--base', '-x'], ['check', '--base=main'], ['check', '--full', '--full'], ['check', '--json', '--json'], ['check', '--base', 'a', '--base', 'b'], ['check', '--strict', '--strict'], ['check', '--staged'], ['check', '--no-scripts'], ['check', '--dry-run'], ['check', '--review', '--max-calls', '1.5'], ['check', '--review', '--max-calls', ''], ['check', '--max-calls', '1']]) {
    assert.ok('problem' in parseArguments(argv), argv.join(' '));
  }
});

test('commands-slice §2: version and help exit 0', async () => {
  assert.deepEqual(await main(['--version'], context), { code: 0, stdout: '0.1.0-alpha.4\n' });
  for (const [argv, first] of [[['--help'], 'usage: lawcheck <command> [<arguments>] [--json]'], [['check', '--help'], 'usage: lawcheck check [--full] [--strict] [--base <ref>] [--review [--again] [--max-calls <n>]] [--json]']] as const) {
    const result = await main([...argv], context);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.split('\n')[0], first);
  }
});

test('test 240: R-82, a write that fails because the reader is gone is not a lost result, whichever code the system gives for it', () => {
  for (const code of ['EPIPE', 'ENOTCONN']) assert.equal(readerGone(Object.assign(new Error(code), { code })), true, code);
  for (const code of ['ENOSPC', 'EBADF', 'EPERM', 'EACCES', 'EIO']) assert.equal(readerGone(Object.assign(new Error(code), { code })), false, code);
  assert.equal(readerGone(new Error('no code')), false);
  assert.equal(readerGone(null), false);
});

test('R-121: memory-too-large names a step that fits what the run was reading: a may_use list, a script rule, a companion, or a file read for what it declares', () => {
  const next = (found: 'file' | 'run', what: string, file: string | null) => memoryError(found, what, file, 'check').next;
  const again = 'then run lawcheck check again';
  assert.equal(next('file', 'reading the uses of a.ts', 'a.ts'), `leave a.ts out of the types whose may_use is in force, ${again}`);
  assert.equal(next('file', 'reading the uses of a.ts for the script rule no-todo', 'a.ts'), `leave a.ts out of the types whose files the script rule no-todo judges, or keep the rule from calling uses() on it, ${again}`);
  assert.equal(next('file', 'reading the tree of a.ts for the script rule no-todo', 'a.ts'), `leave a.ts out of the types whose files the script rule no-todo judges, or keep the rule from calling tree() on it, ${again}`);
  assert.equal(next('file', 'reading the uses of a.ts for the companion of the reviewer rule spec-of-test', 'a.ts'), `leave a.ts out of the types whose files the reviewer rule spec-of-test judges, or keep its companion from calling uses() on it, ${again}`);
  assert.equal(next('file', 'reading what A.cs declares for the script rule no-todo', 'A.cs'), `keep A.cs out of the files git lists here (git rm --cached, and a line in .gitignore), since Lawcheck reads it for what it declares, ${again}`);
  assert.equal(next('run', 'resolving the uses for the script rule no-todo', null), `narrow the types whose files the script rule no-todo judges in .lawcheck/law.yaml, or run Lawcheck where it may hold more memory, ${again}`);
  assert.equal(next('run', 'resolving the uses', null), `narrow the types whose may_use is in force in .lawcheck/law.yaml, or run Lawcheck where it may hold more memory, ${again}`);
});
