export type Speed = 'loop' | 'commit' | 'nightly';

export const SPEED: Speed = ((): Speed => {
  const value = process.env.LAWCHECK_SPEED;
  return value === 'loop' || value === 'nightly' ? value : 'commit';
})();

export const SEED = 20261115;

export const CASES = {
  pure: 100,
  tool: 25,
  loop: 25,
};

export const BUDGET = {
  test: 20_000,
  run: 20_000,
  loop: 30_000,
  commit: 600_000,
  leftover: 2_000,
  killed: 5_000,
};

// Each of these waits on one of the tool's fixed limits: the 30 seconds a rule may run (spec/check-slice.md, section 3) and the hook deadlines of 25 and 145 seconds (spec/plugin-slice.md, section 4).
export const SLOW_TESTS: Record<string, number> = {
  'test 24': 60_000,
  'test 163': 300_000,
};

export const SLOWEST_SHOWN = 10;

let printed = false;

export function seed(): number {
  const given = process.env.LAWCHECK_SEED;
  const value = given !== undefined && /^-?\d+$/.test(given) ? Number(given) : SEED;
  if (!printed) {
    printed = true;
    process.stdout.write(`seed ${value}\n`);
  }
  return value;
}

export function cases(kind: 'pure' | 'tool'): number {
  return SPEED === 'loop' ? CASES.loop : CASES[kind];
}
