import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FAILED_MESSAGE, withFake } from './fake-reviewer.ts';
import { MiB, sparse, textHead } from '../limits/support.ts';
import {
  append,
  F,
  F_PATH,
  F_PRIME,
  findingLines,
  git,
  KEY_F_PRIME,
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
    ['provider: gemini', REVIEWER_CONFIG.replace('openai-compatible', 'gemini'), 2, 'gemini-cli'],
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
    ['temperature under codex', 'reviewer:\n  provider: codex\n  temperature: 0\n', 3, null],
    ['no model with ollama', 'reviewer:\n  provider: ollama\n', 1, null],
    ['a model with NUL under codex', 'reviewer:\n  provider: codex\n  model: "a\\u0000b"\n', 3, null],
    ['a model of 257 characters under copilot-cli', `reviewer:\n  provider: copilot-cli\n  model: ${'m'.repeat(257)}\n`, 3, null],
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

const NO_WAIVERS = replaceOnce(REVIEWER_LAW, '        rules: [no-console, clear-errors]\n', '        rules: [no-console, clear-errors]\n        waivers: false\n');
const NOT_REVIEWED_F = 'src/core/refund.ts  error[not-reviewed]  clear-errors has no verdict for this content';
const NOT_REVIEWED_NAMED = NOT_REVIEWED_F.replace('error[', 'warning[');
const notReviewedOf = (stdout: string) => findingLines(stdout).filter((line) => line.includes('[not-reviewed]'));
const reviewOfF = (stdout: string) => stdout.split('\n').find((line) => line.startsWith('    clear-errors  ')) ?? '';

test('R-97: a pass recorded while the waiver counted is no pass once the type sets waivers: false, in check, check of a named file, explain and --review', async () => {
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        write(r, F_PATH, F_PRIME);
        const recorded = await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(recorded.code, 0, recorded.stdout);
        assert.equal(read(r, '.lawcheck/verdicts'), `${KEY_PRICE} clear-errors\n${KEY_TAX} clear-errors\n${KEY_F_PRIME} clear-errors\n`);
        git(r, 'add', '-A');
        git(r, 'commit', '-q', '-m', 'reviewed');
        write(r, '.lawcheck/law.yaml', NO_WAIVERS);
        git(r, 'commit', '-q', '-am', 'no waivers');

        const plain = await run(r, null, []);
        assert.deepEqual(notReviewedOf(plain.stdout), [NOT_REVIEWED_F], plain.stdout);
        assert.equal(plain.code, 1, plain.stdout);
        const named = await run(r, null, [F_PATH]);
        assert.equal(named.stdout.split('\n')[0], 'lawcheck: PASS  1 warning in 1 named file', named.stdout);
        assert.deepEqual(findingLines(named.stdout), [NOT_REVIEWED_NAMED], named.stdout);
        assert.equal(named.code, 0, named.stdout);
        const full = await run(r, null, ['--full', '--base', 'main']);
        assert.deepEqual(notReviewedOf(full.stdout), [NOT_REVIEWED_F], full.stdout);
        assert.equal(full.code, 1, full.stdout);
        const json = await run(r, null, ['--full', '--base', 'main', '--json']);
        assert.deepEqual(JSON.parse(json.stdout).reviews, { missing: 1, calls_made: 0, passes_recorded: 0 });
        assert.equal(json.code, 1, json.stdout);
        const file = await lawcheck(r, ['explain', F_PATH]);
        assert.match(reviewOfF(file.stdout), /^ {4}clear-errors {2}reviewer {2}enforced {2}from library {2}not reviewed {2}/, file.stdout);
        assert.equal(file.code, 0, file.stdout);
        const rule = await lawcheck(r, ['explain', '--rule', 'clear-errors']);
        assert.ok(rule.stdout.split('\n').includes('  binds:  3 files; 2 have a verdict for their content'), rule.stdout);
        assert.equal(rule.code, 0, rule.stdout);
        assert.equal(fake.requests.length, 1);

        const again = await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(fake.requests.length, 2);
        assert.ok(fake.requests[1]!.prompt.endsWith('\n\n<waived>\nnone\n</waived>'), fake.requests[1]!.prompt);
        assert.deepEqual(findingLines(again.stdout), [`src/core/refund.ts:4  error[clear-errors]  ${FAILED_MESSAGE}`], again.stdout);
        assert.equal(again.code, 1, again.stdout);
      },
      { onMain: (r) => write(r, '.lawcheck/verdicts', `${KEY_PRICE} clear-errors\n${KEY_TAX} clear-errors\n`) },
    );
  });
});

test('R-97: the verdict line of F\' from section 5, written while its waiver counted, passes it under a type that reads waivers and not under one with waivers: false', async () => {
  type Seen = [string[], string, string[], number];
  const cases: [string, string, Seen[], string][] = [
    [
      'waivers counted',
      REVIEWER_LAW,
      [
        [['--base', 'main'], 'lawcheck: PASS  1 changed file (against main), 1 waiver', [], 0],
        [[F_PATH], 'lawcheck: PASS  1 named file, 1 waiver', [], 0],
      ],
      'reviewed',
    ],
    [
      'waivers: false',
      NO_WAIVERS,
      [
        [['--base', 'main'], 'lawcheck: FAIL  1 error in 1 changed file (against main)', [NOT_REVIEWED_F], 1],
        [[F_PATH], 'lawcheck: PASS  1 warning in 1 named file', [NOT_REVIEWED_NAMED], 0],
      ],
      'not reviewed',
    ],
  ];
  await Promise.all(
    cases.map(([name, law, seen, state]) =>
      withR(
        async (r) => {
          write(r, F_PATH, F_PRIME);
          for (const [args, first, notReviewed, code] of seen) {
            const result = await run(r, null, args);
            assert.equal(result.stdout.split('\n')[0], first, `${name}: ${result.stdout}`);
            assert.deepEqual(notReviewedOf(result.stdout), notReviewed, `${name}: ${result.stdout}`);
            assert.equal(result.code, code, `${name}: ${result.stdout}`);
          }
          const file = await lawcheck(r, ['explain', F_PATH]);
          assert.match(reviewOfF(file.stdout), new RegExp(`^ {4}clear-errors {2}reviewer {2}enforced {2}from library {2}${state} {2}`), `${name}: ${file.stdout}`);
          assert.equal(file.code, 0, `${name}: ${file.stdout}`);
        },
        {
          onMain: (r) => {
            write(r, '.lawcheck/law.yaml', law);
            write(r, '.lawcheck/verdicts', `${KEY_F_PRIME} clear-errors\n`);
          },
        },
      ),
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

test('test 72: .lawcheck/verdicts and .lawcheck/.gitattributes have no type', async () => {
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        const typed = git(r, 'ls-files', '.lawcheck').split('\n').filter((path) => path !== '' && path !== '.lawcheck/.gitattributes').sort();
        const first = await run(r, fake, ['--full', '--review', '--base', 'main']);
        assert.equal(first.code, 0, first.stdout);
        const asked = fake.requests.map((request) => request.prompt.match(/\n<file path="([^"]+)">/)![1]!);
        assert.deepEqual(asked.filter((path) => path.startsWith('.lawcheck/')).sort(), typed);
        assert.ok(!asked.includes('.lawcheck/verdicts'));
        assert.ok(!asked.includes('.lawcheck/.gitattributes'));
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
    for (const [args, first] of [[['--help'], 'usage: lawcheck <command> [<arguments>] [--json]'], [['check', '--help'], 'usage: lawcheck check [--full] [--strict] [--base <ref>] [--review [--again] [--max-calls <n>]] [--json]']] as const) {
      const result = await lawcheck(r, [...args]);
      assert.equal(result.stdout.split('\n')[0], first);
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
        scope: { mode: 'change', base: 'main', files: 1, law_changed: false },
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
          { file: 'src/core/refund.ts', line: 3, rule: 'clear-errors', debt: false, waived: 0, reason: 'the payment provider matches this exact text', added: true },
        ],
        unresolved: [],
        reviews: { missing: 1, calls_made: 0, passes_recorded: 0 },
        next: { command: 'lawcheck check --review --base main', text: 'lawcheck check --review --base main  (1 reviewer call)' },
      };
      assert.deepEqual(JSON.parse(plain.stdout), expected);
      assert.equal(JSON.stringify(JSON.parse(plain.stdout)), JSON.stringify(expected), 'the keys keep the order of docs/json.md');
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

test('reviewer-slice §8: the line on standard error before the first call', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      append(r, 'src/core/tax.ts', '// end\n');
      const result = await run(r, fake, ['--review', '--base', 'main']);
      assert.equal(result.stderr, 'lawcheck: 2 reviewer calls to openai-compatible\n');
    });
  });
});

const PAIR = '.lawcheck/rules/lib/spec-of.mjs';
const PAIR_SOURCE = "export function companion({ file }) {\n  return [file.path.replace('src/core/', 'docs/specs/').replace(/\\.ts$/, '.md')];\n}\n";
const WITH_PAIR = replaceOnce(REVIEWER_LAW, '    context: ["docs/errors.md"]\n', `    context: ["docs/errors.md"]\n    companion: ${PAIR}\n`);
const PRICE_SPEC = 'The price is the net times 1.23.\n';
const TAX_SPEC = 'The rate is 0.23.\n';

function withPair(source = PAIR_SOURCE): (r: string) => void {
  return (r) => {
    write(r, '.lawcheck/law.yaml', WITH_PAIR);
    write(r, PAIR, source);
    write(r, 'docs/specs/price.md', PRICE_SPEC);
    write(r, 'docs/specs/tax.md', TAX_SPEC);
  };
}

function promptFor(fake: { requests: { prompt: string }[] }, path: string): string {
  const found = fake.requests.filter((request) => request.prompt.includes(`\n<file path="${path}">\n`));
  assert.equal(found.length, 1, `one prompt for ${path}`);
  return found[0]!.prompt;
}

function contextPaths(prompt: string): string[] {
  return [...prompt.matchAll(/\n<context path="([^"]+)">\n/g)].map((match) => match[1]!);
}

test("test 900: a reviewer rule's companion names, for each judged file, files that go into that file's prompt only, numbered like context files", async () => {
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        const result = await run(r, fake, ['--full', '--review', '--base', 'main']);
        assert.ok(!result.stdout.includes('error[rule-crashed]'), result.stdout);
        assert.equal(fake.requests.length, 2, result.stdout);
        const price = promptFor(fake, 'src/core/price.ts');
        const tax = promptFor(fake, 'src/core/tax.ts');
        assert.deepEqual(contextPaths(price), ['docs/errors.md', 'docs/specs/price.md']);
        assert.deepEqual(contextPaths(tax), ['docs/errors.md', 'docs/specs/tax.md']);
        assert.ok(price.includes('\n</context>\n\n<context path="docs/specs/price.md">\n1| The price is the net times 1.23.\n</context>\n\n<file path="src/core/price.ts">\n'), price);
        assert.ok(tax.includes('\n<context path="docs/specs/tax.md">\n1| The rate is 0.23.\n</context>\n\n<file path="src/core/tax.ts">\n'), tax);
        const explained = await lawcheck(r, ['explain', 'src/core/price.ts']);
        assert.match(explained.stdout, /\n {4}clear-errors {2}reviewer {2}enforced {2}from library {2}reviewed {2}/, explained.stdout);
        const rule = await lawcheck(r, ['explain', '--rule', 'clear-errors']);
        assert.ok(rule.stdout.split('\n').includes(`  companion:  ${PAIR}`), rule.stdout);
        assert.ok(rule.stdout.split('\n').includes('  binds:  2 files; 2 have a verdict for their content'), rule.stdout);
        assert.equal(JSON.parse((await lawcheck(r, ['explain', '--rule', 'clear-errors', '--json'])).stdout).companion, PAIR);
        assert.equal(JSON.parse((await lawcheck(r, ['explain', '--rule', 'no-console', '--json'])).stdout).companion, null);
        const tried = await lawcheck(r, ['try', 'clear-errors', 'src/core/tax.ts'], { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
        assert.equal(tried.code, 0, tried.stdout);
        assert.equal(fake.requests[2]!.prompt, tax);
      },
      { onMain: withPair() },
    );
  });
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        const result = await run(r, fake, ['--full', '--review', '--base', 'main']);
        assert.equal(fake.requests.length, 2, result.stdout);
        assert.deepEqual(contextPaths(promptFor(fake, 'src/core/price.ts')), ['docs/errors.md', 'docs/specs/price.md', 'src/cli/main.ts']);
        assert.deepEqual(contextPaths(promptFor(fake, 'src/core/tax.ts')), ['docs/errors.md', 'src/cli/main.ts']);
      },
      {
        onMain: withPair(
          [
            'export async function companion({ file, repo }) {',
            '  const { root } = await file.tree();',
            '  const { uses } = await file.uses();',
            "  const own = root !== null && uses !== null && file.text.includes('console') ? [file.path.replace('src/core/', 'docs/specs/').replace(/\\.ts$/, '.md')] : [];",
            "  return [...own, ...own, file.path, 'docs/errors.md', ...repo.filesOf('command')];",
            '}',
            '',
          ].join('\n'),
        ),
      },
    );
  });
});

test('test 901: the companion runs in the closed runner of script rules, and a change to it or to a file it returned makes the verdicts it fed stale', async () => {
  const crashed = (stdout: string) => errorsOf(stdout).filter((line) => line.startsWith(`${PAIR}  error[rule-crashed]  `));
  const closed: [string, string, string][] = [
    ['the network', "export async function companion() { await fetch('http://127.0.0.1:9/'); return []; }\n", 'uses the network, which is closed to script rules'],
    ['a write', "import { writeFileSync } from 'node:fs';\nexport function companion() { writeFileSync('out.txt', 'x'); return []; }\n", ', and a rule may write no file'],
    ['a program', "import { execFileSync } from 'node:child_process';\nexport function companion() { execFileSync('git', ['--version']); return []; }\n", 'starts a program, and a rule may start none'],
  ];
  await withFake(async (fake) => {
    await Promise.all(
      closed.map(([name, source, cause]) =>
        withR(
          async (r) => {
            const result = await run(r, fake, ['--full', '--review', '--base', 'main']);
            assert.equal(result.code, 2, `${name}: ${result.stdout}`);
            assert.equal(crashed(result.stdout).length, 1, `${name}: ${result.stdout}`);
            assert.ok(crashed(result.stdout)[0]!.includes(cause), `${name}: ${result.stdout}`);
            assert.ok(!existsSync(join(r, 'out.txt')), name);
          },
          { onMain: withPair(source) },
        ),
      ),
    );
    assert.equal(fake.requests.length, 0);
  });
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        const first = await run(r, fake, ['--full', '--review', '--base', 'main']);
        assert.equal(fake.requests.length, 2, first.stdout);
        git(r, 'add', '-A');
        git(r, 'commit', '-q', '-m', 'reviewed');
        const notReviewed = (stdout: string) => findingLines(stdout).filter((line) => line.includes('[not-reviewed]')).map((line) => line.split('  ')[0]);
        const cases: [string, (r: string) => void, string[]][] = [
          ['nothing', () => undefined, []],
          ['the file the companion returned for price.ts', (r) => append(r, 'docs/specs/price.md', 'Round to cents.\n'), ['src/core/price.ts']],
          ['the file the companion returned for tax.ts', (r) => append(r, 'docs/specs/tax.md', 'Round to cents.\n'), ['src/core/tax.ts']],
          ['the companion', (r) => append(r, PAIR, 'export const unused = 1;\n'), ['src/core/price.ts', 'src/core/tax.ts']],
          ['the fixed context', (r) => append(r, 'docs/errors.md', 'More.\n'), ['src/core/price.ts', 'src/core/tax.ts']],
        ];
        for (const [name, change, expected] of cases) {
          change(r);
          const result = await run(r, null, ['--full', '--base', 'main']);
          assert.deepEqual(notReviewed(result.stdout), expected, `${name}: ${result.stdout}`);
          git(r, 'checkout', '-q', '--', '.');
        }
        assert.equal(fake.requests.length, 2);
        sparse(r, '.lawcheck/verdicts', textHead(read(r, '.lawcheck/verdicts')), 16 * MiB + 1);
        const full = await run(r, null, ['--full', '--base', 'main']);
        assert.equal(full.code, 2, full.stdout);
        assert.ok(full.stdout.includes('the file cannot be read (it holds more than 16 MiB); of its 2 passes the files of this tree need 2,'), full.stdout);
      },
      { onMain: withPair() },
    );
  });
});

test('test 902: the prompt size limit counts the companion files, and a returned path that is no file to send is a stated error', async () => {
  await withR(
    async (r) => {
      const sizeOf = async () => {
        const dry = await lawcheck(r, ['try', 'clear-errors', 'src/core/price.ts', '--dry-run']);
        return Number(/a prompt of (\d+) characters/.exec(dry.stdout)![1]);
      };
      const withSpec = await sizeOf();
      write(r, 'docs/specs/price.md', PRICE_SPEC + 'x'.repeat(500) + '\n');
      const larger = await sizeOf();
      assert.equal(larger, withSpec + 504);
      write(r, '.lawcheck/config.yaml', `${REVIEWER_CONFIG}  max_chars: ${larger - 1}\n`);
      const result = await run(r, null, ['--full', '--base', 'main']);
      assert.ok(
        findingLines(result.stdout).includes(`src/core/price.ts  warning[too-large-to-review]  the prompt for clear-errors holds ${larger} characters; reviewer.max_chars is ${larger - 1}`),
        result.stdout,
      );
      assert.ok(!findingLines(result.stdout).some((line) => line.startsWith('src/core/tax.ts  warning[too-large-to-review]')), result.stdout);
    },
    { onMain: withPair() },
  );
  const stated: [string, string, (r: string) => void, string][] = [
    ['a missing file', "export function companion() { return ['docs/specs/nope.md']; }\n", () => undefined, "returns 'docs/specs/nope.md' for src/core/price.ts, which is no file git lists here"],
    [
      'a file git ignores',
      "export function companion() { return ['docs/specs/local.md']; }\n",
      (r) => {
        write(r, 'docs/specs/local.md', 'local\n');
        write(r, '.gitignore', 'docs/specs/local.md\n');
      },
      "returns 'docs/specs/local.md' for src/core/price.ts, which is no file git lists here",
    ],
    ['a binary file', "export function companion() { return ['docs/specs/blob.bin']; }\n", (r) => write(r, 'docs/specs/blob.bin', Buffer.from([0x61, 0x00, 0x62])), "returns 'docs/specs/blob.bin' for src/core/price.ts, which is binary"],
    ['no list', "export function companion() { return 'docs/specs/price.md'; }\n", () => undefined, 'returns no list of paths for src/core/price.ts'],
    ['a path that is no string', 'export function companion() { return [1]; }\n', () => undefined, 'returns a path that is no string for src/core/price.ts'],
    ['no function companion', 'export function check() { return []; }\n', () => undefined, 'fails to load: the module exports no function companion'],
  ];
  await withFake(async (fake) => {
    await Promise.all(
      stated.map(([name, source, more, message]) =>
        withR(
          async (r) => {
            const result = await run(r, fake, ['--full', '--review', '--base', 'main']);
            assert.equal(result.code, 2, `${name}: ${result.stdout}`);
            assert.deepEqual(errorsOf(result.stdout), [`${PAIR}  error[rule-crashed]  ${message}`], `${name}: ${result.stdout}`);
          },
          {
            onMain: (r) => {
              withPair(source)(r);
              more(r);
            },
          },
        ),
      ),
    );
    assert.equal(fake.requests.length, 0);
  });
});

test("test 903: the companion key of the law: on a reviewer rule alone, and naming a module of .lawcheck/rules/lib/ that git lists", async () => {
  const cases: [string, (r: string) => void, string][] = [
    ['on a script rule', (r) => write(r, '.lawcheck/law.yaml', replaceOnce(WITH_PAIR, '    status: advisory\n', `    status: advisory\n    companion: ${PAIR}\n`)), `.lawcheck/law.yaml:9  error[law-invalid]  the script rule 'no-todo' takes no 'companion'; only a reviewer rule does`],
    ['a missing module', (r) => rmSync(join(r, PAIR)), `.lawcheck/law.yaml:12  error[law-invalid]  'companion' of rule 'clear-errors' names '${PAIR}', which is no file git lists here`],
    [
      'a module outside lib',
      (r) => {
        write(r, 'tools/spec-of.mjs', PAIR_SOURCE);
        write(r, '.lawcheck/law.yaml', WITH_PAIR.replace(PAIR, 'tools/spec-of.mjs'));
      },
      ".lawcheck/law.yaml:12  error[law-invalid]  'companion' of rule 'clear-errors' names 'tools/spec-of.mjs', which is no .mjs file in .lawcheck/rules/lib/",
    ],
    ['a list', (r) => write(r, '.lawcheck/law.yaml', WITH_PAIR.replace(`companion: ${PAIR}`, `companion: [${PAIR}]`)), ".lawcheck/law.yaml:12  error[law-invalid]  'companion' of rule 'clear-errors' takes a string, not a sequence"],
  ];
  await Promise.all(
    cases.map(([name, change, expected]) =>
      withR(
        async (r) => {
          const result = await run(r, null, ['--base', 'main']);
          assert.equal(result.code, 2, `${name}: ${result.stdout}`);
          assert.deepEqual(errorsOf(result.stdout), [expected], `${name}: ${result.stdout}`);
        },
        {
          onMain: (r) => {
            withPair()(r);
            change(r);
          },
        },
      ),
    ),
  );
  await withR(
    async (r) => {
      write(r, '.lawcheck/law.yaml', WITH_PAIR);
      write(r, PAIR, PAIR_SOURCE);
      const result = await run(r, null, ['--base', 'main']);
      assert.ok(result.stdout.split('\n').includes('note: this change edits the law that judges it: changes the companion of the rule clear-errors; adds .lawcheck/rules/lib/spec-of.mjs'), result.stdout);
    },
    {
      onMain: (r) => {
        withPair()(r);
        write(r, '.lawcheck/law.yaml', REVIEWER_LAW);
        rmSync(join(r, PAIR));
      },
    },
  );
});

const SIGNED_PASS = 'lawcheck-signed-pass/1';
const PAIR_F_PRIME = `${KEY_F_PRIME} clear-errors`;
const NO_SIGNER_F = 'src/core/refund.ts  error[not-reviewed]  clear-errors has a pass for this content that no signer of the law signed';

function signerKeys(): { d: string; x: string; key: KeyObject } {
  const pair = generateKeyPairSync('ed25519');
  return { d: pair.privateKey.export({ format: 'jwk' }).d!, x: pair.publicKey.export({ format: 'jwk' }).x!, key: pair.privateKey };
}

function signedLine(pair: string, name: string, key: KeyObject): string {
  return `${pair} ${name} ${sign(null, Buffer.from(`${SIGNED_PASS} ${pair}`), key).toString('base64url')}`;
}

function verifies(line: string, x: string): boolean {
  const [hash, rule, , signature] = line.split(' ');
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
  return verify(null, Buffer.from(`${SIGNED_PASS} ${hash} ${rule}`), key, Buffer.from(signature!, 'base64url'));
}

const withSigners = (law: string, signers: Record<string, string>) => `${law}\nsigners:\n${Object.entries(signers).map(([name, x]) => `  ${name}: ${x}\n`).join('')}`;

test('R-38: when the law names signers, a pass line that no signer of the law signed is no review, in check, check of a named file, explain and --strict', async () => {
  const alice = signerKeys();
  const mallory = signerKeys();
  const forged: [string, string][] = [
    ['an unsigned line', PAIR_F_PRIME],
    ['a line signed by a key the law does not name', signedLine(PAIR_F_PRIME, 'mallory', mallory.key)],
    ["a line that names alice and carries mallory's signature", signedLine(PAIR_F_PRIME, 'alice', mallory.key)],
    ["alice's signature of another pass", `${PAIR_F_PRIME} alice ${signedLine(`${KEY_PRICE} clear-errors`, 'alice', alice.key).split(' ')[3]}`],
  ];
  await Promise.all(
    forged.map(([name, line]) =>
      withR(
        async (r) => {
          write(r, F_PATH, F_PRIME);
          append(r, '.lawcheck/verdicts', `${line}\n`);
          const plain = await run(r, null, ['--base', 'main']);
          assert.deepEqual(notReviewedOf(plain.stdout), [NO_SIGNER_F], `${name}: ${plain.stdout}`);
          assert.equal(plain.code, 1, `${name}: ${plain.stdout}`);
          const named = await run(r, null, [F_PATH]);
          assert.deepEqual(findingLines(named.stdout), [NO_SIGNER_F.replace('error[', 'warning[')], `${name}: ${named.stdout}`);
          const strict = await run(r, null, ['--strict', '--base', 'main']);
          assert.ok(notReviewedOf(strict.stdout).includes(NO_SIGNER_F), `${name}: ${strict.stdout}`);
          assert.equal(strict.code, 1, `${name}: ${strict.stdout}`);
          const file = await lawcheck(r, ['explain', F_PATH]);
          assert.match(reviewOfF(file.stdout), /^ {4}clear-errors {2}reviewer {2}enforced {2}from library {2}not reviewed {2}/, `${name}: ${file.stdout}`);
        },
        { onMain: (r) => write(r, '.lawcheck/law.yaml', withSigners(REVIEWER_LAW, { alice: alice.x })) },
      ),
    ),
  );
  await withR(
    async (r) => {
      write(r, F_PATH, F_PRIME);
      append(r, '.lawcheck/verdicts', `${signedLine(PAIR_F_PRIME, 'alice', alice.key)}\n`);
      const plain = await run(r, null, ['--base', 'main']);
      assert.equal(plain.stdout.split('\n')[0], 'lawcheck: PASS  1 changed file (against main), 1 waiver', plain.stdout);
      assert.equal(plain.code, 0, plain.stdout);
      const file = await lawcheck(r, ['explain', F_PATH]);
      assert.match(reviewOfF(file.stdout), /^ {4}clear-errors {2}reviewer {2}enforced {2}from library {2}reviewed {2}/, file.stdout);
    },
    { onMain: (r) => write(r, '.lawcheck/law.yaml', withSigners(REVIEWER_LAW, { bob: mallory.x, alice: alice.x })) },
  );
});

test('R-38: check --review records a pass, signed, only with the signing key of a signer the law names, and asks the reviewer nothing without one', async () => {
  const alice = signerKeys();
  const mallory = signerKeys();
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        write(r, F_PATH, F_PRIME);
        append(r, '.lawcheck/verdicts', `${PAIR_F_PRIME}\n`);
        const before = read(r, '.lawcheck/verdicts');
        const cases: [string, NodeJS.ProcessEnv, string][] = [
          ['no key', {}, 'error[not-a-signer]  the law names signers and LAWCHECK_SIGNING_KEY is not set, so this run could record no pass that counts'],
          ['a key that is no key', { LAWCHECK_SIGNING_KEY: 'not a key at all' }, 'error[not-a-signer]  LAWCHECK_SIGNING_KEY holds no Ed25519 signing key: it takes 43 characters of base64url'],
          ['a key of no signer', { LAWCHECK_SIGNING_KEY: mallory.d }, `error[not-a-signer]  the key in LAWCHECK_SIGNING_KEY belongs to no signer of the law; its public key is ${mallory.x}`],
        ];
        for (const [name, env, error] of cases) {
          const refused = await run(r, fake, ['--review', '--base', 'main'], env);
          assert.equal(refused.code, 2, `${name}: ${refused.stdout}`);
          assert.deepEqual(errorsOf(refused.stdout), [error], `${name}: ${refused.stdout}`);
          assert.ok(!refused.stdout.includes(mallory.d), `${name}: ${refused.stdout}`);
          assert.equal(fake.requests.length, 0, name);
          assert.equal(read(r, '.lawcheck/verdicts'), before, name);
        }
        const signed = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_SIGNING_KEY: alice.d });
        assert.equal(signed.code, 0, signed.stdout);
        assert.equal(fake.requests.length, 1, 'the unsigned line asks the reviewer again');
        const lines = read(r, '.lawcheck/verdicts').split('\n').filter((line) => line.startsWith(`${PAIR_F_PRIME} `));
        assert.equal(lines.length, 1, read(r, '.lawcheck/verdicts'));
        assert.match(lines[0]!, /^[0-9a-f]{32} clear-errors alice [A-Za-z0-9_-]{86}$/);
        assert.ok(verifies(lines[0]!, alice.x), lines[0]);
        const plain = await run(r, null, ['--base', 'main']);
        assert.equal(plain.code, 0, plain.stdout);
        const again = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_SIGNING_KEY: alice.d });
        assert.equal(again.code, 0, again.stdout);
        assert.equal(fake.requests.length, 1, 'a signed pass needs no second call');
      },
      { onMain: (r) => write(r, '.lawcheck/law.yaml', withSigners(REVIEWER_LAW, { alice: alice.x })) },
    );
  });
});

test("R-38: a pull request that takes the signers out of its law, or adds its own, passes its check and fails the check with the law of the base, as the workflow of docs/ci.md runs it", async () => {
  const alice = signerKeys();
  const mallory = signerKeys();
  const changes: [string, string, string, string][] = [
    ['signers taken out', REVIEWER_LAW, PAIR_F_PRIME, 'removes the signer alice'],
    ['its own signer added', withSigners(REVIEWER_LAW, { alice: alice.x, mallory: mallory.x }), signedLine(PAIR_F_PRIME, 'mallory', mallory.key), 'adds the signer mallory'],
  ];
  await Promise.all(
    changes.map(([name, law, line, told]) =>
      withR(
        async (r) => {
          write(r, F_PATH, F_PRIME);
          write(r, '.lawcheck/law.yaml', law);
          append(r, '.lawcheck/verdicts', `${line}\n`);
          git(r, 'add', '-A');
          git(r, 'commit', '-q', '-m', 'the pull request');
          const own = await run(r, null, ['--base', 'main']);
          assert.equal(own.code, 0, `${name}: ${own.stdout}`);
          assert.ok(own.stdout.split('\n').includes(`note: this change edits the law that judges it: ${told}`), `${name}: ${own.stdout}`);
          git(r, 'checkout', 'main', '--', '.lawcheck/law.yaml');
          const ofBase = await run(r, null, ['--base', 'main']);
          assert.deepEqual(notReviewedOf(ofBase.stdout), [NO_SIGNER_F], `${name}: ${ofBase.stdout}`);
          assert.equal(ofBase.code, 1, `${name}: ${ofBase.stdout}`);
          git(r, 'checkout', 'HEAD', '--', '.lawcheck/law.yaml');
        },
        { onMain: (r) => write(r, '.lawcheck/law.yaml', withSigners(REVIEWER_LAW, { alice: alice.x })) },
      ),
    ),
  );
});

test('R-38: a law that names no signers reads and writes the verdicts as before, counts a signed line as a pass, and leaves LAWCHECK_SIGNING_KEY unused', async () => {
  const alice = signerKeys();
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F_PRIME);
      const recorded = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_SIGNING_KEY: alice.d });
      assert.equal(recorded.code, 0, recorded.stdout);
      assert.equal(read(r, '.lawcheck/verdicts'), `${PAIR_F_PRIME}\n`);
      write(r, '.lawcheck/verdicts', `${signedLine(PAIR_F_PRIME, 'alice', alice.key)}\n`);
      const plain = await run(r, null, ['--base', 'main']);
      assert.equal(plain.code, 0, plain.stdout);
      assert.equal(fake.requests.length, 1);
    });
  });
});

test("R-38: the law's signers: a mapping of kebab-case names to Ed25519 public keys of 43 characters of base64url", async () => {
  const alice = signerKeys();
  const cases: [string, string, string][] = [
    ['a list', `${REVIEWER_LAW}\nsigners: [${alice.x}]\n`, "'signers' takes a mapping, not a sequence"],
    ['empty', `${REVIEWER_LAW}\nsigners: {}\n`, "'signers' names no signer"],
    ['a name in capitals', withSigners(REVIEWER_LAW, { Alice: alice.x }), "the signer name 'Alice' is not kebab-case"],
    ['a key of 44 characters', withSigners(REVIEWER_LAW, { alice: `${alice.x}A` }), "the key of signer 'alice' is no Ed25519 public key: it takes 43 characters of base64url"],
    ['a key in base64 with padding', withSigners(REVIEWER_LAW, { alice: Buffer.from(alice.x, 'base64url').toString('base64') }), "the key of signer 'alice' is no Ed25519 public key: it takes 43 characters of base64url"],
    ['a key of 43 characters that are no 32 bytes', withSigners(REVIEWER_LAW, { alice: `${alice.x.slice(0, 42)}B` }), "the key of signer 'alice' is no Ed25519 public key: it takes 43 characters of base64url"],
    ['a number', `${REVIEWER_LAW}\nsigners:\n  alice: 12\n`, "the key of signer 'alice' takes a string, not a number"],
    ['misspelled', `${REVIEWER_LAW}\nsigner:\n  alice: ${alice.x}\n`, "unknown key 'signer' at the top of the law (did you mean 'signers'?)"],
  ];
  await Promise.all(
    cases.map(([name, law, message]) =>
      withR(
        async (r) => {
          const result = await run(r, null, ['--base', 'main']);
          assert.equal(result.code, 2, `${name}: ${result.stdout}`);
          const errors = errorsOf(result.stdout);
          assert.equal(errors.length, 1, `${name}: ${result.stdout}`);
          assert.match(errors[0]!, /^\.lawcheck\/law\.yaml:\d+  error\[law-invalid\]  /, `${name}: ${errors[0]}`);
          assert.ok(errors[0]!.endsWith(message), `${name}: ${errors[0]}`);
        },
        { onMain: (r) => write(r, '.lawcheck/law.yaml', law) },
      ),
    ),
  );
});
