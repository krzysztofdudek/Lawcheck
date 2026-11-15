import type { ReviewerConfig } from '../config.js';
import { findProgram, variableOf } from '../programs.js';
import type { Env, Provider } from './index.js';
import { plainOutput, programProvider } from './program.js';

// The VS Code Copilot extension puts a program named copilot on PATH that only asks, interactively, to install the CLI.
const EXTENSION_STUB = /github\.copilot-chat[\\/]copilotCli/i;

export function copilotArguments(model: string | null): string[] {
  return [
    '--silent',
    '--no-ask-user',
    '--no-custom-instructions',
    '--disable-builtin-mcps',
    '--deny-tool',
    'shell',
    '--deny-tool',
    'write',
    '--deny-tool',
    'url',
    '--deny-tool',
    'memory',
    '--no-auto-update',
    ...(model === null ? [] : ['--model', model]),
  ];
}

export function findCopilot(env: Env, platform: NodeJS.Platform = process.platform): string | null {
  const separator = platform === 'win32' ? ';' : ':';
  const path = (variableOf(env, 'PATH', platform) ?? '')
    .split(separator)
    .filter((dir) => !EXTENSION_STUB.test(dir))
    .join(separator);
  const key = platform === 'win32' ? (Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH') : 'PATH';
  return findProgram('copilot', { ...env, [key]: path }, platform);
}

export function copilotCli(config: ReviewerConfig, env: Env): Provider {
  return programProvider(
    { name: 'copilot', args: () => copilotArguments(config.model), read: plainOutput('copilot'), find: (e) => findCopilot(e) },
    env,
    config.timeout,
  );
}
