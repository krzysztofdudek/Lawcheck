import type { ReviewerConfig } from '../config.js';
import { post } from './http.js';
import { endpointOf } from './index.js';
import type { Env, Provider } from './index.js';

const OWN_ENDPOINT = 'http://localhost:11434';

export function ollama(config: ReviewerConfig, env: Env): Provider {
  const endpoint = endpointOf(env);
  return {
    ready() {
      return endpoint !== null && 'problem' in endpoint ? endpoint.problem : null;
    },
    async ask(prompt) {
      if (endpoint !== null && 'problem' in endpoint) return { failure: 'LAWCHECK_REVIEWER_ENDPOINT holds no valid address', resend: false };
      const body = {
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        format: 'json',
        options: { temperature: config.temperature },
      };
      const posted = await post(`${endpoint === null ? OWN_ENDPOINT : endpoint.url}/api/chat`, {}, body, config.timeout);
      if ('failure' in posted) return posted;
      const content = (posted.body as { message?: { content?: unknown } } | null)?.message?.content;
      return { answer: typeof content === 'string' ? content : '' };
    },
  };
}
