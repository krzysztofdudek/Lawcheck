import type { ReviewerConfig } from '../config.js';
import { findProgram, variableOf } from '../programs.js';
import type { Env, Provider } from './index.js';
import { plainOutput, programProvider } from './program.js';
import type { Prepared } from './program.js';

// The VS Code Copilot extension puts a program named copilot on PATH that only asks, interactively, to install the CLI.
const EXTENSION_STUB = /github\.copilot-chat[\\/]copilotCli/i;
// --available-tools offers only the tools it names; a name no tool has leaves the model none, while an empty value is ignored.
export const NO_TOOL = 'lawcheck-offers-no-tool';

export function copilotArguments(model: string | null, servers: string[] = []): string[] {
  return [
    '--silent',
    '--no-ask-user',
    '--no-custom-instructions',
    '--disable-builtin-mcps',
    ...servers.flatMap((name) => ['--disable-mcp-server', name]),
    `--available-tools=${NO_TOOL}`,
    '--disallow-temp-dir',
    '--no-auto-update',
    ...(model === null ? [] : ['--model', model]),
  ];
}

export function copilotServers(listed: string): Prepared {
  const fix = 'run copilot mcp list --json and fix what it says';
  let value: unknown;
  try {
    value = JSON.parse(listed);
  } catch {
    return { failure: 'copilot mcp list --json printed no JSON', resend: false, fix };
  }
  const servers = (value as { mcpServers?: unknown } | null)?.mcpServers;
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return { failure: 'copilot mcp list --json printed no mcpServers', resend: false, fix };
  return { args: Object.entries(servers as Record<string, { enabled?: unknown }>).filter(([, server]) => server?.enabled !== false).map(([name]) => name) };
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
    {
      name: 'copilot',
      args: (_aside, servers) => copilotArguments(config.model, servers),
      read: plainOutput('copilot'),
      find: (e) => findCopilot(e),
      prepare: async (list) => {
        const listed = await list(['mcp', 'list', '--json']);
        if ('failure' in listed) return { failure: `copilot could not list its MCP servers: ${listed.failure}`, resend: false, fix: listed.fix };
        return copilotServers(listed.answer);
      },
    },
    env,
    config.timeout,
  );
}
