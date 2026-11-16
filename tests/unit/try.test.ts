import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectTargets } from '../../dist/try.js';
import { Stop } from '../../dist/setup.js';

const FILES = ['README.md', 'src/cli/main.ts', 'src/core/blob.bin', 'src/core/price.ts', 'src/core/tax.ts'];
const binary = (path: string) => path.endsWith('.bin');

function inRoot(body: (root: string) => void): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-try-')));
  try {
    for (const dir of ['src/cli', 'src/core', 'empty']) mkdirSync(join(root, dir), { recursive: true });
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const refused = (body: () => unknown, pattern: RegExp) =>
  assert.throws(body, (error: unknown) => error instanceof Stop && error.errors[0]!.code === 'usage' && pattern.test(error.errors[0]!.message));

test('commands-slice §5: paths, directories and patterns select files once, in path order, binary ones left out', () => {
  inRoot((root) => {
    assert.deepEqual(selectTargets(root, root, ['src/core/tax.ts', 'src/core'], FILES, binary), ['src/core/price.ts', 'src/core/tax.ts']);
    assert.deepEqual(selectTargets(root, root, ['.'], FILES, binary), ['README.md', 'src/cli/main.ts', 'src/core/price.ts', 'src/core/tax.ts']);
    assert.deepEqual(selectTargets(root, root, ['src/**/*.ts'], FILES, binary), ['src/cli/main.ts', 'src/core/price.ts', 'src/core/tax.ts']);
    assert.deepEqual(selectTargets(root, join(root, 'src'), ['c*/*.ts'], FILES, binary), ['src/cli/main.ts', 'src/core/price.ts', 'src/core/tax.ts']);
    assert.deepEqual(selectTargets(root, join(root, 'src/core'), ['price.ts'], FILES, binary), ['src/core/price.ts']);
    assert.deepEqual(selectTargets(root, root, ['src/{cli,core}/m*.ts'], FILES, binary), ['src/cli/main.ts']);
  });
});

test('commands-slice §5: a target that selects nothing says why', () => {
  inRoot((root) => {
    refused(() => selectTargets(root, root, ['nope.ts'], FILES, binary), /git ignores it or it does not exist/);
    refused(() => selectTargets(root, root, ['src/core/blob.bin'], FILES, binary), /it is binary/);
    refused(() => selectTargets(root, root, ['src/**/*.zzz'], FILES, binary), /matches no file/);
    refused(() => selectTargets(root, root, ['empty'], FILES, binary), /matches no file/);
    refused(() => selectTargets(root, root, ['src/{a'], FILES, binary), /brace/);
    refused(() => selectTargets(root, root, ['../x'], FILES, binary), /outside/);
  });
});
