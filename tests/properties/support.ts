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

// The draw before the case for which a class would fall below its share, worst case one class per case; a share of 0 never comes due.
function due(share: number, count: number): number {
  if (share <= 0) return Number.POSITIVE_INFINITY;
  let total = Math.floor(count / share) + 1;
  while (total > 1 && Math.ceil(share * (total - 1)) > count) total--;
  while (Math.ceil(share * total) <= count) total++;
  return total;
}

// A class a seed draws less often than its share would leave the reach short on some seeds, so the draw is steered: when a class comes due within as many cases as there are classes, the generator draws again, up to TRIES times, until the case lies in that class, the one due first. With the shares summing below 1, every class holds its share from as many cases as there are classes on, whatever the seed, and the cases keep the generator's own shrinking. A class the generator cannot reach stays short, and the reach says so.
const TRIES = 1000;

export class Reaching<T> extends fc.Arbitrary<T> {
  private readonly inner: fc.Arbitrary<T>;
  private readonly shares: number[];
  private readonly holds: ((value: T) => boolean)[];
  private readonly counts: number[];
  private total = 0;

  constructor(inner: fc.Arbitrary<T>, claim: Claim<T>) {
    super();
    this.inner = inner;
    const names = Object.keys(claim.classes);
    this.shares = names.map((name) => claim.least?.[name] ?? REACH_SHARE);
    this.holds = names.map((name) => claim.classes[name]!);
    this.counts = names.map(() => 0);
    for (const example of claim.examples ?? []) this.count(example);
  }

  private count(value: T): void {
    this.total++;
    this.holds.forEach((holds, i) => {
      if (holds(value)) this.counts[i]!++;
    });
  }

  generate(mrng: fc.Random, biasFactor: number | undefined): fc.Value<T> {
    let first = -1;
    let soonest = Number.POSITIVE_INFINITY;
    this.shares.forEach((share, i) => {
      const at = due(share, this.counts[i]!);
      if (at < soonest) {
        soonest = at;
        first = i;
      }
    });
    let drawn = this.inner.generate(mrng, biasFactor);
    if (soonest - (this.total + 1) < this.shares.length) for (let tries = 1; tries < TRIES && !this.holds[first]!(drawn.value); tries++) drawn = this.inner.generate(mrng, biasFactor);
    this.count(drawn.value);
    return drawn;
  }

  canShrinkWithoutContext(value: unknown): value is T {
    return this.inner.canShrinkWithoutContext(value);
  }

  shrink(value: T, context: unknown): fc.Stream<fc.Value<T>> {
    return this.inner.shrink(value, context);
  }
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
    fc.property(new Reaching(arbitrary, claim), (value) => {
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
    fc.asyncProperty(new Reaching(arbitrary, claim), async (value) => {
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
