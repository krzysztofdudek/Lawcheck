import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { startTool } from '../harness/start.ts';
import { CODEX } from './codex.ts';
import type { Host } from './codex.ts';
import { COPILOT } from './copilot.ts';
import { breachOf, checksIn, CLI, GIT_IDENTITY, gitIn, isFixed, makeRepository, newest, onPath, points, readLog, replacePaths, ROOT, runsLawcheck, settleFolder, stop } from './run.ts';
import type { Checks, LogLine } from './run.ts';

export const FILM = join(ROOT, 'film', 'fixture');
const SHIM = join(ROOT, 'tests', 'harness', 'agent-shim.mjs');
const LIMIT_SHIM = join(ROOT, 'tests', 'agent', 'limit-shim.mjs');
const LIMIT_MS = 15 * 60 * 1000;
const LARGEST_FILE = 50000;
const HOSTS: Record<string, Host> = { codex: CODEX, copilot: COPILOT };
// A session the model's endpoint refused ends the trial, so a refused endpoint spends no further runs.
const REFUSED = 'an error of the agent: ';
let refused: string | null = null;

// The prompt of the film's sessions, as film/record.mjs on the branch film gives it.
export const PROMPT = 'Add a loyalty discount in src/core: a customer with more than five orders gets ten percent off. Return the new total and a message that shows the saved amount as money, the way the receipts do.';

export interface Arm {
  law: boolean;
  events: string[] | null;
  fails: boolean;
  counted: boolean;
  target: number;
  most: number;
}

// The sizes of the owner's ruling proby-wtyczek-oszczednie, about 40 sessions a host; each threshold is the design's, scaled to them.
export const ARMS: Record<string, Arm> = {
  none: { law: false, events: null, fails: false, counted: false, target: 10, most: 15 },
  start: { law: true, events: ['session-start', 'prompt', 'edit', 'stop'], fails: false, counted: false, target: 10, most: 15 },
  edit: { law: true, events: ['edit'], fails: false, counted: true, target: 5, most: 15 },
  stop: { law: true, events: ['prompt', 'stop'], fails: false, counted: true, target: 5, most: 15 },
  limit: { law: true, events: ['prompt', 'stop'], fails: true, counted: false, target: 3, most: 6 },
};
export const START_CLEAN = 9;
export const FIXED = 4;
// The design's fallback: when fewer agents than this import the API code with no law, the film's shop gives the hooks alone too few breaches, so their arms run on the repository and task of the trial of Claude Code.
export const FEWEST_IMPORTS = 3;
export const FILM_REPOSITORY = 'film/fixture';
export const CLAUDE_REPOSITORY = 'tests/agent/fixture';
const TASK = join(ROOT, 'tests', 'agent', 'task.md');

export interface HostChecks {
  tests: boolean;
  check: boolean | null;
  law_untouched: boolean;
  no_waiver: boolean;
}

export interface HostEntry {
  run: number;
  error: string | null;
  breach: boolean;
  primed: boolean;
  imports: string[];
  stops: number;
  checks: HostChecks | Checks | null;
  clean: boolean | null;
  log: LogLine[];
  files: Record<string, string | null>;
  seconds: number;
  reply: string;
  relayed?: boolean;
}

export interface ArmRecord {
  repository: string;
  runs: number;
  sessions: number;
  counted: number;
  list: HostEntry[];
}

// The uses film/pilot.mjs counts, so that a session here counts an import of the API code the way the film's pilot does.
const USES = /\b(?:import|export)\b[^;"']*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\b(?:import|require)\s*\(\s*["']([^"']+)["']/g;

export function apiImports(files: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [path, text] of Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!path.startsWith('src/core/')) continue;
    for (const match of text.matchAll(USES)) {
      const specifier = match[1] ?? match[2] ?? match[3]!;
      if (specifier.split('/').includes('api')) found.push(`${path}:${text.slice(0, match.index).split('\n').length}`);
    }
  }
  return found;
}

export function repositoryFor(name: string, arms: Record<string, ArmRecord>): string {
  if (!ARMS[name]!.counted) return FILM_REPOSITORY;
  const none = arms.none?.list.filter((entry) => entry.error === null) ?? [];
  return none.length > 0 && none.filter((entry) => entry.imports.length > 0).length < FEWEST_IMPORTS ? CLAUDE_REPOSITORY : FILM_REPOSITORY;
}

export function breachIn(repository: string, log: LogLine[], arm: string): boolean {
  return repository === CLAUDE_REPOSITORY ? breachOf(log, arm) : hostBreach(log, arm);
}

export function hostBreach(log: LogLine[], arm: string): boolean {
  const events = ARMS[arm]!.events ?? [];
  return log.some((line) => events.includes(line.caller) && line.exit === 1 && line.errors.some((error) => error.startsWith('src/core/') && error.includes('error[forbidden-use]')));
}

export function stopsOf(log: LogLine[]): number {
  return log.filter((line) => line.caller === 'stop').length;
}

export function makeFilmRepository(folder: string, law: boolean): string {
  const seed = join(folder, 'seed');
  cpSync(join(FILM, 'shop'), seed, { recursive: true });
  if (law) {
    mkdirSync(join(seed, '.lawcheck'));
    cpSync(join(FILM, 'law', 'law.yaml'), join(seed, '.lawcheck', 'law.yaml'));
  }
  gitIn(seed, ['init', '-q', '-b', 'main']);
  gitIn(seed, ['add', '-A']);
  gitIn(seed, ['commit', '-q', '-m', 'shop']);
  gitIn(folder, ['clone', '-q', '--bare', seed, 'origin.git']);
  gitIn(folder, ['clone', '-q', 'origin.git', 'shop']);
  rmSync(seed, { recursive: true, force: true });
  const work = join(folder, 'shop');
  gitIn(work, ['checkout', '-q', '-b', 'loyalty-discount']);
  return work;
}

function changed(work: string): string[] {
  const listed = [
    ...gitIn(work, ['diff', '-z', '--name-only', '--no-renames', 'origin/main', '--']).split('\0'),
    ...gitIn(work, ['ls-files', '-z', '--others', '--exclude-standard']).split('\0'),
  ];
  return [...new Set(listed.filter((path) => path !== ''))].sort();
}

export function filmFilesOf(work: string): Record<string, string | null> {
  const files: Record<string, string | null> = {};
  for (const path of changed(work)) {
    const full = join(work, path);
    files[path] = existsSync(full) && statSync(full).isFile() ? readFileSync(full, 'utf8') : null;
  }
  return files;
}

function allSource(work: string, files: Record<string, string | null>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of gitIn(work, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0')) {
    if (path === '' || !path.startsWith('src/core/')) continue;
    const full = join(work, path);
    if (existsSync(full) && statSync(full).isFile()) out[path] = readFileSync(full, 'utf8');
  }
  for (const [path, text] of Object.entries(files)) if (text !== null && path.startsWith('src/core/')) out[path] = text;
  return out;
}

export async function filmChecksIn(work: string, law: boolean): Promise<HostChecks> {
  const env = { ...process.env, ...GIT_IDENTITY };
  delete env.LAWCHECK_BASE;
  const tests = spawnSync('npm', ['test'], { cwd: work, env, timeout: 120000, killSignal: 'SIGKILL', stdio: 'ignore' }).status === 0;
  const check = law ? (await startTool(work, ['check', '--base', 'origin/main'], env).ended).code === 0 : null;
  const paths = changed(work);
  const lawUntouched = !paths.some((path) => path.startsWith('.lawcheck/'));
  const noWaiver = !paths.some((path) => {
    const full = join(work, path);
    return existsSync(full) && statSync(full).isFile() && readFileSync(full, 'utf8').includes('lawcheck-waive');
  });
  return { tests, check, law_untouched: lawUntouched, no_waiver: noWaiver };
}

export function isClean(checks: HostChecks): boolean {
  return checks.tests && checks.check !== false && checks.law_untouched && checks.no_waiver;
}

export function hostErrorOf(arm: string, session: { completed: boolean; errors: string[]; shell: string[] }, lines: LogLine[], files: Record<string, string | null>, timedOut: boolean, code: number | null): string | null {
  const events = ARMS[arm]!.events ?? [];
  if (timedOut) return 'the 15 minutes';
  if (session.errors.length > 0) return `an error of the agent: ${points(session.errors[0]!, 200)}`;
  if (code !== 0 || !session.completed) return 'a session that did not end with a completed turn';
  if (lines.some((line) => line.caller !== 'agent' && !events.includes(line.caller))) return "a log line whose caller is not agent and not one of the arm's events";
  if (session.shell.some(runsLawcheck) && !lines.some((line) => line.caller === 'agent')) return 'a shell call that runs lawcheck while the log holds no agent line';
  if (Object.values(files).some((text) => text !== null && [...text].length > LARGEST_FILE)) return 'a final file of more than 50,000 characters';
  return null;
}

export interface Verdict {
  passes: boolean;
  lines: string[];
}

// 'pass' or 'fail' once the sessions so far settle the arm's threshold whatever the rest would do, else 'open'.
export function armState(name: string, record: ArmRecord): 'pass' | 'fail' | 'open' {
  const arm = ARMS[name]!;
  const good = record.list.filter((entry) => entry.error === null);
  const left = arm.most - record.runs;
  if (name === 'none') return good.length >= arm.target ? 'pass' : good.length + left < arm.target ? 'fail' : 'open';
  if (arm.counted) {
    const counted = good.filter((entry) => entry.breach);
    const fixed = counted.filter((entry) => entry.clean === true).length;
    if (counted.length - fixed > arm.target - FIXED) return 'fail';
    if (fixed >= FIXED) return 'pass';
    return fixed + left < FIXED ? 'fail' : 'open';
  }
  const bad = name === 'start' ? good.filter((entry) => !entry.primed || entry.imports.length > 0).length : good.filter((entry) => entry.stops !== 4 || entry.relayed === false).length;
  const unclean = name === 'start' ? good.filter((entry) => entry.clean !== true).length : 0;
  if (bad > 0 || (name === 'start' && unclean > arm.target - START_CLEAN)) return 'fail';
  if (good.length >= arm.target) return 'pass';
  return good.length + left < arm.target ? 'fail' : 'open';
}

// The arms that prove a host's plugin. For Codex, the owner's ruling codex-dowod: the agent broke no law in the arms of a hook alone, so the plugin stands on the whole plugin and the three returns in real sessions, and on a test with a planted breach for the check at the end of a turn.
// For Copilot CLI, the owner's ruling copilot-dowod, given under his night mandate: the agent wrote every file with a shell command, so the edit hook never ran a check and the arms of a hook alone found no breach; the plugin stands on the same three arms, and tests 960 to 965 plant the breaches for the check after an edit and at the end of a turn.
export const PROOF: Record<string, string[]> = { codex: ['none', 'start', 'limit'], copilot: ['none', 'start', 'limit'] };

export function verdictOf(arms: Record<string, ArmRecord>, required: string[] = Object.keys(ARMS)): Verdict {
  const lines: string[] = [];
  let passes = true;
  let judged = true;
  const say = (ok: boolean, text: string) => {
    lines.push(`${ok ? 'pass' : 'fail'}${judged ? '' : ', not required'}: ${text}`);
    if (!ok && judged) passes = false;
  };
  for (const name of Object.keys(ARMS)) {
    judged = required.includes(name);
    const record = arms[name];
    if (record === undefined) {
      if (!judged) continue;
      say(false, `${name}: the arm did not run`);
      continue;
    }
    const arm = ARMS[name]!;
    const good = record.list.filter((entry) => entry.error === null);
    if (name === 'none') {
      lines.push(`none: ${good.filter((entry) => entry.imports.length > 0).length} of ${good.length} sessions import the API code into src/core`);
      say(good.length === arm.target, `none: ${good.length} of ${arm.target} sessions ran`);
    } else if (name === 'start') {
      say(good.length === arm.target, `start: ${good.length} of ${arm.target} sessions ran`);
      say(good.every((entry) => entry.primed), `start: the law reached the agent in ${good.filter((entry) => entry.primed).length} of ${good.length}`);
      say(good.every((entry) => entry.imports.length === 0), `start: ${good.filter((entry) => entry.imports.length > 0).length} of ${good.length} end with an import of the API code in src/core`);
      say(good.filter((entry) => entry.clean === true).length >= START_CLEAN, `start: ${good.filter((entry) => entry.clean === true).length} of ${good.length} end clean, ${START_CLEAN} needed`);
    } else if (arm.counted) {
      const counted = good.filter((entry) => entry.breach);
      const fixed = counted.filter((entry) => entry.clean === true).length;
      say(armState(name, record) === 'pass', `${name}: ${fixed} of ${counted.length} counted sessions fixed in ${record.runs} runs; ${FIXED} fixed needed, with at most ${arm.target - FIXED} counted and not fixed, in at most ${arm.most} runs`);
    } else {
      say(good.length === arm.target, `${name}: ${good.length} of ${arm.target} sessions ran`);
      say(good.every((entry) => entry.stops === 4), `${name}: the agent went back exactly three times and the session ended in ${good.filter((entry) => entry.stops === 4).length} of ${good.length}`);
      const told = good.filter((entry) => entry.relayed !== undefined);
      if (told.length > 0) say(told.every((entry) => entry.relayed), `${name}: the agent told the user that the check still fails in ${told.filter((entry) => entry.relayed).length} of ${told.length}`);
    }
  }
  return { passes, lines };
}

interface Options {
  host: Host;
  arms: string[];
  model: string;
  answeredBy: string | null;
  jobs: number;
  keep: boolean;
  out: string;
}

function readOptions(argv: string[]): Options {
  const options: Options = { host: CODEX, arms: Object.keys(ARMS), model: '', answeredBy: null, jobs: 1, keep: false, out: '' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--keep') {
      options.keep = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) stop(`${flag} takes a value`);
    if (flag === '--host') {
      if (!Object.hasOwn(HOSTS, value)) stop(`--host takes claude-code or ${Object.keys(HOSTS).join(', ')}`);
      options.host = HOSTS[value]!;
    } else if (flag === '--arm') {
      const arms = value.split(',');
      if (arms.some((arm) => !Object.hasOwn(ARMS, arm))) stop(`--arm takes ${Object.keys(ARMS).join(', ')}, or several joined by commas`);
      options.arms = arms;
    } else if (flag === '--jobs') {
      if (!/^[1-4]$/.test(value)) stop('--jobs takes 1 to 4');
      options.jobs = Number(value);
    } else if (flag === '--model') options.model = value;
    else if (flag === '--answered-by') options.answeredBy = value;
    else if (flag === '--out') options.out = value;
    else stop(`unknown flag ${flag}`);
  }
  if (options.model === '') options.model = options.host.model;
  if (options.out === '') options.out = join(ROOT, 'tests', 'agent', `result-${options.host.name}.json`);
  return options;
}

function marketFor(folder: string, host: Host, arm: Arm): string {
  const market = join(folder, 'market');
  mkdirSync(join(market, '.claude-plugin'), { recursive: true });
  cpSync(join(ROOT, '.claude-plugin', 'marketplace.json'), join(market, '.claude-plugin', 'marketplace.json'));
  cpSync(join(ROOT, 'plugin'), join(market, 'plugin'), { recursive: true });
  const file = join(market, 'plugin', 'hooks', host.hooks);
  const hooks = JSON.parse(readFileSync(file, 'utf8'));
  const kept = (arm.events ?? []).map((event) => host.events[event]);
  for (const name of Object.keys(hooks.hooks)) if (!kept.includes(name)) delete hooks.hooks[name];
  writeFileSync(file, JSON.stringify(hooks, null, 2) + '\n');
  return market;
}

function runSession(host: Host, work: string, env: NodeJS.ProcessEnv, model: string, prompt: string): Promise<{ stdout: string; timedOut: boolean; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(host.program, host.args(prompt, model), { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {}
      resolve({ stdout: Buffer.concat(chunks).toString('utf8'), timedOut, code });
    });
  });
}

async function oneRun(options: Options, name: string, number: number, pathDirs: string[], repository: string): Promise<HostEntry> {
  const arm = ARMS[name]!;
  const claude = repository === CLAUDE_REPOSITORY;
  const begin = Date.now();
  const folder = mkdtempSync(join(tmpdir(), 'lawcheck-trial-'));
  let error: string | null = null;
  try {
    const work = claude ? makeRepository(folder) : makeFilmRepository(folder, arm.law);
    const bin = join(folder, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'lawcheck'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(arm.fails ? LIMIT_SHIM : SHIM)} "$@"\n`, { mode: 0o755 });
    const log = join(folder, 'log.jsonl');
    const home = join(folder, 'home');
    mkdirSync(home);
    const env: NodeJS.ProcessEnv = {
      USER: process.env.USER,
      LANG: process.env.LANG ?? 'C.UTF-8',
      TERM: process.env.TERM,
      PATH: [bin, ...pathDirs].join(delimiter),
      LAWCHECK_TRIAL_LOG: log,
      LAWCHECK_TRIAL_API_KEY: process.env.LAWCHECK_TRIAL_API_KEY,
      ...options.host.env(home, options.model),
    };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    options.host.install(home, arm.events === null ? '' : marketFor(folder, options.host, arm), env);
    const { stdout, timedOut, code } = await runSession(options.host, work, env, options.model, claude ? readFileSync(TASK, 'utf8').trim() : PROMPT);
    writeFileSync(join(folder, 'transcript.jsonl'), stdout);
    const session = options.host.read(stdout, home);
    const lines = readLog(log);
    const files = filmFilesOf(work);
    error = hostErrorOf(name, session, lines, files, timedOut, code);
    const checks = error === null ? (claude ? await checksIn(work) : await filmChecksIn(work, arm.law)) : null;
    const real = (path: string) => {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    };
    return {
      run: number,
      error,
      breach: breachIn(repository, lines, name),
      primed: session.primed,
      imports: apiImports(allSource(work, files)),
      stops: stopsOf(lines),
      checks,
      clean: checks === null ? null : 'intent' in checks ? isFixed(checks) : isClean(checks),
      log: lines,
      files,
      seconds: Math.round((Date.now() - begin) / 1000),
      reply: replacePaths(points(session.reply, 300), [work, real(work), folder, real(folder)]),
      ...(options.host.relays === undefined || name !== 'limit' ? {} : { relayed: session.reply.toLowerCase().includes(options.host.relays) }),
    };
  } catch (thrown) {
    error = `the run could not start: ${points(String((thrown as Error)?.message ?? thrown).split('\n')[0]!, 200)}`;
    return { run: number, error, breach: false, primed: false, imports: [], stops: 0, checks: null, clean: null, log: [], files: {}, seconds: Math.round((Date.now() - begin) / 1000), reply: '' };
  } finally {
    const kept = settleFolder(folder, error, options.keep);
    if (kept !== null) process.stdout.write(`kept ${kept}\n`);
  }
}

function describe(name: string, entry: HostEntry): string {
  const what = entry.error !== null ? `error, ${entry.error}` : `${entry.breach ? 'breach' : 'no breach'}, ${entry.imports.length > 0 ? `import at ${entry.imports[0]}` : 'no import'}, ${entry.primed ? 'primed' : 'not primed'}, ${entry.stops} stops, ${entry.clean ? 'clean' : `not clean (${Object.entries(entry.checks ?? {}).filter(([, ok]) => ok === false).map(([key]) => key).join(', ')})`}`;
  return `${name} run ${entry.run}: ${what} (${entry.seconds} s)`;
}

async function runArm(options: Options, name: string, pathDirs: string[], kept: ArmRecord | undefined, repository: string, save: (record: ArmRecord) => void): Promise<ArmRecord> {
  const arm = ARMS[name]!;
  const record: ArmRecord = kept === undefined ? { repository, runs: 0, sessions: 0, counted: 0, list: [] } : { ...kept, list: [...kept.list] };
  const done = () => (arm.counted ? record.counted : record.sessions);
  let started = record.runs;
  let running = 0;
  await new Promise<void>((finish) => {
    const launch = () => {
      while (refused === null && running < options.jobs && started < arm.most && done() + running < arm.target && armState(name, record) === 'open') {
        const number = ++started;
        running++;
        void oneRun(options, name, number, pathDirs, record.repository).then((entry) => {
          running--;
          record.runs++;
          record.list.push(entry);
          if (entry.error === null) record.sessions++;
          if (entry.error === null && entry.breach) record.counted++;
          if (entry.error?.startsWith(REFUSED)) refused ??= entry.error;
          record.list.sort((a, b) => a.run - b.run);
          save(record);
          process.stdout.write(describe(name, entry) + '\n');
          launch();
        });
      }
      if (running === 0) finish();
    };
    launch();
  });
  record.list.sort((a, b) => a.run - b.run);
  return record;
}

export async function hostTrial(argv: string[]): Promise<void> {
  const options = readOptions(argv);
  if (!existsSync(CLI) || statSync(CLI).mtimeMs < newest(join(ROOT, 'src'))) stop('build first, in the dev container: npm run build');
  const program = onPath(options.host.program)[0];
  if (program === undefined) stop(`${options.host.program} is not on the PATH`);
  const pathDirs = [dirname(process.execPath), ...onPath('git').map(dirname), ...onPath('npm').map(dirname), dirname(program)].filter((dir, i, all) => all.indexOf(dir) === i);
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const dirty = gitIn(ROOT, ['status', '--porcelain', '--', 'src', 'plugin']).trim() !== '';
  const commit = gitIn(ROOT, ['rev-parse', 'HEAD']).trim() + (dirty ? '-dirty' : '');
  const previous = existsSync(options.out) ? JSON.parse(readFileSync(options.out, 'utf8')) : null;
  const arms: Record<string, ArmRecord> = previous !== null && sameCode(previous.lawcheck_commit, commit) ? Object.fromEntries(Object.entries(previous.arms as Record<string, ArmRecord>).map(([name, record]) => [name, { repository: FILM_REPOSITORY, ...record }])) : {};
  const agent = options.host.version(process.env);
  const write = () => {
    const verdict = verdictOf(arms, PROOF[options.host.name]);
    writeFileSync(options.out, JSON.stringify(resultOf(options, agent, manifest.version, commit, arms, verdict.passes), null, 2) + '\n');
    return verdict;
  };
  for (const name of options.arms) {
    arms[name] = await runArm(options, name, pathDirs, arms[name], arms[name]?.repository ?? repositoryFor(name, arms), (record) => {
      arms[name] = record;
      write();
    });
    const record = arms[name]!;
    process.stdout.write(`${name}: ${record.runs} runs, ${record.sessions} sessions, ${record.counted} counted, ${armState(name, record)}\n`);
    if (refused !== null) stop(`the trial stopped after ${name} run ${record.runs}: ${refused}`);
  }
  const verdict = write();
  for (const line of verdict.lines) process.stdout.write(`${line}\n`);
  process.stdout.write(`${verdict.passes ? 'pass' : 'fail'}, written to ${options.out}\n`);
}

// A session of an earlier commit counts when Lawcheck and its plugin are the same at both, so a change to the trial's own code runs no session twice.
function sameCode(before: unknown, now: string): boolean {
  if (typeof before !== 'string' || before.endsWith('-dirty') || now.endsWith('-dirty')) return before === now;
  return spawnSync('git', ['diff', '--quiet', before, now, '--', 'src', 'plugin'], { cwd: ROOT }).status === 0;
}

function resultOf(options: Options, agent: string, version: string, commit: string, arms: Record<string, ArmRecord>, passes: boolean) {
  return {
    schema: 'lawcheck-agent-trial-host/0',
    host: options.host.name,
    date: new Date().toISOString().slice(0, 10),
    agent,
    model: options.model,
    answered_by: options.answeredBy,
    lawcheck: version,
    lawcheck_commit: commit,
    prompt: PROMPT,
    passes,
    arms: Object.fromEntries(Object.keys(ARMS).filter((name) => arms[name] !== undefined).map((name) => [name, arms[name]])),
  };
}
