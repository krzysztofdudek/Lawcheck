import type { ReviewerConfig } from '../config.js';
import { anthropic } from './anthropic.js';
import { claudeCode } from './claude-code.js';
import { openaiCompatible } from './openai-compatible.js';

export type Resend = 'after-2s' | 'at-once' | false;

export type Asked = { answer: string } | { failure: string; resend: Resend };

export interface Provider {
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

export const KEY_SHOWN = '[key]';

// The keys a provider hands on: the one in its request header, or, for a program, every key variable the program gets.
function keysOf(config: ReviewerConfig, env: Env): string[] {
  const names =
    config.provider === 'anthropic'
      ? [endpointOf(env) === null && variable(env, 'ANTHROPIC_API_KEY') !== null ? 'ANTHROPIC_API_KEY' : 'LAWCHECK_REVIEWER_KEY']
      : config.provider === 'claude-code'
        ? ['LAWCHECK_REVIEWER_KEY', 'ANTHROPIC_API_KEY']
        : ['LAWCHECK_REVIEWER_KEY'];
  return names.map((name) => variable(env, name)).filter((key): key is string => key !== null).sort((a, b) => b.length - a.length);
}

export function hidden(text: string, keys: string[]): string {
  return keys.reduce((out, key) => out.split(key).join(KEY_SHOWN), text);
}

function masked(provider: Provider, keys: string[]): Provider {
  if (keys.length === 0) return provider;
  return {
    ready: () => provider.ready(),
    async ask(prompt) {
      const asked = await provider.ask(prompt);
      return 'answer' in asked ? { answer: hidden(asked.answer, keys) } : { ...asked, failure: hidden(asked.failure, keys) };
    },
  };
}

function created(config: ReviewerConfig, env: Env): Provider | null {
  switch (config.provider) {
    case 'openai-compatible':
      return openaiCompatible(config, env);
    case 'anthropic':
      return anthropic(config, env);
    case 'claude-code':
      return claudeCode(config, env);
    default:
      return null;
  }
}

export function createProvider(config: ReviewerConfig, env: Env): Provider | null {
  const provider = created(config, env);
  return provider === null ? null : masked(provider, keysOf(config, env));
}
