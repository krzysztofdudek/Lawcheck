import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setRule, withSample, write } from '../acceptance/helpers.ts';
import { errorLines, run } from './support.ts';

// The judged file's first line tells the rule how many findings to return and how long each message is: `// <count> <length>`.
const COUNTED = [
  'export function check({ files }) {',
  "  const [count, length] = files[0].lines[0].slice(3).split(' ').map(Number);",
  "  const message = 'm'.repeat(length);",
  '  const out = [];',
  '  for (let i = 0; i < count; i++) out.push({ message });',
  '  return out;',
  '}',
  '',
].join('\n');

const RULE = '.lawcheck/rules/no-console.mjs';
const withCounted = <T>(body: (s: string) => Promise<T>) => withSample(body, { onMain: (s) => setRule(s, 'no-console', COUNTED) });
const tooMany = (count: string, chars: string, total: string, totalChars: string) =>
  `${RULE}  error[too-many-findings]  returns ${count} findings with ${chars} characters of message in this run; the rules of a run may return 200,000 findings with 16,777,216 characters of message in all, and they returned ${total} with ${totalChars}`;

test('S2-1: test 235: 125,000 and 200,000 findings from one rule give the full report and exit 1', async () => {
  await withCounted(async (s) => {
    for (const count of [125_000, 200_000]) {
      write(s, 'src/core/many.ts', `// ${count} 1\n`);
      const text = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
      assert.equal(text.stdout.split('\n')[0], `lawcheck: FAIL  ${count} errors in 1 changed file (against main)`);
      assert.equal(errorLines(text.stdout).length, 50);
      assert.ok(text.stdout.includes(`\n... ${count - 50} more findings (--json lists all)\n`), String(count));
      assert.equal(text.code, 1);
      const json = await run(s, ['check', '--base', 'main', '--json'], { budget: 'LIMITS_RUN_MS' });
      const document = JSON.parse(json.stdout);
      assert.equal(document.result, 'fail');
      assert.equal(document.summary.errors, count);
      assert.equal(document.findings.length, count);
      assert.ok(document.findings.every((f: { code: string; file: string; message: string }) => f.code === 'no-console' && f.file === 'src/core/many.ts' && f.message === 'm'));
      assert.equal(json.stderr, '');
      assert.equal(json.code, 1);
    }
  });
});

test('S2-1: test 236: 200,001 and 1,000,000 findings from one rule, and 300,000 over three files, are too-many-findings', async () => {
  {
    const cases: [Record<string, string>, string][] = [
      [{ 'src/core/many.ts': '// 200001 1\n' }, tooMany('200,001', '200,001', '200,001', '200,001')],
      [{ 'src/core/many.ts': '// 1000000 1\n' }, tooMany('1,000,000', '1,000,000', '1,000,000', '1,000,000')],
      [{ 'src/core/a.ts': '// 100000 1\n', 'src/core/b.ts': '// 100000 1\n', 'src/core/c.ts': '// 100000 1\n' }, tooMany('300,000', '300,000', '300,000', '300,000')],
    ];
    for (const [files, line] of cases) {
      await withCounted(async (fresh) => {
        for (const [path, text] of Object.entries(files)) write(fresh, path, text);
        const result = await run(fresh, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
        assert.equal(
          result.stdout,
          ['lawcheck: ERROR  1 error', '', line, '  why:  a run holds every finding in memory, so it may hold only so many', '', 'next: make the rules return fewer findings, or narrow the types that list them, then run lawcheck check', ''].join('\n'),
        );
        assert.equal(result.stderr, '');
        assert.equal(result.code, 2);
        const json = await run(fresh, ['check', '--base', 'main', '--json'], { budget: 'LIMITS_RUN_MS' });
        assert.equal(JSON.parse(json.stdout).errors[0].code, 'too-many-findings');
        assert.equal(json.code, 2);
      });
    }
  }
});

test('test 237: the messages of a run may hold 16,777,216 characters together, and a message 4,096', async () => {
  await withCounted(async (s) => {
    write(s, 'src/core/many.ts', '// 4096 4096\n');
    const at = await run(s, ['check', '--base', 'main', '--json'], { budget: 'LIMITS_RUN_MS' });
    const document = JSON.parse(at.stdout);
    assert.equal(document.findings.length, 4096);
    assert.equal(document.findings[0].message, 'm'.repeat(4096));
    assert.equal(at.code, 1);
  });
  const plusOne = COUNTED.replace('  return out;', "  if (files[0].path === 'src/core/one.ts') return [{ message: 'm' }];\n  return out;");
  await withSample(
    async (s) => {
      write(s, 'src/core/many.ts', '// 4096 4096\n');
      write(s, 'src/core/one.ts', '// 0 0\n');
      const beyond = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
      assert.deepEqual(errorLines(beyond.stdout), [tooMany('4,097', '16,777,217', '4,097', '16,777,217')]);
      assert.equal(beyond.code, 2);
    },
    { onMain: (s) => setRule(s, 'no-console', plusOne) },
  );
  await withCounted(async (s) => {
    for (const [length, shown] of [[4097, '4,097'], [200_000_000, '200,000,000']] as const) {
      write(s, 'src/core/many.ts', `// 1 ${length}\n`);
      const result = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
      assert.deepEqual(errorLines(result.stdout), [`${RULE}  error[rule-crashed]  returns a message of ${shown} characters for src/core/many.ts, and a message holds at most 4,096`]);
      assert.equal(result.code, 2);
    }
  });
});

test('S2-1: test 238: try counts the findings of its rule the same way', async () => {
  await withCounted(async (s) => {
    write(s, 'src/core/many.ts', '// 200001 1\n');
    const result = await run(s, ['try', 'no-console', 'src/core/many.ts'], { budget: 'LIMITS_RUN_MS' });
    assert.deepEqual(errorLines(result.stdout), [tooMany('200,001', '200,001', '200,001', '200,001')]);
    assert.equal(result.code, 2);
  });
});

test('test 256: 60,000 findings with a line cost time in proportion to their count', async () => {
  const lined = COUNTED.replace('out.push({ message });', 'out.push({ message, line: 1 + (i % 100) });');
  await withSample(
    async (s) => {
      write(s, 'src/core/many.ts', `// 60000 1\n${'export const a = 1;\n'.repeat(100_000)}`);
      const result = await run(s, ['check', '--base', 'main', '--json'], { budget: 'LIMITS_RUN_MS' });
      const document = JSON.parse(result.stdout);
      assert.equal(document.findings.length, 60_000);
      assert.equal(document.findings[0].line, 1);
      assert.equal(result.code, 1);
    },
    { onMain: (s) => setRule(s, 'no-console', lined) },
  );
});

test('test 264: waivers count toward the findings of a run: 200,000 waivers that name no rule are reported, and one more is too-many-findings', async () => {
  await withSample(async (s) => {
    write(s, 'src/core/waivers.ts', '// lawcheck-waive q\n'.repeat(200_000));
    const at = await run(s, ['check', '--base', 'main', '--json'], { budget: 'LIMITS_RUN_MS' });
    const document = JSON.parse(at.stdout);
    assert.equal(document.findings.length, 200_000);
    assert.equal(document.findings[0].code, 'waiver-unknown-rule');
    assert.equal(at.code, 1);
    write(s, 'src/core/waivers.ts', '// lawcheck-waive q\n'.repeat(200_001));
    const beyond = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
    // Each message is "the waiver names 'q', which is no rule of the law", 49 characters.
    assert.deepEqual(errorLines(beyond.stdout), ['src/core/waivers.ts  error[too-many-findings]  brings the findings of this run to 200,001 with 9,800,049 characters of message, more than the 200,000 findings with 16,777,216 characters one run may hold']);
    assert.equal(beyond.code, 2);
  });
});

test('test 268: a message of 4,096 characters outside the first plane is a finding, and one more character crashes the rule', async () => {
  const wide = (count: number) => `export function check() { return [{ message: '\\u{1F600}'.repeat(${count}) }]; }\n`;
  for (const [count, expected] of [[4096, null], [4097, `${RULE}  error[rule-crashed]  returns a message of 4,097 characters for src/core/many.ts, and a message holds at most 4,096`]] as const) {
    await withSample(
      async (s) => {
        write(s, 'src/core/many.ts', 'export const a = 1;\n');
        const result = await run(s, ['check', '--base', 'main']);
        if (expected === null) {
          assert.deepEqual(errorLines(result.stdout), [`src/core/many.ts  error[no-console]  ${'\u{1F600}'.repeat(4096)}`]);
          assert.equal(result.code, 1);
        } else {
          assert.deepEqual(errorLines(result.stdout), [expected]);
          assert.equal(result.code, 2);
        }
      },
      { onMain: (s) => setRule(s, 'no-console', wide(count)) },
    );
  }
});
