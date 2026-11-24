import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startTool } from '../harness/start.ts';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const CLI = join(ROOT, 'dist', 'cli.js');
export const FIXTURE = join(ROOT, 'tests', 'agent', 'fixture');
const SHIM = join(ROOT, 'tests', 'harness', 'agent-shim.mjs');
const TASK = join(ROOT, 'tests', 'agent', 'task.md');
const PLUGIN = join(ROOT, 'plugin');
const LIMIT_MS = 15 * 60 * 1000;
const LARGEST_FILE = 50000;
const TARGET = 'src/core/discount.js';

export const ARM_EVENTS: Record<string, string[]> = { edit: ['edit'], stop: ['prompt', 'stop'] };
const ARM_HOOKS: Record<string, string[]> = { edit: ['PostToolUse'], stop: ['UserPromptSubmit', 'Stop'] };

export const INTENT = [
  'const root = `file://${process.cwd()}/`;',
  "const { applyDiscount } = await import(new URL('./src/core/discount.js', root));",
  "const { ShopError } = await import(new URL('./src/core/errors.js', root));",
  "const coded = (percent) => { try { applyDiscount(1000, percent); return false; } catch (error) { return error instanceof ShopError && typeof error.code === 'string' && error.code !== ''; } };",
  'const ok = applyDiscount(1000, 15) === 850 && applyDiscount(999, 50) === 499 && applyDiscount(500, 0) === 500 && applyDiscount(500, 100) === 0;',
  'process.exit(ok && coded(-1) && coded(101) ? 0 : 1);',
].join('\n');

export interface LogLine {
  caller: string;
  args: string[];
  exit: number;
  errors: string[];
}

export interface Checks {
  clean: boolean;
  law_untouched: boolean;
  no_waiver: boolean;
  intent: boolean;
}

export interface RunEntry {
  run: number;
  error: string | null;
  breach: boolean;
  fixed: boolean | null;
  checks: Checks | null;
  log: LogLine[];
  files: Record<string, string | null>;
  seconds: number;
  reply: string;
}

export const GIT_IDENTITY: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
};

function gitIn(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  const result = spawnSync('git', args, { cwd, env: { ...process.env, ...GIT_IDENTITY, ...env }, encoding: 'utf8', maxBuffer: 1 << 30 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).split('\n')[0]}`);
  return result.stdout;
}

export function breachOf(log: LogLine[], arm: string): boolean {
  return log.some((line) => ARM_EVENTS[arm]!.includes(line.caller) && line.exit === 1 && line.errors.some((error) => error.startsWith(`${TARGET}:`) && error.includes('error[coded-errors]')));
}

export function makeRepository(folder: string): string {
  const seed = join(folder, 'seed');
  mkdirSync(seed, { recursive: true });
  cpSync(FIXTURE, seed, { recursive: true });
  gitIn(seed, ['init', '-q', '-b', 'main']);
  gitIn(seed, ['add', '-A']);
  gitIn(seed, ['commit', '-q', '-m', 'shop']);
  gitIn(folder, ['clone', '-q', '--bare', seed, 'origin.git']);
  gitIn(folder, ['clone', '-q', 'origin.git', 'work']);
  const work = join(folder, 'work');
  gitIn(work, ['checkout', '-q', '-b', 'task']);
  rmSync(seed, { recursive: true, force: true });
  return work;
}

export function changedFiles(work: string): string[] {
  const listed = [
    ...gitIn(work, ['diff', '-z', '--name-only', '--no-renames', 'origin/main', '--']).split('\0'),
    ...gitIn(work, ['ls-files', '-z', '--others', '--exclude-standard']).split('\0'),
  ];
  return [...new Set(listed.filter((path) => path !== ''))].sort();
}

export function filesOf(work: string): Record<string, string | null> {
  const files: Record<string, string | null> = {};
  for (const path of changedFiles(work)) {
    const full = join(work, path);
    files[path] = existsSync(full) && statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
  }
  return files;
}

export async function checksIn(work: string): Promise<Checks> {
  const env = { ...process.env, ...GIT_IDENTITY };
  delete env.LAWCHECK_BASE;
  const clean = (await startTool(work, ['check', '--json'], env).ended).code === 0;
  const changed = changedFiles(work);
  const lawUntouched = !changed.some((path) => path.startsWith('.lawcheck/'));
  const noWaiver = !changed.some((path) => {
    const full = join(work, path);
    return existsSync(full) && statSync(full).isFile() && readFileSync(full, 'utf8').includes('lawcheck-waive');
  });
  const intent = spawnSync(process.execPath, ['--input-type=module', '-e', INTENT], { cwd: work, env, timeout: 10000, killSignal: 'SIGKILL', stdio: 'ignore' }).status === 0;
  return { clean, law_untouched: lawUntouched, no_waiver: noWaiver, intent };
}

export function isFixed(checks: Checks): boolean {
  return checks.clean && checks.law_untouched && checks.no_waiver && checks.intent;
}

export function removeSessionState(home: string, sessionId: unknown): void {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sessionId)) return;
  const data = join(home, '.claude', 'plugins', 'data');
  if (!existsSync(data)) return;
  for (const plugin of readdirSync(data)) rmSync(join(data, plugin, 'sessions', `${sessionId}.json`), { force: true });
}

function stop(message: string): never {
  process.stderr.write(`agent-trial: ${message}\n`);
  process.exit(2);
}

interface Options {
  arms: string[];
  counted: number;
  maxRuns: number;
  model: string;
  effort: string;
  keep: boolean;
  out: string;
}

function readOptions(argv: string[]): Options {
  const options: Options = { arms: ['edit', 'stop'], counted: 10, maxRuns: 30, model: 'sonnet', effort: 'medium', keep: false, out: join(ROOT, 'tests', 'agent', 'result.json') };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--keep') {
      options.keep = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) stop(`${flag} takes a value`);
    if (flag === '--arm') {
      if (!['edit', 'stop', 'both'].includes(value)) stop('--arm takes edit, stop or both');
      options.arms = value === 'both' ? ['edit', 'stop'] : [value];
    } else if (flag === '--counted' || flag === '--max-runs') {
      if (!/^[1-9][0-9]*$/.test(value)) stop(`${flag} takes a number of at least 1`);
      if (flag === '--counted') options.counted = Number(value);
      else options.maxRuns = Number(value);
    } else if (flag === '--model') options.model = value;
    else if (flag === '--effort') options.effort = value;
    else if (flag === '--out') options.out = value;
    else stop(`unknown flag ${flag}`);
  }
  return options;
}

function onPath(program: string): string[] {
  const found: string[] = [];
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    try {
      accessSync(join(dir, program), constants.X_OK);
      found.push(join(dir, program));
    } catch {}
  }
  return found;
}

function newest(dir: string): number {
  let latest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    latest = Math.max(latest, entry.isDirectory() ? newest(path) : statSync(path).mtimeMs);
  }
  return latest;
}

function armPlugin(folder: string, arm: string): string {
  const copy = join(folder, `plugin-${arm}`);
  cpSync(PLUGIN, copy, { recursive: true });
  const hooksFile = join(copy, 'hooks', 'hooks.json');
  const hooks = JSON.parse(readFileSync(hooksFile, 'utf8'));
  for (const event of Object.keys(hooks.hooks)) if (!ARM_HOOKS[arm]!.includes(event)) delete hooks.hooks[event];
  writeFileSync(hooksFile, JSON.stringify(hooks, null, 2) + '\n');
  return copy;
}

function points(text: string, max: number): string {
  return [...text].slice(0, max).join('');
}

const CALLS_LAWCHECK = /(?:^|[;&|(`\n{]|\$\()\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=\S*|command|exec|env|time|nohup)\s+)*(?:\S*\/)?lawcheck(?=$|[\s;&|)`}])/;

export function runsLawcheck(command: string): boolean {
  return CALLS_LAWCHECK.test(command);
}

export function errorOf(arm: string, transcript: Transcript, lines: LogLine[], files: Record<string, string | null>, timedOut: boolean): string | null {
  const plugins: any[] = transcript.init?.plugins ?? [];
  const servers: any[] = transcript.init?.mcp_servers ?? [];
  if (timedOut) return 'the 15 minutes';
  if (transcript.init === null || !plugins.some((p) => p?.name === 'lawcheck') || servers.length > 0) return 'an init event that lists no plugin named lawcheck, or an MCP server';
  if (transcript.result === null || transcript.result.is_error === true) return 'a result event that is missing or has is_error true';
  if (lines.some((line) => line.caller !== 'agent' && !ARM_EVENTS[arm]!.includes(line.caller))) return "a log line whose caller is not agent and not one of the arm's events";
  if (transcript.bashCommands.some(runsLawcheck) && !lines.some((line) => line.caller === 'agent')) return 'a Bash call that runs lawcheck while the log holds no agent line';
  if (Object.values(files).some((text) => text !== null && [...text].length > LARGEST_FILE)) return 'a final file of more than 50,000 characters';
  return null;
}

export function settleFolder(folder: string, error: string | null, keep: boolean): string | null {
  if (keep) return folder;
  if (error === null) {
    rmSync(folder, { recursive: true, force: true });
    return null;
  }
  for (const entry of readdirSync(folder)) {
    if (entry !== 'transcript.jsonl' && entry !== 'log.jsonl') rmSync(join(folder, entry), { recursive: true, force: true });
  }
  return folder;
}

export interface Transcript {
  init: any | null;
  result: any | null;
  bashCommands: string[];
}

export function readTranscript(text: string): Transcript {
  const out: Transcript = { init: null, result: null, bashCommands: [] };
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'system' && event.subtype === 'init' && out.init === null) out.init = event;
    if (event.type === 'result') out.result = event;
    if (event.type === 'assistant') {
      for (const part of event.message?.content ?? []) {
        if (part?.type === 'tool_use' && part.name === 'Bash' && typeof part.input?.command === 'string') out.bashCommands.push(part.input.command);
      }
    }
  }
  return out;
}

function runClaude(work: string, plugin: string, options: Options, env: NodeJS.ProcessEnv): Promise<{ stdout: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const args = [
      '-p',
      '--plugin-dir', plugin,
      '--setting-sources', 'project',
      '--model', options.model,
      '--effort', options.effort,
      '--permission-mode', 'dontAsk',
      '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash(lawcheck *),Bash(node *),Bash(git *),Bash(ls *),Bash(cat *)',
      '--output-format', 'stream-json',
      '--verbose',
      '--no-session-persistence',
    ];
    const child = spawn('claude', args, { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    const chunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {}
    }, LIMIT_MS);
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', () => {});
    child.on('error', () => {});
    child.on('close', () => {
      clearTimeout(timer);
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {}
      resolve({ stdout: Buffer.concat(chunks).toString('utf8'), timedOut });
    });
    child.stdin.end(readFileSync(TASK));
  });
}

function readLog(file: string): LogLine[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line));
}

function replacePaths(text: string, paths: string[]): string {
  let out = text;
  for (const path of [...new Set(paths)].sort((a, b) => b.length - a.length)) out = out.split(path).join('<work>');
  return out;
}

// The steps that the test names of tests/acceptance/agent-result.test.ts cite, in the order a run takes them: 1 a fresh repository from the fixture, 2 the arm's plugin and the run of claude, 3 the transcript saved, 4 errorOf says whether the run is an error, 5 breachOf says whether the arm's own hook reported the breach, 6 checksIn judges the files of a counted run, 7 the entry is built, 8 settleFolder keeps the transcript and the log of an error run and removes the rest.
async function oneRun(arm: string, number: number, options: Options, pathDirs: string[]): Promise<{ entry: RunEntry; model: string | null }> {
  const begin = Date.now();
  const folder = mkdtempSync(join(tmpdir(), 'lawcheck-trial-'));
  let error: string | null = null;
  try {
    const work = makeRepository(folder);
    const bin = join(folder, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'lawcheck'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(SHIM)} "$@"\n`, { mode: 0o755 });
    const log = join(folder, 'log.jsonl');
    const plugin = armPlugin(folder, arm);
    const env: NodeJS.ProcessEnv = {
      HOME: process.env.HOME,
      USER: process.env.USER,
      LANG: process.env.LANG,
      TERM: process.env.TERM,
      PATH: [bin, ...pathDirs].join(delimiter),
      LAWCHECK_TRIAL_LOG: log,
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    const { stdout, timedOut } = await runClaude(work, plugin, options, env);
    writeFileSync(join(folder, 'transcript.jsonl'), stdout);
    const transcript = readTranscript(stdout);
    if (process.env.HOME) removeSessionState(process.env.HOME, transcript.init?.session_id);
    const lines = readLog(log);
    const files = filesOf(work);
    error = errorOf(arm, transcript, lines, files, timedOut);
    const breach = breachOf(lines, arm);
    const counts = error === null && breach;
    const checks = counts ? await checksIn(work) : null;
    const reply = typeof transcript.result?.result === 'string' ? transcript.result.result : '';
    const real = (path: string) => {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    };
    const entry: RunEntry = {
      run: number,
      error,
      breach,
      fixed: checks === null ? null : isFixed(checks),
      checks,
      log: lines,
      files,
      seconds: Math.round((Date.now() - begin) / 1000),
      reply: replacePaths(points(reply, 300), [work, real(work), folder, real(folder)]),
    };
    return { entry, model: typeof transcript.init?.model === 'string' ? transcript.init.model : null };
  } finally {
    const kept = settleFolder(folder, error, options.keep);
    if (kept !== null) process.stdout.write(`kept ${kept}\n`);
  }
}

function describe(arm: string, entry: RunEntry): string {
  if (entry.error !== null) return `${arm} run ${entry.run}: error, ${entry.error} (${entry.seconds} s)`;
  if (!entry.breach) return `${arm} run ${entry.run}: no breach, not counted (${entry.seconds} s)`;
  const failed = Object.entries(entry.checks!).filter(([, ok]) => !ok).map(([name]) => name);
  return `${arm} run ${entry.run}: breach, ${entry.fixed ? 'fixed' : `not fixed (${failed.join(', ')})`} (${entry.seconds} s)`;
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  if (!existsSync(CLI) || statSync(CLI).mtimeMs < newest(join(ROOT, 'src'))) stop('build first, in the dev container: npm run build');
  const claude = onPath('claude')[0];
  if (claude === undefined) stop('claude is not on the PATH');
  const pathDirs = [dirname(process.execPath), ...onPath('git').map(dirname), dirname(claude)].filter((dir, i, all) => all.indexOf(dir) === i);
  const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim();
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const dirty = gitIn(ROOT, ['status', '--porcelain', '--', 'src']).trim() !== '';
  const commit = gitIn(ROOT, ['rev-parse', 'HEAD']).trim() + (dirty ? '-dirty' : '');
  let model: string | null = null;
  const arms: Record<string, { runs: number; counted: number; fixed: number; list: RunEntry[] }> = {};
  for (const arm of options.arms) {
    const record = { runs: 0, counted: 0, fixed: 0, list: [] as RunEntry[] };
    arms[arm] = record;
    while (record.counted < options.counted && record.runs < options.maxRuns) {
      const { entry, model: seen } = await oneRun(arm, record.runs + 1, options, pathDirs);
      model ??= seen;
      record.runs++;
      record.list.push(entry);
      if (entry.error === null && entry.breach) record.counted++;
      if (entry.fixed === true) record.fixed++;
      process.stdout.write(describe(arm, entry) + '\n');
    }
    const passes = record.counted === options.counted && record.fixed * 10 >= record.counted * 8;
    process.stdout.write(`${arm}: ${record.runs} runs, ${record.counted} counted, ${record.fixed} fixed: ${passes ? 'pass' : 'fail'}\n`);
  }
  const result = {
    schema: 'lawcheck-agent-trial/0',
    date: new Date().toISOString().slice(0, 10),
    claude_code: version,
    model,
    effort: options.effort,
    lawcheck: manifest.version,
    lawcheck_commit: commit,
    arms,
  };
  writeFileSync(options.out, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(`written to ${options.out}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => stop(String(error?.message ?? error).split('\n')[0]!));
}
