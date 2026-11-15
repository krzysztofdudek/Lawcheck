import type { ReviewerConfig } from '../config.js';
import type { Env, Provider } from './index.js';
import { plainOutput, programProvider } from './program.js';

export function codexArguments(model: string | null): string[] {
  return [
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--ephemeral',
    '--ignore-rules',
    '--color',
    'never',
    '--disable',
    'shell_tool',
    '--disable',
    'view_image',
    '--disable',
    'multi_agent',
    '--disable',
    'goals',
    '--disable',
    'hooks',
    '--disable',
    'plugins',
    '--disable',
    'apps',
    '-c',
    'web_search=disabled',
    ...(model === null ? [] : ['--model', model]),
    '-',
  ];
}

export function codex(config: ReviewerConfig, env: Env): Provider {
  return programProvider({ name: 'codex', args: () => codexArguments(config.model), read: plainOutput('codex') }, env, config.timeout);
}
