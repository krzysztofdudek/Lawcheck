import type { ReviewerConfig } from '../config.js';
import { post } from './http.js';
import { ownKey } from './index.js';
import type { Env, Provider } from './index.js';

const OWN_ENDPOINT = 'https://api.anthropic.com/v1';

export function anthropic(config: ReviewerConfig, env: Env): Provider {
  const { problem, keyed } = ownKey(env, 'anthropic', OWN_ENDPOINT, 'ANTHROPIC_API_KEY');
  return {
    ready: () => problem,
    async ask(prompt) {
      if (keyed === null) return { failure: 'anthropic has no valid endpoint and key', resend: false };
      const headers = { 'x-api-key': keyed.key, 'anthropic-version': '2023-06-01' };
      const body = {
        model: config.model,
        max_tokens: 8192,
        temperature: config.temperature,
        messages: [{ role: 'user', content: prompt }],
      };
      const posted = await post(`${keyed.url}/messages`, headers, body, config.timeout);
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
