import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, readArguments, USAGE, PROGRAM_USAGE } from '../../dist/args.js';

const ok = (argv: string[]) => {
  const read = readArguments(argv);
  assert.ok('arguments' in read, argv.join(' '));
  return read.arguments;
};
const bad = (argv: string[]) => assert.ok('problem' in readArguments(argv), argv.join(' '));

test('commands-slice §2: no command and an unknown command name the seven commands', () => {
  for (const argv of [[], ['fix'], ['--json']]) {
    const read = readArguments(argv);
    assert.ok('problem' in read);
    assert.equal(read.command, null);
    assert.match(read.problem, /init, prime, check, explain, try, docs, doctor/);
  }
});

test('commands-slice §2: each command reads its own flags', () => {
  assert.deepEqual([...ok(['init', '--json']).flags], [['--json', true]]);
  assert.deepEqual(ok(['prime']).words, []);
  const explain = ok(['explain', '--type', 'source', '--json']);
  assert.equal(explain.flags.get('--type'), 'source');
  const tryIt = ok(['try', 'rule', 'a', 'b', '--times', '3', '--dry-run', '--max-calls', '007']);
  assert.deepEqual(tryIt.words, ['rule', 'a', 'b']);
  assert.equal(tryIt.flags.get('--times'), '3');
  assert.equal(tryIt.flags.get('--max-calls'), '007');
  assert.deepEqual(ok(['docs', 'law']).words, ['law']);
  const doctor = ok(['doctor', '--base', 'main', '--reviewer']);
  assert.equal(doctor.flags.get('--base'), 'main');
  assert.equal(doctor.flags.get('--reviewer'), true);
});

test('commands-slice §2: flags another command owns, twice, without a value, or with =, are refused', () => {
  for (const argv of [
    ['init', '--full'],
    ['prime', '--base', 'main'],
    ['docs', '--json', '--json'],
    ['doctor', '--base'],
    ['doctor', '--base', '--json'],
    ['doctor', '--base=main'],
    ['doctor', '--no-color'],
    ['explain', '--type'],
    ['explain', '--rule', '-x'],
    ['try', 'r', '--times', 'x'],
    ['try', 'r', '--times', '1.5'],
    ['try', 'r', '--max-calls', ''],
    ['try', 'r', '--all'],
    ['check', '--times', '1'],
  ]) {
    bad(argv);
  }
});

test('commands-slice §2: every command has a usage whose first line names it, and the program lists them', () => {
  for (const command of COMMANDS) assert.match(USAGE[command].split('\n')[0]!, new RegExp(`^usage: lawcheck ${command} `));
  const lines = PROGRAM_USAGE.split('\n');
  assert.equal(lines[0], 'usage: lawcheck <command> [<arguments>] [--json]');
  assert.deepEqual(lines.slice(1, 8).map((line) => line.trim().split('  ')[0]), [...COMMANDS]);
});
