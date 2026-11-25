import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const MARKETPLACE = 'krzysztofdudek/Lawcheck';
const PLUGIN = 'lawcheck@lawcheck-marketplace';
const COMMAND_MS = 180_000;
const APP_SERVER_MS = 60_000;
const MANIFESTS = { claude: '.claude-plugin/plugin.json', codex: '.codex-plugin/plugin.json', copilot: '.plugin/plugin.json' };

type Agent = keyof typeof MANIFESTS;
type Listed = { version?: string; enabled?: boolean; errors?: unknown[] };

const [name, checkout] = process.argv.slice(2);
if (name === undefined || !Object.hasOwn(MANIFESTS, name) || checkout === undefined) {
  console.error('usage: node tests/harness/agent-install.ts <claude|codex|copilot> <checkout whose plugin the agent must install>');
  process.exit(2);
}
const agent = name as Agent;
const expectedPlugin = resolve(checkout, 'plugin');
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const manifest = json(join(expectedPlugin, MANIFESTS[agent])) as { version: string; hooks?: string };
const handlers = json(join(expectedPlugin, manifest.hooks ?? 'hooks/hooks.json')).hooks as Record<string, unknown[]>;
const skills = readdirSync(join(expectedPlugin, 'skills')).filter((dir) => existsSync(join(expectedPlugin, 'skills', dir, 'SKILL.md'))).sort();
if (Object.keys(handlers).length === 0 || skills.length === 0) throw new Error(`${expectedPlugin} holds no hook or no skill for ${agent}, so there is nothing to check`);

const problems: string[] = [];
function same(what: string, found: unknown, expected: unknown): void {
  const ok = JSON.stringify(found) === JSON.stringify(expected);
  console.log(`${ok ? 'ok ' : 'RED'}  ${what}: ${JSON.stringify(found)}${ok ? '' : `, expected ${JSON.stringify(expected)}`}`);
  if (!ok) problems.push(what);
}

// A home of its own and nothing else of the environment, so no token or sign-in of the machine reaches the agent.
const home = mkdtempSync(join(tmpdir(), 'lawcheck-agent-'));
const project = join(home, 'project');
const env = { PATH: process.env.PATH, HOME: home };

function run(args: string[], cwd = project): string {
  console.log(`\n$ ${agent} ${args.join(' ')}`);
  const done = spawnSync(agent, args, { cwd, env, encoding: 'utf8', timeout: COMMAND_MS });
  process.stdout.write(done.stdout ?? '');
  process.stdout.write(done.stderr ?? '');
  if (done.status !== 0) throw new Error(`${agent} ${args.join(' ')} ended with ${done.error?.message ?? `exit ${done.status ?? done.signal}`}`);
  return done.stdout;
}

function listed(entry: Listed | undefined): void {
  same(`${agent} lists the plugin`, entry !== undefined, true);
  same('the version it lists', entry?.version, manifest.version);
  same('enabled', entry?.enabled, true);
  same('errors it reports for the plugin', entry?.errors ?? [], []);
}

function files(root: string, below = ''): string[] {
  return readdirSync(join(root, below)).flatMap((entry) => {
    const path = join(below, entry);
    return statSync(join(root, path)).isDirectory() ? files(root, path) : [path];
  });
}

function installed(root: string): void {
  const different = files(expectedPlugin).filter((path) => !existsSync(join(root, path)) || !readFileSync(join(root, path)).equals(readFileSync(join(expectedPlugin, path))));
  same(`files of plugin/ that are missing or different in ${root}`, different, []);
}

function claude(): void {
  run(['plugin', 'marketplace', 'add', MARKETPLACE]);
  run(['plugin', 'install', PLUGIN]);
  const entry = (JSON.parse(run(['plugin', 'list', '--json'])) as (Listed & { id: string; installPath: string })[]).find((p) => p.id === PLUGIN);
  listed(entry);
  const details = run(['plugin', 'details', PLUGIN]);
  const inventory = (part: string) => new RegExp(`^ *${part} \\(\\d+\\)(.*)$`, 'm').exec(details)?.[1]?.replace(/ {2}\(.*$/, '').split(',').map((s) => s.trim()).filter(Boolean).sort();
  // Claude Code installs a plugin whose hooks file names an event it does not know, exits 0 and drops that hook, so only this list shows it.
  same('hooks it lists', inventory('Hooks'), Object.keys(handlers).sort());
  same('skills it lists', inventory('Skills'), skills);
  if (entry !== undefined) installed(entry.installPath);
  for (const path of ['.', './plugin']) run(['plugin', 'validate', path], resolve(checkout!));
}

type CodexHook = { pluginId: string | null; eventName: string; command: string; enabled: boolean };
type CodexSkill = { pluginId: string | null; name: string; path: string; enabled: boolean };
type CodexLists = { hooks: { hooks: CodexHook[]; errors: unknown[]; warnings: unknown[] }[]; skills: { skills: CodexSkill[]; errors: unknown[] }[] };

// codex plugin has no command that lists hooks or skills; its app server answers both without a sign-in.
function appServer(): Promise<CodexLists> {
  console.log('\n$ codex app-server  (hooks/list, skills/list)');
  const server = spawn('codex', ['app-server'], { cwd: project, env, stdio: ['pipe', 'pipe', 'inherit'] });
  const send = (message: object) => server.stdin.write(`${JSON.stringify(message)}\n`);
  const answers: Partial<CodexLists> = {};
  let buffer = '';
  let deadline: NodeJS.Timeout | undefined;
  return new Promise<CodexLists>((done, fail) => {
    deadline = setTimeout(() => fail(new Error(`codex app-server gave no answer in ${APP_SERVER_MS} ms`)), APP_SERVER_MS);
    server.on('error', fail);
    server.on('close', (code) => fail(new Error(`codex app-server ended with exit ${code} before it answered`)));
    server.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      const lines = (buffer + chunk).split('\n');
      buffer = lines.pop()!;
      for (const line of lines) {
        const message = JSON.parse(line) as { id?: number; result?: { data: never }; error?: unknown };
        if (message.id === undefined) continue;
        if (message.result === undefined) return fail(new Error(`codex app-server refused request ${message.id}: ${JSON.stringify(message.error)}`));
        if (message.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'hooks/list', params: { cwds: [project] } });
          send({ id: 3, method: 'skills/list', params: { cwds: [project] } });
        } else answers[message.id === 2 ? 'hooks' : 'skills'] = message.result.data;
        if (answers.hooks && answers.skills) done(answers as CodexLists);
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'lawcheck-agent-install', version: manifest.version } } });
  }).finally(() => {
    clearTimeout(deadline);
    server.stdin.end();
    server.kill();
  });
}

async function codex(): Promise<void> {
  run(['plugin', 'marketplace', 'add', MARKETPLACE]);
  run(['plugin', 'add', PLUGIN]);
  listed((JSON.parse(run(['plugin', 'list', '--json'])) as { installed: (Listed & { pluginId: string })[] }).installed.find((p) => p.pluginId === PLUGIN));
  const answers = await appServer();
  const hooks = answers.hooks.flatMap((a) => a.hooks).filter((h) => h.pluginId === PLUGIN);
  const found = answers.skills.flatMap((a) => a.skills).filter((s) => s.pluginId === PLUGIN);
  for (const hook of hooks) console.log(`hook  ${hook.eventName}  enabled ${hook.enabled}  ${hook.command}`);
  for (const skill of found) console.log(`skill ${skill.name}  enabled ${skill.enabled}  ${skill.path}`);
  same('errors and warnings of hooks/list and skills/list', [...answers.hooks.flatMap((a) => [...a.errors, ...a.warnings]), ...answers.skills.flatMap((a) => a.errors)], []);
  const events = Object.entries(handlers).flatMap(([event, groups]) => (groups as { hooks: unknown[] }[]).flatMap((g) => g.hooks.map(() => event[0]!.toLowerCase() + event.slice(1))));
  same('hooks it lists', hooks.filter((h) => h.enabled).map((h) => h.eventName).sort(), events.sort());
  same('skills it lists', found.filter((s) => s.enabled).map((s) => s.name).sort(), skills.map((s) => `lawcheck:${s}`));
  if (found[0] !== undefined) installed(dirname(dirname(dirname(found[0].path))));
}

function copilot(): void {
  run(['plugin', 'marketplace', 'add', MARKETPLACE]);
  run(['plugin', 'install', PLUGIN]);
  listed((JSON.parse(run(['plugin', 'list', '--json'])) as (Listed & { name: string; marketplace: string })[]).find((p) => `${p.name}@${p.marketplace}` === PLUGIN));
  const found = (JSON.parse(run(['skill', 'list', '--json'])) as { name: string; source: string; path: string; enabled: boolean }[]).filter((s) => s.source === 'plugin');
  same('skills it lists', found.filter((s) => s.enabled).map((s) => s.name).sort(), skills);
  // Copilot CLI has no command that lists hooks outside a session, so the installed files are the only sight of them.
  if (found[0] !== undefined) installed(dirname(dirname(found[0].path)));
}

try {
  mkdirSync(project);
  run(['--version']);
  await { claude, codex, copilot }[agent]();
  if (problems.length > 0) {
    console.error(`\n${agent}: RED, ${problems.length} check(s) failed: ${problems.join('; ')}`);
    process.exitCode = 1;
  } else console.log(`\n${agent}: installed ${PLUGIN} ${manifest.version} from ${MARKETPLACE}, every check passed`);
} finally {
  rmSync(home, { recursive: true, force: true, maxRetries: 5 });
}
