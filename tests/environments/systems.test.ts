import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withFake } from '../acceptance/fake-reviewer.ts';
import { D, D_PATH, F, F_PATH, findingLines, git, GIT_ENV, inTemp, KEY_F, lawcheck, makeR, makeSample, PROMPT_F, ROOT, TEST4, write } from '../acceptance/helpers.ts';

const WINDOWS = process.platform === 'win32';

function ignoresCase(dir: string): boolean {
  const probe = join(dir, 'case-probe');
  writeFileSync(probe, '');
  return existsSync(join(dir, 'CASE-PROBE'));
}

// The block of spec/commands-slice.md, section 6, that answers lawcheck explain src/core/price.ts in S.
function priceBlock(): string {
  const spec = readFileSync(join(ROOT, 'spec', 'commands-slice.md'), 'utf8');
  const at = spec.indexOf('```\nsrc/core/price.ts\n  type:  library');
  assert.ok(at >= 0, 'the explain block of src/core/price.ts');
  return spec.slice(at + 4, spec.indexOf('```', at + 4));
}

test('test 202: on a file system that ignores case, explain SRC/core/price.ts answers for src/core/price.ts, the file git lists', async (t) => {
  await inTemp(async (dir) => {
    if (!ignoresCase(dir)) return t.skip('this file system tells SRC from src');
    const s = makeSample(dir);
    const run = await lawcheck(s, ['explain', 'SRC/core/price.ts']);
    assert.equal(run.stdout, priceBlock());
    assert.equal(run.code, 0);
    const lower = await lawcheck(s, ['explain', 'src/core/price.ts']);
    assert.equal(lower.stdout, run.stdout);
  });
});

test('test 202: control, where the file system tells case apart, SRC/core/price.ts is a file that does not exist yet', async (t) => {
  await inTemp(async (dir) => {
    if (ignoresCase(dir)) return t.skip('this file system ignores case');
    const run = await lawcheck(makeSample(dir), ['explain', 'SRC/core/price.ts']);
    assert.equal(run.stdout.split('\n')[0], 'SRC/core/price.ts  (does not exist yet)');
    assert.equal(run.code, 0);
  });
});

test('test 203: names in NFC and in NFD are judged, and each finding names the file as git lists it', async () => {
  await inTemp(async (dir) => {
    const s = makeSample(dir);
    const composed = 'src/core/caf\u00e9.ts';
    const decomposed = 'src/core/an\u0303o.ts';
    write(s, composed, 'console.log(1);\n');
    write(s, decomposed, 'console.log(2);\n');
    const listed = execFileSync('git', ['ls-files', '-z', '--others', '--exclude-standard'], { cwd: s, env: GIT_ENV }).toString('utf8').split('\0').filter((p) => p !== '').sort();
    assert.equal(listed.length, 2);
    const run = await lawcheck(s, ['check', '--base', 'main']);
    assert.deepEqual(findingLines(run.stdout), listed.map((path) => `${path}:1  error[no-console]  writes to the terminal with console.log`));
    assert.equal(run.code, 1);
    const json = JSON.parse((await lawcheck(s, ['check', '--base', 'main', '--json'])).stdout);
    assert.deepEqual(json.findings.map((f: { file: string }) => f.file), listed);
  });
});

test('test 204: a checkout with core.autocrlf=true sends the reviewer the prompt of the LF checkout and keys its verdict the same', async () => {
  await withFake(async (fake) => {
    await inTemp(async (dir) => {
      const r = makeR(dir);
      write(r, F_PATH, F);
      git(r, 'add', '-A');
      git(r, 'commit', '-q', '-m', 'refund');
      git(dir, 'clone', '-q', '-c', 'core.autocrlf=true', '--branch', 'work', pathToFileURL(r).href, 'crlf');
      const clone = join(dir, 'crlf');
      assert.ok(readFileSync(join(clone, F_PATH), 'utf8').includes('\r\n'), 'the checkout holds CRLF');
      const run = await lawcheck(clone, ['check', '--review', '--base', 'origin/main'], { LAWCHECK_REVIEWER_ENDPOINT: fake.url });
      assert.equal(run.code, 1, run.stdout);
      assert.equal(fake.requests.length, 1);
      assert.equal(fake.requests[0]!.json.messages[0].content, PROMPT_F);
      assert.deepEqual(readdirSync(join(clone, '.lawcheck', '.local', 'failures')), [`${KEY_F}.json`]);
    });
  });
});

// Each shell starts the installed lawcheck by its bare name from PATH, as a user types it.
const SHELLS: [string, (line: string) => [string, string[]]][] = WINDOWS
  ? [
      ['PowerShell', (line) => ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', line]]],
      ['cmd', (line) => [process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', line]]],
      ['Git Bash', (line) => [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'), ['-c', line]]],
    ]
  : [['sh', (line) => ['sh', ['-c', line]]]];

test('test 205: the packed tarball, installed globally without the network, starts from every shell of the system and checks the sample', async () => {
  await inTemp(async (dir) => {
    execFileSync('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', dir], { cwd: ROOT, env: GIT_ENV, shell: WINDOWS, stdio: ['ignore', 'pipe', 'pipe'] });
    const [tarball] = readdirSync(dir).filter((name) => name.endsWith('.tgz'));
    assert.ok(tarball !== undefined, 'npm pack made a tarball');
    // The npm cache holds the dependencies' files but not their registry entries, so the unpacked tarball gets them from this checkout and npm installs it offline as a folder, with the shims of a global install.
    mkdirSync(join(dir, 'unpacked'));
    execFileSync('tar', ['-xzf', join(dir, tarball), '-C', join(dir, 'unpacked')], { stdio: 'ignore' });
    const unpacked = join(dir, 'unpacked', 'package');
    for (const name of Object.keys(JSON.parse(readFileSync(join(unpacked, 'package.json'), 'utf8')).dependencies)) {
      cpSync(join(ROOT, 'node_modules', name), join(unpacked, 'node_modules', name), { recursive: true });
    }
    const prefix = join(dir, 'prefix');
    execFileSync('npm', ['install', '--global', '--prefix', prefix, '--offline', '--no-audit', '--no-fund', '--silent', unpacked], { cwd: dir, env: GIT_ENV, shell: WINDOWS, stdio: ['ignore', 'pipe', 'pipe'] });
    const bin = WINDOWS ? prefix : join(prefix, 'bin');
    assert.ok(lstatSync(join(bin, WINDOWS ? 'lawcheck.cmd' : 'lawcheck')).isFile() || lstatSync(join(bin, 'lawcheck')).isSymbolicLink());
    const s = makeSample(dir);
    write(s, D_PATH, D);
    const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    for (const [name, shell] of SHELLS) {
      for (const [line, code, stdout] of [
        ['lawcheck --version', 0, `${version}\n`],
        ['lawcheck check --base main', 1, TEST4],
      ] as const) {
        const [program, args] = shell(line);
        const run = spawnSync(program, args, { cwd: s, env: { ...GIT_ENV, PATH: [bin, GIT_ENV.PATH].join(delimiter) }, encoding: 'utf8', windowsVerbatimArguments: name === 'cmd' });
        assert.equal(run.stdout.replace(/\r\n/g, '\n'), stdout, `${name}: ${line}\n${run.stderr}`);
        assert.equal(run.status, code, `${name}: ${line}`);
      }
    }
  });
});
