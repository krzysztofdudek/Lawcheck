import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { writeFakeClaude } from '../acceptance/fake-reviewer.ts';
import { CLI, F, F_PATH, git, inTemp, lawcheck, makeR, makeSample, ROOT, write } from '../acceptance/helpers.ts';

const WINDOWS = process.platform === 'win32';
const HOOK = join(ROOT, 'plugin', 'hooks', 'lawcheck-hook.mjs');
const NODE_DIR = dirname(process.execPath);
const GIT_DIR = dirname(execFileSync(WINDOWS ? 'where.exe' : 'sh', WINDOWS ? ['git'] : ['-c', 'command -v git'], { encoding: 'utf8' }).split(/\r?\n/)[0]!.trim());
const SYSTEM_ENV: NodeJS.ProcessEnv = WINDOWS ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT } : {};
const PROGRAMS = ['git', 'node', 'lawcheck', 'claude', 'npx', 'pnpm'];

// Programs of the repository under the names Lawcheck and its hooks start; each only leaves a marker.
function plantPrograms(root: string, markers: string): void {
  mkdirSync(markers, { recursive: true });
  for (const name of PROGRAMS) {
    const path = join(root, name);
    if (WINDOWS) writeFileSync(`${path}.cmd`, `@echo off\r\ntype nul > "${join(markers, name)}"\r\n`);
    else {
      writeFileSync(path, `#!/bin/sh\n: > "${join(markers, name)}"\n`);
      chmodSync(path, 0o755);
    }
  }
}

// A global install of Lawcheck as npm makes it on Windows: a .cmd shim that calls a bare node.
function globalLawcheck(dir: string): string {
  const bin = join(dir, 'global');
  mkdirSync(bin, { recursive: true });
  if (WINDOWS) writeFileSync(join(bin, 'lawcheck.cmd'), `@node "${CLI}" %*\r\n`);
  else {
    writeFileSync(join(bin, 'lawcheck'), `#!/bin/sh\nexec node "${CLI}" "$@"\n`);
    chmodSync(join(bin, 'lawcheck'), 0o755);
  }
  return bin;
}

function hook(cwd: string, data: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK, 'session-start'], { env: { ...SYSTEM_ENV, CLAUDE_PLUGIN_ROOT: join(ROOT, 'plugin'), CLAUDE_PLUGIN_DATA: data, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.on('error', reject);
    child.on('close', () => resolve(stdout));
    child.stdin.end(JSON.stringify({ session_id: 's1', cwd, hook_event_name: 'SessionStart', source: 'startup' }));
  });
}

// A relative entry of PATH, and an empty one, name the folder a program is started in: the root of the repository.
const RELATIVE = WINDOWS ? ['.', ''] : ['.', ''];

test('I-start-1: check, a review through claude-code and the hooks start no program that lies in the repository, through a relative PATH entry or the current folder', async () => {
  await inTemp(async (dir) => {
    const markers = join(dir, 'markers');
    const r = makeR(dir);
    write(r, F_PATH, F);
    write(r, '.lawcheck/config.yaml', 'reviewer:\n  provider: claude-code\n');
    git(r, 'add', '-A');
    git(r, 'commit', '-q', '-m', 'config');
    write(r, F_PATH, F + '// edited\n');
    plantPrograms(r, markers);
    const path = [...RELATIVE, globalLawcheck(dir), writeFakeClaude(join(dir, 'bin')), GIT_DIR, NODE_DIR].join(delimiter);
    const env = { PATH: path };
    const checked = await lawcheck(r, ['check', '--base', 'main', '--review'], env);
    assert.equal(checked.code, 1, checked.stdout + checked.stderr);
    assert.ok(checked.stdout.includes('error[clear-errors]'), checked.stdout);
    const started = await hook(r, join(dir, 'data'), env);
    assert.ok(started.includes('.lawcheck/law.yaml'), started);
    assert.deepEqual(readdirSync(markers), []);
  });
});

test('I-start-1: under runner npx and pnpm the hooks start no program of the repository through a relative PATH entry', async () => {
  for (const runner of ['npx', 'pnpm']) {
    await inTemp(async (dir) => {
      const markers = join(dir, 'markers');
      const s = makeSample(dir);
      write(s, '.lawcheck/config.yaml', `runner: ${runner}\n`);
      plantPrograms(s, markers);
      await hook(s, join(dir, 'data'), { PATH: [...RELATIVE, GIT_DIR, NODE_DIR].join(delimiter) });
      assert.deepEqual(readdirSync(markers), [], runner);
    });
  }
});

test('I-start-1: on Windows a node.cmd at the root does not run when the hooks start a global Lawcheck whose shim calls node', { skip: WINDOWS ? false : 'cmd.exe looks in the current folder only on Windows' }, async () => {
  await inTemp(async (dir) => {
    const markers = join(dir, 'markers');
    const s = makeSample(dir);
    plantPrograms(s, markers);
    const bin = globalLawcheck(dir);
    const path = [bin, GIT_DIR, NODE_DIR].join(delimiter);
    const plain = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATH' && name !== 'NoDefaultCurrentDirectoryInExePath'));
    spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${join(bin, 'lawcheck.cmd')} --version"`], { cwd: s, env: { ...plain, PATH: path }, windowsVerbatimArguments: true, stdio: 'ignore' });
    assert.ok(existsSync(join(markers, 'node')), 'the control: cmd.exe without the setting runs the node.cmd of the repository');
    rmSync(join(markers, 'node'));
    const started = await hook(s, join(dir, 'data'), { PATH: path });
    assert.ok(started.includes('.lawcheck/law.yaml'), started);
    assert.deepEqual(readdirSync(markers), []);
    assert.equal(existsSync(join(markers, 'node')), false);
  });
});
