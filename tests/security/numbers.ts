export const SEED = 20261115;

export const CASES_PURE = 100;

export const CASES_TOOL = 25;

export const REACH_SHARE = 0.1;

// The live attack run (spec/reviewer-slice.md, invariant I-frame-1): each attack file and its twin go through the real reviewer this many times.
export const LIVE_TIMES = 5;

// The line of the live run: the share of runs in which an attack and its twin get the same verdict, and the share of verdicts that are fail.
export const LIVE_SAME_SHARE = 1;
export const LIVE_FAIL_SHARE = 1;
