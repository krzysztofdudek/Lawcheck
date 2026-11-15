import type { ReviewerConfig } from '../config.js';
import { anthropic } from './anthropic.js';
import { claudeCode } from './claude-code.js';
import { codex } from './codex.js';
import { copilotCli } from './copilot-cli.js';
import { geminiCli } from './gemini-cli.js';
import { google } from './google.js';
import { ollama } from './ollama.js';
import { openai } from './openai.js';
import { openaiCompatible } from './openai-compatible.js';
import { addKeys } from '../keys.js';

export type Resend = 'after-2s' | 'at-once' | false;

export type Asked = { answer: string } | { failure: string; resend: Resend };

export interface Provider {
  // The exact keys this provider sends or hands on, which Lawcheck writes as [key] wherever a reply shows them.
  keys: string[];
  ready(): string | null;
  ask(prompt: string): Promise<Asked>;
}

export type Env = Record<string, string | undefined>;

export function variable(env: Env, name: string): string | null {
  const value = env[name];
  return value === undefined || value === '' ? null : value;
}

export function headerProblem(name: string, value: string | null): string | null {
  return value !== null && /[^!-~]/.test(value) ? `${name} holds a character an HTTP header cannot carry` : null;
}

export function endpointOf(env: Env): { url: string } | { problem: string } | null {
  const value = variable(env, 'LAWCHECK_REVIEWER_ENDPOINT');
  if (value === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { problem: 'LAWCHECK_REVIEWER_ENDPOINT is no URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { problem: 'LAWCHECK_REVIEWER_ENDPOINT is no http: or https: address' };
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { problem: 'LAWCHECK_REVIEWER_ENDPOINT holds a user or a password; the key goes in LAWCHECK_REVIEWER_KEY' };
  }
  if (parsed.search !== '' || parsed.hash !== '' || /[?#]/.test(value)) {
    return { problem: 'LAWCHECK_REVIEWER_ENDPOINT holds a query or a fragment; it takes the base address alone' };
  }
  return { url: value.replace(/\/+$/, '') };
}

export interface Keyed {
  url: string;
  key: string;
}

export function ownKey(env: Env, provider: string, ownUrl: string, ownVariable: string): { problem: string | null; keyed: Keyed | null } {
  const endpoint = endpointOf(env);
  if (endpoint !== null && 'problem' in endpoint) return { problem: endpoint.problem, keyed: null };
  const keyName = endpoint === null && variable(env, ownVariable) !== null ? ownVariable : 'LAWCHECK_REVIEWER_KEY';
  const key = variable(env, keyName);
  if (key === null) {
    const problem =
      endpoint === null
        ? `${provider} needs a key in ${ownVariable} or LAWCHECK_REVIEWER_KEY`
        : `with LAWCHECK_REVIEWER_ENDPOINT set, ${provider} sends LAWCHECK_REVIEWER_KEY alone, and it is not set`;
    return { problem, keyed: null };
  }
  const problem = headerProblem(keyName, key);
  return { problem, keyed: problem === null ? { url: endpoint === null ? ownUrl : endpoint.url, key } : null };
}

export function createProvider(config: ReviewerConfig, env: Env): Provider | null {
  switch (config.provider) {
    case 'openai-compatible':
      return openaiCompatible(config, env);
    case 'anthropic':
      return anthropic(config, env);
    case 'openai':
      return openai(config, env);
    case 'google':
      return google(config, env);
    case 'ollama':
      return ollama(config, env);
    case 'claude-code':
      return claudeCode(config, env);
    case 'codex':
      return codex(config, env);
    case 'gemini-cli':
      return geminiCli(config, env);
    case 'copilot-cli':
      return copilotCli(config, env);
    default:
      return null;
  }
}

export function createProvider(config: ReviewerConfig, env: Env): Provider | null {
  const provider = created(config, env);
  if (provider !== null) addKeys(provider.keys);
  return provider;
}
