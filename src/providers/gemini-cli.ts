import { join } from 'node:path';
import type { ReviewerConfig } from '../config.js';
import type { Env, Provider } from './index.js';
import { plainOutput, programProvider } from './program.js';

export const POLICY_FILE = 'no-tools.toml';
export const NO_TOOLS_POLICY = '[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n';
// An allow list that is present admits only the servers it names, and an empty name is refused at start.
export const NO_MCP_SERVER = 'lawcheck-allows-no-mcp-server';

export function geminiArguments(model: string | null, aside: string): string[] {
  return [
    '--output-format',
    'text',
    ...(model === null ? [] : ['--model', model]),
    '--skip-trust',
    '--approval-mode',
    'plan',
    '--extensions',
    'none',
    '--allowed-mcp-server-names',
    NO_MCP_SERVER,
    '--policy',
    join(aside, POLICY_FILE),
  ];
}

export function geminiCli(config: ReviewerConfig, env: Env): Provider {
  return programProvider(
    {
      name: 'gemini',
      args: (aside) => geminiArguments(config.model, aside!),
      read: plainOutput('gemini'),
      aside: { [POLICY_FILE]: NO_TOOLS_POLICY },
    },
    env,
    config.timeout,
  );
}
