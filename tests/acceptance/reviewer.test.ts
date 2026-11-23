import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plural } from '../../dist/output.js';
import { defaultAnswer, FAILED_MESSAGE, openai, withFake } from './fake-reviewer.ts';
import {
  append,
  F,
  FIRST,
  F_PATH,
  F_PRIME,
  findingLines,
  git,
  KEY_F,
  KEY_F_PRIME,
  KEY_PRICE,
  KEY_TAX,
  lawcheck,
  read,
  PROMPT_F,
  REVIEWER_LAW,
  run,
  SECOND,
  setRule,
  THIRD,
  withR,
  write,
} from './helpers.ts';

const failures = (r: string) => (existsSync(join(r, '.lawcheck/.local/failures')) ? readdirSync(join(r, '.lawcheck/.local/failures')) : []);

test('test 46: a plain run asks nothing and needs no reviewer', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      for (const env of [{}, { LAWCHECK_REVIEWER_ENDPOINT: fake.url }]) {
        const result = await run(r, null, ['--base', 'main'], env);
        assert.equal(result.stdout, FIRST);
        assert.equal(result.code, 1);
      }
      assert.equal(fake.requests.length, 0);
    });
  });
});

test('test 47: --review asks once, keeps the failure, and the next plain run reads it', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const reviewed = await run(r, fake, ['--review', '--base', 'main']);
      assert.equal(reviewed.stdout, SECOND);
      assert.equal(reviewed.code, 1);
      assert.equal(fake.requests.length, 1);
      const request = fake.requests[0]!;
      assert.equal(request.path, '/v1/chat/completions');
      assert.deepEqual(Object.keys(request.json), ['model', 'messages', 'temperature', 'response_format']);
      assert.equal(request.json.model, 'test-model');
      assert.equal(request.json.temperature, 0);
      assert.deepEqual(request.json.response_format, { type: 'json_object' });
      assert.deepEqual(request.json.messages, [{ role: 'user', content: PROMPT_F }]);
      assert.equal(request.json.messages[0].content, PROMPT_F);
      assert.equal(request.headers.authorization, undefined);
      assert.equal(request.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(read(r, `.lawcheck/.local/failures/${KEY_F}.json`)), {
        rule: 'clear-errors',
        findings: [
          { line: 2, message: FAILED_MESSAGE },
          { line: 4, message: FAILED_MESSAGE },
        ],
      });
      assert.equal(read(r, '.lawcheck/.local/.gitignore'), '*\n');
      assert.equal(git(r, 'status', '--porcelain'), '?? src/core/refund.ts\n');
      const plain = await run(r, fake, ['--base', 'main']);
      assert.equal(plain.stdout, SECOND.replace(', 1 reviewer call', ''));
      assert.equal(plain.code, 1);
      assert.equal(fake.requests.length, 1);
    });
  });
});

test("test 48: F' passes, and its pass is recorded", async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F_PRIME);
      const reviewed = await run(r, fake, ['--review', '--base', 'main']);
      assert.equal(reviewed.stdout, 'lawcheck: PASS  1 changed file (against main), 1 waiver, 1 reviewer call\n');
      assert.equal(reviewed.code, 0);
      assert.equal(read(r, '.lawcheck/verdicts'), `${KEY_F_PRIME} clear-errors\n`);
      assert.equal(read(r, '.lawcheck/.gitattributes'), 'verdicts merge=union\n');
      const plain = await run(r, fake, ['--base', 'main']);
      assert.equal(plain.stdout, 'lawcheck: PASS  3 changed files (against main), 1 waiver\n');
      assert.equal(fake.requests.length, 1);
    });
  });
});

test('test 49: a clone with no reviewer reads the committed verdict; CRLF keeps it, an edit loses it', async () => {
  await withFake(async (fake) => {
    await withR(async (r, dir) => {
      write(r, F_PATH, F_PRIME);
      assert.equal((await run(r, fake, ['--review', '--base', 'main'])).code, 0);
      git(r, 'add', '-A');
      git(r, 'commit', '-q', '-m', 'refund');
      git(dir, 'clone', '-q', r, 'clone');
      const clone = join(dir, 'clone');
      const first = await run(clone, null, ['--base', 'origin/main']);
      assert.equal(first.stdout, 'lawcheck: PASS  3 changed files (against origin/main), 1 waiver\n');
      assert.equal(first.code, 0);
      write(clone, F_PATH, F_PRIME.replace(/\n/g, '\r\n'));
      const crlf = await run(clone, null, ['--base', 'origin/main']);
      assert.equal(crlf.stdout, 'lawcheck: PASS  3 changed files (against origin/main), 1 waiver\n');
      assert.equal(crlf.code, 0);
      append(clone, F_PATH, '// end\n');
      const edited = await run(clone, null, ['--base', 'origin/main']);
      assert.ok(findingLines(edited.stdout).includes('src/core/refund.ts  error[not-reviewed]  clear-errors has no verdict for this content'), edited.stdout);
      assert.equal(edited.code, 1);
      assert.equal(fake.requests.length, 1);
    });
  });
});

test('test 50: --full lists the missing reviews of the debt', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const result = await run(r, fake, ['--full', '--base', 'main']);
      assert.equal(result.stdout, THIRD);
      assert.equal(result.code, 1);
      const json = await run(r, fake, ['--full', '--base', 'main', '--json']);
      assert.deepEqual(JSON.parse(json.stdout).reviews, { missing: 3, calls_made: 0, passes_recorded: 0 });
      assert.equal(fake.requests.length, 0);
    });
  });
});

test('test 51: --full --review asks for the debt too', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const result = await run(r, fake, ['--full', '--review', '--base', 'main', '--json']);
      assert.equal(result.code, 1);
      const files = fake.requests.map((request) => request.prompt.match(/\n<file path="([^"]+)">/)![1]).sort();
      assert.deepEqual(files, ['src/core/price.ts', 'src/core/refund.ts', 'src/core/tax.ts']);
      const document = JSON.parse(result.stdout);
      const change = document.findings.filter((f: { debt: boolean }) => !f.debt);
      const debt = document.findings.filter((f: { debt: boolean }) => f.debt);
      assert.equal(change.length, 1);
      assert.equal(change[0].code, 'clear-errors');
      assert.equal(change[0].line, 2);
      assert.equal(change[0].severity, 'error');
      assert.equal(debt.length, 3);
      assert.ok(!document.findings.some((f: { code: string }) => f.code === 'not-reviewed'));
      assert.deepEqual(document.reviews, { missing: 0, calls_made: 3, passes_recorded: 2 });
      assert.equal(read(r, '.lawcheck/verdicts'), `${KEY_PRICE} clear-errors\n${KEY_TAX} clear-errors\n`);
    });
  });
});

test('test 52: an advisory reviewer rule warns', async () => {
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        write(r, F_PATH, F);
        const plain = await run(r, fake, ['--base', 'main']);
        assert.equal(plain.stdout.split('\n')[0], 'lawcheck: PASS  1 warning in 1 changed file (against main), 1 waiver');
        assert.ok(findingLines(plain.stdout).includes('src/core/refund.ts  warning[not-reviewed]  clear-errors has no verdict for this content'));
        assert.equal(plain.code, 0);
        const reviewed = await run(r, fake, ['--review', '--base', 'main']);
        assert.ok(findingLines(reviewed.stdout).some((line) => line.startsWith('src/core/refund.ts:2  warning[clear-errors]')), reviewed.stdout);
        assert.equal(reviewed.code, 0);
      },
      {
        onMain: (r) =>
          write(r, '.lawcheck/law.yaml', REVIEWER_LAW.replace('    context: ["docs/errors.md"]\n', '    status: advisory\n    context: ["docs/errors.md"]\n')),
      },
    );
  });
});

test('test 53: a cached failure is asked again only with --again', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      assert.equal((await run(r, fake, ['--review', '--base', 'main'])).code, 1);
      assert.equal(fake.requests.length, 1);
      assert.equal((await run(r, fake, ['--review', '--base', 'main'])).code, 1);
      assert.equal(fake.requests.length, 1);
      fake.respond = () => openai('{"verdict":"pass","findings":[]}');
      const again = await run(r, fake, ['--review', '--again', '--base', 'main']);
      assert.equal(fake.requests.length, 2);
      assert.equal(again.code, 0, again.stdout);
      assert.deepEqual(failures(r), []);
      assert.ok(read(r, '.lawcheck/verdicts').split('\n').includes(`${KEY_F} clear-errors`));
    });
  });
});

test('test 54: waivers reach the reviewer through <waived>', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F.replace('clear-errors -- the payment provider matches this exact text', 'clear-errors'));
      const result = await run(r, fake, ['--review', '--base', 'main']);
      assert.equal(result.stdout.split('\n')[0], 'lawcheck: FAIL  3 errors in 1 changed file (against main), 1 reviewer call');
      const found = findingLines(result.stdout);
      assert.ok(found.some((line) => line.startsWith('src/core/refund.ts:2  error[clear-errors]')), result.stdout);
      assert.ok(found.some((line) => line.startsWith('src/core/refund.ts:3  error[waiver-without-reason]')), result.stdout);
      assert.ok(found.some((line) => line.startsWith('src/core/refund.ts:4  error[clear-errors]')), result.stdout);
      assert.ok(fake.requests[0]!.prompt.endsWith('\n\n<waived>\nnone\n</waived>'));
    });
  });
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, 'src/core/ok.ts', '// lawcheck-waive clear-errors -- a demo\nexport const ok = 1;\n');
      const result = await run(r, fake, ['--review', '--base', 'main', '--json']);
      assert.equal(result.code, 0, result.stdout);
      assert.ok(fake.requests[0]!.prompt.endsWith('\n\n<waived>\n2\n</waived>'));
      const document = JSON.parse(result.stdout);
      assert.equal(document.summary.waivers, 1);
      assert.ok(!document.findings.some((f: { code: string }) => f.code === 'waiver-unused'));
    });
  });
});

const findingsOfF = () => JSON.parse(defaultAnswer(PROMPT_F)) as { verdict: string; findings: { line: number | null; message: string }[] };

test('test 55: each form of a good answer', async () => {
  const answer = defaultAnswer(PROMPT_F);
  const withFindings = (findings: unknown[]) => JSON.stringify({ verdict: 'fail', findings });
  const cases: [string, string, string[]][] = [
    ['in a json fence', '```json\n' + answer + '\n```', [`src/core/refund.ts:2  error[clear-errors]  ${FAILED_MESSAGE}`]],
    ['after prose', 'The file breaks the rule on two lines. ' + answer, [`src/core/refund.ts:2  error[clear-errors]  ${FAILED_MESSAGE}`]],
    ['before prose', answer + '\nThat is my verdict.', [`src/core/refund.ts:2  error[clear-errors]  ${FAILED_MESSAGE}`]],
    ['before another object', answer + '\n{"note": 1}', [`src/core/refund.ts:2  error[clear-errors]  ${FAILED_MESSAGE}`]],
    ['a line break in a message', withFindings([{ line: 2, message: 'a\nb' }, findingsOfF().findings[1]]), ['src/core/refund.ts:2  error[clear-errors]  a b']],
    [
      'a finding without line',
      withFindings([{ line: 2, message: 'two' }, { message: 'the whole file' }]),
      ['src/core/refund.ts  error[clear-errors]  the whole file', 'src/core/refund.ts:2  error[clear-errors]  two'],
    ],
    ['a finding whose line is null', withFindings([{ line: null, message: 'the whole file' }]), ['src/core/refund.ts  error[clear-errors]  the whole file']],
  ];
  for (const [name, text, expected] of cases) {
    await withFake(
      async (fake) => {
        await withR(async (r) => {
          write(r, F_PATH, F);
          const result = await run(r, fake, ['--review', '--base', 'main']);
          assert.equal(result.code, 1, `${name}: ${result.stdout}`);
          assert.equal(fake.requests.length, 1, name);
          assert.deepEqual(findingLines(result.stdout), expected, name);
        });
      },
      () => openai(text),
    );
  }
});

test('test 56: a bad answer is asked once more, then fails the run', async () => {
  const finding = (line: unknown, message = 'x') => `{"verdict":"fail","findings":[{"line":${JSON.stringify(line)},"message":${JSON.stringify(message)}}]}`;
  const cases = [
    'fine',
    '[]',
    '{"verdict":"pass","findings":[{"line":2,"message":"x"}]}',
    '{"verdict":"fail","findings":[]}',
    '{"verdict":"PASS","findings":[]}',
    finding(0),
    finding(6),
    finding('2'),
    finding(2, '  '),
  ];
  for (const answer of cases) {
    await withFake(
      async (fake) => {
        await withR(async (r) => {
          write(r, F_PATH, F);
          const result = await run(r, fake, ['--review', '--base', 'main']);
          assert.equal(result.code, 2, `${answer}: ${result.stdout}`);
          const line = result.stdout.split('\n').find((l) => l.startsWith('src/core/refund.ts  error[reviewer-bad-answer]  '));
          assert.ok(line, `${answer}: ${result.stdout}`);
          assert.ok(line.slice('src/core/refund.ts  error[reviewer-bad-answer]  '.length).startsWith('clear-errors'), line);
          assert.equal(fake.requests.length, 2, answer);
          assert.ok(!existsSync(join(r, '.lawcheck/verdicts')), answer);
          assert.deepEqual(failures(r), [], answer);
        });
      },
      () => openai(answer),
    );
  }
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(result.stdout, SECOND.replace('1 reviewer call', '2 reviewer calls'));
        assert.equal(result.code, 1);
        assert.equal(fake.requests.length, 2);
      });
    },
    (request) => (request.index === 0 ? openai('fine') : openai(defaultAnswer(request.prompt))),
  );
});

test('S3-9: a run that ends with exit 2 after reviewer calls says how many it made, in the text and in the JSON', async () => {
  const replies: [string, () => (request: { index: number; prompt: string }) => unknown][] = [
    ['a bad answer twice', () => () => openai('fine')],
    ['a server error', () => () => ({ status: 500, body: 'oops' })],
  ];
  for (const [what, reply] of replies) {
    await withFake(
      async (fake) => {
        await withR(async (r) => {
          write(r, F_PATH, F);
          const text = await run(r, fake, ['--review', '--base', 'main']);
          assert.equal(text.code, 2, what);
          assert.ok(fake.requests.length >= 1, what);
          assert.equal(text.stdout.split('\n')[0], `lawcheck: ERROR  1 error, ${plural(fake.requests.length, 'reviewer call')}`, what);
          const before = fake.requests.length;
          const json = await run(r, fake, ['--review', '--base', 'main', '--json']);
          const document = JSON.parse(json.stdout);
          assert.equal(document.schema, 'lawcheck-error/1', what);
          assert.equal(document.calls_made, fake.requests.length - before, what);
          assert.deepEqual(Object.keys(document), ['schema', 'errors', 'calls_made', 'next'], what);
        });
      },
      reply(),
    );
  }
});

test('S3-9: a run that reviewer findings take past the limit of findings says how many reviewer calls it made', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      setRule(r, 'no-console', `export function check({ files }) { return files.some((f) => f.path === '${F_PATH}') ? Array.from({ length: 199999 }, () => ({ file: '${F_PATH}', message: 'm' })) : []; }\n`);
      const result = await run(r, fake, ['--review', '--base', 'main', '--json']);
      assert.equal(result.code, 2, result.stdout);
      const document = JSON.parse(result.stdout);
      assert.deepEqual(document.errors.map((e: { code: string }) => e.code), ['too-many-findings'], result.stdout);
      assert.ok(fake.requests.length >= 1, result.stdout);
      assert.equal(document.calls_made, fake.requests.length);
    });
  });
});

test('S3-9: an error that comes before any reviewer call says nothing of calls', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const result = await run(r, fake, ['--review', '--base', 'main', '--json'], { LAWCHECK_REVIEWER_ENDPOINT: undefined });
      assert.equal(result.code, 2, result.stdout);
      assert.equal(fake.requests.length, 0);
      assert.deepEqual(Object.keys(JSON.parse(result.stdout)), ['schema', 'errors', 'next']);
      const text = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_REVIEWER_ENDPOINT: undefined });
      assert.equal(text.stdout.split('\n')[0], 'lawcheck: ERROR  1 error');
    });
  });
});

test('test 779: --strict names a missing review of old code, and the command of its next line asks about that old code, so a second strict run passes', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      const first = await run(r, fake, ['--strict', '--base', 'main', '--json']);
      assert.equal(first.code, 1);
      const document = JSON.parse(first.stdout);
      const missing = document.findings.filter((f: { code: string }) => f.code === 'not-reviewed');
      assert.deepEqual(missing.map((f: { file: string; debt: boolean; severity: string }) => [f.file, f.debt, f.severity]), [['src/core/price.ts', true, 'error'], ['src/core/tax.ts', true, 'error']]);
      assert.deepEqual(document.next, { command: 'lawcheck check --strict --review --base main', text: 'lawcheck check --strict --review --base main  (2 reviewer calls)' });
      assert.equal(fake.requests.length, 0);
      const text = await run(r, fake, ['--strict', '--base', 'main']);
      assert.match(text.stdout, /^next: lawcheck check --strict --review --base main {2}\(2 reviewer calls\)$/m);
      const followed = await run(r, fake, document.next.command.split(' ').slice(2));
      assert.equal(followed.code, 0, followed.stdout);
      assert.deepEqual(fake.requests.map((request) => request.prompt.match(/\n<file path="([^"]+)">/)![1]).sort(), ['src/core/price.ts', 'src/core/tax.ts']);
      assert.equal(read(r, '.lawcheck/verdicts').trim().split('\n').length, 2);
      const again = await run(r, fake, ['--strict', '--base', 'main']);
      assert.equal(again.code, 0, again.stdout);
      assert.equal(fake.requests.length, 2, 'the second strict run asks nothing');
    }, { onMain: (r) => write(r, 'src/core/price.ts', 'export function price(net: number): number {\n  return net * 1.23;\n}\n') });
  });
});
