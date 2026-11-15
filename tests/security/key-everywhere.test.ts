import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withFake, writeFakeClaude } from '../acceptance/fake-reviewer.ts';
import { F, F_PATH, inTemp, lawcheck, makeSample, pathWith, setRule, withR, write } from '../acceptance/helpers.ts';
import type { Run } from '../acceptance/helpers.ts';

const KEY = 'sk-live-ABCDEF0123456789abcdef';
const OTHER = 'sk-ant-ZYXWVU9876543210zyxwvu';
const ENV = { LAWCHECK_REVIEWER_KEY: KEY, ANTHROPIC_API_KEY: OTHER };

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '.git') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files(path, out);
    else out.push(path);
  }
  return out;
}

// The owner's ruling of question 89 (spec/questions.md): the key appears nowhere Lawcheck prints or writes, not even its first characters cut off at a limit.
function assertHidden(runs: Run[], root: string, planted: string[] = []): void {
  for (const run of runs) {
    for (const key of [KEY, OTHER]) {
      assert.ok(!(run.stdout + run.stderr).includes(key.slice(0, 9)), `${key.slice(0, 9)} in: ${run.stdout}${run.stderr}`);
    }
  }
  for (const path of files(join(root, '.lawcheck'))) {
    if (planted.includes(path)) continue;
    assert.ok(!readFileSync(path, 'utf8').includes(KEY.slice(0, 9)), path);
  }
}

test('S3-2: a rule message that quotes a line holding the key shows [key], in text, JSON and try (I-secret-1)', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    setRule(s, 'no-console', "export function check({ files }) { return [{ line: 1, message: 'quotes: ' + files[0].lines[0] }]; }\n");
    write(s, 'src/core/discount.ts', `const key = '${KEY}';\n`);
    const runs = [await lawcheck(s, ['check', '--base', 'main'], ENV), await lawcheck(s, ['check', '--base', 'main', '--json'], ENV), await lawcheck(s, ['try', 'no-console', 'src/core/discount.ts'], ENV)];
    assertHidden(runs, s);
    assert.ok(runs[0]!.stdout.includes("quotes: const key = '[key]';"), runs[0]!.stdout);
    assert.equal(JSON.parse(runs[1]!.stdout).findings.find((f: { code: string }) => f.code === 'no-console').message, "quotes: const key = '[key]';");
  });
});

test('S3-2: a judged file named with the key shows [key] in check and explain, and the base named with it in its error (I-secret-1)', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    write(s, `src/core/${KEY}.ts`, "console.log('x');\n");
    const runs = [
      await lawcheck(s, ['check', '--base', 'main'], ENV),
      await lawcheck(s, ['check', '--base', 'main', '--json'], ENV),
      await lawcheck(s, ['explain', `src/core/${KEY}.ts`], ENV),
      await lawcheck(s, ['check', '--base', KEY], ENV),
      await lawcheck(s, ['check', '--base', OTHER, '--json'], ENV),
    ];
    assertHidden(runs, s);
    assert.ok(runs[0]!.stdout.includes('src/core/[key].ts:1  error[no-console]'), runs[0]!.stdout);
    assert.ok(runs[3]!.stdout.includes("the base '[key]'"), runs[3]!.stdout);
  });
});

test('S3-2: a config value that holds the key shows [key] in doctor (I-secret-1)', async () => {
  await withR(async (r) => {
    write(r, '.lawcheck/config.yaml', `reviewer:\n  provider: openai-compatible\n  model: ${KEY}\n  timeout: ${JSON.stringify(OTHER)}\n`);
    const runs = [await lawcheck(r, ['doctor'], ENV), await lawcheck(r, ['doctor', '--json'], ENV)];
    assertHidden(runs, r, [join(r, '.lawcheck', 'config.yaml')]);
    assert.ok(runs[0]!.stdout.includes('[key]'), runs[0]!.stdout);
  });
});

test("S3-2: what a script rule prints holding the key reaches standard error as [key] (I-secret-1)", async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    setRule(s, 'no-console', "export function check({ files }) { console.error('saw ' + files[0].lines[0]); return []; }\n");
    write(s, 'src/core/discount.ts', `const key = '${KEY}';\n`);
    const run = await lawcheck(s, ['check', '--base', 'main'], ENV, [], { stderr: /^saw const key = '\[key\]';\n$/ });
    assertHidden([run], s);
    assert.ok(run.stderr.includes("saw const key = '[key]';"), run.stderr);
  });
});

test('S3-2: a key that straddles the 200-character cut of an endpoint message shows none of its characters (I-secret-1)', async () => {
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const runs = [await lawcheck(r, ['check', '--review', '--base', 'main'], { ...ENV, LAWCHECK_REVIEWER_ENDPOINT: fake.url }), await lawcheck(r, ['doctor', '--reviewer'], { ...ENV, LAWCHECK_REVIEWER_ENDPOINT: fake.url })];
        assertHidden(runs, r);
        assert.ok(runs[0]!.stdout.includes('HTTP 401'), runs[0]!.stdout);
      });
    },
    () => ({ status: 401, body: JSON.stringify({ error: { message: `${'x'.repeat(190)} ${KEY} rejected` } }) }),
  );
});

test('S3-2: a key that straddles the 300-character cut of a claude-code message shows none of its characters (I-secret-1)', async () => {
  await withR(async (r, dir) => {
    write(r, '.lawcheck/config.yaml', 'reviewer:\n  provider: claude-code\n');
    write(r, F_PATH, F);
    const bin = join(dir, 'bin');
    writeFakeClaude(bin);
    const echo = join(bin, 'echo-long.cjs');
    writeFileSync(echo, `process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: '${'y'.repeat(290)} ' + process.env.LAWCHECK_REVIEWER_KEY + ' refused' })); process.exit(1); });\n`);
    writeFileSync(join(bin, 'claude'), `#!/usr/bin/env node\nrequire(${JSON.stringify(echo)});\n`);
    if (process.platform === 'win32') writeFileSync(join(bin, 'claude.cmd'), `@"${process.execPath}" "${echo}" %*\r\n`);
    const run = await lawcheck(r, ['check', '--review', '--base', 'main'], { ...ENV, PATH: pathWith(bin) });
    assertHidden([run], r);
    assert.equal(run.code, 2, run.stdout);
  });
});


test("S3-2: a key that is a word of Lawcheck's own output leaves that output as it is; only the text from outside shows [key] (I-secret-1)", async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    setRule(s, 'no-console', "export function check() { return [{ line: 1, message: 'lawcheck saw it' }]; }\n");
    write(s, 'src/core/discount.ts', 'export const d = 1;\n');
    const env = { LAWCHECK_REVIEWER_KEY: 'lawcheck' };
    const text = await lawcheck(s, ['check', '--base', 'main'], env);
    assert.match(text.stdout, /^lawcheck: FAIL  1 error in \d+ changed files \(against main\)\n/, text.stdout);
    assert.ok(text.stdout.includes('src/core/discount.ts:1  error[no-console]  [key] saw it'), text.stdout);
    const json = await lawcheck(s, ['check', '--base', 'main', '--json'], env);
    const document = JSON.parse(json.stdout);
    assert.equal(document.schema, 'lawcheck-check/0');
    assert.equal(document.findings.find((f: { code: string }) => f.code === 'no-console').message, '[key] saw it');
  });
});

for (const [key, replaced] of [['seven77', false], ['eight888', true]] as const) {
  test(`S3-2: a key of ${key.length} characters is ${replaced ? '' : 'not '}replaced; a key shorter than 8 is no secret (I-secret-1)`, async () => {
    await inTemp(async (dir) => {
      const s = makeSample(dir);
      setRule(s, 'no-console', `export function check() { return [{ line: 1, message: 'quotes ${key}' }]; }\n`);
      write(s, 'src/core/discount.ts', 'export const d = 1;\n');
      const run = await lawcheck(s, ['check', '--base', 'main'], { LAWCHECK_REVIEWER_KEY: key });
      assert.ok(run.stdout.includes(`error[no-console]  quotes ${replaced ? '[key]' : key}`), run.stdout);
    });
  });
}

test("S3-2: a one-character key changes nothing in a plain check's output (I-secret-1)", async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    write(s, 'src/core/discount.ts', "console.log('e');\n");
    const plain = await lawcheck(s, ['check', '--base', 'main', '--json']);
    for (const key of ['e', '1']) {
      const keyed = await lawcheck(s, ['check', '--base', 'main', '--json'], { LAWCHECK_REVIEWER_KEY: key });
      assert.equal(keyed.stdout, plain.stdout, key);
    }
  });
});
