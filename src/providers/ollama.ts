import type { ReviewerConfig } from '../config.js';
import { get, post } from './http.js';
import { ENDPOINT_FIX, endpointOf } from './index.js';
import type { Env } from './index.js';
import type { Provider } from '../provider.js';

const OWN_ENDPOINT = 'http://localhost:11434';
const PROBE_SECONDS = 5;

export function ollama(config: ReviewerConfig, env: Env): Provider {
  const endpoint = endpointOf(env);
  const base = endpoint !== null && 'url' in endpoint ? endpoint.url : OWN_ENDPOINT;
  return {
    keys: [],
    ready() {
      return endpoint !== null && 'problem' in endpoint ? endpoint.problem : null;
    },
    fix: () => ENDPOINT_FIX,
    async probe() {
      const got = await get(`${base}/api/version`, PROBE_SECONDS, base);
      if ('failure' in got) return { problem: got.failure, fix: got.fix };
      if (got.status !== 200) return { problem: `${base}/api/version answered HTTP ${got.status}, so no Ollama server is there`, fix: `set LAWCHECK_REVIEWER_ENDPOINT to the address of the Ollama server` };
      return { at: base };
    },
    async ask(prompt, seconds) {
      if (endpoint !== null && 'problem' in endpoint) return { failure: 'LAWCHECK_REVIEWER_ENDPOINT holds no valid address', resend: false, fix: ENDPOINT_FIX };
      const body = {
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        format: 'json',
        options: { temperature: config.temperature },
      };
      const posted = await post(`${base}/api/chat`, {}, body, config.timeout, { base, keyName: null, seconds });
      if ('failure' in posted) return posted;
      const content = (posted.body as { message?: { content?: unknown } } | null)?.message?.content;
      return { answer: typeof content === 'string' ? content : '' };
    },
  };
}
