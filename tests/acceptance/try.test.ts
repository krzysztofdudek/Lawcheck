import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defaultAnswer, FAILED_MESSAGE, withFake } from './fake-reviewer.ts';
import { D, D_PATH, F, F_PATH, F_PRIME, git, lawcheck, LAW, PROMPT_F, REVIEWER_CONFIG, setRule, withR, withSample, write } from './helpers.ts';

const WHY_CLEAR = '  why:  An error a caller sees says what happened and what to do next.';
const FAIL_LINE = `src/core/refund.ts:2  error[clear-errors]  ${FAILED_MESSAGE}`;

const tryIn = (cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) => lawcheck(cwd, ['try', ...args], env);

test('test 116: a script rule on the files it binds, on a file, and on a file it does not bind', async () => {
  await withSample(async (s) => {
    const bound = await tryIn(s, ['no-console']);
    assert.equal(
      bound.stdout,
      [
        'lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 2 files',
        '',
        'src/core/price.ts:2  error[no-console]  writes to the terminal with console.log',
        '  why:  Only the command layer writes to the terminal.',
        '',
      ].join('\n'),
    );
    assert.equal(bound.code, 1);
    const main = await tryIn(s, ['no-console', 'src/cli/main.ts']);
    assert.equal(
      main.stdout,
      [
        'lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 1 file',
        '',
        'src/cli/main.ts:2  error[no-console]  writes to the terminal with console.log',
        '  why:  Only the command layer writes to the terminal.',
        '',
      ].join('\n'),
    );
    assert.equal(main.code, 1);
    const readme = await tryIn(s, ['no-todo', 'README.md']);
    assert.equal(readme.stdout, 'lawcheck: try no-todo (script rule, advisory)  nothing found in 1 file\n');
    assert.equal(readme.code, 0);
  });
});

test('test 117: directories, patterns and their union', async () => {
  await withSample(async (s) => {
    const three = 'lawcheck: try no-console (script rule, enforced)  2 findings in 2 of 3 files';
    for (const [cwd, args] of [
      [s, ['no-console', 'src']],
      [s, ['no-console', 'src/**/*.ts']],
      [join(s, 'src'), ['no-console', 'c*/*.ts']],
    ] as const) {
      const result = await tryIn(cwd, [...args]);
      const lines = result.stdout.split('\n');
      assert.equal(lines[0], three, args.join(' '));
      assert.ok(lines.some((line) => line.startsWith('src/cli/main.ts:2  error[no-console]')));
      assert.ok(lines.some((line) => line.startsWith('src/core/price.ts:2  error[no-console]')));
      assert.equal(result.code, 1);
    }
    const union = await tryIn(s, ['no-console', 'src/core/price.ts', 'src/core']);
    assert.equal(union.stdout.split('\n')[0], 'lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 2 files');
    assert.equal(union.code, 1);
    write(s, 'src/core/blob.ts', Buffer.from([0x78, 0x00]));
    const binary = await tryIn(s, ['no-console', 'src/core/*']);
    assert.equal(binary.stdout.split('\n')[0], 'lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 2 files');
    assert.equal(binary.code, 1);
  });
});

test('test 118: a reviewer rule takes files alone', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      for (const args of [['clear-errors'], ['clear-errors', 'src/core'], ['clear-errors', 'src/core/*.ts'], ['clear-errors', F_PATH, '--dry-run', '--max-calls', '3']]) {
        const result = await tryIn(r, args, { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
        assert.match(result.stdout, /^error\[usage\]/m, args.join(' '));
        assert.equal(result.code, 2);
      }
      assert.equal(fake.requests.length, 0);
    });
  });
});

test('test 119: waivers count, and nothing is written', async () => {
  await withSample(async (s) => {
    write(s, D_PATH, D);
    const result = await tryIn(s, ['no-console', D_PATH]);
    const lines = result.stdout.split('\n');
    assert.equal(lines[0], 'lawcheck: try no-console (script rule, enforced)  1 finding in 1 of 1 file, 1 waived');
    assert.deepEqual(
      lines.filter((line) => /error\[/.test(line)),
      ['src/core/discount.ts:2  error[no-console]  writes to the terminal with console.log'],
    );
    assert.equal(result.code, 1);
    assert.equal(git(s, 'status', '--porcelain'), '?? src/core/discount.ts\n');
    assert.equal(existsSync(join(s, '.lawcheck/.local')), false);
  });
});

test('test 120: a file with no type reaches a rule with type null', async () => {
  await withSample(
    async (s) => {
      const readme = await tryIn(s, ['spare', 'README.md']);
      assert.equal(readme.stdout.split('\n')[2], 'README.md  error[spare]  null');
      assert.equal(readme.code, 1);
      const price = await tryIn(s, ['spare', 'src/core/price.ts']);
      assert.equal(price.stdout.split('\n')[2], 'src/core/price.ts  error[spare]  library');
      assert.equal(price.code, 1);
      const none = await tryIn(s, ['spare']);
      assert.match(none.stdout, /^error\[usage\]/m);
      assert.equal(none.code, 2);
    },
    {
      onMain: (s) => {
        write(s, '.lawcheck/law.yaml', LAW.replace('rules:\n', 'rules:\n  spare:\n    why: Nothing lists it.\n'));
        setRule(s, 'spare', 'export function check({ files }) { return [{ message: String(files[0].type) }]; }\n');
      },
    },
  );
});

test('test 121: a rule that throws is rule-crashed', async () => {
  await withSample(
    async (s) => {
      const result = await tryIn(s, ['no-console']);
      assert.match(result.stdout, /^\.lawcheck\/rules\/no-console\.mjs {2}error\[rule-crashed\]/m);
      assert.equal(result.code, 2);
    },
    { onMain: (s) => setRule(s, 'no-console', "export function check() { throw new Error('broken'); }\n") },
  );
});

test('test 122: usage', async () => {
  await withSample(async (s) => {
    const cases = [
      [],
      ['nope'],
      ['no-consol'],
      ['forbidden-use', 'src'],
      ['no-console', '--times', '2'],
      ['no-console', '--dry-run'],
      ['no-console', '--max-calls', '3'],
      ['--all'],
      ['no-console', 'nope.ts'],
      ['no-console', 'src/**/*.zzz'],
      ['no-console', 'src/{a'],
      ['no-console', '../x'],
    ];
    for (const args of cases) {
      const result = await tryIn(s, args);
      assert.match(result.stdout, /^error\[usage\]/m, args.join(' '));
      assert.equal(result.code, 2, args.join(' '));
      if (args[0] === 'no-consol') assert.match(result.stdout, /'no-console'/);
      if (args[1] === 'nope.ts') assert.match(result.stdout, /git ignores it or it does not exist/);
      if (args[1] === 'src/**/*.zzz') assert.match(result.stdout, /matches no file/);
    }
    write(s, '.gitignore', 'src/core/gen.ts\n');
    write(s, 'src/core/gen.ts', 'console.log(1);\n');
    write(s, 'src/core/blob.ts', Buffer.from([0x78, 0x00]));
    for (const [args, why] of [[['no-console', 'src/core/gen.ts'], /git ignores it or it does not exist/], [['no-console', 'src/core/blob.ts'], /it is binary/]] as const) {
      const result = await tryIn(s, [...args]);
      assert.match(result.stdout, /^error\[usage\]/m, args.join(' '));
      assert.match(result.stdout, why, args.join(' '));
      assert.equal(result.code, 2, args.join(' '));
    }
  });
});

test('test 123: a reviewer rule is asked with check prompt, records nothing, and runs dry', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.url };
      const once = await tryIn(r, ['clear-errors', F_PATH], env);
      assert.equal(
        once.stdout,
        ['lawcheck: try clear-errors (reviewer rule, enforced)  1 finding in 1 of 1 file, 1 waived, 1 reviewer call', '', FAIL_LINE, WHY_CLEAR, ''].join('\n'),
      );
      assert.equal(once.code, 1);
      assert.equal(fake.requests.length, 1);
      assert.equal(fake.requests[0]!.json.messages[0].content, PROMPT_F);
      assert.equal(git(r, 'status', '--porcelain'), '?? src/core/refund.ts\n');
      assert.equal(existsSync(join(r, '.lawcheck/verdicts')), false);
      assert.equal(existsSync(join(r, '.lawcheck/.local')), false);
      const twice = await tryIn(r, ['clear-errors', F_PATH, '--times', '2'], env);
      assert.equal(
        twice.stdout,
        [
          'lawcheck: try clear-errors (reviewer rule, enforced)  2 answers for 1 file: 2 fail, 0 pass, 2 waived, 2 reviewer calls',
          '',
          'src/core/refund.ts  answer 1 of 2: fail',
          FAIL_LINE,
          WHY_CLEAR,
          'src/core/refund.ts  answer 2 of 2: fail',
          FAIL_LINE,
          '',
        ].join('\n'),
      );
      assert.equal(twice.code, 1);
      assert.equal(fake.requests.length, 3);
      const dry = await tryIn(r, ['clear-errors', F_PATH, '--dry-run', '--times', '3'], env);
      assert.equal(dry.stdout, ['lawcheck: try clear-errors (reviewer rule, enforced)  dry run: 3 reviewer calls, none made', '', 'src/core/refund.ts  3 calls, a prompt of 2127 characters', ''].join('\n'));
      assert.equal(dry.code, 0);
      assert.equal(fake.requests.length, 3);
    });
  });
});

test('test 124: a pass that try paid for is not recorded', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F_PRIME);
      const tried = await tryIn(r, ['clear-errors', F_PATH], { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
      assert.equal(tried.stdout, 'lawcheck: try clear-errors (reviewer rule, enforced)  nothing found in 1 file, 1 waived, 1 reviewer call\n');
      assert.equal(tried.code, 0);
      const checked = await lawcheck(r, ['check', '--base', 'main']);
      assert.match(checked.stdout, /^src\/core\/refund\.ts {2}error\[not-reviewed\]/m);
      assert.equal(checked.code, 1);
      await lawcheck(r, ['check', '--review', '--base', 'main'], { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
      assert.equal(fake.requests.length, 2);
      const again = await tryIn(r, ['clear-errors', F_PATH], { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
      assert.equal(again.stdout, tried.stdout);
      assert.equal(fake.requests.length, 3);
    });
  });
});

test('test 125: what stops a reviewer rule before the first call', async () => {
  await withFake(async (fake) => {
    const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.url };
    await withR(
      async (r) => {
        write(r, F_PATH, F);
        const result = await tryIn(r, ['clear-errors', F_PATH], env);
        assert.match(result.stdout, /^error\[reviewer-not-configured\]/m);
        assert.equal(result.code, 2);
      },
      { onMain: (r) => git(r, 'rm', '-q', '.lawcheck/config.yaml') },
    );
    await withR(async (r) => {
      write(r, F_PATH, F);
      const many = await tryIn(r, ['clear-errors', F_PATH, '--times', '3', '--max-calls', '2'], env);
      assert.match(many.stdout, /^error\[too-many-reviews\] .*3.*2/m);
      assert.equal(many.code, 2);
      const unset = await tryIn(r, ['clear-errors', F_PATH]);
      assert.match(unset.stdout, /^error\[reviewer-unreachable\]/m);
      assert.equal(unset.code, 2);
    });
    await withR(
      async (r) => {
        write(r, F_PATH, F);
        const large = await tryIn(r, ['clear-errors', F_PATH], env);
        assert.match(large.stdout, /^src\/core\/refund\.ts {2}error\[too-large-to-review\]/m);
        assert.equal(large.code, 2);
      },
      { onMain: (r) => write(r, '.lawcheck/config.yaml', REVIEWER_CONFIG + '  max_chars: 2126\n') },
    );
    await withR(
      async (r) => {
        write(r, F_PATH, F);
        const both = await tryIn(r, ['clear-errors', F_PATH], env);
        assert.match(both.stdout, /^src\/core\/refund\.ts {2}error\[too-large-to-review\]/m);
        assert.doesNotMatch(both.stdout, /reviewer-not-configured/);
        assert.equal(both.code, 2);
      },
      { onMain: (r) => write(r, '.lawcheck/config.yaml', 'reviewer:\n  max_chars: 100\n') },
    );
    assert.equal(fake.requests.length, 0);
  });
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await tryIn(r, ['clear-errors', F_PATH], { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
        assert.match(result.stdout, /^src\/core\/refund\.ts {2}error\[reviewer-unreachable\] .*500/m);
        assert.match(result.stdout, /^next: run the same command again; try keeps no answer, so it makes every call again$/m);
        assert.equal(result.code, 2);
      });
    },
    () => ({ status: 500, body: '{}' }),
  );
});

test('test 126: JSON of a reviewer rule asked twice', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const result = await tryIn(r, ['clear-errors', F_PATH, '--times', '2', '--json'], { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
      const document = JSON.parse(result.stdout);
      const answer = defaultAnswer(PROMPT_F);
      const item = (attempt: number) => ({
        file: F_PATH,
        attempt,
        verdict: 'fail',
        findings: [{ line: 2, message: FAILED_MESSAGE, severity: 'error' }],
        waived: 1,
        answer,
        prompt_chars: 2127,
      });
      assert.deepEqual(document, {
        schema: 'lawcheck-try/0',
        rule: 'clear-errors',
        files: 1,
        summary: { findings: 2, files_with_findings: 1, waived: 2, calls_made: 2 },
        runs: [item(1), item(2)],
        next: null,
      });
      assert.equal(result.code, 1);
    });
  });
});

test('test 127: JSON of a script rule', async () => {
  await withSample(async (s) => {
    const result = await tryIn(s, ['no-console', '--json']);
    assert.deepEqual(JSON.parse(result.stdout), {
      schema: 'lawcheck-try/0',
      rule: 'no-console',
      files: 2,
      summary: { findings: 1, files_with_findings: 1, waived: 0, calls_made: 0 },
      runs: [
        { file: 'src/core/price.ts', attempt: 1, verdict: null, findings: [{ line: 2, message: 'writes to the terminal with console.log', severity: 'error' }], waived: 0, answer: null, prompt_chars: null },
        { file: 'src/core/tax.ts', attempt: 1, verdict: null, findings: [], waived: 0, answer: null, prompt_chars: null },
      ],
      next: null,
    });
    assert.equal(result.code, 1);
  });
});
