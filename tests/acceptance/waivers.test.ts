import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fakeWrites } from '../harness/tool.ts';
import { append, check, D, D_PATH, E_PATH, findingLines, lawcheck, withSample, withU, write } from './helpers.ts';

function withLine(at: number, line: string): string {
  const lines = D.split('\n');
  lines.splice(at - 1, 0, line);
  return lines.join('\n');
}

const SUPPORT = '  // lawcheck-waive no-console -- support reads this line';

test('test 31: a waiver on a line of its own covers the next line', async () => {
  await withSample(async (s) => {
    write(s, D_PATH, withLine(2, SUPPORT));
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: PASS  1 warning in 1 changed file (against main), 2 waivers');
    assert.deepEqual(findingLines(run.stdout), ['src/core/discount.ts:4  warning[no-todo]  TODO without an issue number']);
    assert.equal(run.code, 0);
  });
});

test('test 32: a waiver without a reason', async () => {
  await withSample(async (s) => {
    write(s, D_PATH, withLine(2, '  // lawcheck-waive no-console'));
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: FAIL  2 errors, 1 warning in 1 changed file (against main), 1 waiver');
    const found = findingLines(run.stdout);
    assert.ok(found.some((line) => line.startsWith('src/core/discount.ts:2  error[waiver-without-reason]')), run.stdout);
    assert.ok(found.some((line) => line.startsWith('src/core/discount.ts:3  error[no-console]')), run.stdout);
    assert.equal(run.code, 1);
  });
});

test('test 33: a waiver of an unknown rule', async () => {
  const variants: [string, string][] = [
    ['no-such', SUPPORT.replace('no-console', 'no-such')],
    ['lawcheck-waive-file', SUPPORT.replace('lawcheck-waive', 'lawcheck-waive-file')],
    ['cut after the marker', '  // lawcheck-waive'],
  ];
  for (const [name, line] of variants) {
    await withSample(async (s) => {
      write(s, D_PATH, withLine(2, line));
      const run = await check(s);
      const found = findingLines(run.stdout);
      assert.ok(found.some((l) => l.startsWith('src/core/discount.ts:2  error[waiver-unknown-rule]')), `${name}: ${run.stdout}`);
      assert.ok(found.some((l) => l.startsWith('src/core/discount.ts:3  error[no-console]')), `${name}: ${run.stdout}`);
      assert.doesNotMatch(run.stdout, /waiver-without-reason/, name);
      assert.equal(run.code, 1, name);
    });
  }
});

test('test 34: an unused waiver', async () => {
  await withSample(async (s) => {
    write(s, D_PATH, withLine(5, '  // lawcheck-waive no-console -- nothing here'));
    const run = await check(s);
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: FAIL  1 error, 2 warnings in 1 changed file (against main), 2 waivers');
    assert.ok(findingLines(run.stdout).some((line) => line.startsWith('src/core/discount.ts:5  warning[waiver-unused]')), run.stdout);
  });
});

test('test 35: two waivers in comments of other languages', async () => {
  const both = [
    '<!-- lawcheck-waive no-console -- a demo of two waivers -->',
    '/* lawcheck-waive no-todo -- tracked on the board */',
    "console.log('x'); // TODO later",
    '',
  ].join('\n');
  await withSample(async (s) => {
    write(s, 'src/core/both.ts', both);
    const run = await check(s);
    assert.equal(run.stdout, 'lawcheck: PASS  1 changed file (against main), 2 waivers\nnote: this change adds 2 waivers: no-console at src/core/both.ts:1; no-todo at src/core/both.ts:2\n');
    assert.equal(run.code, 0);
    const json = JSON.parse((await check(s, '--base', 'main', '--json')).stdout);
    assert.deepEqual(
      json.waivers.map((w: { reason: string; waived: number }) => [w.reason, w.waived]),
      [
        ['a demo of two waivers', 1],
        ['tracked on the board', 1],
      ],
    );
  });
});

test('test 36: waivers outside the change count in the debt heading', async () => {
  const edit = (s: string) => {
    append(s, 'src/core/price.ts', '// end\n');
    append(s, 'src/core/tax.ts', '// end\n');
    append(s, 'tools/release.mjs', '// end\n');
  };
  await withSample(async (s) => {
    edit(s);
    const run = await check(s, '--full', '--base', 'main');
    assert.equal(run.stdout.split('\n')[0], 'lawcheck: FAIL  1 error, 2 warnings in 3 changed files (against main)');
    assert.ok(run.stdout.split('\n').includes('debt (outside this change): none'), run.stdout);
    assert.equal(run.code, 1);
  });
  await withSample(
    async (s) => {
      edit(s);
      const run = await check(s, '--full', '--base', 'main');
      assert.equal(run.stdout.split('\n')[0], 'lawcheck: FAIL  1 error, 2 warnings in 3 changed files (against main)');
      assert.ok(run.stdout.split('\n').includes('debt (outside this change): none, 1 waiver'), run.stdout);
      assert.equal(run.code, 1);
    },
    { onMain: (s) => append(s, 'src/cli/main.ts', '// TODO later lawcheck-waive no-todo -- a demo\n') },
  );
});

test('test 37: waiver findings outside the change are debt', async () => {
  await withSample(
    async (s) => {
      const run = await check(s, '--full', '--base', 'main');
      const lines = run.stdout.split('\n');
      assert.equal(lines[0], 'lawcheck: PASS  nothing changed against main');
      assert.ok(lines.includes('debt (outside this change): 5 findings in 3 files, 1 waiver'), run.stdout);
      const found = findingLines(run.stdout);
      assert.ok(found.some((line) => line.startsWith('src/core/tax.ts:3  warning[waiver-unknown-rule]')), run.stdout);
      assert.ok(found.some((line) => line.startsWith('src/core/tax.ts:4  warning[waiver-unused]')), run.stdout);
      assert.equal(run.code, 0);
    },
    { onMain: (s) => append(s, 'src/core/tax.ts', '// lawcheck-waive no-such -- x\n// lawcheck-waive no-todo -- nothing here\n') },
  );
});

const LEGACY = "console.log('x'); // lawcheck-waive no-console -- a legacy call\n";
const SHIPPING = 'src/core/shipping.ts';
const ADDED = (line: number) => `note: this change adds 1 waiver: no-console at ${SHIPPING}:${line}`;
const waiversOf = async (s: string, ...args: string[]) => JSON.parse((await check(s, ...args, '--json')).stdout).waivers.map((w: { line: number; added: boolean | null }) => [w.line, w.added]);

test('test 850: check names a waiver the change adds, in text and in JSON, and not one the base already holds', async () => {
  await withSample(async (s) => {
    write(s, SHIPPING, LEGACY);
    const run = await check(s);
    assert.equal(run.stdout, `lawcheck: PASS  1 changed file (against main), 1 waiver\n${ADDED(1)}\n`);
    assert.equal(run.code, 0);
    const json = JSON.parse((await check(s, '--base', 'main', '--json')).stdout);
    assert.deepEqual(json.waivers, [{ file: SHIPPING, line: 1, rule: 'no-console', debt: false, waived: 1, reason: 'a legacy call', added: true }]);
    assert.ok((await check(s, '--full', '--base', 'main')).stdout.split('\n').includes(ADDED(1)), 'a full check against a base names it too');
    const named = await check(s, `./${SHIPPING}`);
    assert.ok(!named.stdout.includes('note:'), named.stdout);
    assert.deepEqual(await waiversOf(s, `./${SHIPPING}`), [[1, null]]);
  });
  await withSample(
    async (s) => {
      append(s, SHIPPING, '// more\n');
      const run = await check(s);
      assert.equal(run.stdout, 'lawcheck: PASS  1 changed file (against main), 1 waiver\n');
      assert.deepEqual(await waiversOf(s, '--base', 'main'), [[1, false]]);
      assert.deepEqual(await waiversOf(s, '--full', '--base', 'main'), [[1, false]]);
    },
    { onMain: (s) => write(s, SHIPPING, LEGACY) },
  );
  await withSample(
    async (s) => {
      write(s, SHIPPING, LEGACY.replace("'x'", "'y'") + LEGACY);
      const run = await check(s);
      assert.equal(run.stdout, `lawcheck: PASS  1 changed file (against main), 2 waivers\n${ADDED(1)}\n`);
      assert.deepEqual(await waiversOf(s, '--base', 'main'), [[1, true], [2, false]]);
    },
    { onMain: (s) => write(s, SHIPPING, LEGACY) },
  );
  await withSample(async (s) => {
    write(s, 'notes/plan.md', '<!-- lawcheck-waive no-console -- no type takes this file -->\n');
    write(s, SHIPPING, Array.from({ length: 7 }, (_, i) => LEGACY.replace("'x'", `'${i}'`)).join(''));
    const run = await check(s);
    assert.deepEqual(run.stdout.split('\n').slice(0, 2), [
      'lawcheck: PASS  2 changed files (against main), 7 waivers',
      `note: this change adds 7 waivers: ${[1, 2, 3, 4, 5].map((line) => `no-console at ${SHIPPING}:${line}`).join('; ')}; and 2 more`,
    ]);
  });
});

test('S4-5: a waiver after the last line of a multi-line import does not cover the use, which sits on the first line; a waiver on the line above the statement does', async () => {
  const reason = 'the report repeats the banner until 2.0';
  await withU(async (u) => {
    write(u, E_PATH, `import {\n  main,\n} from '../cli/main.js'; // lawcheck-waive forbidden-use -- ${reason}\nexport const report = main;\n`);
    const run = await check(u);
    assert.deepEqual(findingLines(run.stdout), [
      `${E_PATH}:1  error[forbidden-use]  library may not use command (src/cli/main.ts); it takes may_use [library] from source`,
      `${E_PATH}:3  warning[waiver-unused]  the waiver of 'forbidden-use' drops no finding`,
    ]);
    assert.equal(run.code, 1);
  });
  await withU(async (u) => {
    write(u, E_PATH, `// lawcheck-waive forbidden-use -- ${reason}\nimport {\n  main,\n} from '../cli/main.js';\nexport const report = main;\n`);
    const run = await check(u);
    assert.deepEqual(findingLines(run.stdout), []);
    assert.equal(run.code, 0);
  });
});

test('test 850: the base text of the changed files that hold a waiver is read by as many git processes for twenty files as for two', async () => {
  const starts = async (count: number) =>
    withSample(
      async (s, dir) => {
        for (let i = 0; i < count; i++) append(s, `src/core/old${i}.ts`, '// more\n');
        write(s, SHIPPING, LEGACY);
        const trace = join(dir, 'trace.log');
        fakeWrites(dir, ['trace.log']);
        const run = await lawcheck(s, ['check', '--base', 'main'], { GIT_TRACE: trace });
        assert.equal(run.stdout, `lawcheck: PASS  ${count + 1} changed files (against main), ${count + 1} waivers\n${ADDED(1)}\n`);
        return readFileSync(trace, 'utf8').split('\n').filter((line) => /trace: (built-in|exec|run_command): /.test(line)).length;
      },
      {
        onMain: (s) => {
          for (let i = 0; i < count; i++) write(s, `src/core/old${i}.ts`, LEGACY);
        },
      },
    );
  assert.equal(await starts(20), await starts(2));

test('S1-15: of two waivers of one rule that cover one line, the unused one names the waiver that takes the findings', async () => {
  await withSample(async (s) => {
    write(s, D_PATH, 'export function discount(net: number): number {\n  // lawcheck-waive no-console -- the first\n  // lawcheck-waive no-console -- the second\n  console.log(net);\n  return net;\n}\n');
    const run = await check(s);
    assert.equal(run.code, 0, run.stdout);
    assert.deepEqual(findingLines(run.stdout), ["src/core/discount.ts:2  warning[waiver-unused]  the waiver of 'no-console' drops no finding; the waiver on line 3 already drops the findings of that line"]);
    write(s, D_PATH, 'export function discount(net: number): number {\n  // lawcheck-waive no-console -- the first\n  console.log(net); // lawcheck-waive no-console -- the second\n  return net;\n}\n');
    const own = await check(s);
    assert.deepEqual(findingLines(own.stdout), ["src/core/discount.ts:2  warning[waiver-unused]  the waiver of 'no-console' drops no finding; the waiver on line 3 already drops the findings of that line"]);
  });
});

test('S1-15: a reason of only invisible characters is no reason, and a reason with a visible word beside one is', async () => {
  await withSample(async (s) => {
    for (const invisible of ['\u200b', ' \u200b\u2060 ', '\ufeff', '\u200b\u200d']) {
      write(s, D_PATH, `export function discount(net: number): number {\n  // lawcheck-waive no-console --${invisible}\n  console.log(net);\n  return net;\n}\n`);
      const run = await check(s);
      assert.equal(run.code, 1, JSON.stringify(invisible));
      assert.deepEqual(findingLines(run.stdout).slice(0, 2), ["src/core/discount.ts:2  error[waiver-without-reason]  the waiver of 'no-console' gives no reason after --", 'src/core/discount.ts:3  error[no-console]  writes to the terminal with console.log'], JSON.stringify(invisible));
    }
    write(s, D_PATH, 'export function discount(net: number): number {\n  // lawcheck-waive no-console -- \u200bpricing reads it\n  console.log(net);\n  return net;\n}\n');
    assert.equal((await check(s)).code, 0);
  });
});
