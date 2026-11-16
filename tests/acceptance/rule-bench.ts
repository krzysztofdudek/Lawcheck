import assert from 'node:assert/strict';
import { D, D_PATH, findingLines, setRule, startLawcheck, withSample, write } from './helpers.ts';
import { RULE_PAST_LIMIT_MS, RULE_PAST_LIMIT_SHARE } from '../numbers.ts';
import { LIMITS } from '../../dist/rules.js';

export const CRASH = '.lawcheck/rules/no-console.mjs  error[rule-crashed]';

export function assertCrashes(run: { code: number | null; stdout: string }, name: string): void {
  assert.equal(run.code, 2, `${name}: ${run.stdout}`);
  assert.ok(run.stdout.split('\n').some((line) => line.startsWith(CRASH)), `${name}: ${run.stdout}`);
  assert.deepEqual(findingLines(run.stdout).filter((line) => !line.includes('error[rule-crashed]')), [], name);
}

export async function withRule(source: string, body: (s: string) => Promise<void>, rules: Record<string, string> = {}): Promise<void> {
  await withRules({ 'no-console': source, ...rules }, async (s) => {
    write(s, D_PATH, D);
    await body(s);
  });
}

export async function withRules(rules: Record<string, string>, body: (s: string) => Promise<void>): Promise<void> {
  await withSample(body, {
    onMain: (s) => {
      for (const [rule, source] of Object.entries(rules)) setRule(s, rule, source);
    },
  });
}

// Test 24 of spec/check-slice.md: a rule that never answers, in check and at the top level of its module, crashes once its time passes. With a limit given, the tool runs with it in place of the shipped one. The rule says it hangs once its limit already runs, so the tool's end is timed from there too.
export async function hangScenario(limitMs: number | null): Promise<void> {
  const ms = limitMs ?? LIMITS.ruleMs;
  const cases: [string, string, string][] = [
    ['in check', "export function check() { console.error('hanging'); while (true) {} }\n", `on ${D_PATH}`],
    ['at the top level', "console.error('hanging');\nwhile (true) {}\nexport function check() { return []; }\n", 'in its load'],
  ];
  await Promise.all(
    cases.map(([name, source, stage]) =>
      withRule(source, async (s) => {
        const tool = startLawcheck(s, ['check', '--base', 'main'], { stderr: /^hanging\n$/, ...(limitMs === null ? {} : { limits: { ruleMs: limitMs } }) });
        await tool.output(/^hanging\n/m, 'stderr');
        const hung = Date.now();
        const run = await tool.ended;
        const past = Date.now() - hung;
        assertCrashes(run, name);
        assert.ok(run.stdout.split('\n').includes(`${CRASH}  passes ${ms / 1000} seconds ${stage}`), `${name}: ${run.stdout}`);
        assert.ok(run.ms >= ms, `${name} crashed after ${run.ms} ms, before its limit of ${ms} ms`);
        assert.ok(run.ms < ms + RULE_PAST_LIMIT_MS, `${name} took ${run.ms} ms`);
        assert.ok(past < ms * (1 + RULE_PAST_LIMIT_SHARE), `${name} ended ${past} ms after it said it hangs, past its limit of ${ms} ms and ${RULE_PAST_LIMIT_SHARE * 100}% of it`);
      }),
    ),
  );
}
