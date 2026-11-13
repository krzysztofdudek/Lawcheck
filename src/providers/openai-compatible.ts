import type { ReviewerConfig } from '../config.js';
import { post } from './http.js';
import { endpointOf, headerProblem, variable } from './index.js';
import type { Env, Provider } from './index.js';

export function openaiCompatible(config: ReviewerConfig, env: Env): Provider {
  const endpoint = endpointOf(env);
  const key = variable(env, 'LAWCHECK_REVIEWER_KEY');
  return {
    ready() {
      if (endpoint === null) return 'openai-compatible needs the address of its endpoint in LAWCHECK_REVIEWER_ENDPOINT';
      if ('problem' in endpoint) return endpoint.problem;
      return headerProblem('LAWCHECK_REVIEWER_KEY', key);
    },
    async ask(prompt) {
      if (endpoint === null || 'problem' in endpoint) return { failure: 'LAWCHECK_REVIEWER_ENDPOINT holds no valid address', resend: false };
      const headers: Record<string, string> = key === null ? {} : { authorization: `Bearer ${key}` };
      const body = {
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: config.temperature,
        response_format: { type: 'json_object' },
      };
      const posted = await post(`${endpoint.url}/chat/completions`, headers, body, config.timeout);
      if ('failure' in posted) return posted;
      const content = (posted.body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
      return { answer: typeof content === 'string' ? content : '' };
    },
  };
}
