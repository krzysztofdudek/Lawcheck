import { spawn, spawnSync } from 'node:child_process';
import { existsSync, globSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { paint, render, scriptLength, segments, unreachedLines } from './list.ts';
import type { FileList, Script, Segment } from './list.ts';
import { COMMIT_GROUPS, ROOT } from '../harness/sets.ts';

const USAGE = 'usage: node tests/coverage/run.ts [--out <file>] [<arguments of tests/run.ts>...]';

// Lawcheck starts a rule runner with an empty environment and no right to write, so the runner cannot say what it ran; only the tests that load its file themselves are counted.
const UNMEASURED: Record<string, string> = {
  'src/runner.ts': 'This file runs in the rule runner, which Lawcheck starts with an empty environment and no right to write a file, so what it ran there is not counted: a line below may be reached.',
  'src/runner-trace.ts': 'This file runs in the rule runner, which Lawcheck starts with an empty environment and no right to write a file, so what it ran there is not counted: a line below may be reached.',
};

class CouldNotRun extends Error {}

function fail(message: string): never {
  throw new CouldNotRun(message);
}

type Built = { file: string; text: string; ran: Uint8Array; loaded: boolean; all: Segment[]; sources: string[] };

// The build of the checkout carries no source maps, so the same build is made once more beside it, with them; a built file that differs from its twin is not the build of this src/.
function readBuild(maps: string): Map<string, Built> {
  const tsc = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', ROOT, '--sourceMap', '--outDir', maps], { cwd: ROOT, encoding: 'utf8' });
  if (tsc.status !== 0) fail(`the build with source maps failed:\n${tsc.stdout}${tsc.stderr}`);
  const out = new Map<string, Built>();
  for (const map of globSync('**/*.map', { cwd: maps }).sort()) {
    const file = map.replace(/\\/g, '/').replace(/\.map$/, '');
    const twin = readFileSync(join(maps, file), 'utf8').replace(/\n?\/\/# sourceMappingURL=.*\n?$/, '');
    const path = join(ROOT, 'dist', file);
    if (!existsSync(path)) fail(`dist/${file} does not exist; run npm run build first`);
    const text = readFileSync(path, 'utf8');
    if (text.trimEnd() !== twin.trimEnd()) fail(`dist/${file} is not the build of this src/; run npm run build first`);
    const parsed = JSON.parse(readFileSync(join(maps, map), 'utf8')) as { mappings: string; sources: string[] };
    const sources = parsed.sources.map((source) => `src/${resolve(join(maps, file, '..'), source).slice(resolve(ROOT, 'src').length + 1).replace(/\\/g, '/')}`);
    out.set(file, { file, text, ran: new Uint8Array(text.length), loaded: false, all: segments(parsed.mappings, text), sources });
  }
  return out;
}

// A test may run a copy of the build from another folder: a script under a folder dist, by the same name and of the same length, is that built file.
function builtOf(url: string, built: Map<string, Built>): Built | null {
  if (!url.startsWith('file://')) return null;
  const at = url.lastIndexOf('/dist/');
  return at < 0 ? null : (built.get(decodeURIComponent(url.slice(at + '/dist/'.length))) ?? null);
}

// A process writes what it ran when it ends, some hundreds of kilobytes each, and the commit set starts thousands: each file is read and removed while the tests run, so they never fill the disk. A file still being written does not parse yet and is read on a later pass.
function take(v8: string, built: Map<string, Built>, last: boolean): number {
  let taken = 0;
  for (const name of existsSync(v8) ? readdirSync(v8) : []) {
    const path = join(v8, name);
    let scripts: Script[];
    try {
      scripts = (JSON.parse(readFileSync(path, 'utf8')) as { result: Script[] }).result;
    } catch {
      if (last) rmSync(path, { force: true });
      continue;
    }
    rmSync(path, { force: true });
    taken++;
    for (const script of scripts) {
      const file = builtOf(script.url, built);
      if (file === null || scriptLength(script) !== file.text.length) continue;
      file.loaded = true;
      paint(script, file.text.length, file.ran);
    }
  }
  return taken;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  let out = join(ROOT, 'coverage-list.md');
  if (argv[0] === '--out') {
    if (argv[1] === undefined) fail(`--out takes a file\n${USAGE}`);
    out = resolve(argv[1]);
    argv.splice(0, 2);
  }
  // The whole commit set has a target for its time, which the record of what ran would pass on a small machine; its groups one after another are the same tests, and a group has no target.
  const runs = argv.length > 0 ? [argv] : Object.keys(COMMIT_GROUPS).map((group) => ['commit', '--group', group]);
  const ran = argv.length > 0 ? `node tests/run.ts ${argv.join(' ')}` : 'node tests/run.ts commit --group <group>, for each group of the commit set';
  const temp = mkdtempSync(join(tmpdir(), 'lawcheck-coverage-'));
  try {
    const built = readBuild(join(temp, 'maps'));
    const v8 = join(temp, 'v8');
    const env = { ...process.env, NODE_V8_COVERAGE: v8 };
    delete env.NODE_TEST_CONTEXT;
    let processes = 0;
    let red = false;
    for (const tests of runs) {
      const run = spawn(process.execPath, [join(ROOT, 'tests', 'run.ts'), ...tests], { cwd: ROOT, env, stdio: ['ignore', 2, 2] });
      const status = await new Promise<number | null>((done) => {
        const timer = setInterval(() => (processes += take(v8, built, false)), 1000);
        run.on('error', () => undefined);
        run.on('close', (code) => {
          clearInterval(timer);
          done(code);
        });
      });
      if (status === 2 || status === null) fail(`node tests/run.ts ${tests.join(' ')} did not run`);
      if (status !== 0) red = true;
    }
    processes += take(v8, built, true);
    if (processes === 0) fail('no process wrote what it ran');
    const files: FileList[] = [];
    for (const file of built.values()) {
      file.sources.forEach((source, index) => {
        const text = readFileSync(join(ROOT, source), 'utf8').split('\n');
        const lines = unreachedLines(file.all, index, file.ran, (line) => (text[line - 1] ?? '').trimStart().startsWith('//'));
        files.push({ file: source, code: lines.code, loaded: file.loaded, unreached: lines.unreached, text });
      });
    }
    const text = render(files, { ran, red, processes, system: process.platform, unmeasured: UNMEASURED });
    writeFileSync(out, text);
    process.stdout.write(`${text.split('\n')[2]}\ncoverage: the list is in ${out}\n`);
    return 0;
  } finally {
    rmSync(temp, { recursive: true, force: true, maxRetries: 5 });
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  if (!(error instanceof CouldNotRun)) throw error;
  process.stderr.write(`coverage: could not run: ${error.message}\n`);
  process.exitCode = 2;
}
