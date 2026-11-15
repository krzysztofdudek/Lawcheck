import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const spec = (name: string) => readFileSync(new URL(`../../spec/${name}`, import.meta.url), 'utf8');
const SLICES = ['check-slice.md', 'reviewer-slice.md', 'dependency-slice.md', 'commands-slice.md', 'plugin-slice.md'];
const deferred = spec('deferred.md');
const rows = deferred.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| What |') && !/^\|[-| ]+\|$/.test(line));

test('deferred-1: every slice spec points to the one ledger of what is not built, in place of its own list', () => {
  for (const name of SLICES) {
    const text = spec(name);
    assert.ok(text.includes('[`deferred.md`](deferred.md)'), `${name} does not point to deferred.md`);
    assert.ok(!text.includes('Out, each with what this slice does where the design has it'), `${name} still has its own list`);
  }
});

test('deferred-1: every row of the ledger says what, where it is mentioned in a spec, what a run does instead and why it waits', () => {
  assert.ok(rows.length >= 25, `${rows.length} rows`);
  for (const row of rows) {
    const cells = row.split(' | ').map((cell) => cell.replace(/^\| /, '').replace(/ \|$/, ''));
    const wide = cells.length === 4 || cells.length === 3;
    assert.ok(wide && cells.every((cell) => cell.length > 0), row);
    for (const [, file] of cells[1]!.matchAll(/`([a-z-]+\.md)`/g)) assert.ok(existsSync(new URL(`../../spec/${file}`, import.meta.url)), `${file} named in ${row}`);
  }
});

test('deferred-1: the ledger lists what the assessment names and nothing that is built', () => {
  const plain = deferred.replaceAll('`', '');
  for (const what of ['required', '--staged', '--strict', '--no-scripts', 'lawcheck-waive-start', 'config.local.yaml', 'LAWCHECK_BASE', 'Codex, Copilot, Cursor', 'group', 'lawcheck-check/1']) {
    assert.ok(plain.includes(what), what);
  }
  assert.ok(!/gemini|ollama|copilot-cli/i.test(deferred.replace('Codex, Copilot, Cursor', '')), 'the six providers are built');
});

test('deferred-1: the ledger names no other tool of the author and no layer above this one', () => {
  assert.doesNotMatch(deferred, /yggdrasil|grain|jarl|ratatoskr|\burd\b|researcher|organi[sz]ation|server mode|law set|migrat/i);
});
