import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { cases } from '../numbers.ts';
import { rulesProperties } from './rules.ts';
import { COMMIT, pure, Reaching } from './support.ts';

const properties = rulesProperties(COMMIT);

test('I-rules-1: S2-4, S2-6, any value a rule returns, throws or rejects with gives findings or a rule-crashed naming its cause, and file A is judged the same alone or with B', () => properties['I-rules-1: S2-4, S2-6, any value a rule returns, throws or rejects with gives findings or a rule-crashed naming its cause, and file A is judged the same alone or with B']!());

class Step implements fc.Command<object, { count: number }> {
  check(): boolean {
    return true;
  }
  run(_model: object, real: { count: number }): void {
    real.count++;
    if (real.count >= 3) throw new Error('the third step');
  }
  toString(): string {
    return 'step';
  }
}

test('R-111: the draw is steered, so a class the generator reaches holds its share on every seed, a class it cannot reach leaves the reach short, and fc.commands still shrinks', () => {
  for (let seed = 1; seed <= 50; seed++) pure({ nightly: false, seed }, fc.integer({ min: 0, max: 99 }), { classes: { 'one in twenty': (n) => n % 20 === 13 } }, () => undefined);
  assert.throws(() => pure(COMMIT, fc.integer({ min: 0, max: 99 }), { classes: { 'over 99': (n) => n > 99 } }, () => undefined), new RegExp(`the generator reached the class 'over 99' in 0 of ${cases('pure')} cases, below the share 0\\.1 it claims`));
  const read = new Set<unknown>();
  const own = new Reaching(fc.commands([fc.constant(new Step())], { maxCommands: 2 }), { classes: { 'any case': (commands) => read.add(commands) !== undefined } });
  fc.assert(fc.property(own, (commands) => assert.ok(read.has(commands), 'the property runs the instance the classes read, not a clone of it')), { seed: COMMIT.seed, numRuns: 20 });
  const steps = new Reaching(fc.commands([fc.constant(new Step())], { maxCommands: 20 }), { classes: { 'three steps or more': (commands) => [...commands].length >= 3 } });
  const result = fc.check(fc.property(steps, (commands) => fc.modelRun(() => ({ model: {}, real: { count: 0 } }), commands)), { seed: COMMIT.seed, numRuns: 100 });
  assert.equal(result.failed, true);
  assert.match(String(result.counterexample![0]), /^step,step,step( \/\*.*\*\/)?$/);
});
