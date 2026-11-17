import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import fc from 'fast-check';
import { cases, NIGHTLY_MS, REACH_SHARE, SEED, seed as commitSeed } from '../numbers.ts';

export interface Speed {
  nightly: boolean;
  seed: number;
}

export const COMMIT: Speed = { nightly: false, seed: commitSeed() };

export function nightly(): Speed {
  // tests/run.ts hands every run the commit seed; a nightly run takes a new one unless it is given another to replay.
  const given = process.env.LAWCHECK_SEED;
  const seed = given !== undefined && /^\d+$/.test(given) && Number(given) !== SEED ? Number(given) : (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const line = `nightly properties: seed ${seed} (rerun with LAWCHECK_SEED=${seed})`;
  process.stdout.write(`${line}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n\n`);
  return { nightly: true, seed };
}

export type Classes<T> = Record<string, (value: T) => boolean>;

export interface Claim<T> {
  classes: Classes<T>;
  // Cases that run before the generated ones and count toward the classes, so a class a seed might not draw is still tried on every seed.
  examples?: T[];
  least?: Record<string, number>;
}

function parameters(speed: Speed, tool: boolean, examples: unknown[] = []): fc.Parameters<unknown> {
  const numRuns = cases(tool ? 'tool' : 'pure');
  const given = examples.map((example) => [example]);
  if (!speed.nightly) return { seed: speed.seed, numRuns: numRuns + given.length, examples: given as [unknown][] };
  return { seed: speed.seed, examples: given as [unknown][], numRuns: Number.MAX_SAFE_INTEGER, interruptAfterTimeLimit: NIGHTLY_MS, markInterruptAsFailure: false };
}

function counter<T>(claim: Claim<T>) {
  const counts: Record<string, number> = Object.fromEntries(Object.keys(claim.classes).map((name) => [name, 0]));
  let total = 0;
  return {
    count(value: T) {
      total++;
      for (const [name, holds] of Object.entries(claim.classes)) if (holds(value)) counts[name]!++;
    },
    reached() {
      for (const name of Object.keys(claim.classes)) {
        const share = claim.least?.[name] ?? REACH_SHARE;
        assert.ok(counts[name]! >= Math.ceil(share * total), `the generator reached the class '${name}' in ${counts[name]} of ${total} cases, below the share ${share} it claims`);
      }
      return { counts, total };
    },
  };
}

// Runs a property on a pure function with the speed's seed, and asserts the reach of its generator over the cases that ran.
export function pure<T>(speed: Speed, arbitrary: fc.Arbitrary<T>, claim: Claim<T>, predicate: (value: T) => void): void {
  const tally = counter(claim);
  let shrinking = false;
  fc.assert(
    fc.property(arbitrary, (value) => {
      if (!shrinking) tally.count(value);
      try {
        predicate(value);
      } catch (error) {
        shrinking = true;
        throw error;
      }
    }),
    parameters(speed, false, claim.examples),
  );
  tally.reached();
}

// The same for a property that starts the tool.
export async function tool<T>(speed: Speed, arbitrary: fc.Arbitrary<T>, claim: Claim<T>, predicate: (value: T) => Promise<void>): Promise<void> {
  const tally = counter(claim);
  let shrinking = false;
  await fc.assert(
    fc.asyncProperty(arbitrary, async (value) => {
      if (!shrinking) tally.count(value);
      try {
        await predicate(value);
      } catch (error) {
        shrinking = true;
        throw error;
      }
    }),
    parameters(speed, true, claim.examples),
  );
  tally.reached();
}

export function within<T>(budgetMs: number, what: string, body: () => T): T {
  const started = performance.now();
  const value = body();
  const ms = performance.now() - started;
  assert.ok(ms <= budgetMs, `${what} took ${Math.round(ms)} ms, over its budget of ${budgetMs} ms`);
  return value;
}
