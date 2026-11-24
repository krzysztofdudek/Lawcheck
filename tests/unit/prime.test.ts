import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLaw } from '../../dist/law.js';
import { cut, firstPart, length, NO_LAW, NO_REVIEWER, primeText } from '../../dist/prime.js';

const FIRST_PART = firstPart(false, false);

const W = 'w'.repeat(200);
const A = 'a'.repeat(200);
const LAW = `lawcheck: 0.1.0
rules:
  r1:
    why: ${W}
  r2:
    why: short
    status: advisory
types:
  root:
    about: ${A}
    paths: ["src/**"]
    content: "^x"
    rules: [r1]
    types:
      sub:
        about: Below.
        paths: ["src/sub/**"]
  other:
    paths: ["lib/**"]
`;

function kinds(scripts: string[]) {
  return { errors: [], unreadable: [], scripts: new Set(scripts), reviewers: new Map() };
}

const law = parseLaw(LAW).law!;
const part = (text: string) => text.slice(text.indexOf('\nThe law here: ') + 1).split('\n');

test('commands-slice §4: the first part is 1,567 characters without reviewer rules or may_use, and 1,863 with both', () => {
  assert.equal(length(FIRST_PART), 1567);
  assert.equal(FIRST_PART.split('\n').length, 20);
  assert.equal(length(firstPart(true, true)), 1863);
  assert.equal(firstPart(true, true).split('\n').length, 24);
  assert.ok(firstPart(true, false).includes('- not-reviewed: '));
  assert.ok(!firstPart(true, false).includes('may use'));
  assert.ok(firstPart(false, true).includes('- widening may_use\n'));
  assert.ok(!firstPart(false, true).includes('review'));
  assert.ok(FIRST_PART.endsWith('\n'));
  assert.ok(NO_LAW.endsWith('\n'));
});

test('commands-slice §4: a text longer than 60 characters is cut to 59 and an ellipsis, counted in code points', () => {
  assert.equal(cut('x'.repeat(60)), 'x'.repeat(60));
  assert.equal(cut('x'.repeat(61)), 'x'.repeat(59) + '…');
  assert.equal(cut('é'.repeat(61)), 'é'.repeat(59) + '…');
});

test('commands-slice §4: step 1 holds everything', () => {
  const { text, step } = primeText(law, kinds(['r1']), 100000);
  assert.equal(step, 1);
  assert.deepEqual(part(text), [
    'The law here: 3 types, 2 rules',
    `root  src/**  content: ^x  ${A}  rules: r1`,
    '  sub  src/sub/**  Below.',
    'other  lib/**',
    '',
    'Rules',
    `r1  script  ${W}`,
    'r2  reviewer  advisory  on no type  short',
    '',
    'More: lawcheck docs',
    '',
  ]);
});

function budgetFor(step: number): number {
  for (let budget = 1; budget < 100000; budget++) if (primeText(law, kinds(['r1']), budget).step === step - 1) return budget - 1;
  throw new Error(`no budget gives step ${step - 1}`);
}

test('commands-slice §4: each step is taken when the one before it does not fit', () => {
  const two = primeText(law, kinds(['r1']), budgetFor(2));
  assert.equal(two.step, 2);
  assert.ok(part(two.text).includes(`root  src/**  content: ^x  ${'a'.repeat(59)}…  rules: r1`));
  assert.ok(part(two.text).includes(`r1  script  ${'w'.repeat(59)}…`));
  const three = primeText(law, kinds(['r1']), budgetFor(3));
  assert.ok(part(three.text).includes('  sub  Below.'));
  assert.ok(part(three.text).includes('r1  script'));
  const four = primeText(law, kinds(['r1']), budgetFor(4));
  assert.deepEqual(part(four.text), [
    'The law here: 3 types, 2 rules',
    `root  src/**  content: ^x  ${'a'.repeat(59)}…  subtypes: 1  rules: 1`,
    'other  lib/**',
    '',
    'Rules',
    'r1, r2',
    '',
    'shortened to fit; lawcheck explain --type <id> shows a type in full, lawcheck explain --rule <id> a rule',
    '',
  ]);
  for (const result of [two, three, four]) assert.ok(length(result.text) <= budgetFor(result.step));
});

test('commands-slice §4: the guard: type lines while they fit, then the rule line cut to the ids that fit', () => {
  const k = kinds(['r1']);
  const full = length(primeText(law, k, budgetFor(4)).text);
  const fewer = primeText(law, k, full - 1);
  assert.equal(fewer.step, 4);
  assert.ok(length(fewer.text) <= full - 1);
  assert.ok(part(fewer.text).some((line) => /^\.\.\. and (1 more root type|2 more root types)$/.test(line)));
  let budget = full - 1;
  while (!part(primeText(law, k, budget).text).includes('... and 2 more root types')) budget--;
  assert.ok(part(primeText(law, k, budget).text).includes('r1, r2'));
  const ids = Array.from({ length: 30 }, (_, i) => `rule-number-${String(i + 1).padStart(2, '0')}`);
  const many = parseLaw(`lawcheck: 0.1.0\nrules:\n${ids.map((id) => `  ${id}:\n    why: x\n`).join('')}types:\n  one:\n    paths: ["src/**"]\n    about: ${A}\n`).law!;
  const whole = primeText(many, kinds(ids), 100000);
  const target = length(FIRST_PART) + 300;
  const cutIds = primeText(many, kinds(ids), target);
  assert.ok(whole.step === 1 && cutIds.step === 4);
  assert.ok(length(cutIds.text) <= target);
  assert.ok(part(cutIds.text).includes('... and 1 more root type'));
  assert.ok(part(cutIds.text).some((line) => /^rule-number-01, .*, and \d+ more$/.test(line)));
});

test('R-150: a law with may_use leaves adding a pattern to ignored to the user, as a law with required or ignored does, since a pattern of ignored takes a file out of the may_use list in force', () => {
  assert.ok(firstPart(false, true).includes('\n- widening may_use\n- adding a pattern to ignored\n'), firstPart(false, true));
  assert.ok(!firstPart(false, false).includes('ignored'));
  const both = firstPart(false, true, true);
  assert.equal(both.split('adding a pattern to ignored').length, 2);
  assert.ok(both.includes('\n- adding a pattern to ignored, or taking one from required\n'));
  assert.ok(firstPart(false, false, true).includes('\n- adding a pattern to ignored, or taking one from required\n'));
});

test('S6-5: with no reviewer set, the line on not-reviewed says so and leaves the setting to the user', () => {
  const unset = firstPart(true, false, false, true);
  assert.ok(unset.includes(`\n${NO_REVIEWER}\n`));
  assert.equal(NO_REVIEWER, "- not-reviewed: no reviewer is set in .lawcheck/config.yaml, so a plain lawcheck check and CI fail on every file a reviewer rule judges; tell the user once, since setting a reviewer is the user's decision.");
  assert.ok(!unset.includes('then run lawcheck check --review'));
  assert.equal(firstPart(false, false, false, true), FIRST_PART);
  assert.ok(primeText(law, kinds([]), 100000, '', true).text.includes(NO_REVIEWER));
  assert.ok(!primeText(law, kinds(['r1', 'r2']), 100000, '', true).text.includes('not-reviewed'));
});
