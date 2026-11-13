import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { withFake } from './fake-reviewer.ts';
import {
  append,
  F,
  F_PATH,
  F_PRIME,
  findingLines,
  git,
  KEY_PRICE,
  KEY_TAX,
  lawcheck,
  read,
  REVIEWER_CONFIG,
  REVIEWER_LAW,
  run,
  setRule,
  withR,
  write,
} from './helpers.ts';

function errorsOf(stdout: string): string[] {
  return stdout.split('\n').filter((line) => /(^|  )error\[[a-z0-9-]+\]  /.test(line));
}

function replaceOnce(text: string, from: string, to: string): string {
  assert.ok(text.includes(from), `the text holds ${from}`);
  return text.replace(from, to);
}

test('test 68: config-invalid', async () => {
  const cases: [string, string, number, string | null][] = [
    ['provider: codex', REVIEWER_CONFIG.replace('openai-compatible', 'codex'), 2, null],
    ['provider: claude-cod', REVIEWER_CONFIG.replace('openai-compatible', 'claude-cod'), 2, 'claude-code'],
    ['reviewr:', REVIEWER_CONFIG.replace('reviewer:', 'reviewr:'), 1, 'reviewer'],
    ['keys at the top', REVIEWER_CONFIG + 'keys: { anthropic: x }\n', 4, null],
    ['endpoint', REVIEWER_CONFIG + '  endpoint: http://localhost\n', 4, null],
    ['max_calls: -1', REVIEWER_CONFIG + '  max_calls: -1\n', 4, null],
    ['parallel: 0', REVIEWER_CONFIG + '  parallel: 0\n', 4, null],
    ['timeout: "60"', REVIEWER_CONFIG + '  timeout: "60"\n', 4, null],
    ['timeout: 86401', REVIEWER_CONFIG + '  timeout: 86401\n', 4, null],
    ['max_chars: 1.5', REVIEWER_CONFIG + '  max_chars: 1.5\n', 4, null],
    ['temperature: -1', REVIEWER_CONFIG + '  temperature: -1\n', 4, null],
    ['temperature under claude-code', 'reviewer:\n  provider: claude-code\n  temperature: 0.5\n', 3, null],
    ['no model', 'reviewer:\n  provider: openai-compatible\n', 1, null],
  ];
  await Promise.all(
    cases.map(([name, text, line, names]) =>
      withR(
        async (r) => {
          const result = await run(r, null, ['--base', 'main']);
          assert.equal(result.code, 2, `${name}: ${result.stdout}`);
          const errors = errorsOf(result.stdout);
          assert.equal(errors.length, 1, `${name}: ${result.stdout}`);
          assert.ok(errors[0]!.startsWith(`.lawcheck/config.yaml:${line}  error[config-invalid]  `), `${name}: ${errors[0]}`);
          if (names !== null) assert.ok(errors[0]!.includes(names), `${name}: ${errors[0]}`);
        },
        { onMain: (r) => write(r, '.lawcheck/config.yaml', text) },
      ),
    ),
  );
  await withR(
    async (r) => {
      const result = await run(r, null, ['--base', 'main']);
      assert.equal(result.code, 2);
      const errors = errorsOf(result.stdout);
      assert.ok(errors.length > 0 && errors.every((line) => line.includes('error[law-invalid]')), result.stdout);
    },
    {
      onMain: (r) => {
        write(r, '.lawcheck/config.yaml', REVIEWER_CONFIG.replace('reviewer:', 'reviewr:'));
        write(r, '.lawcheck/law.yaml', REVIEWER_LAW.replace('status: advisory', 'statuss: advisory'));
      },
    },
  );
});

test('test 69: the kind of a rule and its context', async () => {
  const law = (text: string) => (r: string) => write(r, '.lawcheck/law.yaml', text);
  const cases: [string, (r: string) => void, string[]][] = [
    ['a missing context file', law(REVIEWER_LAW.replace('docs/errors.md', 'docs/missing.md')), ['.lawcheck/law.yaml:11  error[law-invalid]']],
    ['a context that is no sequence', law(REVIEWER_LAW.replace('["docs/errors.md"]', '"docs/errors.md"')), ['.lawcheck/law.yaml:11  error[law-invalid]']],
    [
      'context on a script rule',
      law(replaceOnce(REVIEWER_LAW, '    status: advisory\n', '    status: advisory\n    context: ["docs/errors.md"]\n')),
      ['.lawcheck/law.yaml:9  error[law-invalid]'],
    ],
    [
      'an ignored context file',
      (r) => {
        law(REVIEWER_LAW.replace('docs/errors.md', '.env'))(r);
        write(r, '.env', 'SECRET=1\n');
        write(r, '.gitignore', '.env\n');
      },
      ['.lawcheck/law.yaml:11  error[law-invalid]'],
    ],
    [
      'a binary context file',
      (r) => {
        law(REVIEWER_LAW.replace('docs/errors.md', 'docs/blob.bin'))(r);
        write(r, 'docs/blob.bin', Buffer.from([0x61, 0x00, 0x62]));
      },
      ['.lawcheck/law.yaml:11  error[law-invalid]'],
    ],
    [
      'both files',
      (r) => setRule(r, 'clear-errors', 'export function check() { return []; }\n'),
      ['.lawcheck/rules/clear-errors.md  error[rule-file-without-entry]'],
    ],
    ['a rule file of blank lines', (r) => write(r, '.lawcheck/rules/clear-errors.md', '\n  \n\t\n'), ['.lawcheck/law.yaml:9  error[rule-missing-file]']],
    ['no rule file', (r) => rmSync(join(r, '.lawcheck/rules/clear-errors.md')), ['.lawcheck/law.yaml:9  error[rule-missing-file]']],
    ['a stray .md', (r) => write(r, '.lawcheck/rules/notes.md', 'notes\n'), ['.lawcheck/rules/notes.md  error[rule-file-without-entry]']],
    [
      'a rule named not-reviewed',
      law(replaceOnce(REVIEWER_LAW, '\ntypes:\n', '  not-reviewed:\n    why: x\n\ntypes:\n')),
      ['.lawcheck/law.yaml:12  error[law-invalid]'],
    ],
  ];
  await Promise.all(
    cases.map(([name, change, expected]) =>
      withR(
        async (r) => {
          const result = await run(r, null, ['--base', 'main']);
          assert.equal(result.code, 2, `${name}: ${result.stdout}`);
          const errors = errorsOf(result.stdout);
          assert.equal(errors.length, expected.length, `${name}: ${result.stdout}`);
          expected.forEach((prefix, index) => assert.ok(errors[index]!.startsWith(prefix), `${name}: ${errors[index]}`));
          if (name === 'both files') {
            assert.ok(result.stdout.endsWith('\nnext: keep one of .lawcheck/rules/clear-errors.mjs and .lawcheck/rules/clear-errors.md, then run lawcheck check\n'), result.stdout);
          }
          if (name === 'a stray .md') assert.ok(!result.stdout.includes('keep one of'), result.stdout);
        },
        { onMain: change },
      ),
    ),
  );
});

test('test 70: what re-opens a verdict', async () => {
  const withVerdicts = { onMain: (r: string) => write(r, '.lawcheck/verdicts', `${KEY_PRICE} clear-errors\n${KEY_TAX} clear-errors\n`) };
  const notReviewed = (stdout: string) => findingLines(stdout).filter((line) => line.includes('[not-reviewed]'));
  const cases: [string, (r: string) => void, string[], number][] = [
    ['nothing', () => undefined, [], 0],
    [
      'the why',
      (r) => write(r, '.lawcheck/law.yaml', REVIEWER_LAW.replace('what happened and what to do next.', 'what happened and what to do.')),
      ['src/core/price.ts  warning[not-reviewed]  clear-errors has no verdict for this content', 'src/core/tax.ts  warning[not-reviewed]  clear-errors has no verdict for this content'],
      0,
    ],
    ['the status', (r) => write(r, '.lawcheck/law.yaml', replaceOnce(REVIEWER_LAW, '    context:', '    status: advisory\n    context:')), [], 0],
    ['the model', (r) => write(r, '.lawcheck/config.yaml', REVIEWER_CONFIG.replace('test-model', 'other-model')), [], 0],
    [
      'a context file',
      (r) => write(r, 'docs/errors.md', read(r, 'docs/errors.md').replace('Say what', 'Always say what')),
      ['src/core/price.ts  warning[not-reviewed]  clear-errors has no verdict for this content', 'src/core/tax.ts  warning[not-reviewed]  clear-errors has no verdict for this content'],
      0,
    ],
    ['a move', (r) => git(r, 'mv', 'src/core/price.ts', 'src/core/cost.ts'), ['src/core/cost.ts  error[not-reviewed]  clear-errors has no verdict for this content'], 1],
  ];
  await Promise.all(
    cases.map(([name, change, expected, code]) =>
      withR(async (r) => {
        change(r);
        const result = await run(r, null, ['--full', '--base', 'main']);
        assert.deepEqual(notReviewed(result.stdout), expected, `${name}: ${result.stdout}`);
        assert.equal(result.code, code, `${name}: ${result.stdout}`);
      }, withVerdicts),
    ),
  );
});

test('test 71: two branches merge their verdicts', async () => {
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        git(r, 'checkout', '-q', '-b', 'a', 'main');
        const onA = await run(r, fake, ['--full', '--review', '--base', 'main']);
        assert.equal(fake.requests.length, 1, onA.stdout);
        assert.ok(fake.requests[0]!.prompt.includes('\n<file path="src/core/tax.ts">\n'));
        assert.equal(read(r, '.lawcheck/verdicts'), `${KEY_PRICE} clear-errors\n${KEY_TAX} clear-errors\n`);
        git(r, 'add', '-A');
        git(r, 'commit', '-q', '-m', 'a');
        git(r, 'checkout', '-q', '-b', 'b', 'main');
        write(r, F_PATH, F_PRIME);
        const onB = await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(onB.code, 0, onB.stdout);
        assert.equal(fake.requests.length, 2);
        git(r, 'add', '-A');
        git(r, 'commit', '-q', '-m', 'b');
        git(r, 'merge', '-q', '--no-edit', 'a');
        assert.equal(git(r, 'status', '--porcelain'), '');
        const merged = await run(r, fake, ['--full', '--base', 'main']);
        assert.ok(!merged.stdout.includes('not-reviewed'), merged.stdout);
        assert.equal(fake.requests.length, 2);
      },
      {
        onMain: (r) => {
          write(r, '.lawcheck/.gitattributes', 'verdicts merge=union\n');
          write(r, '.lawcheck/verdicts', `${KEY_PRICE} clear-errors\r\ngarbage\r\n<<<<<<< HEAD\r\n`);
        },
      },
    );
  });
});

test('test 72: .lawcheck/verdicts has no type', async () => {
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        const typed = git(r, 'ls-files', '.lawcheck').split('\n').filter(Boolean).sort();
        const first = await run(r, fake, ['--full', '--review', '--base', 'main']);
        assert.equal(first.code, 0, first.stdout);
        const asked = fake.requests.map((request) => request.prompt.match(/\n<file path="([^"]+)">/)![1]!);
        assert.deepEqual(asked.filter((path) => path.startsWith('.lawcheck/')).sort(), typed);
        assert.ok(!asked.includes('.lawcheck/verdicts'));
        const count = fake.requests.length;
        const second = await run(r, fake, ['--full', '--review', '--base', 'main']);
        assert.equal(second.code, 0, second.stdout);
        assert.equal(fake.requests.length, count);
      },
      {
        onMain: (r) => {
          write(r, '.lawcheck/law.yaml', REVIEWER_LAW + '  law-files:\n    paths: [".lawcheck/**"]\n    rules: [clear-errors]\n');
          write(r, '.lawcheck/.gitattributes', 'verdicts merge=union\n');
        },
      },
    );
  });
});

test('test 73: a crashed rule and an unreachable base stop the run before any call', async () => {
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        write(r, F_PATH, F);
        const crashed = await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(crashed.code, 2);
        assert.ok(crashed.stdout.includes('.lawcheck/rules/no-console.mjs  error[rule-crashed]'), crashed.stdout);
      },
      { onMain: (r) => setRule(r, 'no-console', "export function check() { throw new Error('x'); }\n") },
    );
    await withR(async (r) => {
      write(r, F_PATH, F);
      const based = await run(r, fake, ['--review', '--base', 'nope']);
      assert.equal(based.code, 2);
      assert.ok(based.stdout.split('\n').some((line) => line.startsWith('error[base-unreachable]')), based.stdout);
    });
    assert.equal(fake.requests.length, 0);
  });
});

test('test 74: the new flags', async () => {
  await withR(async (r) => {
    const cases = [
      ['--again'],
      ['--max-calls', '3'],
      ['--review', '--max-calls'],
      ['--review', '--max-calls', '-1'],
      ['--review', '--max-calls', 'x'],
      ['--review', '--max-calls=3'],
      ['--review', '--review'],
      ['--review', '--again', '--again'],
      ['--review', '--max-calls', '1', '--max-calls', '2'],
    ];
    for (const args of cases) {
      const result = await lawcheck(r, ['check', ...args]);
      assert.equal(result.code, 2, args.join(' '));
      assert.match(result.stdout, /^error\[usage\]/m, args.join(' '));
    }
    for (const args of [['--help'], ['check', '--help']]) {
      const result = await lawcheck(r, args);
      assert.equal(result.stdout.split('\n')[0], 'usage: lawcheck check [--full] [--base <ref>] [--review [--again] [--max-calls <n>]] [--json]');
      assert.equal(result.code, 0);
    }
  });
});

test('test 75: JSON', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const plain = await run(r, fake, ['--base', 'main', '--json']);
      const expected = {
        schema: 'lawcheck-check/0',
        result: 'fail',
        scope: { mode: 'change', base: 'main', files: 1 },
        summary: { errors: 1, warnings: 0, debt: 0, waivers: 1, unresolved: 0 },
        findings: [
          {
            code: 'not-reviewed', rule: 'clear-errors', severity: 'error', blocking: true, debt: false,
            file: 'src/core/refund.ts', type: 'library',
            message: 'clear-errors has no verdict for this content',
            why: 'a reviewer rule says nothing about content it has not judged',
          },
        ],
        waivers: [
          { file: 'src/core/refund.ts', line: 3, rule: 'clear-errors', debt: false, waived: 0, reason: 'the payment provider matches this exact text' },
        ],
        unresolved: [],
        reviews: { missing: 1, calls_made: 0, passes_recorded: 0 },
        next: { command: 'lawcheck check --review --base main', text: 'lawcheck check --review --base main  (1 reviewer call)' },
      };
      assert.deepEqual(JSON.parse(plain.stdout), expected);
      assert.equal(JSON.stringify(JSON.parse(plain.stdout)), JSON.stringify(expected), 'the keys keep the order of section 8');
      assert.equal(plain.code, 1);
      const reviewed = await run(r, fake, ['--review', '--base', 'main', '--json']);
      const document = JSON.parse(reviewed.stdout);
      assert.equal(document.findings.length, 1);
      assert.deepEqual(
        { code: document.findings[0].code, rule: document.findings[0].rule, line: document.findings[0].line, severity: document.findings[0].severity },
        { code: 'clear-errors', rule: 'clear-errors', line: 2, severity: 'error' },
      );
      assert.equal(document.waivers[0].waived, 1);
      assert.deepEqual(document.reviews, { missing: 0, calls_made: 1, passes_recorded: 0 });
      assert.deepEqual(document.next, { command: null, text: 'fix src/core/refund.ts:2' });
      assert.equal(reviewed.code, 1);
    });
  });
});

test('the line on standard error before the first call', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      append(r, 'src/core/tax.ts', '// end\n');
      const result = await run(r, fake, ['--review', '--base', 'main']);
      assert.equal(result.stderr, 'lawcheck: 2 reviewer calls to openai-compatible\n');
    });
  });
});
