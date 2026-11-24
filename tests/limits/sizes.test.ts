import { test } from 'node:test';
import { linkSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { atOnce, D, D_PATH, git, inTemp, setRule, TEST4, withSample, write } from '../acceptance/helpers.ts';
import { errorLines, MiB, run, sparse, textHead } from './support.ts';

const HUGE = 'src/core/huge.ts';
const TOO_LARGE_600 = `${HUGE}  error[file-too-large]  the file holds 600,000,000 bytes, more than the 16 MiB a file read as text may hold`;
const WHY_FILE = '  why:  a run holds every file it reads as text in memory, so one file may hold only so much';
const nextFile = (path: string, command: string) =>
  `next: leave ${path} out of the types with a pattern that starts with ! in .lawcheck/law.yaml, or make it smaller than 16 MiB, then run lawcheck ${command}`;

test('test 230: S1-3, a file of 2.6 GB of zero bytes has no type, and the run judges the rest', async () => {
  await withSample(async (s) => {
    sparse(s, 'src/core/big.ts', '', 2_600_000_000);
    write(s, D_PATH, D);
    const result = await run(s, ['check', '--base', 'main']);
    assert.equal(result.stdout, TEST4.replace('in 1 changed file (against main)', 'in 2 changed files (against main)'));
    assert.equal(result.stderr, '');
    assert.equal(result.code, 1);
  });
});

test('test 231: S1-4, S5-2, a text file of 600 MB is file-too-large with its path, in check, doctor, explain and try', async () => {
  await withSample(async (s) => {
    sparse(s, HUGE, textHead(''), 600_000_000);
    const ended = (command: string) => ['lawcheck: ERROR  1 error', '', TOO_LARGE_600, WHY_FILE, '', nextFile(HUGE, command), ''].join('\n');
    const cases: [string[], string][] = [
      [['check', '--base', 'main'], 'check'],
      [['explain', HUGE], 'explain again'],
      [['explain', 'src'], 'explain again'],
      [['try', 'no-todo', 'src/core/tax.ts'], 'try again'],
    ];
    for (const [args, command] of cases) {
      const result = await run(s, args);
      assert.equal(result.stdout, ended(command), args.join(' '));
      assert.equal(result.stderr, '', args.join(' '));
      assert.equal(result.code, 2, args.join(' '));
    }
    const json = await run(s, ['check', '--base', 'main', '--json']);
    assert.deepEqual(JSON.parse(json.stdout), {
      schema: 'lawcheck-error/1',
      errors: [{ code: 'file-too-large', file: HUGE, line: null, message: 'the file holds 600,000,000 bytes, more than the 16 MiB a file read as text may hold', why: WHY_FILE.slice('  why:  '.length) }],
      next: { command: null, text: nextFile(HUGE, 'check').slice('next: '.length) },
    });
    assert.equal(json.code, 2);
    const doctor = await run(s, ['doctor']);
    assert.ok(doctor.stdout.split('\n').includes(`fail  types  ${HUGE}  the file holds 600,000,000 bytes, more than the 16 MiB a file read as text may hold`), doctor.stdout);
    assert.ok(doctor.stdout.split('\n').includes(`  ${nextFile(HUGE, 'doctor again')}`), doctor.stdout);
    assert.doesNotMatch(doctor.stdout, /internal/);
    assert.equal(doctor.code, 2);
  });
});

test('test 232: a text file of exactly 16 MiB is judged, and one byte more is file-too-large', async () => {
  await withSample(async (s) => {
    const edge = 'src/core/edge.ts';
    sparse(s, edge, textHead('console.log(1);\n'), 16 * MiB);
    const at = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
    assert.deepEqual(errorLines(at.stdout), [`${edge}:1  error[no-console]  writes to the terminal with console.log`]);
    assert.equal(at.stderr, '');
    assert.equal(at.code, 1);
    sparse(s, edge, textHead('console.log(1);\n'), 16 * MiB + 1);
    const beyond = await run(s, ['check', '--base', 'main']);
    assert.deepEqual(errorLines(beyond.stdout), [`${edge}  error[file-too-large]  the file holds 16,777,217 bytes, more than the 16 MiB a file read as text may hold`]);
    assert.equal(beyond.code, 2);
  });
});

test('test 233: the files of a run may hold 128 MiB of text together, and the file that passes it is text-too-large', async () => {
  await inTemp(async (dir) => {
    const repo = `${dir}/r`;
    write(repo, '.lawcheck/law.yaml', 'lawcheck: 0.1.0\ntypes:\n  big:\n    paths: ["big/**"]\n');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'law');
    for (let i = 1; i <= 8; i++) sparse(repo, `big/t${i}.ts`, textHead(''), 16 * MiB);
    const at = await run(repo, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
    assert.equal(at.stdout, 'lawcheck: PASS  8 changed files (against main)\n');
    assert.equal(at.code, 0);
    write(repo, 'big/z.ts', 'x');
    const beyond = await run(repo, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
    assert.equal(
      beyond.stdout,
      [
        'lawcheck: ERROR  1 error',
        '',
        'big/z.ts  error[text-too-large]  the text of the files read in this run reaches 134,217,729 bytes with this file, more than the 128 MiB one run may read',
        '  why:  a run holds the text it reads in memory, so all of it may hold only so much',
        '',
        'next: narrow the paths of the types in .lawcheck/law.yaml, so that the files they match hold at most 128 MiB of text, then run lawcheck check',
        '',
      ].join('\n'),
    );
    assert.equal(beyond.code, 2);
  });
});

test('test 234: a law over 16 MiB is law-invalid, not internal', async () => {
  await withSample(async (s) => {
    sparse(s, '.lawcheck/law.yaml', textHead('lawcheck: 0.1.0\n# '), 16 * MiB + 1);
    const result = await run(s, ['check', '--base', 'main']);
    assert.deepEqual(errorLines(result.stdout), ['.lawcheck/law.yaml:1  error[law-invalid]  the law cannot be read (it holds more than 16 MiB)']);
    assert.equal(result.code, 2);
  });
});

const LAWS_AT_ONCE = 4;

function lawOf(rules: number, types: number, padTo = 0): string {
  let law = 'lawcheck: 0.1.0\nrules:\n';
  for (let i = 0; i < rules; i++) law += `  r${i}:\n    why: w\n`;
  law += 'types:\n';
  for (let i = 0; i < types; i++) law += `  t${i}:\n    paths: ["t${i}/**"]\n`;
  if (padTo > law.length) law += `#${'x'.repeat(padTo - law.length - 2)}\n`;
  return law;
}

// The rule files are a few files with the other names linked to them: ten thousand files with data of their own were most of the time of test 254 on a loaded disk. NTFS gives a file at most 1,024 names, so each file takes the names of a thousand rules.
const NAMES_A_FILE = 1_000;

async function withLaw(law: string, rules: number, body: (repo: string) => Promise<void>): Promise<void> {
  await inTemp(async (dir) => {
    const repo = `${dir}/r`;
    write(repo, '.lawcheck/law.yaml', law);
    for (let i = 0; i < rules; i++) {
      const first = i - (i % NAMES_A_FILE);
      if (i === first) write(repo, `.lawcheck/rules/r${i}.mjs`, 'export function check() { return []; }\n');
      else linkSync(`${repo}/.lawcheck/rules/r${first}.mjs`, `${repo}/.lawcheck/rules/r${i}.mjs`);
    }
    git(repo, 'init', '-q', '-b', 'main');
    await body(repo);
  });
}

test('test 254: R-28, a law may hold 10,000 rules, 1,000 types and 1 MiB, and past each it is file-too-large', async () => {
  // Each law is alone in a folder of its own, so the laws are checked a few at a time, the one of ten thousand rules beside the small ones.
  const jobs: [string, () => Promise<void>][] = [];
  jobs.push(['10,000 rules and 1,000 types', () => withLaw(lawOf(10_000, 1_000), 10_000, async (repo) => {
    const at = await run(repo, ['check'], { budget: 'LIMITS_RUN_MS' });
    assert.equal(at.stdout, 'lawcheck: PASS  10001 files (no base: every file counts as changed)\n');
    assert.equal(at.code, 0);
  })]);
  // The law of 10,001 rules has no rule files: the tool counts the rules of the law before it looks for their files, and a count that came after them would print 10,001 rule-missing-file errors in place of the one line.
  const cases: [string, string, number, string][] = [
    ['10,001 rules', lawOf(10_001, 1), 0, '.lawcheck/law.yaml:2  error[file-too-large]  the law holds 10,001 rules, more than the 10,000 a law may hold'],
    ['1,001 types', lawOf(1, 1_001), 1, '.lawcheck/law.yaml:5  error[file-too-large]  the law holds 1,001 types, more than the 1,000 a law may hold'],
    ['1 MiB and a byte', lawOf(1, 1, MiB + 1), 1, '.lawcheck/law.yaml:1  error[file-too-large]  the law holds 1,048,577 bytes, more than the 1 MiB a law may hold'],
  ];
  for (const [name, law, rules, line] of cases) {
    jobs.push([name, () => withLaw(law, rules, async (repo) => {
      const beyond = await run(repo, ['check'], { budget: 'LIMITS_RUN_MS' });
      assert.deepEqual(errorLines(beyond.stdout), [line]);
      assert.equal(beyond.code, 2);
    })]);
  }
  jobs.push(['the whole output of 1 MiB and a byte', () => withLaw(lawOf(1, 1, MiB + 1), 1, async (repo) => {
    const beyond = await run(repo, ['check']);
    assert.equal(
      beyond.stdout,
      [
        'lawcheck: ERROR  1 error',
        '',
        '.lawcheck/law.yaml:1  error[file-too-large]  the law holds 1,048,577 bytes, more than the 1 MiB a law may hold',
        '  why:  a run holds every file it reads as text in memory, so one file may hold only so much',
        '',
        'next: make .lawcheck/law.yaml hold less than its limits (1 MiB, 10,000 rules and 1,000 types), then run lawcheck check',
        '',
      ].join('\n'),
    );
  })]);
  jobs.push(['1 MiB', () => withLaw(lawOf(1, 1, MiB), 1, async (repo) => {
    const at = await run(repo, ['check']);
    assert.equal(at.code, 0, at.stdout);
  })]);
  await atOnce(jobs, LAWS_AT_ONCE, ([name]) => name, ([, job]) => job());
});

test('test 262: a text file may hold 1,048,576 lines, and one more line is file-too-large', async () => {
  await withSample(async (s) => {
    const lines = 'src/core/lines.ts';
    write(s, lines, `console.log(1);\n${'\n'.repeat(1_048_575)}`);
    const at = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
    assert.deepEqual(errorLines(at.stdout), [`${lines}:1  error[no-console]  writes to the terminal with console.log`]);
    assert.equal(at.code, 1);
    write(s, lines, `console.log(1);\n${'\n'.repeat(1_048_576)}`);
    const beyond = await run(s, ['check', '--base', 'main']);
    assert.deepEqual(errorLines(beyond.stdout), [`${lines}  error[file-too-large]  the file holds 1,048,577 lines, more than the 1,048,576 a file read as text may hold`]);
    assert.equal(beyond.code, 2);
  });
});

// A file of quotes is the costliest text measured for the reader of uses: every quote opens or closes a string.
test('test 263: a file whose uses are read may hold 512 KiB, even of the costliest text, past it its uses are not read and the run goes on, and a config may hold 1 MiB', async () => {
  await withSample(
    async (s) => {
      const big = 'src/core/big.ts';
      write(s, big, "'".repeat(512 * 1024));
      const at = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
      assert.equal(at.code, 0, at.stdout);
      write(s, big, `console.log(1);${"'".repeat(512 * 1024 - 15 + 1)}`);
      const beyond = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
      assert.deepEqual(errorLines(beyond.stdout), [
        `${big}  error[uses-not-read]  its uses are not read: the file holds 524,289 bytes, more than the 512 KiB a file whose uses are read may hold`,
        `${big}:1  error[no-console]  writes to the terminal with console.log`,
      ]);
      assert.equal(beyond.stdout.split('\n')[0], 'lawcheck: FAIL  2 errors in 1 changed file (against main)');
      assert.equal(beyond.code, 1);
    },
    { onMain: (s) => writeFileSync(join(s, '.lawcheck/law.yaml'), readFileSync(join(s, '.lawcheck/law.yaml'), 'utf8').replace('        rules: [no-console]', '        rules: [no-console]\n        may_use: [library]')) },
  );
  await withSample(async (s) => {
    write(s, '.lawcheck/config.yaml', `reviewer:\n  provider: claude-code\n${'#'.repeat(MiB)}\n`);
    const message = 'the file holds 1,048,611 bytes, more than the 1 MiB the config may hold';
    const checked = await run(s, ['check', '--base', 'main']);
    assert.deepEqual(errorLines(checked.stdout), [`.lawcheck/config.yaml  error[file-too-large]  ${message}`]);
    assert.ok(checked.stdout.endsWith('\nnext: make .lawcheck/config.yaml smaller than 1 MiB, then run lawcheck check\n'), checked.stdout);
    assert.equal(checked.code, 2);
    const doctor = await run(s, ['doctor']);
    assert.ok(doctor.stdout.split('\n').includes(`fail  config  .lawcheck/config.yaml  ${message}`), doctor.stdout);
    assert.equal(doctor.code, 2);
    const prime = await run(s, ['prime']);
    assert.equal(prime.code, 0);
    assert.doesNotMatch(prime.stdout, /Start it here/);
  });
});

const MAY_USE = (s: string) => writeFileSync(join(s, '.lawcheck/law.yaml'), readFileSync(join(s, '.lawcheck/law.yaml'), 'utf8').replace('        rules: [no-console]', '        rules: [no-console]\n        may_use: [library]'));

// 64 KiB of `a<a,`: the syntax tree of TypeScript grows by the square of such a file, past a gigabyte, inside Runes, where nothing can stop it.
test('test 273: a file whose uses take more memory than a run may hold ends the run as memory-too-large at that file', async () => {
  await withSample(
    async (s) => {
      write(s, 'src/core/big.ts', 'a<a,'.repeat(16 * 1024));
      const result = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
      assert.equal(
        result.stdout,
        [
          'lawcheck: ERROR  1 error',
          '',
          'src/core/big.ts  error[memory-too-large]  the run grew by more than the 384 MiB of memory one file may add while reading the uses of src/core/big.ts',
          '  why:  a run past its memory would be ended by the system',
          '',
          'next: leave src/core/big.ts out of the types whose may_use is in force, then run lawcheck check again',
          '',
        ].join('\n'),
      );
      assert.equal(result.code, 2);
    },
    { onMain: MAY_USE },
  );
});

test('R-105: memory-too-large names the whole path of a file whose path is longer than 256 characters, and its next line names that path', async () => {
  const folders = Array.from({ length: 6 }, (_, i) => `${'d'.repeat(50)}${i}`);
  const path = `src/core/${folders.join('/')}/big.ts`;
  assert.ok(path.length > 256);
  await withSample(
    async (s) => {
      // git for Windows lists a path past 260 characters only with core.longpaths, which a Windows user with such paths sets; the test's git reads no system config.
      git(s, 'config', 'core.longpaths', 'true');
      write(s, path, 'a<a,'.repeat(16 * 1024));
      const result = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
      assert.equal(
        result.stdout,
        [
          'lawcheck: ERROR  1 error',
          '',
          `${path}  error[memory-too-large]  the run grew by more than the 384 MiB of memory one file may add while reading the uses of ${path}`,
          '  why:  a run past its memory would be ended by the system',
          '',
          `next: leave ${path} out of the types whose may_use is in force, then run lawcheck check again`,
          '',
        ].join('\n'),
      );
      assert.equal(result.code, 2);
    },
    { onMain: MAY_USE },
  );
});

const READS_USES = (s: string) => setRule(s, 'no-console', 'export async function check({ files: [file] }) { await file.uses(); return []; }\n');

test('test 904: R-121, a file whose uses a script rule reads through uses() and that takes too much memory names a step for a law with no may_use', async () => {
  await withSample(
    async (s) => {
      write(s, 'src/core/big.ts', 'a<a,'.repeat(16 * 1024));
      const result = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
      assert.equal(
        result.stdout,
        [
          'lawcheck: ERROR  1 error',
          '',
          'src/core/big.ts  error[memory-too-large]  the run grew by more than the 384 MiB of memory one file may add while reading the uses of src/core/big.ts for the script rule no-console',
          '  why:  a run past its memory would be ended by the system',
          '',
          'next: leave src/core/big.ts out of the types whose files the script rule no-console judges, or keep the rule from calling uses() on it, then run lawcheck check again',
          '',
        ].join('\n'),
      );
      assert.equal(result.code, 2);
    },
    { onMain: READS_USES },
  );
});

test('test 275: a file past the uses limit outside the change is debt, and one read only for what it declares is named, since the uses of it are not judged', async () => {
  const big = 'src/core/big.ts';
  await withSample(
    async (s) => {
      const full = await run(s, ['check', '--base', 'main', '--full'], { budget: 'LIMITS_RUN_MS' });
      assert.ok(full.stdout.split('\n').includes(`${big}  warning[uses-not-read]  its uses are not read: the file holds 524,289 bytes, more than the 512 KiB a file whose uses are read may hold`), full.stdout);
      assert.equal(full.code, 0);
    },
    {
      onMain: (s) => {
        MAY_USE(s);
        write(s, big, "'".repeat(512 * 1024 + 1));
      },
    },
  );
  const generated = (pad: number) => `package gen;\npublic class Generated {\n${'  int a = 1;\n'.repeat(pad)}}\n`;
  const javaLaw = (s: string) => writeFileSync(join(s, '.lawcheck/law.yaml'), `${readFileSync(join(s, '.lawcheck/law.yaml'), 'utf8')}  java:\n    paths: ["app/**/*.java"]\n    may_use: [java]\n`);
  for (const [lines, expected] of [
    [1, ['app/src/main/java/app/App.java:2  error[forbidden-use]  java may not use gen/src/main/java/gen/Generated.java, which has no type; its may_use is [java]']],
    [Math.ceil(614_479 / 13), ['gen/src/main/java/gen/Generated.java  error[uses-not-read]  the uses of it are not judged: it is read for what it declares, and the file holds 614,524 bytes, more than the 512 KiB a file whose uses are read may hold']],
  ] as const) {
    await withSample(
      async (s) => {
        write(s, 'gen/src/main/java/gen/Generated.java', generated(lines));
        write(s, 'app/src/main/java/app/App.java', 'package app;\nimport gen.Generated;\npublic class App { Generated g; }\n');
        const result = await run(s, ['check', '--base', 'main'], { budget: 'LIMITS_RUN_MS' });
        assert.deepEqual(errorLines(result.stdout), expected, String(lines));
        assert.equal(result.code, 1, String(lines));
      },
      { onMain: javaLaw },
    );
  }
});

const CRASHED = '.lawcheck/rules/no-console.mjs  error[rule-crashed]  ';
const shown = (text: string, more: number) => `${text}… (cut: ${more.toLocaleString('en-US')} more characters)`;

test('test 1300: an error of 50 MB that a rule throws is cut at 4,096 characters of its first line, with the count left out, in check, check --json, try and try --json', async () => {
  await withSample(async (s) => {
    setRule(s, 'no-console', "export function check() { throw new Error('x'.repeat(50 * 1024 * 1024)); }\n");
    write(s, 'src/core/a.ts', 'export const a = 1;\n');
    const message = `throws on src/core/a.ts: ${shown('x'.repeat(4096), 50 * 1024 * 1024 - 4096)}`;
    for (const args of [['check', '--base', 'main'], ['try', 'no-console', 'src/core/a.ts']]) {
      const text = await run(s, args);
      assert.deepEqual([text.code, errorLines(text.stdout)], [2, [`${CRASHED}${message}`]]);
      assert.ok(text.stdout.length < 6000, `${args[0]} printed ${text.stdout.length} characters`);
      const json = await run(s, [...args, '--json']);
      assert.deepEqual([json.code, JSON.parse(json.stdout).errors.map((error: { message: string }) => error.message)], [2, [message]]);
      assert.ok(json.stdout.length < 6000, `${args[0]} --json printed ${json.stdout.length} characters`);
    }
  });
});

const longLine = `line too long: ${'é'.repeat(100_000)}`;
const cutCases: [string, string, string][] = [
  ['a throw', "export function check({ files: [f] }) { for (const l of f.lines) if (l.length > 1000) throw new Error('line too long: ' + l); return []; }\n", 'throws on src/core/a.ts: '],
  ['a rejection', "export async function check({ files: [f] }) { await null; for (const l of f.lines) if (l.length > 1000) throw new Error('line too long: ' + l); return []; }\n", 'throws on src/core/a.ts: '],
  ['a rejection nobody handles', "export function check({ files: [f] }) { for (const l of f.lines) if (l.length > 1000) Promise.reject(new Error('line too long: ' + l)); return []; }\n", 'fails in the background: '],
  ['a throw in the load', `throw new Error('${longLine}\\nsecond line');\nexport function check() { return []; }\n`, 'fails to load: '],
];

for (const [what, source, start] of cutCases) {
  test(`test 1300: ${what} with a line of 100,000 characters is cut at 4,096 characters, and a line at the limit is shown whole`, async () => {
    await withSample(async (s) => {
      setRule(s, 'no-console', source);
      write(s, 'src/core/a.ts', `${longLine.slice('line too long: '.length)}\n`);
      const long = await run(s, ['check', '--base', 'main']);
      assert.deepEqual([long.code, errorLines(long.stdout)], [2, [`${CRASHED}${start}${shown(longLine.slice(0, 4096), longLine.length - 4096)}`]]);
      const atLimit = longLine.slice(0, 4096);
      setRule(s, 'no-console', source.replace("'line too long: ' + l", "('line too long: ' + l).slice(0, 4096)").replace(longLine, atLimit));
      const whole = await run(s, ['check', '--base', 'main']);
      assert.deepEqual([whole.code, errorLines(whole.stdout)], [2, [`${CRASHED}${start}${atLimit}`]]);
    });
  });
}
