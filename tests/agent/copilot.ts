import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Host, Session } from './codex.ts';

// The first words of what lawcheck prime prints, which the session-start hook hands to the agent.
const PRIMER = 'Lawcheck checks this repository';
// Copilot CLI tells a model that has no such id in its catalog nothing of its tools, so the trial names a model of the catalog whose tools write files; the endpoint answers with the model of LAWCHECK_TRIAL_BASE_URL.
const MODEL_ID = 'claude-sonnet-4';

function copilotHome(home: string): string {
  return join(home, '.copilot');
}

function events(home: string): string[] {
  const dir = join(copilotHome(home), 'session-state');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((id) => join(dir, id, 'events.jsonl')).filter(existsSync).map((file) => readFileSync(file, 'utf8'));
}

function lines(text: string): any[] {
  const out: any[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line));
    } catch {}
  }
  return out;
}

export function readCopilot(stdout: string, transcripts: string[]): Session {
  const out: Session = { completed: false, errors: [], shell: [], reply: '', primed: false };
  for (const event of lines(stdout)) {
    const data = event.data ?? {};
    if (event.type === 'result' && event.exitCode === 0) out.completed = true;
    if (event.type === 'session.error') out.errors.push(String(data.message ?? 'session.error'));
    if (event.type === 'tool.execution_start' && data.toolName === 'bash' && typeof data.arguments?.command === 'string') out.shell.push(data.arguments.command);
    if (event.type === 'assistant.message' && typeof data.content === 'string' && data.content !== '') out.reply = data.content;
  }
  for (const event of transcripts.flatMap(lines)) {
    if (event.type !== 'hook.end') continue;
    const data = event.data ?? {};
    if (data.success === false) out.errors.push(`the ${data.hookType} hook failed`);
    if (data.hookType === 'sessionStart' && String(data.output?.additionalContext ?? '').includes(PRIMER)) out.primed = true;
  }
  return out;
}

function provider(model: string): NodeJS.ProcessEnv {
  const base = process.env.LAWCHECK_TRIAL_BASE_URL;
  if (base === undefined || base === '') return { COPILOT_GITHUB_TOKEN: process.env.COPILOT_GITHUB_TOKEN, COPILOT_MODEL: model };
  return { COPILOT_PROVIDER_BASE_URL: base, COPILOT_PROVIDER_API_KEY: process.env.LAWCHECK_TRIAL_API_KEY, COPILOT_PROVIDER_MODEL_ID: MODEL_ID, COPILOT_PROVIDER_WIRE_MODEL: model, COPILOT_MODEL: MODEL_ID };
}

export const COPILOT: Host = {
  name: 'copilot',
  program: 'copilot',
  hooks: 'copilot.json',
  model: 'gpt-4o',
  relays: 'still fail',
  events: { 'session-start': 'sessionStart', prompt: 'userPromptSubmitted', edit: 'postToolUse', stop: 'agentStop' },
  version(env) {
    return spawnSync('copilot', ['--version'], { encoding: 'utf8', env }).stdout.trim().split('\n')[0]!.replace(/\.$/, '');
  },
  env(home, model) {
    return { HOME: home, COPILOT_HOME: copilotHome(home), COPILOT_ALLOW_ALL: 'true', ...provider(model) };
  },
  install(home, market, env) {
    if (market === '') return;
    for (const args of [['plugin', 'marketplace', 'add', market], ['plugin', 'install', 'lawcheck@lawcheck-marketplace']]) {
      const result = spawnSync('copilot', args, { encoding: 'utf8', env, cwd: home });
      if (result.status !== 0) throw new Error(`copilot ${args.join(' ')} ended with ${result.status}: ${(result.stderr || result.stdout).trim().split('\n')[0]}`);
    }
  },
  args(prompt) {
    return ['-p', prompt, '--output-format', 'json', '--no-ask-user', '--disable-builtin-mcps'];
  },
  read(stdout, home) {
    return readCopilot(stdout, events(home));
  },
};
