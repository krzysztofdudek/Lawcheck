import { chmodSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLI } from './start.ts';

// The lines of a stand-in for an installed lawcheck: a program on the PATH that logs how it was called and runs the built tool. A hook starts it, and the harness checks that hook's run.
export function installedLawcheck(log: string): string[] {
  return [
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');`,
    `const r = spawnSync(process.execPath, [${JSON.stringify(CLI)}, ...process.argv.slice(2)], { stdio: ['ignore', 'inherit', 'inherit'] });`,
    'process.exit(r.status ?? 2);',
  ];
}

// The lines of a stand-in for a package runner (npx, pnpm, bun, yarn) that logs its words and runs the given lawcheck with the words after the runner's own.
export function packageRunner(log: string, name: string, skip: number, lawcheck: string, yarn = false): string[] {
  return [
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ runner: ${JSON.stringify(name)}, args: process.argv.slice(2) }) + '\\n');`,
    ...(yarn ? ["process.stdout.write('yarn run v1.22.22\\n$ /x/node_modules/.bin/lawcheck\\n');"] : []),
    `const r = spawnSync(process.execPath, [${JSON.stringify(lawcheck)}, ...process.argv.slice(${2 + skip})], { stdio: ['ignore', 'pipe', 'inherit'] });`,
    'process.stdout.write(r.stdout);',
    ...(yarn ? ["process.stdout.write('Done in 0.10s.\\n');"] : []),
    'process.exit(r.status ?? 2);',
  ];
}

export interface FakeGit {
  // Before it answers: hang until it is killed, or wait this long on its first call alone.
  hang?: boolean;
  firstWaitMs?: number;
  // A file each call appends its words and the value of this variable to.
  record?: { file: string; variable: string };
}

// A git on the PATH that a hook starts in place of the real one. Outside Windows, one that hangs is a shell script, which records its call before the hook's deadline on a loaded runner, where a new node may not. The hooks start git only as git.exe on Windows, so a script cannot stand in for it there, nor does one for a git that goes on to run the real one: that stand-in is a copy of node named git, and NODE_OPTIONS makes every node load a preload that acts only in that copy, before node looks for a script, and then runs the real git with the same words. Node reads a first word that starts with - as its own option, so the stand-in serves only calls that start with a git command, as the hooks' snapshot does, and not the tool, which asks git --version. Returns the variables that the run's environment needs.
export function fakeGit(bin: string, realGit: string, act: FakeGit): NodeJS.ProcessEnv {
  const program = join(bin, process.platform === 'win32' ? 'git.exe' : 'git');
  if (act.hang === true && process.platform !== 'win32') {
    const record = act.record === undefined ? [] : [
      'words=',
      'for word in "$@"; do words="$words${words:+,}\\"$word\\""; done',
      `printf '{"words":[%s],"value":"%s"}\\n' "$words" "$${act.record.variable}" >> '${act.record.file}'`,
    ];
    writeFileSync(program, ['#!/bin/sh', ...record, 'exec /bin/sleep 300', ''].join('\n'));
    chmodSync(program, 0o755);
    return {};
  }
  copyFileSync(process.execPath, program);
  chmodSync(program, 0o755);
  const preload = join(bin, 'fake-git.cjs');
  const waited = join(bin, 'fake-git-waited');
  writeFileSync(
    preload,
    [
      "const { basename } = require('node:path');",
      "if (/^git(\\.exe)?$/i.test(basename(process.execPath))) {",
      "  const { appendFileSync, existsSync, writeFileSync } = require('node:fs');",
      "  const { spawnSync } = require('node:child_process');",
      '  const words = [basename(process.argv[1]), ...process.argv.slice(2)];',
      ...(act.record === undefined ? [] : [`  appendFileSync(${JSON.stringify(act.record.file)}, JSON.stringify({ words, value: process.env[${JSON.stringify(act.record.variable)}] ?? null }) + '\\n');`]),
      ...(act.hang === true ? ['  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);'] : []),
      ...(act.firstWaitMs === undefined ? [] : [`  if (!existsSync(${JSON.stringify(waited)})) {`, `    writeFileSync(${JSON.stringify(waited)}, '');`, `    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${act.firstWaitMs});`, '  }']),
      `  process.exit(spawnSync(${JSON.stringify(realGit)}, words, { stdio: 'inherit' }).status ?? 2);`,
      '}',
      '',
    ].join('\n'),
  );
  return { NODE_OPTIONS: `--require "${preload.split('\\').join('/')}"` };
}

export function removeFakeGit(bin: string): void {
  for (const name of ['git', 'git.exe', 'fake-git.cjs', 'fake-git-waited']) rmSync(join(bin, name), { force: true });
}
