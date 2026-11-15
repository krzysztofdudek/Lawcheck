import type { ReviewerConfig } from '../config.js';
import { anthropic } from './anthropic.js';
import { claudeCode } from './claude-code.js';
import { openaiCompatible } from './openai-compatible.js';

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

export const KEY_SHOWN = '[key]';

const NAMED_ESCAPES: Record<string, string> = { '"': '\\"', '\\': '\\\\', '/': '\\/', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

// The key in any spelling JSON allows: each character as it is, as a \u escape, or by its short escape.
function spellings(key: string): RegExp {
  const parts = [...key].map((c) => {
    const units = [...Array(c.length).keys()]
      .map((i) => `\\\\u${[...c.charCodeAt(i).toString(16).padStart(4, '0')].map((d) => (/[a-f]/.test(d) ? `[${d}${d.toUpperCase()}]` : d)).join('')}`)
      .join('');
    const named = NAMED_ESCAPES[c];
    return `(?:${named === undefined ? '' : `${named.replace(/\\/g, '\\\\')}|`}${units}|${c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')})`;
  });
  return new RegExp(parts.join(''), 'g');
}

export function hidden(text: string, keys: string[]): string {
  return [...keys].sort((a, b) => b.length - a.length).reduce((out, key) => out.replace(spellings(key), KEY_SHOWN), text);
}

export function createProvider(config: ReviewerConfig, env: Env): Provider | null {
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
