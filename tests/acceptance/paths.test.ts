import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { withFake } from './fake-reviewer.ts';
import { D, D_PATH, E, E_PATH, F, F_PATH, git, inTemp, LAW, lawcheck, newRepository, run, SAMPLE, setRule, withR, withSample, withU, write } from './helpers.ts';
import { parseConfig } from '../../dist/config.js';

const spec = readFileSync(new URL('../../spec/plugin-slice.md', import.meta.url), 'utf8').split('\n');
const fenced = (first: string): string => {
  const at = spec.indexOf(first);
  const lines: string[] = [];
  for (let i = at; spec[i] !== '```'; i++) lines.push(spec[i]!);
  return lines.join('\n') + '\n';
};
const commands = readFileSync(new URL('../../spec/commands-slice.md', import.meta.url), 'utf8').split('\n');
const PRIME_S = (() => {
  const at = commands.indexOf("Lawcheck checks this repository's code against its law: the file types and the rules each type keeps. The law is .lawcheck/law.yaml; rule files are in .lawcheck/rules/.");
  const lines: string[] = [];
  for (let i = at; commands[i] !== '```'; i++) lines.push(commands[i]!);
  return lines.join('\n') + '\n';
})();

const TEST142 = fenced('lawcheck: FAIL  1 error in 1 named file');
const TEST17 = [
  'lawcheck: ERROR  1 error',
  '',
  ".lawcheck/law.yaml:8  error[law-invalid]  unknown key 'statuss' in rule 'no-todo' (did you mean 'status'?)",
  '  why:  a misspelled key changes the law without a word',
  '',
  'next: fix .lawcheck/law.yaml, then run lawcheck check',
  '',
].join('\n');
const BROKEN_LAW = LAW.replace('status: advisory', 'statuss: advisory');
const COMMANDS: Record<string, string> = { npx: 'npx --no-install lawcheck', pnpm: 'pnpm exec lawcheck', yarn: 'yarn run lawcheck', bun: 'bun x --no-install lawcheck' };
const points = (text: string) => [...text].length;
const firstLine = (text: string) => text.split('\n')[0]!;
const usage = (stdout: string) => /^error\[usage\]/m.test(stdout);

test('test 142: one named file, and its JSON', async () => {
  assert.equal(TEST142.split('\n')[0], 'lawcheck: FAIL  1 error in 1 named file');
  await withSample(async (s) => {
    const plain = await lawcheck(s, ['check', 'src/core/price.ts']);
    assert.equal(plain.stdout, TEST142);
    assert.equal(plain.code, 1);
    const json = await lawcheck(s, ['check', 'src/core/price.ts', '--json']);
    const document = JSON.parse(json.stdout);
    assert.deepEqual(document.scope, { mode: 'paths', base: null, files: 1, law_changed: false });
    assert.equal(document.findings.length, 1);
    assert.equal(document.findings[0].file, 'src/core/price.ts');
    assert.equal(document.findings[0].line, 2);
    assert.equal(document.findings[0].code, 'no-console');
    assert.equal(json.code, 1);
    const none = await lawcheck(s, ['check', 'nothing.ts']);
    assert.equal(none.stdout, 'lawcheck: PASS  0 named files\n');
    assert.equal(none.code, 0);
  });
});

test('test 143: directories, patterns, a file twice, an untyped file, files that select nothing, and a name that starts with -', async () => {
  await withSample(async (s) => {
    const cases: [string, string[], string, number][] = [
      [s, ['src/core'], 'lawcheck: FAIL  1 error, 1 warning in 2 named files', 1],
      [s, ['src/**/*.ts'], 'lawcheck: FAIL  1 error, 1 warning in 3 named files', 1],
      [join(s, 'src'), ['core/tax.ts', 'core/tax.ts'], 'lawcheck: PASS  1 warning in 1 named file', 0],
      [s, ['README.md'], 'lawcheck: PASS  1 named file', 0],
      [s, ['nothing.ts'], 'lawcheck: PASS  0 named files', 0],
    ];
    for (const [cwd, words, first, code] of cases) {
      const result = await lawcheck(cwd, ['check', ...words]);
      assert.equal(firstLine(result.stdout), first, words.join(' '));
      assert.equal(result.code, code, words.join(' '));
    }
    write(s, '.gitignore', '*.log\n');
    write(s, 'x.log', 'console.log(1);\n');
    const ignored = await lawcheck(s, ['check', 'x.log']);
    assert.equal(ignored.stdout, 'lawcheck: PASS  0 named files\n');
    assert.equal(ignored.code, 0);
    write(s, 'src/core/-odd.ts', 'console.log(1);\n');
    const odd = await lawcheck(join(s, 'src/core'), ['check', './-odd.ts']);
    assert.equal(firstLine(odd.stdout), 'lawcheck: FAIL  1 error in 1 named file');
    assert.match(odd.stdout, /^src\/core\/-odd\.ts:1 {2}error\[no-console\]/m);
    assert.equal(odd.code, 1);
    const flag = await lawcheck(join(s, 'src/core'), ['check', '-odd.ts']);
    assert.ok(usage(flag.stdout), flag.stdout);
    assert.equal(flag.code, 2);
  });
});

test('test 144: paths with the flags of a change, and a path outside the root', async () => {
  await withSample(async (s) => {
    const core = join(s, 'src/core');
    for (const args of [['price.ts', '--full'], ['price.ts', '--base', 'main'], ['price.ts', '--review']]) {
      const result = await lawcheck(core, ['check', ...args]);
      assert.ok(usage(result.stdout), args.join(' '));
      assert.match(result.stdout, /^error\[usage\] {2}paths go with --json alone$/m, args.join(' '));
      assert.equal(result.code, 2);
    }
    const outside = await lawcheck(core, ['check', '../../../x']);
    assert.ok(usage(outside.stdout), outside.stdout);
    assert.equal(outside.code, 2);
  });
});

test('test 145: a waiver in a named file, and a repository with no commit', async () => {
  await withSample(async (s) => {
    write(s, D_PATH, D);
    const result = await lawcheck(s, ['check', D_PATH]);
    assert.equal(
      result.stdout,
      [
        'lawcheck: FAIL  1 error, 1 warning in 1 named file, 1 waiver',
        '',
        'src/core/discount.ts:2  error[no-console]  writes to the terminal with console.log',
        '  why:  Only the command layer writes to the terminal.',
        'src/core/discount.ts:3  warning[no-todo]  TODO without an issue number',
        '  why:  A TODO without an issue number gets forgotten.',
        '',
        'next: fix src/core/discount.ts:2',
        '',
      ].join('\n'),
    );
    assert.equal(result.code, 1);
  });
  await inTemp(async (dir) => {
    const repo = join(dir, 'fresh');
    mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    cpSync(SAMPLE, repo, { recursive: true });
    for (const env of [{}, { LAWCHECK_BASE: 'nope' }]) {
      const result = await lawcheck(repo, ['check', 'src/core/price.ts'], env);
      assert.equal(result.stdout, TEST142);
      assert.equal(result.code, 1);
    }
  });
});

test('test 146: a named file asks no reviewer, and its missing review is a warning', async () => {
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const plain = await run(r, fake, [F_PATH]);
      const lines = plain.stdout.split('\n');
      assert.equal(lines[0], 'lawcheck: PASS  1 warning in 1 named file, 1 waiver');
      assert.ok(lines.some((line) => line.startsWith('src/core/refund.ts  warning[not-reviewed]')), plain.stdout);
      assert.ok(!lines.some((line) => line.startsWith('next:')), plain.stdout);
      assert.equal(plain.code, 0);
      const json = await run(r, fake, [F_PATH, '--json']);
      const document = JSON.parse(json.stdout);
      assert.ok(document.findings.length > 0);
      assert.ok(document.findings.every((finding: { blocking: boolean }) => finding.blocking === false));
      assert.equal(json.code, 0);
      assert.equal(fake.requests.length, 0);
      assert.equal(existsSync(join(r, '.lawcheck/verdicts')), false);
    });
  });
});

test('test 147: a forbidden use in a named file', async () => {
  await withU(async (u) => {
    write(u, E_PATH, E);
    const result = await lawcheck(u, ['check', E_PATH]);
    assert.equal(
      result.stdout,
      [
        'lawcheck: FAIL  1 error in 1 named file',
        '',
        'src/core/report.ts:2  error[forbidden-use]  library may not use command (src/cli/main.ts); it takes may_use [library] from source',
        "  why:  a type's may_use names every type its files may use",
        '',
        'next: fix src/core/report.ts:2',
        '',
      ].join('\n'),
    );
    assert.equal(result.code, 1);
  });
});

test('test 148: a broken law stops a check of named files', async () => {
  await withSample(async (s) => {
    write(s, '.lawcheck/law.yaml', BROKEN_LAW);
    const result = await lawcheck(s, ['check', 'src/core/price.ts']);
    assert.equal(result.stdout, TEST17);
    assert.equal(result.code, 2);
  });
});

test('test 149: the runner key in the config', async () => {
  const passing = ['runner: pnpm  # pinned\n', ...['global', 'npx', 'pnpm', 'yarn', 'bun'].map((name) => `runner: ${name}\n`)];
  for (const config of passing) {
    await withSample(
      async (s) => {
        const result = await lawcheck(s, ['check', '--base', 'main']);
        assert.equal(result.stdout, 'lawcheck: PASS  nothing changed against main\n', config);
        assert.equal(result.code, 0);
      },
      { onMain: (s) => write(s, '.lawcheck/config.yaml', config) },
    );
  }
  const refused: [string, string][] = [
    ['runner: npm\n', ".lawcheck/config.yaml:1  error[config-invalid]  the runner 'npm' is unknown (did you mean 'npx' or 'pnpm'?); it takes global, npx, pnpm, yarn or bun"],
    ['runner: pnmp\n', ".lawcheck/config.yaml:1  error[config-invalid]  the runner 'pnmp' is unknown (did you mean 'pnpm'?); it takes global, npx, pnpm, yarn or bun"],
    ['runner: "pnpm"\n', '.lawcheck/config.yaml:1  error[config-invalid]  write runner on one line of its own at the top level, as runner: pnpm'],
    ['{ runner: pnpm }\n', '.lawcheck/config.yaml:1  error[config-invalid]  write runner on one line of its own at the top level, as runner: pnpm'],
    ['reviewer:\n  runner: pnpm\n', ".lawcheck/config.yaml:2  error[config-invalid]  unknown key 'runner' in 'reviewer'"],
  ];
  for (const [config, line] of refused) {
    await withSample(
      async (s) => {
        const result = await lawcheck(s, ['check', '--base', 'main']);
        assert.equal(result.stdout.split('\n')[2], line, config);
        assert.equal(firstLine(result.stdout), 'lawcheck: ERROR  1 error');
        assert.equal(result.code, 2);
      },
      { onMain: (s) => write(s, '.lawcheck/config.yaml', config) },
    );
  }
});

test('test 150: prime names the command of the runner', async () => {
  await withSample(async (s) => {
    for (const [name, cmd] of Object.entries(COMMANDS)) {
      write(s, '.lawcheck/config.yaml', `runner: ${name}\n`);
      const result = await lawcheck(s, ['prime']);
      const expected = PRIME_S.split('\n');
      expected[0] += ` Start it here as: ${cmd}`;
      assert.equal(result.stdout, expected.join('\n'), name);
      assert.equal(result.code, 0);
    }
    assert.equal(
      fenced("Lawcheck checks this repository's code against its law: the file types and the rules each type keeps. The law is .lawcheck/law.yaml; rule files are in .lawcheck/rules/. Start it here as: pnpm exec lawcheck"),
      PRIME_S.split('\n')[0] + ' Start it here as: pnpm exec lawcheck\n',
    );
    for (const config of ['runner: global\n', null, 'runner: make\n', 'runner: "pnpm"\n']) {
      if (config === null) rmSync(join(s, '.lawcheck/config.yaml'), { force: true });
      else write(s, '.lawcheck/config.yaml', config);
      const result = await lawcheck(s, ['prime']);
      assert.equal(result.stdout, PRIME_S, String(config));
      assert.equal(result.code, 0);
    }
  });
  await withR(
    async (r) => {
      write(r, '.lawcheck/config.yaml', lawFile(r, 'config.yaml') + 'runner: bun\n');
      const result = await lawcheck(r, ['prime', '--json']);
      const text = JSON.parse(result.stdout).text as string;
      const first = text.slice(0, text.indexOf('\nThe law here: '));
      assert.ok(first.includes('widening may_use') && first.includes('--dry-run first'), first);
      assert.equal(points(first), 1767);
      assert.ok(first.split('\n')[0]!.endsWith(' Start it here as: bun x --no-install lawcheck'));
    },
    { onMain: (r) => write(r, '.lawcheck/law.yaml', lawFile(r, 'law.yaml').replace('        paths: ["src/core/**"]\n', '        paths: ["src/core/**"]\n        may_use: [library]\n')) },
  );
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    setRule(repo, 'r1', 'export function check() { return []; }\n');
    const lawOf = (about: number) => `lawcheck: 0.1.0\n\nrules:\n  r1:\n    why: w\n\ntypes:\n  t1:\n    paths: ["src/**"]\n    about: ${'a'.repeat(about)}\n    rules: [r1]\n`;
    const primed = async () => JSON.parse((await lawcheck(repo, ['prime', '--json'])).stdout) as { text: string; step: number; characters: number };
    write(repo, '.lawcheck/law.yaml', lawOf(100));
    const probe = await primed();
    write(repo, '.lawcheck/law.yaml', lawOf(100 + 7990 - probe.characters));
    const plain = await primed();
    assert.equal(plain.characters, 7990);
    assert.equal(plain.step, 1);
    write(repo, '.lawcheck/config.yaml', 'runner: bun\n');
    const longer = await primed();
    assert.equal(longer.step, 2);
    assert.ok(longer.characters <= 8000);
  });
});

function lawFile(repo: string, name: string): string {
  return readFileSync(join(repo, '.lawcheck', name), 'utf8');
}

test('test 151: the pages config and json', async () => {
  await inTemp(async (dir) => {
    const config = await lawcheck(dir, ['docs', 'config']);
    for (const word of ['runner', 'global', 'npx', 'pnpm', 'yarn', 'bun', 'lawcheck', 'npx --no-install lawcheck', 'pnpm exec lawcheck', 'yarn run lawcheck', 'bun x --no-install lawcheck']) {
      assert.ok(config.stdout.includes(`\`${word}\``), word);
    }
    const lines = config.stdout.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] !== '```yaml') continue;
      const block: string[] = [];
      for (let j = i + 1; lines[j] !== '```'; j++) block.push(lines[j]!);
      assert.ok('config' in parseConfig(block.join('\n') + '\n'), block.join('\n'));
    }
    assert.ok(points(config.stdout) <= 8000);
    const json = await lawcheck(dir, ['docs', 'json']);
    assert.ok(json.stdout.includes('`paths`'));
    assert.ok(points(json.stdout) <= 8000);
  });
});
