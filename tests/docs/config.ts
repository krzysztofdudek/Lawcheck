import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { parseConfig } from '../../dist/config.js';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const READ = 'tests/acceptance/docs.test.ts > test 129: every page holds what section 7 asks, and its examples are real';

export const claims: Claims = {
  'block 1 under "Settings"': READ,
  'block 1 under "reviewer"': READ,
  'block 2 under "reviewer"': READ,
  'block 1 under "Keys and values Lawcheck refuses"': SCENARIO,
  'block 2 under "Keys and values Lawcheck refuses"': SCENARIO,
  'block 3 under "Keys and values Lawcheck refuses"': SCENARIO,
  'block 1 under "runner"': READ,
  'block 2 under "runner"': SCENARIO,
  'block 3 under "runner"': SCENARIO,
};

const REFUSED: [string, string, RegExp][] = [
  ['block 1 under "Keys and values Lawcheck refuses"', 'keys', /in the environment$/],
  ['block 2 under "Keys and values Lawcheck refuses"', 'endpoint', /LAWCHECK_REVIEWER_ENDPOINT$/],
  ['block 3 under "Keys and values Lawcheck refuses"', 'temperature', /takes no temperature/],
];

export async function scenario(page: Page): Promise<void> {
  const messages = new Set<string>();
  for (const [key, refused, says] of REFUSED) {
    const text = page.text(key);
    const read = parseConfig(text);
    assert.ok('problems' in read, `${key} is refused`);
    assert.equal(read.problems.length, 1, key);
    const [problem] = read.problems;
    assert.equal(problem!.line, text.split('\n').findIndex((line) => line.trim().startsWith(`${refused}:`)) + 1, `${key} is refused at the line of ${refused}`);
    assert.match(problem!.message, says, key);
    messages.add(problem!.message);
  }
  assert.equal(messages.size, 3, 'each of the three cases has a message of its own');
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { name: string; dependencies: Record<string, string> };
  const runes = Object.keys(manifest.dependencies).filter((name) => name.endsWith('/runes'));
  assert.equal(runes.length, 1, 'the library of the readers');
  assert.deepEqual(parse(page.text('block 2 under "runner"')), { npmPreapprovedPackages: [manifest.name, runes[0]] });
  assert.deepEqual(parse(page.text('block 3 under "runner"')), { minimumReleaseAgeExclude: [manifest.name, runes[0]] });
}
