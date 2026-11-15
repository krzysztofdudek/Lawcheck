import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { CLI, git, GIT_ENV, inTemp, lawcheck, makeSample, ROOT, write } from '../acceptance/helpers.ts';
import type { Run, SampleOptions } from '../acceptance/helpers.ts';

export const WINDOWS = process.platform === 'win32';

// A package in a node_modules of its own, as a hoisted install leaves it.
export const HOISTED = 'hoisted-helper';

function installHoisted(dir: string): void {
  write(dir, `node_modules/${HOISTED}/package.json`, JSON.stringify({ name: HOISTED, type: 'module', main: 'index.js' }) + '\n');
  write(dir, `node_modules/${HOISTED}/index.js`, "export const hoisted = 'from a hoisted package';\n");
}

export interface Placed {
  // The folder that holds .lawcheck/law.yaml, as the test reaches it.
  root: string;
  // The top of the git work tree the root lies in.
  top: string;
  // What git commands of the scenario run in, so a commit lands on the branch the root has checked out.
  repo: string;
}

export interface Shape {
  name: string;
  // Builds the sample S in this shape inside dir, on branch work, and gives where its root is.
  make(dir: string, options: SampleOptions): Placed;
}

const atTop: Shape = {
  name: 'the law at the top',
  make(dir, options) {
    const s = makeSample(dir, { ...options, top: (repo) => { installHoisted(repo); options.top?.(repo); } });
    return { root: s, top: s, repo: s };
  },
};

const inPackage: Shape = {
  name: 'the law in pkg/ of a monorepo with node_modules hoisted above it',
  make(dir, options) {
    const repo = makeSample(dir, {
      under: 'pkg',
      onMain: options.onMain === undefined ? undefined : (top) => options.onMain!(join(top, 'pkg')),
      top: (top) => {
        installHoisted(top);
        write(top, 'top.txt', 'outside the root\n');
        write(top, 'package.json', JSON.stringify({ name: 'mono', private: true, workspaces: ['pkg'] }) + '\n');
        options.top?.(join(top, 'pkg'));
      },
    });
    write(repo, 'top.txt', 'outside the root, changed\n');
    return { root: join(repo, 'pkg'), top: repo, repo: join(repo, 'pkg') };
  },
};

const linkedWorktree: Shape = {
  name: 'a linked worktree',
  make(dir, options) {
    const s = makeSample(dir, { ...options, top: (repo) => { installHoisted(repo); options.top?.(repo); } });
    git(s, 'checkout', '-q', 'main');
    const tree = join(dir, 'tree');
    git(s, 'worktree', 'add', '-q', tree, 'work');
    return { root: tree, top: tree, repo: tree };
  },
};

const oddPath: Shape = {
  name: 'a root path with a space and a non-ASCII letter',
  make(dir, options) {
    const outer = join(dir, 'my repo żółw');
    mkdirSync(outer);
    const s = makeSample(outer, { ...options, top: (repo) => { installHoisted(repo); options.top?.(repo); } });
    return { root: s, top: s, repo: s };
  },
};

const throughLink: Shape = {
  name: 'a root reached through a symbolic link',
  make(dir, options) {
    const s = makeSample(dir, { ...options, top: (repo) => { installHoisted(repo); options.top?.(repo); } });
    const link = join(dir, 'link');
    symlinkSync(s, link, WINDOWS ? 'junction' : 'dir');
    return { root: link, top: link, repo: link };
  },
};

export const SHAPES: Shape[] = [atTop, inPackage, linkedWorktree, oddPath, throughLink];

export interface Start {
  name: string;
  cwd(placed: Placed): string;
}

export const STARTS: Start[] = [
  { name: 'from the root', cwd: (placed) => placed.root },
  { name: 'from src/core below it', cwd: (placed) => join(placed.root, 'src', 'core') },
];

export interface Scenario {
  name: string;
  options?: SampleOptions;
  // Changes the fresh S in the shape, through paths relative to its root.
  arrange?(placed: Placed): void;
  args: string[];
  // Judges the result; it throws on a difference, with the scenario's own words.
  expect(run: Run, shape: Shape): void;
}

export interface Outcome {
  shape: string;
  start: string;
  scenario: string;
  run: Run;
}

// Runs every scenario in every shape and from every start, each in a fresh S of its own.
export async function inShapes(scenarios: Scenario[], shapes: Shape[] = SHAPES, starts: Start[] = STARTS): Promise<string[]> {
  const problems: string[] = [];
  for (const shape of shapes) {
    for (const start of starts) {
      for (const scenario of scenarios) {
        await inTemp(async (dir) => {
          const placed = shape.make(dir, scenario.options ?? {});
          scenario.arrange?.(placed);
          const run = await lawcheck(start.cwd(placed), scenario.args);
          try {
            scenario.expect(run, shape);
          } catch (error) {
            problems.push(`${scenario.name}, in ${shape.name}, ${start.name}: ${(error as Error).message}\n${run.stdout}${run.stderr === '' ? '' : `\nstandard error: ${run.stderr}`}`);
          }
        });
      }
    }
  }
  return problems;
}

export interface HookRun {
  code: number | null;
  stdout: string;
  stderr: string;
  json: unknown;
}

// A folder with a lawcheck command that starts the built tool, as a global install puts one on PATH.
export function binWithLawcheck(dir: string): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const path = join(bin, 'lawcheck');
  writeFileSync(path, [`#!${process.execPath}`, "import { spawnSync } from 'node:child_process';", `const r = spawnSync(process.execPath, [${JSON.stringify(CLI)}, ...process.argv.slice(2)], { stdio: ['ignore', 'inherit', 'inherit'] });`, 'process.exit(r.status ?? 2);', ''].join('\n'));
  chmodSync(path, 0o755);
  if (WINDOWS) writeFileSync(`${path}.cmd`, `@"${process.execPath}" "${path}" %*\r\n`);
  return bin;
}

export const HOOK = join(ROOT, 'plugin', 'hooks', 'lawcheck-hook.mjs');

export function hookEnv(dir: string, path: string[]): NodeJS.ProcessEnv {
  const system: NodeJS.ProcessEnv = WINDOWS ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec } : {};
  return { PATH: path.join(delimiter), ...system, CLAUDE_PLUGIN_ROOT: join(ROOT, 'plugin'), CLAUDE_PLUGIN_DATA: join(dir, 'data') };
}

export function runHook(event: string, input: Record<string, unknown>, env: NodeJS.ProcessEnv): Promise<HookRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK, event], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      let json: unknown = null;
      try {
        json = stdout === '' ? null : JSON.parse(stdout);
      } catch {}
      resolve({ code, stdout, stderr, json });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export const NODE_DIR = dirname(process.execPath);
export { GIT_ENV };
