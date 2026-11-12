import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, parseArguments } from '../../dist/cli.js';

const context = { cwd: '/', env: {} };

test('a command that throws ends in exit 2 with internal', async () => {
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

test('arguments', () => {
  assert.deepEqual(parseArguments(['check']), { options: { full: false, base: null } });
  assert.deepEqual(parseArguments(['check', '--json', '--base', 'main', '--full']), { options: { full: true, base: 'main' } });
  for (const argv of [[], ['fix'], ['check', 'src'], ['check', '--base'], ['check', '--base', '-x'], ['check', '--base=main'], ['check', '--full', '--full'], ['check', '--json', '--json'], ['check', '--base', 'a', '--base', 'b'], ['check', '--strict'], ['check', '--staged'], ['check', '--no-scripts']]) {
    assert.ok('problem' in parseArguments(argv), argv.join(' '));
  }
});

test('version and help exit 0', async () => {
  assert.deepEqual(await main(['--version'], context), { code: 0, stdout: '0.1.0\n' });
  for (const argv of [['--help'], ['check', '--help']]) {
    const result = await main(argv, context);
    assert.equal(result.code, 0);
    assert.equal(result.stdout.split('\n')[0], 'usage: lawcheck check [--full] [--base <ref>] [--json]');
  }
});
