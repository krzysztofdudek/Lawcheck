import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { D, D_PATH, GIT_ENV, inTemp, TEST4, lawcheck, lawcheckAt, makeSample, ROOT, withCopy, write } from '../acceptance/helpers.ts';
import type { Run } from '../acceptance/helpers.ts';

const WINDOWS = process.platform === 'win32';
const AS_ROOT = process.getuid?.() === 0;

// A preload that sets what Node, Bun and Yarn's Plug'n'Play set in process.versions, so the real Node 24 reports another runtime. The install matrix runs the real ones.
function posing(name: string, value: string): string[] {
  return ['--import', `data:text/javascript,Object.defineProperty(process.versions,${JSON.stringify(name)},{value:${JSON.stringify(value)},enumerable:true})`];
}

const WHY = 'Lawcheck answers only where its rules and readers are known to run';

// The refusal as spec/environments.md, section 3, gives it: the message as the first line, the error line, its why, the next line.
function refusal(message: string, next: string, command: string): string {
  const again = command === 'check' ? 'then run lawcheck check' : `then run lawcheck ${command} again`;
  return ['lawcheck: ERROR  ' + message, '', `error[unsupported-environment]  ${message}`, `  why:  ${WHY}`, '', `next: ${next.replace('then run lawcheck check', again)}`, ''].join('\n');
}

const COMMANDS: [string, string[]][] = [
  ['check', ['check', '--base', 'main']],
  ['check', ['check', './src/core/discount.ts']],
  ['try', ['try', 'no-console', 'src/core/discount.ts']],
  ['doctor', ['doctor']],
  ['explain', ['explain', 'src/core/price.ts']],
  ['prime', ['prime']],
  ['init', ['init']],
];

async function refusedEverywhere(s: string, message: string, next: string, nodeArgs: string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  for (const [command, argv] of COMMANDS) {
    const run = await lawcheck(s, argv, env, nodeArgs);
    assert.equal(run.stdout, refusal(message, next, command), argv.join(' '));
    assert.equal(run.stderr, '', argv.join(' '));
    assert.equal(run.code, 2, argv.join(' '));
    const json = await lawcheck(s, [...argv, '--json'], env, nodeArgs);
    const document = JSON.parse(json.stdout);
    assert.equal(document.schema, 'lawcheck-error/1');
    assert.deepEqual(document.errors.map((e: { code: string; message: string }) => [e.code, e.message]), [['unsupported-environment', message]]);
    assert.equal(json.code, 2);
  }
  for (const argv of [['--version'], ['--help'], ['check', '--help'], ['docs'], ['docs', 'config']]) {
    const run = await lawcheck(s, argv, env, nodeArgs);
    assert.equal(run.code, 0, argv.join(' '));
    assert.doesNotMatch(run.stdout, /unsupported-environment/);
  }
}

function sampleWithD(dir: string): string {
  const s = makeSample(dir);
  write(s, D_PATH, D);
  return s;
}

const POSED: [string, string[], string, string][] = [
  ['Node 20', posing('node', '20.20.2'), 'Node 20.20.2 is older than 24, the oldest Node Lawcheck runs on', 'install Node 24 or later, then run lawcheck check'],
  ['Node 22', posing('node', '22.23.5'), 'Node 22.23.5 is older than 24, the oldest Node Lawcheck runs on', 'install Node 24 or later, then run lawcheck check'],
  ['Bun', posing('bun', '1.4.0'), 'this run is on Bun 1.4.0, and Lawcheck runs on Node 24 or later', 'install Node 24 or later beside Bun, so that bun x starts Lawcheck on Node, then run lawcheck check'],
  ["Yarn's Plug'n'Play", posing('pnp', '3'), "Lawcheck is installed by Yarn Plug'n'Play, inside an archive that the runner of script rules cannot open", 'set nodeLinker: node-modules in .yarnrc.yml and run yarn install, then run lawcheck check'],
];

test('I-env-1: every command but --version, --help and docs refuses an unsupported runtime in its first line, naming it, and doctor says what check says', async () => {
  await inTemp(async (dir) => {
    const s = sampleWithD(dir);
    for (const [, nodeArgs, message, next] of POSED) await refusedEverywhere(s, message, next, nodeArgs);
  });
});

test('I-env-1: control, posed as Node 24 the same commands answer', async () => {
  await inTemp(async (dir) => {
    const s = sampleWithD(dir);
    const run = await lawcheck(s, ['check', '--base', 'main'], {}, posing('node', '24.0.0'));
    assert.match(run.stdout, /^lawcheck: FAIL  1 error, 1 warning in 1 changed file \(against main\), 1 waiver\n/);
    assert.equal(run.code, 1);
  });
});

async function refusesCheck(which: string): Promise<void> {
  const [, nodeArgs, message, next] = POSED.find(([name]) => name === which)!;
  await inTemp(async (dir) => {
    const run = await lawcheck(sampleWithD(dir), ['check', '--base', 'main'], {}, nodeArgs);
    assert.equal(run.stdout, refusal(message, next, 'check'));
    assert.doesNotMatch(run.stdout, /rule-crashed|\.lawcheck\/rules\//);
    assert.equal(run.stderr, '');
    assert.equal(run.code, 2);
  });
}

test('S2-3: on Node 20 a check with a script rule to run names the Node version in its first line and blames no rule file', () => refusesCheck('Node 20'));

test('S8-2: on Bun a check with a script rule to run names Bun in its first line and blames no rule file', () => refusesCheck('Bun'));

test("S8-1: under Yarn's Plug'n'Play a check with a script rule to run names it in its first line and blames no rule file", () => refusesCheck("Yarn's Plug'n'Play"));

test("S8-1: a Lawcheck whose folder lies inside a .zip path, as Plug'n'Play keeps it, is refused the same way", async () => {
  await inTemp(async (dir) => {
    const s = sampleWithD(dir);
    const zipped = join(dir, 'cache', 'lawcheck-npm-0.1.0.zip', 'node_modules', 'lawcheck');
    mkdirSync(zipped, { recursive: true });
    cpSync(join(ROOT, 'package.json'), join(zipped, 'package.json'));
    cpSync(join(ROOT, 'dist'), join(zipped, 'dist'), { recursive: true });
    symlinkSync(join(ROOT, 'node_modules'), join(zipped, 'node_modules'), WINDOWS ? 'junction' : 'dir');
    const [, , message, next] = POSED.find(([name]) => name === "Yarn's Plug'n'Play")!;
    const run = await lawcheckAt(join(zipped, 'dist', 'cli.js'), s, ['check', '--base', 'main']);
    assert.equal(run.stdout, refusal(message, next, 'check'));
    assert.equal(run.code, 2);
  });
});

// A git that reports the given version and hands every other call to the real git.
function gitReporting(dir: string, version: string): string {
  const bin = join(dir, `git-${version}`);
  mkdirSync(bin);
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "git version ${version}"; exit 0; fi\nexec "${real}" "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  return bin;
}

test('test 200: below git 2.34 every command but --version, --help and docs refuses in its first line, naming the version', { skip: WINDOWS ? 'git is started as git.exe on Windows, so a script cannot stand in for it' : false }, async () => {
  await inTemp(async (dir) => {
    const s = sampleWithD(dir);
    const env = { PATH: [gitReporting(dir, '2.33.8'), GIT_ENV.PATH].join(delimiter) };
    await refusedEverywhere(s, 'git 2.33.8 is older than 2.34, the oldest git Lawcheck runs with', 'install git 2.34 or later, then run lawcheck check', [], env);
  });
});

test('test 200: control, git 2.34.1 is not refused', { skip: WINDOWS ? 'git is started as git.exe on Windows, so a script cannot stand in for it' : false }, async () => {
  await inTemp(async (dir) => {
    const s = sampleWithD(dir);
    const run = await lawcheck(s, ['check', '--base', 'main'], { PATH: [gitReporting(dir, '2.34.1'), GIT_ENV.PATH].join(delimiter) });
    assert.equal(run.stdout, TEST4);
    assert.equal(run.code, 1);
  });
});
