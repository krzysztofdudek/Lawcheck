import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Session {
  completed: boolean;
  errors: string[];
  shell: string[];
  reply: string;
  primed: boolean;
}

export interface Host {
  name: string;
  program: string;
  hooks: string;
  events: Record<string, string>;
  version(env: NodeJS.ProcessEnv): string;
  install(home: string, market: string, env: NodeJS.ProcessEnv): void;
  args(prompt: string, model: string): string[];
  env(home: string): NodeJS.ProcessEnv;
  read(stdout: string, home: string): Session;
}

// Codex says this on every run with --dangerously-bypass-hook-trust, as an item of type error.
const TRUST_NOTICE = '`--dangerously-bypass-hook-trust` is enabled.';
// The first words of what lawcheck prime prints, which the session-start hook hands to the agent.
const PRIMER = 'Lawcheck checks this repository';

function codexHome(home: string): string {
  return join(home, '.codex');
}

function filesBelow(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? filesBelow(join(dir, entry.name)) : [join(dir, entry.name)]));
}

function provider(): string[] {
  const base = process.env.LAWCHECK_TRIAL_BASE_URL;
  if (base === undefined || base === '') return [];
  return ['-c', 'model_provider=trial', '-c', `model_providers.trial={name="trial",base_url=${JSON.stringify(base)},wire_api="responses",env_key="LAWCHECK_TRIAL_API_KEY"}`];
}

export function readCodex(stdout: string, rollouts: string[]): Session {
  const out: Session = { completed: false, errors: [], shell: [], reply: '', primed: false };
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'turn.completed') out.completed = true;
    if (event.type === 'turn.failed') out.errors.push(String(event.error?.message ?? 'turn.failed'));
    if (event.type === 'error') out.errors.push(String(event.message ?? 'error'));
    if (event.type !== 'item.completed') continue;
    const item = event.item ?? {};
    if (item.type === 'error' && typeof item.message === 'string' && !item.message.startsWith(TRUST_NOTICE)) out.errors.push(item.message);
    if (item.type === 'command_execution' && typeof item.command === 'string') out.shell.push(item.command);
    if (item.type === 'agent_message' && typeof item.text === 'string') out.reply = item.text;
  }
  out.primed = rollouts.some((text) => text.includes(PRIMER));
  return out;
}

export const CODEX: Host = {
  name: 'codex',
  program: 'codex',
  hooks: 'codex.json',
  events: { 'session-start': 'SessionStart', prompt: 'UserPromptSubmit', edit: 'PostToolUse', stop: 'Stop' },
  version(env) {
    return spawnSync('codex', ['--version'], { encoding: 'utf8', env }).stdout.trim();
  },
  env(home) {
    return { HOME: home, CODEX_HOME: codexHome(home) };
  },
  install(home, market, env) {
    const own = join(process.env.HOME ?? '', '.codex', 'auth.json');
    mkdirSync(codexHome(home), { recursive: true });
    if (provider().length === 0 && existsSync(own)) copyFileSync(own, join(codexHome(home), 'auth.json'));
    if (market === '') return;
    for (const args of [['plugin', 'marketplace', 'add', market], ['plugin', 'add', 'lawcheck@lawcheck-marketplace']]) {
      const result = spawnSync('codex', args, { encoding: 'utf8', env, cwd: home });
      if (result.status !== 0) throw new Error(`codex ${args.join(' ')} ended with ${result.status}: ${(result.stderr || result.stdout).trim().split('\n')[0]}`);
    }
  },
  args(prompt, model) {
    return ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust', '-m', model, ...provider(), prompt];
  },
  read(stdout, home) {
    const rollouts = filesBelow(join(codexHome(home), 'sessions')).filter((file) => file.endsWith('.jsonl')).map((file) => readFileSync(file, 'utf8'));
    return readCodex(stdout, rollouts);
  },
};
