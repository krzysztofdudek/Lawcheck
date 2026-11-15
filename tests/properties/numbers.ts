export const SEED = 20261115;

export const CASES_PURE = 100;
export const CASES_TOOL = 25;

// The nightly run of a property goes on with a new seed until this much time has passed.
export const NIGHTLY_MS = 120_000;

// A match of src/**/*a*a*a*a*a*a*b.ts against a name of 240 `a`, through the matcher and through check --full (design test 4, stress finding S1-1); measured below 2 ms and 400 ms.
export const MATCH_BUDGET_MS = 100;
export const PATTERN_RUN_BUDGET_MS = 8_000;

// takeAnswer on one megabyte of `{` and on 50,000 nested objects (design test 6, stress finding S3-3); measured below 30 ms.
export const ANSWER_BUDGET_MS = 1_000;

// parseLaw on the generator's deepest text, 20,000 levels of brackets; measured at 57 ms in the dev container.
export const LAW_PARSE_BUDGET_MS = 1_500;

// One pure call on generated input, for the base oracle of no run over its budget.
export const PURE_CALL_BUDGET_MS = 1_000;

// One start of the tool on a generated case.
export const TOOL_RUN_BUDGET_MS = 20_000;

// The share of cases a generator must put into each class it claims; a property states its own where it claims more.
export const LEAST_SHARE = 0.1;
