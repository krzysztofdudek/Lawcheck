import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inTemp, lawcheck, newRepository, ROOT } from './helpers.ts';

type Line = [code: string, ...messages: string[]];

const KEEP = '; pass the state in, or hold it in an object the caller creates';
const CYCLE = '; move what both need into a module that imports neither';

function lawFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const add = (folder: string) => {
    for (const entry of readdirSync(join(ROOT, folder), { withFileTypes: true })) {
      const path = `${folder}/${entry.name}`;
      if (entry.isDirectory()) add(path);
      else if (path !== '.lawcheck/verdicts') files[path] = readFileSync(join(ROOT, path), 'utf8');
    }
  };
  add('.lawcheck');
  files['docs/codes.md'] = readFileSync(join(ROOT, 'docs', 'codes.md'), 'utf8');
  return files;
}

function text(lines: Line[]): string {
  return lines.map(([code]) => code).join('\n') + '\n';
}

function expected(lines: Line[]): string[] {
  return lines.flatMap(([, ...messages], index) => messages.map((message) => `${index + 1} ${message}`)).sort();
}

async function tried(repo: string, rule: string, path: string): Promise<string[]> {
  const run = await lawcheck(repo, ['try', rule, path, '--json']);
  assert.equal(run.stderr, '');
  const document = JSON.parse(run.stdout) as { runs: { findings: { line: number | null; message: string }[] }[] };
  const findings = document.runs.flatMap((r) => r.findings.map((f) => `${f.line ?? ''} ${f.message}`)).sort();
  assert.equal(run.code, findings.length > 0 ? 1 : 0, run.stdout);
  return findings;
}

function typed(...names: string[]): (law: string) => string {
  return (law) => names.reduce((text, name) => {
    assert.ok(text.includes(`,${name},`), `src/${name}.ts is in the list of untyped files`);
    return text.replace(`,${name},`, ',');
  }, law);
}

async function judge(rule: string, probes: Record<string, Line[]>, others: Record<string, string> = {}, law?: (text: string) => string): Promise<void> {
  await inTemp(async (dir) => {
    const files = { ...lawFiles(), ...others };
    if (law !== undefined) files['.lawcheck/law.yaml'] = law(files['.lawcheck/law.yaml']!);
    for (const [path, lines] of Object.entries(probes)) files[path] = text(lines);
    const repo = newRepository(dir, files);
    for (const [path, lines] of Object.entries(probes)) assert.deepEqual(await tried(repo, rule, path), expected(lines), path);
  });
}

test('question 160: layer-imports, an outside import a row does not hold, and a door taken by another file, are found; what a row holds passes', async () => {
  const core = 'which core may not; it may import from outside: yaml, node:crypto';
  await judge('layer-imports', {
    'src/core/probe.ts': [
      ["import { parse } from 'yaml';"],
      ["import { createHash } from 'node:crypto';"],
      ["import './local.js';"],
      ["import { readFileSync } from 'node:fs';", `imports node:fs, ${core}`],
      ["import fs from 'fs';", `imports fs, ${core}`],
      ["export { pad } from 'left-pad';", `imports left-pad, ${core}`],
      ["const os = await import('node:os');", `imports node:os, ${core}`],
      ['import {'],
      ['  connect,'],
      ["} from 'node:net';", `imports node:net, ${core}`],
      ["import type { ChildProcess } from 'node:child_process';", 'imports node:child_process for a type; only src/adapters/processes.ts does, so go through it'],
      ["import { Worker } from 'node:worker_threads';", 'imports node:worker_threads; no module of src does'],
      ["import { parseFile } from '@chrisdudek/runes/ast';", 'imports @chrisdudek/runes/ast; only src/adapters/readers.ts does, so go through it'],
      ["import{ join }from'node:path';", `imports node:path, ${core}`],
      ["import type{ Stats }from'node:fs';", `imports node:fs, ${core}`],
      ["import yamlAgain from 'yaml'; import { hostname } from 'node:os';", `imports node:os, ${core}`],
      ['const util = await import(`node:util`);', `imports node:util, ${core}`],
      ["const zlib = require('node:zlib');", `imports node:zlib, ${core}`],
      ["export * from 'node:events';", `imports node:events, ${core}`],
      ["export default 'node:fs';"],
      ["const text = 'node:fs in a string';"],
      ["// import { x } from 'node:fs';"],
    ],
    'src/core/bom.ts': [["\uFEFFimport { readFileSync } from 'node:fs';", `imports node:fs, ${core}`]],
    'src/adapters/git.ts': [
      ["import { readFileSync } from 'node:fs';"],
      ["import { spawnSync } from 'node:child_process';", 'imports node:child_process; only src/adapters/processes.ts does, so go through it'],
      ["import { env } from 'node:process';", 'imports node:process; no module of src does'],
      ["import { Console } from 'node:console';", 'imports node:console; no module of src does'],
      ["import cluster from 'node:cluster';", 'imports node:cluster; no module of src does'],
    ],
    'src/adapters/processes.ts': [["import { spawn } from 'node:child_process';"], ["import { join } from 'node:path';"]],
    'src/adapters/tree.ts': [["import * as TreeSitter from 'web-tree-sitter';", 'imports web-tree-sitter; only src/adapters/readers.ts does, so go through it']],
    'src/adapters/readers.ts': [["import { parseFile } from '@chrisdudek/runes/ast';"], ["import * as TreeSitter from 'web-tree-sitter';"]],
    'plugin/hooks/probe.mjs': [["import { spawn } from 'node:child_process';"]],
  });
});

test('question 160: layer-imports, a type with no row is one finding about the whole file', async () => {
  await inTemp(async (dir) => {
    const files = lawFiles();
    files['.lawcheck/law.yaml'] = files['.lawcheck/law.yaml']!.replace('    types:\n      cli:\n', '    types:\n      extra:\n        paths: ["src/extra/**"]\n      cli:\n');
    files['src/extra/probe.ts'] = 'export const nothing = 1;\n';
    const repo = newRepository(dir, files);
    assert.deepEqual(await tried(repo, 'layer-imports', 'src/extra/probe.ts'), [' the type extra has no row in .lawcheck/rules/layer-imports.mjs; add one that names what it may import from outside']);
  });
});

test('question 160: pure-layers, process, globalThis, console, fetch, the clock, randomness and timers in core and output are found; a property and text pass', async () => {
  const core = '; a core module takes what it needs as an argument';
  await judge('pure-layers', {
    'src/core/probe.ts': [
      ['export const a = () => process.platform;', `reads process${core}`],
      ['export const b = () => ({ ...process.env });', `reads process${core}`],
      ['export const c = () => globalThis.structuredClone;', `reads globalThis${core}`],
      ["export const d = () => console.log('x');", `uses console${core}`],
      ["export const e = () => fetch('https://example.com');", `calls fetch${core}`],
      ['export const f = () => Date.now();', `reads the clock${core}`],
      ['export const g = () => new Date();', `reads the clock${core}`],
      ['export const h = () => Math.random();', `draws a random number${core}`],
      ['export const h1 = () => randomUUID();', `draws a random number${core}`],
      ['export const h2 = () => crypto.randomUUID();', `draws a random number${core}`],
      ['export const h3 = () => randomBytes(8);', `draws a random number${core}`],
      ['export const g1 = () => Date();', `reads the clock${core}`],
      ['export const g2 = Date.now;', `reads the clock${core}`],
      ['const { now } = Date;', `reads the clock${core}`],
      ['export const g3 = () => performance.now();', `reads the clock${core}`],
      ['export const g4 = (ms: number) => new Date(ms);'],
      ['export const g5 = (text: string) => Date.parse(text);'],
      ['export const i = () => setTimeout(() => {}, 1);', `starts a timer${core}`],
      ['export const i1 = () => setInterval(() => {}, 1);', `starts a timer${core}`],
      ['export const i2 = () => setImmediate(() => {});', `starts a timer${core}`],
      ['export const h4 = (a: Uint8Array) => crypto.getRandomValues(a);', `draws a random number${core}`],
      ['export const h5 = () => randomInt(6);', `draws a random number${core}`],
      ['export const h6 = (b: Buffer) => randomFillSync(b);', `draws a random number${core}`],
      ['export const h7 = (b: Buffer, done: () => void) => randomFill(b, done);', `draws a random number${core}`],
      ['export const j = (options) => options.process;'],
      ['export const k = (date: Date) => date.getTime();'],
      ["export const l = 'process.env and Date.now() in a string';"],
      ['// console.log() in a comment'],
      ['export const t = () => `at ${Date.now()}`;', `reads the clock${core}`],
      ['export const u = (n: number) => `process and Date.now() in the text of ${n} and ${`${n}`}`;'],
    ],
    'src/output/probe.ts': [["export const m = () => console.log('x');", 'uses console; an output module takes what it needs as an argument']],
  });
});

test('question 160: programs-own-the-process, the process members of a program used outside the programs are found; the members an adapter needs pass', async () => {
  await judge('programs-own-the-process', {
    'src/steps/probe.ts': [
      ['export const a = () => process.env.HOME;', 'uses process.env outside the programs; take it from the context the program passes'],
      ['export const b = () => ({ ...process.env });', 'uses process.env outside the programs; take it from the context the program passes'],
      ['export const c = () => process.cwd();', 'uses process.cwd outside the programs; take it from the context the program passes'],
      ['export const d = () => process?.argv;', 'uses process.argv outside the programs; take it from the context the program passes'],
      ["export const e = () => process.stdout.write('x');", "uses process.stdout outside the programs; return the text in the command's result"],
      ["export const f = () => process.stderr.write('x');", "uses process.stderr outside the programs; return the text in the command's result"],
      ['export const g = () => process.exit(1);', 'uses process.exit outside the programs; leave it to src/cli.ts'],
      ["export const h = () => process.on('exit', () => {});", 'uses process.on outside the programs; leave it to src/cli.ts'],
      ["export const h1 = () => process.once('exit', () => {});", 'uses process.once outside the programs; leave it to src/cli.ts'],
      ["export const h2 = (f: () => void) => process.off('exit', f);", 'uses process.off outside the programs; leave it to src/cli.ts'],
      ['export const h3 = (m: object) => process.send?.(m);', 'uses process.send outside the programs; leave it to src/cli.ts'],
      ['export const h4 = () => process.stdin;', 'uses process.stdin outside the programs; leave it to src/cli.ts'],
      ['export const h5 = () => { process.exitCode = 2; };', 'uses process.exitCode outside the programs; leave it to src/cli.ts'],
      ["export const h6 = () => process.chdir('/');", 'uses process.chdir outside the programs; leave it to src/cli.ts'],
      ["export const i1 = () => console.log('x');", "uses console outside the programs; return the text in the command's result"],
      ["export const i = () => console.error('x');", "uses console outside the programs; return the text in the command's result"],
      ['export const j = () => [process.platform, process.pid, process.execPath, process.versions.node];'],
      ['export const k = (options) => options.process.env;'],
      ["export const l = 'process.env in a string';"],
      ['export const m = () => `home ${process.env.HOME}`;', 'uses process.env outside the programs; take it from the context the program passes'],
    ],
    'src/runner.ts': [["process.stdout.write('a program may');"], ["console.log('a program may');"]],
  }, {}, typed('runner'));
});

test('question 160: modules-only-declare, a statement at load, a variable, an empty Set or Map and a Sync call at load are found; declarations pass', async () => {
  await judge('modules-only-declare', {
    'src/steps/probe.ts': [
      ["import { readFileSync } from 'node:fs';"],
      ["console.log('loaded');", 'runs a statement when the module loads; put it in a function that a program calls'],
      ['if (globalFlag) start();', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['await start();', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['registry.add(1);', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['counter++;', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['counter--;', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['settings.mode = 1;', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['table[0] = 1;', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['for (const name of names) register(name);', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['while (pending()) step();', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['do step(); while (pending());', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['try { start(); } catch {}', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['switch (mode) {}', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['new Watcher();', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['void start();', 'runs a statement when the module loads; put it in a function that a program calls'],
      ["throw new Error('at load');", 'runs a statement when the module loads; put it in a function that a program calls'],
      ['!function () {}();', 'runs a statement when the module loads; put it in a function that a program calls'],
      [';[1].map(String);', 'runs a statement when the module loads; put it in a function that a program calls'],
      ['export let count = 0;', `keeps the variable count between calls${KEEP}`],
      ['var seen = [];', `keeps the variable seen between calls${KEEP}`],
      ['const live = new Set<number>();', `keeps the Set live between calls${KEEP}`],
      ['export const cache = new Map();', `keeps the Map cache between calls${KEEP}`],
      ["const text = readFileSync('a.txt', 'utf8');", 'computes text with readFileSync when the module loads; make it a function'],
      ['(() => { start(); })();', 'runs a statement when the module loads; put it in a function that a program calls'],
      ["['a', 'b'].forEach((name) => register(name));", 'runs a statement when the module loads; put it in a function that a program calls'],
      ['export const lifetime = createLifetime();', 'creates lifetime with createLifetime when the module loads; make it a function'],
      ['export const shape = makeShape();', 'creates shape with makeShape when the module loads; make it a function'],
      ['export const watcher = startWatcher();', 'creates watcher with startWatcher when the module loads; make it a function'],
      ['export const handle = openHandle();', 'creates handle with openHandle when the module loads; make it a function'],
      ['export const hook = registerHook();', 'creates hook with registerHook when the module loads; make it a function'],
      ['export const state = initState();', 'creates state with initState when the module loads; make it a function'],
      ['export const child = spawnChild();', 'creates child with spawnChild when the module loads; make it a function'],
      ['export const db = connectDb();', 'creates db with connectDb when the module loads; make it a function'],
      ['export const pool = Pool.create();', 'creates pool with Pool.create when the module loads; make it a function'],
      ['export const box = Object.create(null);', 'creates box with Object.create when the module loads; make it a function'],
      ['export const queue = new Pool();'],
      ['export const ready = setup();'],
      ['export const data = await load();', 'computes data with await when the module loads; make it a function'],
      ['export const value = (() => 1)();', 'computes value by running a function when the module loads; make it a function'],
      ['export const store = {};', `keeps the empty object store between calls${KEEP}`],
      ['const list: string[] = [];', `keeps the empty array list between calls${KEEP}`],
      ['const seen = new WeakMap();', `keeps the WeakMap seen between calls${KEEP}`],
      ['const marks = new WeakSet<object>();', `keeps the WeakSet marks between calls${KEEP}`],
      ['export class Registry {'],
      ['  static entries = new Map<string, number>();', `keeps the static field entries between calls${KEEP}`],
      ['  static readonly order: string[] = [];', `keeps the static field order between calls${KEEP}`],
      ['  static readonly LIMIT = 3;'],
      ['  count = 0;'],
      ['}'],
      ['export const exists = (path: string): boolean => existsSync(path);'],
      ['export const read = async (path) => readFileSync(path);'],
      ["export const pattern = compile('x');"],
      ['const EMPTY = Object.freeze({});'],
      ["const EXTENSIONS = new Set(['.vue', '.svelte']);"],
      ['export const LIMIT = 30;'],
      ['type Name = string;'],
      ['interface Shape {}'],
      ['async function later(): Promise<void> {}'],
      ['enum Color { Red }'],
      ['declare const injected: string;'],
      ['abstract class Base {}'],
      ['function helper(): void {}'],
      ['export function run(): void {'],
      ["  console.log('inside a function');"],
      ['  let local = 0;'],
      ['}'],
    ],
    'src/runner.ts': [["console.log('a program may');"], ['let state = 0;']],
  }, {}, typed('runner'));
});

test('question 160: no-import-cycles, a circle of value imports is found on each file of it; a type-only import closes no circle', async () => {
  await judge('no-import-cycles', {
    'src/core/a.ts': [["import { b } from './b.js';", `imports src/core/b.ts, which imports this file back${CYCLE}`], ['export const a = () => b;']],
    'src/core/b.ts': [["import { a } from './a.js';", `imports src/core/a.ts, which imports this file back${CYCLE}`], ['export const b = () => a;']],
    'src/core/x.ts': [["import { y } from './y.js';", `imports src/core/y.ts, which imports src/core/z.ts, which imports this file back${CYCLE}`], ['export const x = () => y;']],
    'src/core/c.ts': [["import type { D } from './d.js';"], ['export type C = D;']],
  }, {
    'src/core/y.ts': "import { z } from './z.js';\nexport const y = () => z;\n",
    'src/core/z.ts': "import { x } from './x.js';\nexport const z = () => x;\n",
    'src/core/d.ts': "import { c } from './c.js';\nexport type D = string;\nexport const d = c;\n",
  });
});

test('question 160: own-paths-in-one-place, import.meta outside src/adapters/package.ts and src/cli.ts is found', async () => {
  const ask = "reads import.meta; src/adapters/package.ts computes every path into Lawcheck's own folder, so ask it";
  await judge('own-paths-in-one-place', {
    'src/steps/probe.ts': [
      ['export const here = () => import.meta.url;', ask],
      ["export const folder = () => new URL('.', import.meta.url);", ask],
      ["export const text = 'import.meta in a string';"],
      ['// import.meta in a comment'],
    ],
    'src/adapters/package.ts': [["export const manifest = () => new URL('../../package.json', import.meta.url);"]],
    'src/cli.ts': [['export const started = () => import.meta.url;']],
  }, {}, typed('cli'));
});
