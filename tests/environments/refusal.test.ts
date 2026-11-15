import { test } from 'node:test';
import { platformSkip } from '../harness/tool.ts';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { D, D_PATH, GIT_ENV, inTemp, TEST4, lawcheck, lawcheckAt, makeSample, ROOT, withCopy, write } from '../acceptance/helpers.ts';
import type { Run } from '../acceptance/helpers.ts';

const WINDOWS = process.platform === 'win32';

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
  ['explain', ['explain', 'src/core/price.ts']],
  ['prime', ['prime']],
  ['init', ['init']],
];

type Go = (argv: string[]) => Promise<Run>;

// Every command refuses alike; doctor leads with the same line and still runs its nine rows, the row named failing with the refusal.
async function refusedEverywhere(go: Go, message: string, next: string, row: 'node' | 'git'): Promise<void> {
  for (const [command, argv] of COMMANDS) {
    const run = await go(argv);
    assert.equal(run.stdout, refusal(message, next, command), argv.join(' '));
    assert.equal(run.stderr, '', argv.join(' '));
    assert.equal(run.code, 2, argv.join(' '));
    const json = await go([...argv, '--json']);
    const document = JSON.parse(json.stdout);
    assert.equal(document.schema, 'lawcheck-error/1');
    assert.deepEqual(document.errors.map((e: { code: string; message: string }) => [e.code, e.message]), [['unsupported-environment', message]]);
    assert.equal(document.next.command, null, 'the first step of a refusal is no command');
    assert.equal(json.code, 2);
  }
  const doctor = await go(['doctor']);
  const lines = doctor.stdout.split('\n');
  assert.equal(lines[0], `lawcheck: ERROR  ${message}`);
  assert.equal(lines.filter((line) => /^(ok|note|fail|skip)  [a-z-]+  /.test(line)).length, 9, doctor.stdout);
  const at = lines.indexOf(`fail  ${row}  ${message}`);
  assert.ok(at > 0, doctor.stdout);
  assert.equal(lines[at + 1], `  next: ${next.replace('then run lawcheck check', 'then run lawcheck doctor again')}`);
  assert.equal(doctor.stderr, '');
  assert.equal(doctor.code, 2);
  const report = JSON.parse((await go(['doctor', '--json'])).stdout);
  assert.equal(report.schema, 'lawcheck-doctor/0');
  assert.equal(report.result, 'fail');
  assert.deepEqual(report.checks.find((c: { id: string }) => c.id === row).state, 'fail');
  for (const argv of [['--version'], ['--help'], ['check', '--help'], ['docs'], ['docs', 'config']]) {
    const run = await go(argv);
    assert.equal(run.code, 0, argv.join(' '));
    assert.doesNotMatch(run.stdout, /unsupported-environment/);
  }
}

function sampleWithD(dir: string): string {
  const s = makeSample(dir);
  write(s, D_PATH, D);
  return s;
}

const NO_NODE_NEXT = 'install Node 24 or later beside Bun, so that bun x starts Lawcheck on Node, then run lawcheck check';

const POSED: [string, string[], string, string][] = [
  ['Node 20', posing('node', '20.20.2'), 'Node 20.20.2 is older than 24, the oldest Node Lawcheck runs on', 'install Node 24 or later, then run lawcheck check'],
  ['Node 22', posing('node', '22.23.5'), 'Node 22.23.5 is older than 24, the oldest Node Lawcheck runs on', 'install Node 24 or later, then run lawcheck check'],
  ['Bun', posing('bun', '1.4.0'), 'this run is on Bun 1.4.0, and Lawcheck runs on Node 24 or later; no node is on the PATH', NO_NODE_NEXT],
];

test('I-env-1: every command but --version, --help and docs refuses an unsupported runtime in its first line, naming it, and doctor leads with the same line', async () => {
  await inTemp(async (dir) => {
    const s = sampleWithD(dir);
    for (const [, nodeArgs, message, next] of POSED) await refusedEverywhere((argv) => lawcheck(s, argv, {}, nodeArgs), message, next, 'node');
  });
});

test('I-env-1: control, posed as Node 24 the same commands answer', async () => {
  await inTemp(async (dir) => {
    const s = sampleWithD(dir);
    const run = await lawcheck(s, ['check', '--base', 'main'], {}, posing('node', '24.0.0'));
    assert.equal(run.stdout, TEST4);
    assert.equal(run.code, 1);
  });
});

async function refusesCheck(nodeArgs: string[], message: string, next: string, env: NodeJS.ProcessEnv = {}): Promise<void> {
  await inTemp(async (dir) => {
    const run = await lawcheck(sampleWithD(dir), ['check', '--base', 'main'], env, nodeArgs);
    assert.equal(run.stdout, refusal(message, next, 'check'));
    assert.doesNotMatch(run.stdout, /rule-crashed|\.lawcheck\/rules\//);
    assert.equal(run.stderr, '');
    assert.equal(run.code, 2);
  });
}

test('S2-3: on Node 20 a check with a script rule to run names the Node version in its first line and blames no rule file', () => refusesCheck(POSED[0]![1], POSED[0]![2], POSED[0]![3]));

test('S8-2: on Bun with no node on the PATH a check names Bun in its first line, and says to install Node beside it', () => refusesCheck(POSED[2]![1], POSED[2]![2], POSED[2]![3]));

test('S8-2: on Bun with a node first on the PATH, as bun --bun runs it, the refusal names that node and says to start Lawcheck without --bun', async () => {
  await inTemp(async (dir) => {
    const bin = join(dir, 'other-node');
    mkdirSync(bin);
    const node = join(bin, WINDOWS ? 'node.cmd' : 'node');
    writeFileSync(node, WINDOWS ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n');
    chmodSync(node, 0o755);
    await refusesCheck(
      posing('bun', '1.4.0'),
      `this run is on Bun 1.4.0, and Lawcheck runs on Node 24 or later; the node first on the PATH is ${node}`,
      `start Lawcheck without --bun, as bun x --no-install lawcheck, so that it runs on ${node}, then run lawcheck check`,
      { PATH: [bin, GIT_ENV.PATH].join(delimiter) },
    );
  });
});

test("S8-2: on Bun with a link to the program of this run first on the PATH, as Bun's own node fallback is, no node counts as found", async () => {
  await inTemp(async (dir) => {
    const bin = join(dir, 'fallback');
    mkdirSync(bin);
    symlinkSync(process.execPath, join(bin, WINDOWS ? 'node.exe' : 'node'), 'file');
    await refusesCheck(posing('bun', '1.4.0'), POSED[2]![2], POSED[2]![3], { PATH: [bin, GIT_ENV.PATH].join(delimiter) });
  });
});

// A copy of Lawcheck kept as Yarn keeps a package in its cache, in a folder whose name ends in .zip.
function zippedCopy(dir: string, folder: string): string {
  const zipped = join(dir, 'cache', folder, 'node_modules', 'lawcheck');
  mkdirSync(zipped, { recursive: true });
  cpSync(join(ROOT, 'package.json'), join(zipped, 'package.json'));
  cpSync(join(ROOT, 'dist'), join(zipped, 'dist'), { recursive: true });
  cpSync(join(ROOT, 'docs'), join(zipped, 'docs'), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(zipped, 'node_modules'), WINDOWS ? 'junction' : 'dir');
  return join(zipped, 'dist', 'cli.js');
}

// NODE_OPTIONS reads double quotes as quoting, so this preload is written with single ones.
const PNP_ENV = { NODE_OPTIONS: "--import=data:text/javascript,Object.defineProperty(process.versions,'pnp',{value:'3',enumerable:true})" };
const PNP = "Yarn Plug'n'Play is not supported: Lawcheck is served from the archive lawcheck-npm-0.1.0-4f9d.zip, which the runner of script rules cannot open";
const PNP_NEXT = 'set nodeLinker: node-modules in .yarnrc.yml and run yarn install, then run lawcheck check';

test('S8-1: a Lawcheck served from an archive of Yarn PnP refuses every command in its first line, and blames no rule file', async () => {
  await inTemp(async (dir) => {
    const s = sampleWithD(dir);
    const cli = zippedCopy(dir, 'lawcheck-npm-0.1.0-4f9d.zip');
    await refusedEverywhere((argv) => lawcheckAt(cli, s, argv, PNP_ENV), PNP, PNP_NEXT, 'node');
  });
});

test("S8-1: control, a Lawcheck installed outside Plug'n'Play and started from a project that uses it judges the rules", async () => {
  await inTemp(async (dir) => {
    const run = await lawcheck(sampleWithD(dir), ['check', '--base', 'main'], PNP_ENV);
    assert.equal(run.stdout, TEST4);
    assert.equal(run.code, 1);
  });
});

test("S8-1: control, a Lawcheck in a folder whose name ends in .zip, with no Plug'n'Play, judges the rules", async () => {
  await inTemp(async (dir) => {
    const s = sampleWithD(dir);
    const run = await lawcheckAt(zippedCopy(dir, 'backup.zip'), s, ['check', '--base', 'main']);
    assert.equal(run.stdout, TEST4);
    assert.equal(run.code, 1);
  });
});

test('I-env-1: Node with --permission in NODE_OPTIONS, given the entry by its own path as the Windows shims give it, gets the refusal and no stack trace', async () => {
  await inTemp(async (dir) => {
    const s = sampleWithD(dir);
    for (const [command, argv] of [...COMMANDS, ['doctor', ['doctor']] as [string, string[]], ['check', ['--version']] as [string, string[]]]) {
      const run = await lawcheckAt(join(ROOT, 'dist', 'bin.js'), s, argv, { NODE_OPTIONS: '--permission' });
      assert.equal(run.stdout, refusal('Node runs with --permission, set in NODE_OPTIONS, and under it Lawcheck cannot read its own files', 'start Lawcheck with NODE_OPTIONS free of --permission, then run lawcheck check', command), argv.join(' '));
      assert.equal(run.stderr, '', argv.join(' '));
      assert.equal(run.code, 2);
    }
    const plain = await lawcheckAt(join(ROOT, 'dist', 'bin.js'), s, ['check', '--base', 'main']);
    assert.equal(plain.stdout, TEST4, 'control: the entry without --permission runs the check');
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

test('test 200: below git 2.34 every command but --version, --help and docs refuses in its first line, naming the version', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await inTemp(async (dir) => {
    const s = sampleWithD(dir);
    const env = { PATH: [gitReporting(dir, '2.33.8'), GIT_ENV.PATH].join(delimiter) };
    await refusedEverywhere((argv) => lawcheck(s, argv, env), 'git 2.33.8 is older than 2.34, the oldest git Lawcheck runs with', 'install git 2.34 or later, then run lawcheck check', 'git');
  });
});

test('test 200: control, git 2.34.1 is not refused', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await inTemp(async (dir) => {
    const s = sampleWithD(dir);
    const run = await lawcheck(s, ['check', '--base', 'main'], { PATH: [gitReporting(dir, '2.34.1'), GIT_ENV.PATH].join(delimiter) });
    assert.equal(run.stdout, TEST4);
    assert.equal(run.code, 1);
  });
});

function runnerFailed(run: Run, said: RegExp, command: string): void {
  const lines = run.stdout.split('\n');
  assert.equal(lines[0], 'lawcheck: ERROR  1 error');
  assert.match(lines[2]!, /^error\[runner-failed\]  the runner of script rules did not start: /);
  assert.match(lines[2]!, said);
  assert.equal(lines[3], '  why:  a runner that does not start says nothing about the rules');
  assert.equal(lines[5], `next: reinstall Lawcheck, then run lawcheck ${command === 'check' ? 'check' : `${command} again`}`);
  assert.doesNotMatch(run.stdout, /rule-crashed|\.lawcheck\/rules\//);
  assert.equal(run.code, 2);
}

test('test 201: a runner Node cannot start with its flags is runner-failed, with Node\'s words, and never rule-crashed on a rule file', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withCopy(async (copy) => {
    const rules = join(copy.dir, 'dist', 'rules.js');
    writeFileSync(rules, readFileSync(rules, 'utf8').replace("'--permission', ", "'--permission', '--no-such-flag', "));
    await inTemp(async (dir) => {
      const s = sampleWithD(dir);
      // Node prints why it cannot start the runner on the tool's standard error, where the rule's own output goes.
      const said = { stderr: /^(.*: bad option: --no-such-flag\n)+$/ };
      runnerFailed(await lawcheckAt(copy.cli, s, ['check', '--base', 'main'], {}, said), /bad option: --no-such-flag$/, 'check');
      runnerFailed(await lawcheckAt(copy.cli, s, ['try', 'no-console', 'src/core/discount.ts'], {}, said), /bad option: --no-such-flag$/, 'try');
    });
  });
});

test('test 201: a runner whose process cannot be started, as with EAGAIN, is runner-failed with the system\'s words', async () => {
  await withCopy(async (copy) => {
    const rules = join(copy.dir, 'dist', 'rules.js');
    const missing = join(copy.dir, 'no-node');
    writeFileSync(rules, readFileSync(rules, 'utf8').replace("serialization: 'advanced',", `serialization: 'advanced', execPath: ${JSON.stringify(missing)},`));
    await inTemp(async (dir) => {
      runnerFailed(await lawcheckAt(copy.cli, sampleWithD(dir), ['check', '--base', 'main']), /spawn .*no-node ENOENT$/, 'check');
    });
  });
});

test('test 201: a runner file that cannot be read is runner-failed, naming the file', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withCopy(async (copy) => {
    const runner = realpathSync(join(copy.dir, 'dist', 'runner.js'));
    chmodSync(runner, 0o000);
    try {
      await inTemp(async (dir) => {
        runnerFailed(await lawcheckAt(copy.cli, sampleWithD(dir), ['check', '--base', 'main'], {}, { stderr: /Error: EACCES: permission denied, open / }), new RegExp(`EACCES: permission denied, open '${runner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'$`), 'check');
      });
    } finally {
      chmodSync(runner, 0o644);
    }
  });
});

test('test 201: control, the same copy with a sound runner judges the rules', async () => {
  await withCopy(async (copy) => {
    await inTemp(async (dir) => {
      const run = await lawcheckAt(copy.cli, sampleWithD(dir), ['check', '--base', 'main']);
      assert.equal(run.stdout, TEST4);
      assert.equal(run.code, 1);
    });
  });
});

test('test 210: doctor fails its config row when the runner the config names has no program on the PATH, and names it when it has', async () => {
  await inTemp(async (dir) => {
    const s = sampleWithD(dir);
    write(s, '.lawcheck/config.yaml', 'runner: pnpm\n');
    const bin = join(dir, 'pnpm-bin');
    mkdirSync(bin);
    const missing = await lawcheck(s, ['doctor'], { PATH: GIT_ENV.PATH!.split(delimiter).filter((d) => !existsSync(join(d, WINDOWS ? 'pnpm.cmd' : 'pnpm'))).join(delimiter) });
    assert.match(missing.stdout, /^fail  config  \.lawcheck\/config\.yaml: runner pnpm, and pnpm is not on the PATH\n  next: install pnpm, or set runner to the way this repository starts Lawcheck, then run lawcheck doctor again$/m);
    assert.equal(missing.code, 2);
    const pnpm = join(bin, WINDOWS ? 'pnpm.cmd' : 'pnpm');
    writeFileSync(pnpm, WINDOWS ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n');
    chmodSync(pnpm, 0o755);
    const found = await lawcheck(s, ['doctor'], { PATH: [bin, GIT_ENV.PATH].join(delimiter) });
    assert.match(found.stdout, new RegExp(`^ok  config  \\.lawcheck/config\\.yaml: no reviewer set; runner pnpm, pnpm at ${pnpm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  });
});
