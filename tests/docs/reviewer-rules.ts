import assert from 'node:assert/strict';
import { checkAnswer } from '../../dist/prompt.js';
import { inTemp, lawcheck, newRepository, REVIEWER_CONFIG } from '../acceptance/helpers.ts';
import { withFake } from '../acceptance/fake-reviewer.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

const READ = 'tests/acceptance/docs.test.ts > test 129: every page holds what section 7 asks, and its examples are real';

export const claims: Claims = {
  'block 1 under "The rule file"': READ,
  'block 1 under "Files for each judged file"': SCENARIO,
  'block 2 under "Files for each judged file"': SCENARIO,
  'block 1 under "The answer"': SCENARIO,
  'block 1 under "Asking the reviewer"': READ,
  'block 1 under "Trying a reviewer rule"': READ,
};

export async function scenario(page: Page): Promise<void> {
  const answer = page.text('block 1 under "The answer"');
  assert.deepEqual(checkAnswer(answer, 12), { verdict: 'fail', findings: [{ line: 12, message: 'what breaks the rule on this line' }] });
  assert.ok('problem' in checkAnswer(answer, 11), 'a line outside the file is a bad answer');
  await withFake(async (fake) => {
    await inTemp(async (dir) => {
      const repo = newRepository(dir, {
        '.lawcheck/law.yaml': `lawcheck: 0.1.0\n\n${page.text('block 1 under "Files for each judged file"')}\n\ntypes:\n  test:\n    paths: ["tests/**/*.ts"]\n    rules: [tests-follow-the-spec]\n`,
        '.lawcheck/config.yaml': REVIEWER_CONFIG,
        '.lawcheck/rules/tests-follow-the-spec.md': 'Report a check of the test that its spec does not ask for.\n',
        '.lawcheck/rules/lib/spec-of-test.mjs': page.text('block 2 under "Files for each judged file"') + '\n',
        'tests/price.test.ts': 'expect(price(100)).toBe(123);\n',
        'tests/tax.test.ts': 'expect(rate).toBe(0.23);\n',
        'specs/price.md': 'The price is the net times 1.23.\n',
        'specs/tax.md': 'The rate is 0.23.\n',
      });
      const run = await lawcheck(repo, ['try', 'tests-follow-the-spec', 'tests/price.test.ts', 'tests/tax.test.ts'], { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
      assert.equal(run.code, 0, run.stdout);
      const prompts = fake.requests.map((request) => request.prompt);
      assert.equal(prompts.length, 2);
      for (const name of ['price', 'tax']) {
        const prompt = prompts.find((text) => text.includes(`\n<file path="tests/${name}.test.ts">\n`))!;
        assert.ok(prompt.includes(`\n<context path="specs/${name}.md">\n1| `), prompt);
        assert.equal(prompt.split('\n<context path=').length, 2, prompt);
      }
    });
  });
}
