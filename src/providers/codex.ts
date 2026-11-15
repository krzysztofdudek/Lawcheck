import type { ReviewerConfig } from '../config.js';
import type { Env, Provider } from './index.js';
import { plainOutput, programProvider } from './program.js';
import type { Prepared } from './program.js';

// codex reads the key of -c as a path split at every dot, quotes included, so only such names can be switched off one by one.
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

export function codexArguments(model: string | null, servers: string[] = []): string[] {
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
    ...servers.flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]),
    ...(model === null ? [] : ['--model', model]),
    '-',
  ];
}

export function codexServers(listed: string): Prepared {
  const fix = 'run codex mcp list --json and fix what it says';
  let value: unknown;
  try {
    value = JSON.parse(listed);
  } catch {
    return { failure: 'codex mcp list --json printed no JSON', resend: false, fix };
  }
  if (!Array.isArray(value)) return { failure: 'codex mcp list --json printed no list', resend: false, fix };
  const names: string[] = [];
  for (const server of value as { name?: unknown; enabled?: unknown }[]) {
    if (typeof server?.name !== 'string') return { failure: 'codex mcp list --json printed a server without a name', resend: false, fix };
    if (server.enabled === false) continue;
    if (!SERVER_NAME.test(server.name)) {
      return {
        failure: `codex would start the MCP server ${JSON.stringify(server.name)}, and a server whose name holds another character than a letter, a digit, _ or - cannot be switched off for one call`,
        resend: false,
        fix: `rename the server in ~/.codex/config.toml, or set enabled = false under [mcp_servers."${server.name}"]`,
      };
    }
    names.push(server.name);
  }
  return { args: names };
}

export function codex(config: ReviewerConfig, env: Env): Provider {
  return programProvider(
    {
      name: 'codex',
      args: (_aside, servers) => codexArguments(config.model, servers),
      read: plainOutput('codex'),
      prepare: async (list) => {
        const listed = await list(['mcp', 'list', '--json']);
        if ('failure' in listed) return { failure: `codex could not list its MCP servers: ${listed.failure}`, resend: false, fix: listed.fix };
        return codexServers(listed.answer);
      },
    },
    env,
    config.timeout,
  );
}
