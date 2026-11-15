import type { ReviewerConfig } from '../config.js';
import type { Asked, Env, Provider } from './index.js';
import { failure, programProvider } from './program.js';
import type { Ended } from './program.js';

export function claudeArguments(model: string | null): string[] {
  return [
    '--print',
    '--output-format',
    'json',
    ...(model === null ? [] : ['--model', model]),
    '--tools',
    '',
    '--disable-slash-commands',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--no-session-persistence',
  ];
}

export function readOutput(code: number | null, signal: string | null, stdout: string, stderr: string): Asked {
  const ended: Ended = { code, signal, stdout, stderr };
  let envelope: Record<string, unknown> | null = null;
  try {
    const value: unknown = JSON.parse(stdout.trim());
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) envelope = value as Record<string, unknown>;
  } catch {
    envelope = null;
  }
  const result = envelope !== null && typeof envelope.result === 'string' ? envelope.result : null;
  if (code !== 0 || envelope?.is_error === true) return failure('claude', ended, result);
  return { answer: envelope?.type === 'result' && result !== null ? result : stdout };
}

export function claudeCode(config: ReviewerConfig, env: Env): Provider {
  return programProvider(
    {
      name: 'claude',
      args: () => claudeArguments(config.model),
      read: ({ code, signal, stdout, stderr }) => readOutput(code, signal, stdout, stderr),
    },
    env,
    config.timeout,
  );
}
