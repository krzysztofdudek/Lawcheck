import type { ReviewerConfig } from '../config.js';
import { post } from './http.js';
import { endpointOf, headerProblem, variable } from './index.js';
import type { Env, Provider } from './index.js';

const OWN_ENDPOINT = 'https://api.anthropic.com/v1';

export function anthropic(config: ReviewerConfig, env: Env): Provider {
  const endpoint = endpointOf(env);
  const keyName = endpoint === null && variable(env, 'ANTHROPIC_API_KEY') !== null ? 'ANTHROPIC_API_KEY' : 'LAWCHECK_REVIEWER_KEY';
  const key = variable(env, keyName);
  return {
    ready() {
      if (endpoint !== null && 'problem' in endpoint) return endpoint.problem;
      if (key === null) {
        return endpoint === null
          ? 'anthropic needs a key in ANTHROPIC_API_KEY or LAWCHECK_REVIEWER_KEY'
          : 'with LAWCHECK_REVIEWER_ENDPOINT set, anthropic sends LAWCHECK_REVIEWER_KEY alone, and it is not set';
      }
      return headerProblem(keyName, key);
    },
    async ask(prompt) {
      if ((endpoint !== null && 'problem' in endpoint) || key === null) return { failure: 'anthropic has no valid endpoint and key', resend: false };
      const url = endpoint === null ? OWN_ENDPOINT : endpoint.url;
      const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      const body = {
        model: config.model,
        max_tokens: 8192,
        temperature: config.temperature,
        messages: [{ role: 'user', content: prompt }],
      };
      const posted = await post(`${url}/messages`, headers, body, config.timeout);
      if ('failure' in posted) return posted;
      const content = (posted.body as { content?: unknown } | null)?.content;
      if (!Array.isArray(content)) return { answer: '' };
      const texts = content
        .filter((item): item is { type: string; text: string } => typeof item === 'object' && item !== null && item.type === 'text' && typeof item.text === 'string')
        .map((item) => item.text);
      return { answer: texts.join('') };
    },
  };
}
